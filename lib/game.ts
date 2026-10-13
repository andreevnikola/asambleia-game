// All database access for the game. State lives in Postgres only (many serverless instances).
import { ERR } from "./copy";
import { isUniqueViolation, retryRead, sql } from "./db";
import { ApiError } from "./http";
import { assignLeaders, cleanName } from "./logic";
import { simulatedNames } from "./simnames";
import type { AdminState, AdvanceAction, JoinResult, PlayerSnapshot, Stage, Status } from "./types";

export const MAX_TEAMS = 30;
export const MAX_QUESTIONS = 30;
export const SIMULATION_PLAYERS = 100;

// ───────────────────────── setup (admin, preparation only) ─────────────────────────

export async function addTeam(rawName: unknown) {
  const name = cleanName(rawName);
  if (!name) throw new ApiError(400, ERR.teamRequired);
  if (name.length > 40) throw new ApiError(400, ERR.teamTooLong);
  const s = sql();
  const [info] = await s`SELECT (SELECT status FROM game WHERE id = 1) AS status,
    (SELECT count(*)::int FROM teams) AS n,
    EXISTS (SELECT 1 FROM teams WHERE lower(name) = lower(${name})) AS dup`;
  if (info.status !== "prep") throw new ApiError(409, ERR.notPrep);
  if (info.dup) throw new ApiError(409, ERR.teamDuplicate);
  if (info.n >= MAX_TEAMS) throw new ApiError(409, ERR.teamLimit);
  const rows = await s`INSERT INTO teams (name) SELECT ${name}
    WHERE (SELECT status FROM game WHERE id = 1) = 'prep' RETURNING id`;
  if (rows.length === 0) throw new ApiError(409, ERR.notPrep);
}

export async function deleteTeam(id: number) {
  const rows = await sql()`DELETE FROM teams WHERE id = ${id}
    AND (SELECT status FROM game WHERE id = 1) = 'prep' RETURNING id`;
  if (rows.length === 0) throw new ApiError(409, ERR.notPrep);
}

export async function addQuestion(rawText: unknown) {
  const text = cleanName(rawText);
  if (!text) throw new ApiError(400, ERR.questionRequired);
  if (text.length > 400) throw new ApiError(400, ERR.questionTooLong);
  const s = sql();
  const [info] = await s`SELECT (SELECT status FROM game WHERE id = 1) AS status,
    (SELECT count(*)::int FROM questions) AS n`;
  if (info.status !== "prep") throw new ApiError(409, ERR.notPrep);
  if (info.n >= MAX_QUESTIONS) throw new ApiError(409, ERR.questionLimit);
  const rows = await s`INSERT INTO questions (text) SELECT ${text}
    WHERE (SELECT status FROM game WHERE id = 1) = 'prep' RETURNING id`;
  if (rows.length === 0) throw new ApiError(409, ERR.notPrep);
}

export async function deleteQuestion(id: number) {
  const rows = await sql()`DELETE FROM questions WHERE id = ${id}
    AND (SELECT status FROM game WHERE id = 1) = 'prep' RETURNING id`;
  if (rows.length === 0) throw new ApiError(409, ERR.notPrep);
}

const RANGES = {
  speakSeconds: [3, 3600],
  pauseSeconds: [1, 120],
  revealSeconds: [1, 10],
  scrollSeconds: [1, 15],
} as const;

/** Partial update: only the provided fields change (so two quick edits can never overwrite each other). */
export async function saveSettings(input: Partial<Record<keyof typeof RANGES, number | null>>) {
  const keys = Object.keys(input) as (keyof typeof RANGES)[];
  if (keys.length === 0) throw new ApiError(400, ERR.badSettings);
  for (const key of keys) {
    const v = input[key];
    const range = RANGES[key];
    if (!range || v === null || v === undefined || v < range[0] || v > range[1]) throw new ApiError(400, ERR.badSettings);
  }
  const rows = await sql()`UPDATE game SET
      speak_seconds = COALESCE(${input.speakSeconds ?? null}::int, speak_seconds),
      pause_seconds = COALESCE(${input.pauseSeconds ?? null}::int, pause_seconds),
      reveal_seconds = COALESCE(${input.revealSeconds ?? null}::int, reveal_seconds),
      scroll_seconds = COALESCE(${input.scrollSeconds ?? null}::int, scroll_seconds)
    WHERE id = 1 AND status = 'prep' RETURNING id`;
  if (rows.length === 0) throw new ApiError(409, ERR.notPrep);
}

