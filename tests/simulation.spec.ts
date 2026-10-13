import { expect, test } from "@playwright/test";
import { Admin, SECRET } from "./helpers";

test.describe.configure({ mode: "serial" });

test("simulation: 100 players appear, teams are balanced, the whole draw runs with nobody listening", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const api = new Admin(request);
  await api.setup({
    teams: ["Червени", "Сини", "Зелени", "Жълти", "Лилави"],
    questions: ["Първи въпрос?", "Втори въпрос?", "Трети въпрос?"],
    speak: 3,
    pause: 2,
    reveal: 1,
    scroll: 1,
  });

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "bg-BG" });
  await context.addInitScript((key) => localStorage.setItem("asm.admin", key), SECRET());
  const page = await context.newPage();
  await page.goto("/admin");

  await page.getByRole("button", { name: /Старт със симулация/ }).click();
  await expect(page.getByText("Играта тече")).toBeVisible();
  await expect(page.getByTestId("sim-flag")).toHaveText("Симулация");
  await expect(page.getByTestId("player-count")).toHaveText("100");
  const s = await api.state();
  expect(s.teams.map((t) => t.members.length)).toEqual([20, 20, 20, 20, 20]);
  expect(new Set(s.teams.flatMap((t) => t.members.map((m) => m.code))).size).toBe(100);
  expect(s.game.isSimulation).toBe(true);

  // the board with 100 people does not break the page layout
  await expect(page.getByTestId("board")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

  // leaders -> picking (no phones are connected) -> results -> presentations -> thanks
  await page.getByTestId("assign").click();
  await expect(page.getByTestId("assigned-status")).toBeVisible();
  await page.getByTestId("start-picking").click();
  await expect(page.getByTestId("picking")).toBeVisible();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60_000 });
  const r = await api.state();
  expect(r.assignments).toHaveLength(5);
  expect(r.assignments.every((a) => a.revealed)).toBe(true);
  expect(r.assignments.filter((a) => a.questionId === r.questions[0].id)).toHaveLength(2);
  expect(r.assignments.filter((a) => a.questionId === r.questions[1].id)).toHaveLength(2);
  expect(r.assignments.filter((a) => a.questionId === r.questions[2].id)).toHaveLength(1);

  await page.getByTestId("start-presentation").click();
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId("timeup")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("continue").click();
  }
  await expect(page.getByTestId("thanks")).toBeVisible();
  expect((await api.state()).playerCount).toBe(0);
  await page.getByTestId("new-game").click();
  await expect(page.getByRole("heading", { name: "Отбори" })).toBeVisible();

  // second round: reset from the live board works and wipes the players
  await page.getByRole("button", { name: /Старт със симулация/ }).click();
  await expect(page.getByTestId("player-count")).toHaveText("100");
  await page.getByRole("button", { name: "Нулирай играта" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Нулирай играта" }).click();
  await expect(page.getByRole("heading", { name: "Отбори" })).toBeVisible();
  expect((await api.state()).playerCount).toBe(0);

  await context.close();
  await api.clean();
});
