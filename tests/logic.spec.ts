import { expect, test } from "@playwright/test";
import { assignLeaders, cleanName, formatClock, seededRng, teamIndexForSeq } from "../lib/logic";

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