// ───────────────────────── players ─────────────────────────

type NewUser = {
  id: number;
  code: number;
  name: string;
  team_id: number;
  team: string;
  game_id: number;
  assigned: boolean;
  questions: { id: number; text: string }[] | null;
};

/**
 * Creates players atomically. One statement: bumps user_seq (row lock serialises concurrent
 * sign-ups, so round-robin stays exact), picks random free 3-digit codes and inserts.
 * A unique violation (two statements picked the same free code) rolls the whole statement
 * back, including the seq bump, and we simply retry.
 * The same statement returns everything the new player's screen needs (team name, game id and,
 * on request, the question list), so a sign-up is one request and one SQL statement.
 */
export async function createUsers(names: string[], withQuestions = false): Promise<NewUser[]> {
  const s = sql();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const rows = (await s.query(
        `WITH g AS (
           UPDATE game SET user_seq = user_seq + $2::int
           WHERE id = 1 AND status = 'live'
           RETURNING user_seq - $2::int AS base
         ),
         tm AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS idx FROM teams),
         cnt AS (SELECT count(*)::int AS n FROM teams),
         free AS (
           SELECT c, row_number() OVER () AS ord FROM (
             SELECT c FROM generate_series(100, 999) AS c
             WHERE c NOT IN (SELECT code FROM users)
             ORDER BY random() LIMIT $2::int
           ) f
         ),
         nm AS (SELECT name, ord FROM unnest($1::text[]) WITH ORDINALITY AS t(name, ord)),
         ins AS (
           INSERT INTO users (code, name, team_id)
           SELECT free.c, nm.name, tm.id
           FROM nm
           JOIN free ON free.ord = nm.ord
           JOIN g ON true
           JOIN cnt ON cnt.n > 0
           JOIN tm ON tm.idx = (g.base + nm.ord - 1) % cnt.n
           RETURNING id, code, name, team_id
         )
         SELECT ins.id, ins.code, ins.name, ins.team_id, t.name AS team,
           (SELECT game_id FROM game WHERE id = 1) AS game_id,
           EXISTS (SELECT 1 FROM assignments) AS assigned,
           CASE WHEN $3::boolean THEN (
             SELECT coalesce(json_agg(json_build_object('id', q.id, 'text', q.text) ORDER BY q.id), '[]'::json)
             FROM questions q
           ) END AS questions
         FROM ins JOIN teams t ON t.id = ins.team_id`,
        [names, names.length, withQuestions],
      )) as NewUser[];
      if (rows.length === 0) {
        const [g] = await s`SELECT status FROM game WHERE id = 1`;
        throw new ApiError(409, g.status === "live" ? ERR.codesExhausted : ERR.noGame);
      }
      return rows;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 60));
    }
  }
  throw new ApiError(503, ERR.generic);
}

/** One request, one statement: the response already holds the player's whole home screen. */
export async function joinPlayer(rawName: unknown): Promise<JoinResult> {
  const name = cleanName(rawName);
  if (!name) throw new ApiError(400, ERR.nameRequired);
  if (name.length > 30) throw new ApiError(400, ERR.nameTooLong);
  const [u] = await createUsers([name], true);
  return {
    code: u.code,
    gameId: u.game_id,
    snapshot: {
      live: true,
      gameId: u.game_id,
      user: { name: u.name, code: u.code, team: u.team },
      questions: (u.questions ?? []).map((q, i) => ({ id: q.id, n: i + 1, text: q.text })),
      leader: null,
      // A late joiner is never a leader: the draw only covers the players who were there when it ran.
      phase: { assigned: u.assigned, leader: false },
      feed: null,
    },
  };
}

export function parseCode(raw: unknown): number {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{3}$/.test(s)) throw new ApiError(400, ERR.codeInvalid);
  return Number(s);
}

export async function loginPlayer(rawCode: unknown) {
  const code = parseCode(rawCode);
  const [row] = await sql()`SELECT g.status, g.game_id, u.id AS user_id
    FROM game g LEFT JOIN users u ON u.code = ${code} WHERE g.id = 1`;
  if (row.status !== "live") throw new ApiError(409, ERR.noGame);
  if (!row.user_id) throw new ApiError(404, ERR.codeUnknown);
  return { code, gameId: row.game_id as number };
}

