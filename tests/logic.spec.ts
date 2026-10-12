import { expect, test } from "@playwright/test";
import { assignLeaders, cleanName, formatClock, seededRng, teamIndexForSeq } from "../lib/logic";
import { reelNames, reelTrack } from "../lib/reel";

const mkTeams = (sizes: number[]) =>
  sizes.map((n, i) => ({ id: i + 1, members: Array.from({ length: n }, (_, j) => ({ id: (i + 1) * 1000 + j })) }));

test.describe("round-robin", () => {
  test("cycles through teams and stays balanced", () => {
    const counts = [0, 0, 0];
    for (let seq = 1; seq <= 100; seq++) counts[teamIndexForSeq(seq, 3)]++;
    expect(counts).toEqual([34, 33, 33]);
    expect([1, 2, 3, 4, 5].map((s) => teamIndexForSeq(s, 3))).toEqual([0, 1, 2, 0, 1]);
  });
  test("single team", () => {
    expect(teamIndexForSeq(57, 1)).toBe(0);
  });
  test("no teams is an error", () => {
    expect(() => teamIndexForSeq(1, 0)).toThrow();
  });
});

test.describe("assignLeaders", () => {
  const Q = [10, 20];

  test("every team with members gets exactly one leader and one question", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const teams = mkTeams([4, 5, 3, 6, 2]);
      const out = assignLeaders(teams, Q, seededRng(seed));
      expect(out).toHaveLength(5);
      expect(new Set(out.map((o) => o.teamId)).size).toBe(5);
      expect(new Set(out.map((o) => o.userId)).size).toBe(5);
      for (const o of out) {
        const team = teams.find((t) => t.id === o.teamId)!;
        expect(team.members.some((m) => m.id === o.userId)).toBe(true);
        expect(Q).toContain(o.questionId);
      }
    }
  });

  test("questions are served in rotation: Q1, Q2, Q1, Q2, Q1", () => {
    const out = assignLeaders(mkTeams([2, 2, 2, 2, 2]), Q, seededRng(7));
    expect(out.map((o) => o.questionId)).toEqual([10, 20, 10, 20, 10]);
    expect(out.map((o) => o.slot)).toEqual([0, 0, 1, 1, 2]);
  });

  test("teams without members are never drawn", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const out = assignLeaders(mkTeams([3, 0, 2, 0]), Q, seededRng(seed));
      expect(out.map((o) => o.teamId).sort()).toEqual([1, 3]);
    }
  });

  test("each question gets at least one team when teams >= questions", () => {
    const out = assignLeaders(mkTeams([1, 1, 1]), [1, 2, 3], seededRng(3));
    expect(new Set(out.map((o) => o.questionId)).size).toBe(3);
  });

  test("is random: different seeds produce different draws", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      seen.add(
        assignLeaders(mkTeams([5, 5, 5, 5]), Q, seededRng(seed))
          .map((o) => `${o.teamId}:${o.userId}`)
          .join(","),
      );
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  test("no questions is an error; no eligible teams gives an empty draw", () => {
    expect(() => assignLeaders(mkTeams([2]), [], seededRng(1))).toThrow();
    expect(assignLeaders(mkTeams([0, 0]), Q, seededRng(1))).toEqual([]);
  });
});

test.describe("helpers", () => {
  test("formatClock", () => {
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(59.2)).toBe("1:00");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-4)).toBe("0:00");
  });
  test("cleanName trims and collapses whitespace", () => {
    expect(cleanName("  Иван   Петров ")).toBe("Иван Петров");
    expect(cleanName(42)).toBe("");
    expect(cleanName(undefined)).toBe("");
  });
});

test.describe("leader picker drum", () => {
  const mod = (x: number, n: number) => ((x % n) + n) % n;

  test("always comes to rest exactly on the chosen item, at the stop time", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const land = Math.floor(rng() * 7);
      const stop = 300 + Math.floor(rng() * 9000);
      const t = reelTrack(7, land, rng() * 7, stop);
      expect(mod(t.final, 7), `seed ${seed}`).toBe(land);
      expect(t.at(stop).pos).toBe(t.final);
      expect(t.at(stop).speed).toBe(0);
      expect(t.at(stop + 5000).pos).toBe(t.final);
      expect(Math.abs(t.at(stop - 1).pos - t.final), "no jump into the stop").toBeLessThan(0.05);
    }
  });

  test("never runs backwards, slows down monotonically and keeps its speed continuous", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 100; seed++) {
      const rng = seededRng(seed * 13);
      const stop = 600 + Math.floor(rng() * 8000);
      const t = reelTrack(7, Math.floor(rng() * 7), rng() * 7, stop);
      let prev = t.at(0);
      let slowing = false;
      for (let ms = 5; ms <= stop; ms += 5) {
        const cur = t.at(ms);
        if (cur.pos < prev.pos - 1e-9) problems.push(`seed ${seed} @${ms}: ran backwards`);
        if (cur.speed < prev.speed - 1e-9) slowing = true;
        if (slowing && cur.speed > prev.speed + 1e-9) problems.push(`seed ${seed} @${ms}: sped up again`);
        if (Math.abs(cur.pos - prev.pos) > 0.4) problems.push(`seed ${seed} @${ms}: jumped ${cur.pos - prev.pos}`); // 5 ms never covers 0.4 items
        prev = cur;
      }
      if (!(t.at(stop * 0.99).speed < t.at(0).speed * 0.05)) problems.push(`seed ${seed}: not nearly stopped just before the end`);
    }
    expect(problems).toEqual([]);
  });

  test("starts fast and spends the last stretch slowing down", () => {
    const t = reelTrack(7, 3, 0, 5000);
    expect(t.at(100).speed).toBeGreaterThanOrEqual(11);
    expect(t.at(1500).speed).toBeGreaterThanOrEqual(11); // still at full speed well before the end
    expect(t.at(4000).speed).toBeLessThan(t.at(1500).speed); // already slowing
    expect(t.at(4900).speed).toBeLessThan(1);
  });

  test("a zero or tiny stop time lands at once", () => {
    for (const stop of [0, 1, 50]) {
      const t = reelTrack(7, 5, 2.3, stop);
      expect(mod(t.final, 7)).toBe(5);
      expect(t.at(stop).pos).toBe(t.final);
    }
  });

  test("names: seven stops, the chosen player is exactly where the drum lands", () => {
    const pool = Array.from({ length: 40 }, (_, i) => `Играч ${i}`);
    for (let seed = 1; seed <= 100; seed++) {
      const { names, land } = reelNames("Играч 7", pool, seed);
      expect(names).toHaveLength(7);
      expect(names[land]).toBe("Играч 7");
      expect(names.filter((n) => n === "Играч 7")).toHaveLength(1);
      expect(new Set(names).size).toBe(7); // enough players: every stop is a different name
      expect(reelNames("Играч 7", pool, seed)).toEqual({ names, land }); // stable for a seed
    }
  });

  test("names: tiny games still fill the drum", () => {
    const few = reelNames("Ана", ["Ана", "Бо", "Вихър"], 5);
    expect(few.names).toHaveLength(7);
    expect(few.names[few.land]).toBe("Ана");
    expect(few.names.every((n) => ["Ана", "Бо", "Вихър"].includes(n))).toBe(true);
    const alone = reelNames("Ана", ["Ана"], 9);
    expect(alone.names).toEqual(Array(7).fill("Ана"));
    expect(reelNames("Ана", [], 1).names[reelNames("Ана", [], 1).land]).toBe("Ана");
  });
});
