import { expect, test } from "@playwright/test";
import { Admin, Stream, headers, join, sleep } from "./helpers";

const external = !!process.env.BASE_URL;

test.describe.configure({ mode: "serial" });

test.describe("API: access and input safety", () => {
  test("every admin endpoint rejects a missing or wrong key", async ({ request }) => {
    const calls: [string, string, unknown?][] = [
      ["GET", "state"],
      ["POST", "auth"],
      ["POST", "teams", { name: "x" }],
      ["DELETE", "teams", { id: 1 }],
      ["POST", "questions", { text: "x" }],
      ["DELETE", "questions", { id: 1 }],
      ["PUT", "settings", { speakSeconds: 10, pauseSeconds: 1, revealSeconds: 1, scrollSeconds: 1 }],
      ["POST", "start", {}],
      ["POST", "move", { userId: 1, teamId: 1 }],
      ["POST", "assign"],
      ["POST", "reveal", { assignmentId: 1 }],
      ["POST", "advance", { action: "reset" }],
    ];
    for (const [method, path, data] of calls) {
      for (const h of [
        {} as Record<string, string>,
        { "x-admin-key": "wrong" },
        { "x-admin-key": "" },
        { "x-admin-key": encodeURIComponent("грешен-ключ") },
        { "x-admin-key": "%E0%A4%A" }, // broken encoding must not crash
      ]) {
        const res = await request.fetch(`/api/admin/${path}`, { method, data: data ?? {}, headers: h });
        expect(res.status(), `${method} ${path} ${JSON.stringify(h)}`).toBe(401);
      }
    }
  });

  test("the right key is accepted", async ({ request }) => {
    const res = await request.post("/api/admin/auth", { headers: headers(), data: {} });
    expect(res.status()).toBe(200);
  });

  test("no game: join/login are refused politely, /api/me says not live", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B"], questions: ["Q1"] });
    expect((await join(request, "Иван")).status).toBe(409);
    expect((await request.post("/api/login", { data: { code: "123" } })).status()).toBe(409);
    expect(await (await request.get("/api/me")).json()).toEqual({ live: false });
    expect(await (await request.get("/api/me?code=123&gid=1")).json()).toEqual({ live: false });
  });

  test("bad input never causes a 5xx", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B"], questions: ["Q1"] });
    await admin.ok("start");
    const bad = async (path: string, data: unknown, expected: number[]) => {
      const res = await request.post(path, { data });
      expect(expected, `${path} ${JSON.stringify(data)} -> ${res.status()}`).toContain(res.status());
    };
    await bad("/api/join", {}, [400]);
    await bad("/api/join", { name: "" }, [400]);
    await bad("/api/join", { name: "   \n\t " }, [400]);
    await bad("/api/join", { name: 123 }, [400]);
    await bad("/api/join", { name: "x".repeat(31) }, [400]);
    await bad("/api/join", [], [400]);
    await bad("/api/login", {}, [400]);
    await bad("/api/login", { code: "abc" }, [400]);
    await bad("/api/login", { code: "12" }, [400]);
    await bad("/api/login", { code: "1234" }, [400]);
    await bad("/api/login", { code: "'; DROP TABLE users;--" }, [400]);
    await bad("/api/login", { code: "000" }, [404]);
    const raw = await request.post("/api/join", { data: "not json{", headers: { "content-type": "application/json" } });
    expect(raw.status()).toBe(400);
    expect((await request.get("/api/stream?code=abc")).status()).toBe(400);
    expect((await request.get("/api/me?code=zz")).status()).toBe(400);

    const sneaky = await join(request, "Robert'); DROP TABLE users;--");
    expect(sneaky.status).toBe(200);
    const xss = await join(request, "<script>alert(1)</script>");
    expect(xss.status).toBe(200);
    expect((await admin.state()).playerCount).toBe(2);

    const a = (path: string, data: unknown) => admin.post(path, data);
    expect((await a("teams", { name: "A" })).status()).toBe(409); // not in prep
    expect((await a("move", { userId: "x", teamId: 1 })).status()).toBe(400);
    expect((await a("move", { userId: 999999, teamId: 1 })).status()).toBe(404);
    expect((await a("reveal", { assignmentId: "x" })).status()).toBe(400);
    expect((await a("advance", { action: "explode" })).status()).toBe(400);
    expect((await a("advance", { action: "next-pick" })).status()).toBe(400);
    expect((await a("advance", { action: "next-pick", qIndex: 0 })).status()).toBe(409);
    expect((await a("start", {})).status()).toBe(409);
    await admin.post("advance", { action: "reset" });
  });

  test("setup validation: duplicates, limits, settings ranges, teams >= questions", async ({ request }) => {
    const admin = new Admin(request);
    await admin.clean();
    expect((await admin.post("teams", { name: "  " })).status()).toBe(400);
    expect((await admin.post("teams", { name: "x".repeat(41) })).status()).toBe(400);
    expect((await admin.post("teams", { name: "Червени" })).status()).toBe(200);
    expect((await admin.post("teams", { name: "  червени " })).status()).toBe(409);
    expect((await admin.post("questions", { text: "" })).status()).toBe(400);
    expect((await admin.post("questions", { text: "y".repeat(401) })).status()).toBe(400);
    expect((await admin.post("questions", { text: "y".repeat(400) })).status()).toBe(200);
    expect((await admin.post("questions", { text: "Втори" })).status()).toBe(200);
    // 1 team < 2 questions
    expect((await admin.post("start")).status()).toBe(400);
    const put = (d: Record<string, unknown>) =>
      request.put("/api/admin/settings", { headers: headers(), data: d });
    const ok = { speakSeconds: 180, pauseSeconds: 7, revealSeconds: 1, scrollSeconds: 3 };
    expect((await put({ ...ok, speakSeconds: 2 })).status()).toBe(400);
    expect((await put({ ...ok, speakSeconds: 3601 })).status()).toBe(400);
    expect((await put({ ...ok, pauseSeconds: 0 })).status()).toBe(400);
    expect((await put({ ...ok, revealSeconds: "x" })).status()).toBe(400);
    expect((await put({ ...ok, scrollSeconds: 1.5 })).status()).toBe(400);
    expect((await put({})).status()).toBe(400); // nothing to change
    expect((await put({ speakSeconds: null })).status()).toBe(400);
    expect((await put(ok)).status()).toBe(200);
    // partial updates change only what was sent
    expect((await put({ speakSeconds: 10 })).status()).toBe(200);
    expect((await put({ pauseSeconds: 9 })).status()).toBe(200);
    const st = await admin.state();
    expect(st.game).toMatchObject({ speakSeconds: 10, pauseSeconds: 9, revealSeconds: 1, scrollSeconds: 3 });
    expect((await put(ok)).status()).toBe(200);
    await admin.clean();
    expect((await admin.post("start")).status()).toBe(400); // nothing at all
  });
});