export async function playerSnapshot(code: number, gameId: number | null): Promise<PlayerSnapshot> {
  return retryRead(async () => {
    const s = sql();
    const [gameRows, userRows, questionRows] = await s.transaction([
      s`SELECT status, game_id, stage, q_index, speak_seconds,
          (extract(epoch FROM timer_started_at) * 1000)::float8 AS ts,
          (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now,
          EXISTS (SELECT 1 FROM assignments) AS assigned
        FROM game WHERE id = 1`,
      s`SELECT u.name, u.code, t.name AS team, a.id AS aid, a.slot, a.revealed_at IS NOT NULL AS revealed,
          q.id AS qid, q.text AS qtext
        FROM users u
        JOIN teams t ON t.id = u.team_id
        LEFT JOIN assignments a ON a.user_id = u.id
        LEFT JOIN questions q ON q.id = a.question_id
        WHERE u.code = ${code}`,
      s`SELECT id, text FROM questions ORDER BY id`,
    ]);
    const g = gameRows[0];
    if (g.status !== "live") return { live: false };
    const u = userRows[0];
    if (!u || gameId !== g.game_id) return { live: true, gameId: g.game_id, user: null };
    const questions = questionRows.map((q, i) => ({ id: q.id as number, n: i + 1, text: q.text as string }));
    // The question and team of a leader stay hidden until the admin screen reveals them; whether a
    // draw exists for this player is only a yes/no (it tells the phone to open the live feed).
    const leader =
      u.aid && u.revealed
        ? {
            assignmentId: u.aid as number,
            n: questions.findIndex((q) => q.id === u.qid) + 1,
            text: u.qtext as string,
            team: u.team as string,
            slot: u.slot as number,
          }
        : null;
    return {
      live: true,
      gameId: g.game_id,
      user: { name: u.name, code: u.code, team: u.team },
      questions,
      leader,
      phase: { assigned: g.assigned as boolean, leader: !!u.aid },
      feed: u.aid
        ? {
            stage: g.stage as Stage,
            qIndex: g.q_index as number,
            questionCount: questions.length,
            timerStartedAt: (g.ts as number | null) ?? null,
            speakSeconds: g.speak_seconds as number,
            serverNow: g.now as number,
          }
        : null,
    };
  });
}

/** True for a joined player who has a draw (revealed or not): the only players that get a live feed. */
export function isLeaderSnapshot(snap: PlayerSnapshot): boolean {
  return snap.live && snap.user !== null && snap.phase.leader;
}

/** The leader's phone checked in (feed opened, heartbeat, backup poll). Best effort: never breaks a response. */
export async function touchLeader(code: number): Promise<void> {
  try {
    await sql()`UPDATE assignments SET seen_at = now() WHERE user_id = (SELECT id FROM users WHERE code = ${code})`;
  } catch (err) {
    console.warn("[touchLeader]", err);
  }
}

/**
 * Cheap change detector for the leader feed: one tiny query. It must cover everything the snapshot
 * shows: the game's stage/question/timer move without touching `game.ver`.
 */
export async function playerVersion(code: number, gameId: number | null): Promise<string> {
  return retryRead(async () => {
    const [r] = await sql()`SELECT g.status, g.game_id, g.ver AS gver, g.stage, g.q_index,
        (extract(epoch FROM g.timer_started_at) * 1000)::bigint AS ts,
        u.ver AS uver, a.id AS aid, a.revealed_at IS NOT NULL AS rev,
        EXISTS (SELECT 1 FROM assignments) AS assigned
      FROM game g
      LEFT JOIN users u ON u.code = ${code} AND g.game_id = ${gameId}
      LEFT JOIN assignments a ON a.user_id = u.id
      WHERE g.id = 1`;
    return [r.status, r.game_id, r.gver, r.stage, r.q_index, r.ts ?? "-", r.uver ?? "x", r.aid ?? "-", r.rev ?? "-", r.assigned].join(":");
  });
}

// ───────────────────────── game lifecycle (admin) ─────────────────────────

