import { expect, type APIRequestContext } from "@playwright/test";

export const SECRET = () => process.env.E2E_ADMIN_SECRET ?? "e2e-secret";
export const headers = () => ({ "x-admin-key": SECRET() });

export type StateJson = {
  game: {
    status: string;
    stage: string;
    qIndex: number;
    gameId: number;
    timerStartedAt: number | null;
    speakSeconds: number;
    isSimulation: boolean;
  };
  teams: { id: number; name: string; members: { id: number; name: string; code: number; isLeader: boolean }[] }[];
  questions: { id: number; text: string }[];
  assignments: {
    id: number;
    questionId: number;
    teamId: number;
    userId: number;
    userName: string;
    userCode: number;
    teamName: string;
    slot: number;
    revealed: boolean;
  }[];
  playerCount: number;
};

export class Admin {
  constructor(private req: APIRequestContext) {}

  post(path: string, data: unknown = {}) {
    return this.req.post(`/api/admin/${path}`, { data, headers: headers() });
  }
  async ok(path: string, data: unknown = {}) {
    const res = await this.post(path, data);
    expect(res.status(), `${path}: ${await res.text()}`).toBe(200);
  }
  async state(): Promise<StateJson> {
    const res = await this.req.get("/api/admin/state", { headers: headers() });
    expect(res.status()).toBe(200);
    return res.json();
  }
  async advance(action: string, qIndex?: number) {
    return this.post("advance", { action, qIndex });
  }

  /** Back to an empty preparation stage (no players, no teams, no questions, default timers). */
  async clean() {
    await this.post("advance", { action: "reset" });
    const s = await this.state();
    if (s.game.status === "finished") await this.post("advance", { action: "new-game" });
    for (const t of s.teams) await this.req.delete("/api/admin/teams", { data: { id: t.id }, headers: headers() });
    for (const q of s.questions) await this.req.delete("/api/admin/questions", { data: { id: q.id }, headers: headers() });
  }

  async setup(opts: {
    teams: string[];
    questions: string[];
    speak?: number;
    pause?: number;
    reveal?: number;
    scroll?: number;
  }) {
    await this.clean();
    for (const name of opts.teams) await this.ok("teams", { name });
    for (const text of opts.questions) await this.ok("questions", { text });
    const res = await this.req.put("/api/admin/settings", {
      headers: headers(),
      data: {
        speakSeconds: opts.speak ?? 180,
        pauseSeconds: opts.pause ?? 7,
        revealSeconds: opts.reveal ?? 1,
        scrollSeconds: opts.scroll ?? 3,
      },
    });
    expect(res.status()).toBe(200);
  }
}

export async function join(req: APIRequestContext, name: string) {
  const res = await req.post("/api/join", { data: { name } });
  return { status: res.status(), body: await res.json() };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal SSE client over fetch (Node). Collects every snapshot the server pushes. */
export class Stream {
  snapshots: { t: number; data: any }[] = [];
  closed = false;
  private ctl = new AbortController();
  private started = Date.now();

  constructor(
    private baseURL: string,
    readonly code: number,
    readonly gameId: number,
  ) {}

  async open() {
    const res = await fetch(`${this.baseURL}/api/stream?code=${this.code}&gid=${this.gameId}`, {
      signal: this.ctl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    this.pump(res);
    return this;
  }

  private async pump(res: Response) {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (frame.startsWith("data:")) {
            this.snapshots.push({ t: Date.now() - this.started, data: JSON.parse(frame.slice(5)) });
          }
        }
      }
    } catch {
      // aborted
    }
    this.closed = true;
  }

  get last() {
    return this.snapshots.at(-1)?.data;
  }

  async waitFor(pred: (snap: any) => boolean, timeoutMs = 10_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const hit = this.snapshots.find((s) => pred(s.data));
      if (hit) return hit;
      await sleep(50);
    }
    throw new Error(`Stream ${this.code}: condition not met in ${timeoutMs}ms; last=${JSON.stringify(this.last)}`);
  }

  close() {
    this.ctl.abort();
  }
}
