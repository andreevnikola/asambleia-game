// Direct DB access for test setup/teardown. The app's data (teams, questions, timers) is preserved:
// it is snapshotted before the run and restored afterwards. Player data is always deleted.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const SNAPSHOT = ".e2e-snapshot.json";

function sql() {
  const url = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

type Snapshot = {
  teams: string[];
  questions: string[];
  settings: { speak: number; pause: number; reveal: number; scroll: number };
};

async function wipe() {
  const s = sql();
  await s.query("DELETE FROM users"); // cascades to assignments
  await s.query("DELETE FROM teams");
  await s.query("DELETE FROM questions");
  await s.query(`UPDATE game SET status = 'prep', stage = 'lobby', q_index = 0, timer_started_at = NULL,
    user_seq = 0, is_simulation = false, speak_seconds = 180, pause_seconds = 7, reveal_seconds = 1,
    scroll_seconds = 3, ver = ver + 1 WHERE id = 1`);
}

export async function restoreSetup() {
  if (!existsSync(SNAPSHOT)) {
    await wipe();
    return;
  }
  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  await wipe();
  const s = sql();
  if (snap.teams.length) {
    await s.query(
      "INSERT INTO teams (name) SELECT name FROM unnest($1::text[]) WITH ORDINALITY AS t(name, o) ORDER BY o",
      [snap.teams],
    );
  }
  if (snap.questions.length) {
    await s.query(
      "INSERT INTO questions (text) SELECT text FROM unnest($1::text[]) WITH ORDINALITY AS t(text, o) ORDER BY o",
      [snap.questions],
    );
  }
  await s.query(
    "UPDATE game SET speak_seconds = $1, pause_seconds = $2, reveal_seconds = $3, scroll_seconds = $4 WHERE id = 1",
    [snap.settings.speak, snap.settings.pause, snap.settings.reveal, snap.settings.scroll],
  );
  unlinkSync(SNAPSHOT);
}

export async function snapshotAndWipe() {
  const s = sql();
  // A crash in a previous run may have left the real setup in the snapshot file: put it back first.
  if (existsSync(SNAPSHOT)) await restoreSetup();

  const [g] = await s.query(
    "SELECT status, speak_seconds, pause_seconds, reveal_seconds, scroll_seconds, (SELECT count(*)::int FROM users) AS users FROM game WHERE id = 1",
  );
  if (!process.env.E2E_FORCE && g.status !== "prep" && g.users > 0) {
    throw new Error(
      `Refusing to run: a game is in progress (status=${g.status}, ${g.users} players). Finish/reset it first, or set E2E_FORCE=1.`,
    );
  }
  const teams = (await s.query("SELECT name FROM teams ORDER BY id")).map((r) => r.name as string);
  const questions = (await s.query("SELECT text FROM questions ORDER BY id")).map((r) => r.text as string);
  const snap: Snapshot = {
    teams,
    questions,
    settings: { speak: g.speak_seconds, pause: g.pause_seconds, reveal: g.reveal_seconds, scroll: g.scroll_seconds },
  };
  writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
  await wipe();
}