export async function startGame(simulate: boolean) {
  const s = sql();
  const [c] = await s`SELECT (SELECT status FROM game WHERE id = 1) AS status,
    (SELECT count(*)::int FROM teams) AS teams, (SELECT count(*)::int FROM questions) AS questions`;
  if (c.status !== "prep") throw new ApiError(409, ERR.alreadyStarted);
  if (c.teams < 1) throw new ApiError(400, ERR.needTeams);
  if (c.questions < 1) throw new ApiError(400, ERR.needQuestions);
  if (c.teams < c.questions) throw new ApiError(400, ERR.teamsLessThanQuestions);
  const rows = await s`UPDATE game SET status = 'live', stage = 'lobby', q_index = 0, timer_started_at = NULL,
    game_id = game_id + 1, user_seq = 0, is_simulation = ${simulate}, ver = ver + 1
    WHERE id = 1 AND status = 'prep' RETURNING game_id`;
  if (rows.length === 0) throw new ApiError(409, ERR.alreadyStarted);
  if (simulate) await createUsers(simulatedNames(SIMULATION_PLAYERS));
}

/** Aborts a live/finished game: deletes all player data, keeps teams/questions/settings. */
export async function resetGame() {
  await sql()`WITH r AS (
      UPDATE game SET status = 'prep', stage = 'lobby', q_index = 0, timer_started_at = NULL,
        user_seq = 0, is_simulation = false, ver = ver + 1
      WHERE id = 1 AND status IN ('live', 'finished') RETURNING 1
    ), du AS (DELETE FROM users WHERE EXISTS (SELECT 1 FROM r) RETURNING 1)
    SELECT count(*)::int AS n FROM r`;
}

// ───────────────────────── live game (admin) ─────────────────────────

export async function moveUser(userId: number, teamId: number) {
  const s = sql();
  const [u] = await s`SELECT u.team_id, EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id) AS leader
    FROM users u WHERE u.id = ${userId}`;
  if (!u) throw new ApiError(404, ERR.notFound);
  if (u.leader) throw new ApiError(409, ERR.leaderLocked);
  if (u.team_id === teamId) return;
  const rows = await s`UPDATE users SET team_id = ${teamId}, ver = ver + 1
    WHERE id = ${userId} AND EXISTS (SELECT 1 FROM teams WHERE id = ${teamId})
      AND NOT EXISTS (SELECT 1 FROM assignments WHERE user_id = ${userId})
      AND (SELECT status FROM game WHERE id = 1) = 'live'
    RETURNING id`;
  if (rows.length === 0) throw new ApiError(409, ERR.stale);
}

/**
 * Step 1 of the leader flow: draw the leaders and store the draw. The stage stays "lobby" (nobody sees
 * anything yet; phones only learn that a draw exists). Step 2, `start-picking`, opens the projector show.
 * Atomic: every assignment or none. The UNIQUE team/user columns make a second concurrent draw fail.
 */
export async function assignAllLeaders() {
  const s = sql();
  const [teamRows, userRows, questionRows, gameRows, existing] = await s.transaction([
    s`SELECT id FROM teams ORDER BY id`,
    s`SELECT id, team_id FROM users ORDER BY id`,
    s`SELECT id FROM questions ORDER BY id`,
    s`SELECT status, stage FROM game WHERE id = 1`,
    s`SELECT count(*)::int AS n FROM assignments`,
  ]);
  const g = gameRows[0];
  if (g.status !== "live" || g.stage !== "lobby") throw new ApiError(409, ERR.notLive);
  if (existing[0].n > 0) throw new ApiError(409, ERR.alreadyAssigned);
  const teams = teamRows.map((t) => ({
    id: t.id as number,
    members: userRows.filter((u) => u.team_id === t.id).map((u) => ({ id: u.id as number })),
  }));
  const questionIds = questionRows.map((q) => q.id as number);
  if (teams.filter((t) => t.members.length > 0).length < questionIds.length) {
    throw new ApiError(409, ERR.notEnoughEligible);
  }
  const draw = assignLeaders(teams, questionIds);
  try {
    // A leader who was moved to another team after the read above would make the draw wrong: the join
    // on users drops that row, the count check below turns it into "stale" and nothing is stored.
    const rows = await s.query(
      `INSERT INTO assignments (question_id, team_id, user_id, slot)
       SELECT d.question_id, d.team_id, d.user_id, d.slot
       FROM unnest($1::int[], $2::int[], $3::int[], $4::int[]) AS d(question_id, team_id, user_id, slot)
       JOIN users u ON u.id = d.user_id AND u.team_id = d.team_id
       WHERE (SELECT status FROM game WHERE id = 1) = 'live'
         AND (SELECT stage FROM game WHERE id = 1) = 'lobby'
       RETURNING id`,
      [draw.map((d) => d.questionId), draw.map((d) => d.teamId), draw.map((d) => d.userId), draw.map((d) => d.slot)],
    );
    if (rows.length !== draw.length) throw new ApiError(409, ERR.stale);
  } catch (err) {
    // Another click drew first: its rows hold the UNIQUE team/user slots.
    if (isUniqueViolation(err)) throw new ApiError(409, ERR.alreadyAssigned);
    throw err;
  }
}