test.describe("API: concurrency and load (100 players)", () => {
  test("100 simultaneous sign-ups: unique 3-digit codes, perfectly balanced teams", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["Червени", "Сини", "Зелени", "Жълти"], questions: ["В1", "В2"] });
    await admin.ok("start");

    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => join(request, `Играч ${i + 1}`)));
    expect(results.filter((r) => r.status !== 200).map((r) => r.status)).toEqual([]);
    const codes = results.map((r) => r.body.code as number);
    expect(new Set(codes).size).toBe(100);
    for (const c of codes) expect(c).toBeGreaterThanOrEqual(100), expect(c).toBeLessThanOrEqual(999);

    const s = await admin.state();
    expect(s.playerCount).toBe(100);
    expect(s.teams.map((t) => t.members.length)).toEqual([25, 25, 25, 25]);
    // round-robin by sign-up order, no matter how the requests interleaved
    const sizes = s.teams.map((t) => t.members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBe(0);
    await admin.post("advance", { action: "reset" });
  });

  test("uneven round-robin: 10 players into 3 teams -> 4/3/3", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B", "C"], questions: ["Q"] });
    await admin.ok("start");
    for (let i = 0; i < 10; i++) expect((await join(request, `P${i}`)).status).toBe(200);
    const s = await admin.state();
    expect(s.teams.map((t) => t.members.length)).toEqual([4, 3, 3]);
    // sequential sign-ups go to teams in order: first player -> first team
    expect(s.teams[0].members[0].name).toBe("P0");
    expect(s.teams[1].members[0].name).toBe("P1");
    expect(s.teams[0].members[1].name).toBe("P3");
    await admin.post("advance", { action: "reset" });
  });

  test("login: right code works from anywhere, wrong code and stale game id do not", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B"], questions: ["Q"] });
    await admin.ok("start");
    const me = await join(request, "Мария");
    const login = await request.post("/api/login", { data: { code: String(me.body.code) } });
    expect(login.status()).toBe(200);
    expect(await login.json()).toEqual({ code: me.body.code, gameId: me.body.gameId });
    const snap = await (await request.get(`/api/me?code=${me.body.code}&gid=${me.body.gameId}`)).json();
    expect(snap.user.name).toBe("Мария");
    expect(snap.questions).toHaveLength(1);
    const stale = await (await request.get(`/api/me?code=${me.body.code}&gid=${me.body.gameId + 1}`)).json();
    expect(stale.user).toBeNull();
    await admin.post("advance", { action: "reset" });
    // after a reset the same code is gone
    expect((await request.get(`/api/me?code=${me.body.code}&gid=${me.body.gameId}`)).status()).toBe(200);
    expect(await (await request.get(`/api/me?code=${me.body.code}&gid=${me.body.gameId}`)).json()).toEqual({ live: false });
  });

  test("100 live SSE streams: everyone gets a snapshot; a reveal reaches only its leader", async ({ request, baseURL }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["Червени", "Сини", "Зелени", "Жълти"], questions: ["В1", "В2"] });
    await admin.ok("start");
    const joined = await Promise.all(Array.from({ length: 100 }, (_, i) => join(request, `Играч ${i + 1}`)));
    const gid = joined[0].body.gameId as number;

    const streams = await Promise.all(joined.map((j) => new Stream(baseURL!, j.body.code, gid).open()));
    try {
      const t0 = Date.now();
      await Promise.all(streams.map((s) => s.waitFor((d) => d.live && d.user, 15_000)));
      const connectMs = Date.now() - t0;
      console.log(`  100 streams connected and delivered a snapshot in ${connectMs} ms`);
      for (const s of streams) {
        expect(s.last.user.code).toBe(s.code);
        expect(s.last.leader).toBeNull();
        expect(s.last.questions).toHaveLength(2);
      }

      await admin.ok("assign");
      const st = await admin.state();
      expect(st.assignments).toHaveLength(4);
      // before any reveal nobody knows anything
      await sleep(1800);
      for (const s of streams) expect(s.last.leader).toBeNull();

      const target = st.assignments[0];
      const mark = Date.now();
      await admin.ok("reveal", { assignmentId: target.id });
      const hit = streams.find((s) => s.code === target.userCode)!;
      await hit.waitFor((d) => d.leader !== null, 8_000);
      console.log(`  reveal -> leader's stream updated in ${Date.now() - mark} ms`);
      expect(hit.last.leader.n).toBe(st.questions.findIndex((q) => q.id === target.questionId) + 1);
      expect(hit.last.leader.team).toBe(target.teamName);

      await sleep(1800);
      for (const s of streams) {
        if (s !== hit) expect(s.last.leader, `player ${s.code} must not be notified`).toBeNull();
      }
    } finally {
      streams.forEach((s) => s.close());
      await admin.post("advance", { action: "reset" });
    }
  });

  test("a moved player is told live about the new team", async ({ request, baseURL }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["Алфа", "Бета"], questions: ["В1"] });
    await admin.ok("start");
    const me = await join(request, "Петър");
    const stream = await new Stream(baseURL!, me.body.code, me.body.gameId).open();
    try {
      await stream.waitFor((d) => d.user?.team === "Алфа");
      const s = await admin.state();
      const beta = s.teams.find((t) => t.name === "Бета")!;
      const user = s.teams[0].members[0];
      await admin.ok("move", { userId: user.id, teamId: beta.id });
      await stream.waitFor((d) => d.user?.team === "Бета", 8_000);
    } finally {
      stream.close();
      await admin.post("advance", { action: "reset" });
    }
  });

  test("streams close themselves and a reconnect still sees the state (nothing can be missed)", async ({ request, baseURL }) => {
    test.skip(external, "needs the short SSE_MAX_MS of the local test server");
    const admin = new Admin(request);
    await admin.setup({ teams: ["А", "Б"], questions: ["В1"] });
    await admin.ok("start");
    const joined = await Promise.all([join(request, "Един"), join(request, "Два")]);
    const gid = joined[0].body.gameId as number;
    await admin.ok("assign");
    const st = await admin.state();
    const first = new Stream(baseURL!, joined[0].body.code, gid);
    await first.open();
    await first.waitFor((d) => d.user);
    // reveal while the stream is about to end; whoever it was, a new stream must show the truth
    const a = st.assignments.find((x) => x.userCode === joined[0].body.code) ?? st.assignments[0];
    await admin.ok("reveal", { assignmentId: a.id });
    const end = Date.now() + 12_000;
    while (!first.closed && Date.now() < end) await sleep(100);
    expect(first.closed, "stream should end by itself (SSE_MAX_MS)").toBe(true);

    const second = new Stream(baseURL!, a.userCode, gid);
    await second.open();
    try {
      const snap = await second.waitFor((d) => d.user);
      expect(snap.data.leader).not.toBeNull();
      expect(snap.data.leader.assignmentId).toBe(a.id);
    } finally {
      second.close();
      await admin.post("advance", { action: "reset" });
    }
  });

  test("double clicks and parallel admin tabs cannot corrupt the game", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B", "C"], questions: ["Q1", "Q2"], pause: 1 });

    // start twice at once: exactly one wins
    const starts = await Promise.all([admin.post("start"), admin.post("start"), admin.post("start")]);
    expect(starts.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    await Promise.all(Array.from({ length: 12 }, (_, i) => join(request, `P${i}`)));

    // assign three times at once: exactly one wins, and there are exactly 3 assignments
    const assigns = await Promise.all([admin.post("assign"), admin.post("assign"), admin.post("assign")]);
    expect(assigns.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    let s = await admin.state();
    expect(s.assignments).toHaveLength(3);
    expect(s.game.stage).toBe("picking");

    // can't skip a question while someone is unrevealed
    expect((await admin.advance("next-pick", 0)).status()).toBe(409);
    // reveal everyone in Q1 twice (idempotent), then advance 3x in parallel: moves exactly one step
    const q1 = s.assignments.filter((a) => a.questionId === s.questions[0].id);
    await Promise.all([...q1, ...q1].map((a) => admin.post("reveal", { assignmentId: a.id })));
    const adv = await Promise.all([1, 2, 3].map(() => admin.advance("next-pick", 0)));
    expect(adv.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    s = await admin.state();
    expect(s.game.qIndex).toBe(1);
    expect(s.game.stage).toBe("picking");

    // leaders are locked
    const leader = s.assignments[0];
    const other = s.teams.find((t) => t.id !== leader.teamId)!;
    expect((await admin.post("move", { userId: leader.userId, teamId: other.id })).status()).toBe(409);

    // the rest of the show
    const q2 = s.assignments.filter((a) => a.questionId === s.questions[1].id);
    for (const a of q2) await admin.ok("reveal", { assignmentId: a.id });
    expect((await admin.advance("next-pick", 1)).status()).toBe(200);
    s = await admin.state();
    expect(s.game.stage).toBe("results");
    expect((await Promise.all([admin.advance("start-presentation"), admin.advance("start-presentation")])).map((r) => r.status()).sort()).toEqual([200, 409]);
    expect((await Promise.all([admin.advance("next", 0), admin.advance("next", 0)])).map((r) => r.status()).sort()).toEqual([200, 409]);
    s = await admin.state();
    expect(s.game).toMatchObject({ stage: "presenting", qIndex: 1 });
    // last question: finish deletes all player data, once
    expect((await Promise.all([admin.advance("next", 1), admin.advance("next", 1)])).map((r) => r.status()).sort()).toEqual([200, 409]);
    s = await admin.state();
    expect(s.game.status).toBe("finished");
    expect(s.playerCount).toBe(0);
    expect(s.assignments).toHaveLength(0);
    expect(s.teams).toHaveLength(3); // setup survives
    expect(s.questions).toHaveLength(2);
    expect((await join(request, "Късно")).status).toBe(409);
    expect((await admin.advance("new-game")).status()).toBe(200);
    expect((await admin.state()).game.status).toBe("prep");
  });

  test("stop-presentation: back to the lobby from every projector stage, leaders cancelled, players kept", async ({ request, baseURL }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B", "C"], questions: ["Q1", "Q2"], pause: 1, speak: 60 });
    // nothing to stop outside the projector screens
    expect((await admin.advance("stop-presentation")).status()).toBe(409);
    await admin.ok("start");
    expect((await admin.advance("stop-presentation")).status()).toBe(409); // lobby
    const joined = await Promise.all(Array.from({ length: 6 }, (_, i) => join(request, `Играч ${i + 1}`)));
    const gid = joined[0].body.gameId as number;

    // stage 1: picking, with one leader already revealed on a phone
    await admin.ok("assign");
    let s = await admin.state();
    expect(s.game.stage).toBe("picking");
    const lead = s.assignments[0];
    const stream = await new Stream(baseURL!, lead.userCode, gid).open();
    try {
      await admin.ok("reveal", { assignmentId: lead.id });
      await stream.waitFor((d) => d.leader?.assignmentId === lead.id);
      const seen = stream.snapshots.length;
      // three stops at once: exactly one wins
      const stops = await Promise.all([1, 2, 3].map(() => admin.advance("stop-presentation")));
      expect(stops.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
      s = await admin.state();
      expect(s.game).toMatchObject({ status: "live", stage: "lobby", qIndex: 0, timerStartedAt: null });
      expect(s.assignments).toHaveLength(0);
      expect(s.playerCount).toBe(6); // players, teams and questions stay
      expect(s.teams).toHaveLength(3);
      expect(s.questions).toHaveLength(2);
      // the phone drops the leader notice by itself, and still knows who it is
      let after: (typeof stream.snapshots)[number] | undefined;
      for (const end = Date.now() + 8_000; !after && Date.now() < end; await sleep(50)) {
        after = stream.snapshots.slice(seen).find((x) => x.data.user && x.data.leader === null);
      }
      expect(after, "a new snapshot without the leader notice").toBeTruthy();
      expect(after!.data.user.code).toBe(lead.userCode);
    } finally {
      stream.close();
    }

    // the old leader can be moved again, and a fresh draw works
    const other = s.teams.find((t) => t.id !== lead.teamId)!;
    expect((await admin.post("move", { userId: lead.userId, teamId: other.id })).status()).toBe(200);
    await admin.ok("assign");
    s = await admin.state();
    expect(s.assignments).toHaveLength(3);
    expect(s.assignments.every((a) => !a.revealed)).toBe(true);

    // stage 2: results
    for (const q of s.questions) {
      for (const a of s.assignments.filter((x) => x.questionId === q.id)) await admin.ok("reveal", { assignmentId: a.id });
      await admin.ok("advance", { action: "next-pick", qIndex: s.questions.indexOf(q) });
    }
    expect((await admin.state()).game.stage).toBe("results");
    expect((await admin.advance("stop-presentation")).status()).toBe(200);
    s = await admin.state();
    expect(s.game).toMatchObject({ stage: "lobby", qIndex: 0 });
    expect(s.assignments).toHaveLength(0);

    // stage 3: presenting (timer running)
    await admin.ok("assign");
    s = await admin.state();
    for (const q of s.questions) {
      for (const a of s.assignments.filter((x) => x.questionId === q.id)) await admin.ok("reveal", { assignmentId: a.id });
      await admin.ok("advance", { action: "next-pick", qIndex: s.questions.indexOf(q) });
    }
    await admin.ok("advance", { action: "start-presentation" });
    s = await admin.state();
    expect(s.game.stage).toBe("presenting");
    expect(s.game.timerStartedAt).not.toBeNull();
    expect((await admin.advance("stop-presentation")).status()).toBe(200);
    s = await admin.state();
    expect(s.game).toMatchObject({ status: "live", stage: "lobby", qIndex: 0, timerStartedAt: null });
    expect(s.assignments).toHaveLength(0);
    expect(s.playerCount).toBe(6);
    await admin.post("advance", { action: "reset" });
  });

  test("skipping a running timer is one clean step: the next question starts with a fresh timer", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B", "C"], questions: ["Q1", "Q2", "Q3"], pause: 1, speak: 120 });
    await admin.ok("start");
    await Promise.all(Array.from({ length: 6 }, (_, i) => join(request, `Играч ${i + 1}`)));
    await admin.ok("assign");
    let s = await admin.state();
    for (const q of s.questions) {
      for (const a of s.assignments.filter((x) => x.questionId === q.id)) await admin.ok("reveal", { assignmentId: a.id });
      await admin.ok("advance", { action: "next-pick", qIndex: s.questions.indexOf(q) });
    }
    await admin.ok("advance", { action: "start-presentation" });
    s = await admin.state();
    const first = s.game.timerStartedAt!;
    await sleep(1200);
    // skip while 118 s are left; a double click (or a second admin tab) only skips once
    const skips = await Promise.all([admin.advance("next", 0), admin.advance("next", 0)]);
    expect(skips.map((r) => r.status()).sort()).toEqual([200, 409]);
    s = await admin.state();
    expect(s.game).toMatchObject({ stage: "presenting", qIndex: 1 });
    expect(s.game.timerStartedAt!).toBeGreaterThan(first + 1000); // the clock of Q2 restarted
    expect(s.game.speakSeconds).toBe(120); // the setting itself is untouched
    // a skip aimed at a question that is already over is refused, not applied to the next one
    expect((await admin.advance("next", 0)).status()).toBe(409);
    expect((await admin.state()).game.qIndex).toBe(1);
    await admin.post("advance", { action: "reset" });
  });

  test("assign needs enough teams with players", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B", "C"], questions: ["Q1", "Q2"] });
    await admin.ok("start");
    await join(request, "Само един"); // only one team has a player, 2 questions
    expect((await admin.post("assign")).status()).toBe(409);
    await join(request, "Втори");
    expect((await admin.post("assign")).status()).toBe(200);
    await admin.post("advance", { action: "reset" });
  });

  test("simulation start creates exactly 100 balanced players", async ({ request }) => {
    const admin = new Admin(request);
    await admin.setup({ teams: ["A", "B", "C"], questions: ["Q1"] });
    await admin.ok("start", { simulate: true });
    const s = await admin.state();
    expect(s.playerCount).toBe(100);
    expect(s.game.isSimulation).toBe(true);
    const sizes = s.teams.map((t) => t.members.length);
    expect(sizes.sort()).toEqual([33, 33, 34]);
    expect(new Set(s.teams.flatMap((t) => t.members.map((m) => m.code))).size).toBe(100);
    await admin.post("advance", { action: "reset" });
    expect((await admin.state()).playerCount).toBe(0);
  });
});