/** Admin screen revealed a slot: from now on that player may see their assignment. Idempotent. */
export async function revealAssignment(assignmentId: number) {
  await sql()`WITH a AS (
      UPDATE assignments SET revealed_at = now()
      WHERE id = ${assignmentId} AND revealed_at IS NULL
        AND (SELECT stage FROM game WHERE id = 1) = 'picking'
      RETURNING user_id
    )
    UPDATE users SET ver = ver + 1 WHERE id IN (SELECT user_id FROM a)`;
}

export async function advance(action: AdvanceAction, qIndex: number | null) {
  const s = sql();
  let ok = false;
  switch (action) {
    case "start-picking": {
      // Step 2: open the projector show. Only possible once the draw is stored.
      const rows = await s`UPDATE game SET stage = 'picking', q_index = 0
        WHERE id = 1 AND status = 'live' AND stage = 'lobby'
          AND EXISTS (SELECT 1 FROM assignments) RETURNING id`;
      ok = rows.length === 1;
      if (!ok) {
        const [c] = await s`SELECT EXISTS (SELECT 1 FROM assignments) AS assigned`;
        if (!c.assigned) throw new ApiError(409, ERR.notAssigned);
      }
      break;
    }
    case "unassign": {
      // Throw the stored draw away (before the show) so it can be made again.
      const rows = await s`WITH st AS (
          SELECT 1 FROM game WHERE id = 1 AND status = 'live' AND stage = 'lobby'
        ), da AS (DELETE FROM assignments WHERE EXISTS (SELECT 1 FROM st) RETURNING 1)
        SELECT count(*)::int AS n FROM da`;
      ok = rows[0].n > 0;
      break;
    }
    case "next-pick": {
      if (qIndex === null) throw new ApiError(400, ERR.badJson);
      const rows = await s`UPDATE game SET
          stage = CASE WHEN q_index + 1 < (SELECT count(*) FROM questions) THEN 'picking' ELSE 'results' END,
          q_index = CASE WHEN q_index + 1 < (SELECT count(*) FROM questions) THEN q_index + 1 ELSE 0 END
        WHERE id = 1 AND status = 'live' AND stage = 'picking' AND q_index = ${qIndex}
          AND NOT EXISTS (
            SELECT 1 FROM assignments a
            WHERE a.revealed_at IS NULL
              AND a.question_id = (SELECT id FROM questions ORDER BY id OFFSET ${qIndex} LIMIT 1)
          )
        RETURNING id`;
      ok = rows.length === 1;
      break;
    }
    case "start-presentation": {
      const rows = await s`UPDATE game SET stage = 'presenting', q_index = 0, timer_started_at = now()
        WHERE id = 1 AND status = 'live' AND stage = 'results' RETURNING id`;
      ok = rows.length === 1;
      break;
    }
    case "stop-presentation": {
      // Back to the lobby board: the draw is thrown away (a new one can be made), while players,
      // teams, questions and settings stay. `ver` is bumped so every phone drops its leader notice.
      const rows = await s`WITH st AS (
          UPDATE game SET stage = 'lobby', q_index = 0, timer_started_at = NULL, ver = ver + 1
          WHERE id = 1 AND status = 'live' AND stage IN ('picking', 'results', 'presenting') RETURNING 1
        ), da AS (DELETE FROM assignments WHERE EXISTS (SELECT 1 FROM st) RETURNING 1)
        SELECT count(*)::int AS n FROM st`;
      ok = rows[0].n === 1;
      break;
    }
    case "next": {
      if (qIndex === null) throw new ApiError(400, ERR.badJson);
      const rows = await s`UPDATE game SET q_index = q_index + 1, timer_started_at = now()
        WHERE id = 1 AND status = 'live' AND stage = 'presenting' AND q_index = ${qIndex}
          AND q_index + 1 < (SELECT count(*) FROM questions) RETURNING id`;
      if (rows.length === 1) {
        ok = true;
        break;
      }
      // Last question: finish and delete all player data in the same statement.
      const fin = await s`WITH fin AS (
          UPDATE game SET status = 'finished', stage = 'finished', timer_started_at = NULL, user_seq = 0, ver = ver + 1
          WHERE id = 1 AND status = 'live' AND stage = 'presenting' AND q_index = ${qIndex}
            AND q_index + 1 >= (SELECT count(*) FROM questions)
          RETURNING 1
        ), du AS (DELETE FROM users WHERE EXISTS (SELECT 1 FROM fin) RETURNING 1)
        SELECT count(*)::int AS n FROM fin`;
      ok = fin[0].n === 1;
      break;
    }
    case "new-game": {
      const rows = await s`UPDATE game SET status = 'prep', stage = 'lobby', q_index = 0, timer_started_at = NULL,
          is_simulation = false, ver = ver + 1
        WHERE id = 1 AND status = 'finished' RETURNING id`;
      ok = rows.length === 1;
      break;
    }
    case "reset":
      await resetGame();
      return;
  }
  if (!ok) throw new ApiError(409, ERR.stale);
}

// ───────────────────────── admin snapshot ─────────────────────────

export async function adminState(): Promise<AdminState> {
  return retryRead(async () => {
    const s = sql();
    const [gameRows, teamRows, questionRows, userRows, assignRows] = await s.transaction([
      s`SELECT status, stage, q_index, speak_seconds, pause_seconds, reveal_seconds, scroll_seconds,
          is_simulation, game_id, (extract(epoch FROM timer_started_at) * 1000)::float8 AS ts,
          (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now FROM game WHERE id = 1`,
      s`SELECT id, name FROM teams ORDER BY id`,
      s`SELECT id, text FROM questions ORDER BY id`,
      s`SELECT id, name, code, team_id FROM users ORDER BY id`,
      s`SELECT id, question_id, team_id, user_id, slot, revealed_at IS NOT NULL AS revealed,
          (seen_at IS NOT NULL AND seen_at > clock_timestamp() - interval '60 seconds') AS connected
        FROM assignments ORDER BY question_id, slot`,
    ]);
    const g = gameRows[0];
    const leaders = new Set(assignRows.map((a) => a.user_id as number));
    const teams = teamRows.map((t) => ({
      id: t.id as number,
      name: t.name as string,
      members: userRows
        .filter((u) => u.team_id === t.id)
        .map((u) => ({ id: u.id as number, name: u.name as string, code: u.code as number, isLeader: leaders.has(u.id) })),
    }));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const userById = new Map(userRows.map((u) => [u.id as number, u]));
    return {
      serverNow: g.now as number,
      game: {
        status: g.status as Status,
        stage: g.stage as Stage,
        qIndex: g.q_index as number,
        timerStartedAt: (g.ts as number | null) ?? null,
        speakSeconds: g.speak_seconds as number,
        pauseSeconds: g.pause_seconds as number,
        revealSeconds: g.reveal_seconds as number,
        scrollSeconds: g.scroll_seconds as number,
        isSimulation: g.is_simulation as boolean,
        gameId: g.game_id as number,
      },
      teams,
      questions: questionRows.map((q) => ({ id: q.id as number, text: q.text as string })),
      assignments: assignRows.map((a) => ({
        id: a.id as number,
        questionId: a.question_id as number,
        teamId: a.team_id as number,
        teamName: teamName.get(a.team_id) ?? "",
        userId: a.user_id as number,
        userName: (userById.get(a.user_id)?.name as string) ?? "",
        userCode: (userById.get(a.user_id)?.code as number) ?? 0,
        slot: a.slot as number,
        revealed: a.revealed as boolean,
        connected: a.connected as boolean,
      })),
      playerCount: userRows.length,
    };
  });
}

export async function isGameLive(): Promise<boolean> {
  return retryRead(async () => {
    const [g] = await sql()`SELECT status FROM game WHERE id = 1`;
    return g.status === "live";
  });
}
