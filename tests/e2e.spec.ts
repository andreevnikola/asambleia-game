import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Admin, SECRET, join, sleep } from "./helpers";

test.describe.configure({ mode: "serial" });

const TEAMS = ["Червени", "Сини", "Зелени"];
const QUESTIONS = ["Как да привлечем нови членове в клуба?", "Как да направим проектите си устойчиви?"];
const NO_GAME = "В момента няма активна игра.";

/** Set E2E_SHOTS=1 to also save screenshots to test-results/shots (for design review). */
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(600); // let entrance animations finish
  await page.screenshot({ path: `test-results/shots/${name}.png` });
}

// ───────────── helpers ─────────────

async function adminPage(browser: Browser, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, locale: "bg-BG" });
  await context.addInitScript((key) => localStorage.setItem("asm.admin", key), SECRET());
  const page = await context.newPage();
  await page.goto("/admin");
  return { context, page };
}

async function playerContext(browser: Browser) {
  return browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    locale: "bg-BG",
  });
}

type Player = { name: string; code: number; team: string; context: BrowserContext; page: Page };

async function signUp(browser: Browser, name: string): Promise<Player> {
  const context = await playerContext(browser);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Как се казваш?").fill(name);
  await page.getByRole("button", { name: "Влез в играта" }).click();
  const code = Number(await page.getByTestId("player-code").innerText());
  const team = await page.getByTestId("player-team").innerText();
  return { name, code, team, context, page };
}

/**
 * A projector screen must be completely visible and readable: nothing scrolls, nothing is clipped by an
 * ancestor, nothing leaves the viewport, and no two pieces of text overlap. (A plain scrollHeight check is
 * not enough: content that overflows upwards or is clipped by overflow:hidden does not show up in it.)
 */
async function expectFits(page: Page, testId: string) {
  const root = page.getByTestId(testId);
  const m = await root.evaluate((el) => ({
    sh: el.scrollHeight,
    ch: el.clientHeight,
    sw: el.scrollWidth,
    cw: el.clientWidth,
    docH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  }));
  expect(m.sh, `${testId} content taller than its box`).toBeLessThanOrEqual(m.ch + 1);
  expect(m.sw, `${testId} content wider than its box`).toBeLessThanOrEqual(m.cw + 1);
  expect(m.docH).toBeLessThanOrEqual(m.winH + 1);
  expect(m.docW).toBeLessThanOrEqual(m.winW + 1);

  const problems = await root.evaluate((rootEl) => {
    const out: string[] = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const items: { el: Element; r: DOMRect; label: string }[] = [];
    for (const el of rootEl.querySelectorAll("*")) {
      if (el.closest("[aria-hidden='true']") || el.closest("svg") || el.closest("dialog")) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
      if (!hasText) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      items.push({ el, r, label: (el.textContent ?? "").trim().slice(0, 28) });
    }
    for (const { el, r, label } of items) {
      if (r.top < -1 || r.left < -1 || r.bottom > H + 1 || r.right > W + 1) out.push(`outside the viewport: "${label}"`);
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const ar = a.getBoundingClientRect();
        if (r.top < ar.top - 1 || r.bottom > ar.bottom + 1 || r.left < ar.left - 1 || r.right > ar.right + 1) {
          out.push(`clipped by an ancestor: "${label}"`);
          break;
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix > 3 && iy > 3) out.push(`overlap: "${a.label}" and "${b.label}"`);
      }
    }
    return out;
  });
  expect(problems, `layout problems on ${testId}`).toEqual([]);
}

async function expectCentered(locator: Locator) {
  const b = (await locator.boundingBox())!;
  const win = await locator.page().evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(Math.abs(b.x + b.width / 2 - win.w / 2)).toBeLessThan(6);
  expect(Math.abs(b.y + b.height / 2 - win.h / 2)).toBeLessThan(6);
}

async function expectInViewport(locator: Locator) {
  const win = await locator.page().evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  for (const el of await locator.all()) {
    const b = (await el.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(-1);
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.y + b.height).toBeLessThanOrEqual(win.h + 1);
    expect(b.x + b.width).toBeLessThanOrEqual(win.w + 1);
  }
}

const clockSeconds = (text: string) => {
  const [m, s] = text.trim().split(":").map(Number);
  return m * 60 + s;
};

// ───────────── 1. admin preparation through the UI ─────────────

test("admin: sign-in, preparation, validation and timers", async ({ browser, request }) => {
  const api = new Admin(request);
  await api.clean();

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "bg-BG" });
  const page = await context.newPage();
  await page.goto("/admin");

  // wrong key, then right key
  await expect(page.getByRole("heading", { name: "Администрация" })).toBeVisible();
  await page.getByLabel("Таен ключ").fill("грешен-ключ");
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page.locator("#key-error")).toHaveText("Грешен таен ключ.");
  await page.getByLabel("Таен ключ").fill(SECRET());
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page.getByRole("heading", { name: "Отбори" })).toBeVisible();

  // the key survives a reload (local storage) and sign-out clears it
  await page.reload();
  await expect(page.getByRole("heading", { name: "Отбори" })).toBeVisible();
  await page.getByRole("button", { name: "Изход" }).click();
  await expect(page.getByRole("heading", { name: "Администрация" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Администрация" })).toBeVisible();
  await page.getByLabel("Таен ключ").fill(SECRET());
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page.getByRole("heading", { name: "Отбори" })).toBeVisible();

  // nothing yet: cannot start
  await expect(page.getByTestId("start-problem")).toHaveText("Добави поне един отбор.");
  await expect(page.getByRole("button", { name: "Започни играта" })).toBeDisabled();

  // teams
  const teamInput = page.getByLabel("Име на отбор");
  for (const t of TEAMS) {
    await teamInput.fill(t);
    await teamInput.press("Enter");
    await expect(page.getByTestId("team-list")).toContainText(t);
  }
  await expect(page.getByTestId("count-Отбори")).toHaveText("3");
  await teamInput.fill("  червени ");
  await teamInput.press("Enter");
  await expect(page.getByTestId("toast")).toHaveText("Вече има отбор с това име.");
  await expect(page.getByTestId("count-Отбори")).toHaveText("3");

  // questions (Enter adds, Shift+Enter would add a line break)
  await expect(page.getByTestId("start-problem")).toHaveText("Добави поне един въпрос.");
  const qInput = page.getByLabel("Текст на въпроса");
  for (const q of [...QUESTIONS, "Трети въпрос за проверка"]) {
    await qInput.fill(q);
    await qInput.press("Enter");
    await expect(page.getByTestId("question-list")).toContainText(q);
  }
  await expect(page.getByTestId("count-Въпроси")).toHaveText("3");
  await expect(page.getByRole("button", { name: "Започни играта" })).toBeEnabled();

  // 4 questions > 3 teams: blocked, with the reason on screen
  await qInput.fill("Четвърти въпрос");
  await qInput.press("Enter");
  await expect(page.getByTestId("count-Въпроси")).toHaveText("4");
  await expect(page.getByTestId("start-problem")).toContainText("Отборите (3) трябва да са поне колкото въпросите (4)");
  await expect(page.getByRole("button", { name: "Започни играта" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Старт със симулация/ })).toBeDisabled();
  await page.getByRole("button", { name: "Изтрий въпрос 4" }).click();
  await page.getByRole("button", { name: "Изтрий въпрос 3" }).click();
  await expect(page.getByTestId("count-Въпроси")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Започни играта" })).toBeEnabled();

  // delete + re-add a team
  await page.getByRole("button", { name: "Изтрий отбор Зелени" }).click();
  await expect(page.getByTestId("count-Отбори")).toHaveText("2");
  await teamInput.fill("Зелени");
  await teamInput.press("Enter");
  await expect(page.getByTestId("count-Отбори")).toHaveText("3");

  // timers: edit, persist across reload, reject nonsense
  const set = async (id: string, v: string) => {
    await page.locator(`#${id}`).fill(v);
    await page.locator(`#${id}`).blur();
  };
  await set("speakSeconds", "5");
  await expect(page.getByText("Запазено")).toBeVisible();
  await set("pauseSeconds", "6");
  await set("revealSeconds", "1");
  await set("scrollSeconds", "1");
  await set("speakSeconds", "2"); // below the minimum of 3: rejected, reverts
  await expect(page.getByTestId("toast")).toContainText("Невалидни стойности");
  await expect(page.locator("#speakSeconds")).toHaveValue("5");
  await page.reload();
  await expect(page.locator("#speakSeconds")).toHaveValue("5");
  await expect(page.locator("#pauseSeconds")).toHaveValue("6");
  await expect(page.locator("#revealSeconds")).toHaveValue("1");
  await expect(page.locator("#scrollSeconds")).toHaveValue("1");

  // the public page says no game is on
  const visitor = await (await playerContext(browser)).newPage();
  await visitor.goto("/");
  await expect(visitor.getByText(NO_GAME)).toBeVisible();
  await expect(visitor.getByLabel("Как се казваш?")).toHaveCount(0);

  // no UI at all can be reached without a game: API refuses too
  expect((await join(request, "Рано")).status).toBe(409);

  await visitor.context().close();
  await context.close();
  await api.clean();
});

// ───────────── 2. the whole event, with real browsers ─────────────

test("full game: join, sign out/in, move, leader picking, notifications, presentations, thanks", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const api = new Admin(request);
  await api.setup({ teams: TEAMS, questions: QUESTIONS, speak: 4, pause: 6, reveal: 1, scroll: 1 });

  const { context: adminCtx, page: admin } = await adminPage(browser);
  await expect(admin.getByRole("button", { name: "Започни играта", exact: true })).toBeEnabled();

  // a waiting visitor: the page opens itself when the game starts
  const waiter = await (await playerContext(browser)).newPage();
  await waiter.goto("/");
  await expect(waiter.getByText(NO_GAME)).toBeVisible();

  await admin.getByRole("button", { name: "Започни играта", exact: true }).click();
  await expect(admin.getByText("Играта тече")).toBeVisible();
  await expect(waiter.getByLabel("Как се казваш?")).toBeVisible({ timeout: 15_000 });
  await waiter.context().close();

  // six players join one after another -> teams are filled in a cycle
  const names = ["Ана", "Борис", "Виктор", "Галя", "Данчо", "Елица <b>x</b>"];
  const players: Player[] = [];
  for (const n of names) players.push(await signUp(browser, n));
  expect(new Set(players.map((p) => p.code)).size).toBe(6);
  players.forEach((p, i) => {
    expect(String(p.code)).toMatch(/^\d{3}$/);
    expect(p.team, `player ${i + 1} must be in team ${(i % 3) + 1}`).toBe(TEAMS[i % 3]);
  });
  // names are rendered as text, never as HTML
  await expect(players[5].page.getByTestId("player-name")).toHaveText("Елица <b>x</b>");
  await expect(players[5].page.locator('[data-testid="player-name"] b')).toHaveCount(0);
  await expect(players[0].page.getByRole("heading", { name: "Въпроси за обсъждане" })).toBeVisible();
  await expect(players[0].page.getByText(QUESTIONS[0])).toBeVisible();
  await expect(players[0].page.getByText(QUESTIONS[1])).toBeVisible();
  await expectNoHorizontalScroll(players[0].page);
  await shot(players[0].page, "player-home");
  await shot(admin, "admin-board");

  // admin board shows everybody, live
  await expect(admin.getByTestId("player-count")).toHaveText("6");

  // sign out (with confirmation + code), stay, sign out for real, sign back in with the code
  const p1 = players[0];
  await p1.page.getByRole("button", { name: "Изход" }).click();
  await expect(p1.page.getByTestId("signout-code")).toHaveText(String(p1.code));
  await shot(p1.page, "player-signout");
  await p1.page.getByRole("button", { name: "Остани" }).click();
  await expect(p1.page.getByTestId("signout-code")).toBeHidden();
  await expect(p1.page.getByTestId("player-name")).toHaveText(p1.name);
  await p1.page.getByRole("button", { name: "Изход" }).click();
  await p1.page.getByRole("dialog").getByRole("button", { name: "Изход" }).click();
  await expect(p1.page.getByLabel("Как се казваш?")).toBeVisible();
  await p1.page.getByLabel("Вече имаш код?").fill(String(p1.code).slice(0, 2) + "x");
  await expect(p1.page.getByLabel("Вече имаш код?")).toHaveValue(String(p1.code).slice(0, 2)); // digits only
  await expect(p1.page.getByRole("button", { name: "Влез с код" })).toBeDisabled();
  const taken = new Set(players.map((p) => p.code));
  let wrong = 100;
  while (taken.has(wrong)) wrong++;
  await p1.page.getByLabel("Вече имаш код?").fill(String(wrong));
  await p1.page.getByRole("button", { name: "Влез с код" }).click();
  await expect(p1.page.locator("#login-error")).toHaveText("Няма участник с такъв код.");
  await p1.page.getByLabel("Вече имаш код?").fill(String(p1.code));
  await p1.page.getByRole("button", { name: "Влез с код" }).click();
  await expect(p1.page.getByTestId("player-name")).toHaveText(p1.name);
  await expect(p1.page.getByTestId("player-team")).toHaveText(p1.team);

  // "another device": a brand new browser with the code
  const other = await (await playerContext(browser)).newPage();
  await other.goto("/");
  await other.getByLabel("Вече имаш код?").fill(String(players[1].code));
  await other.getByRole("button", { name: "Влез с код" }).click();
  await expect(other.getByTestId("player-name")).toHaveText(players[1].name);
  await other.context().close();

  // admin moves player 2 (Сини) into Червени; the phone updates by itself
  const p2 = players[1];
  expect(p2.team).toBe("Сини");
  await admin.getByTestId(`member-${p2.code}`).click();
  await expect(admin.getByTestId("move-popover")).toBeVisible();
  await admin.getByTestId("move-popover").getByRole("button", { name: /Червени/ }).click();
  await expect(p2.page.getByTestId("player-team")).toHaveText("Червени", { timeout: 15_000 });
  p2.team = "Червени";
  await expect(admin.getByTestId("team-" + (await api.state()).teams[0].id).getByText(p2.name)).toBeVisible();

  // ── leaders ──
  await admin.getByRole("button", { name: "Определи лидери" }).click();
  await expect(admin.getByTestId("picking")).toBeVisible();
  const draw = await api.state();
  expect(draw.assignments).toHaveLength(3); // 3 teams with players
  const q1Slots = draw.assignments.filter((a) => a.questionId === draw.questions[0].id);
  const q2Slots = draw.assignments.filter((a) => a.questionId === draw.questions[1].id);
  expect(q1Slots.length).toBe(2);
  expect(q2Slots.length).toBe(1);

  // question 1: the question on top, N slots at the bottom, everything on one screen
  await expect(admin.getByTestId("picking-question")).toHaveText(QUESTIONS[0]);
  await expect(admin.getByTestId("slot")).toHaveCount(2);
  await expectFits(admin, "picking");
  await expectInViewport(admin.getByTestId("slot"));
  // nobody is revealed (or notified) before the scroll animation is over
  for (const p of players) await expect(p.page.getByTestId("takeover")).toHaveCount(0);

  // reveals happen one at a time, about a second apart
  const revealed = admin.locator('[data-testid="slot"][data-revealed="true"]');
  const seen = new Map<number, number>();
  const started = Date.now();
  while (seen.size < 2 && Date.now() - started < 25_000) {
    const n = await revealed.count();
    if (n > 0 && !seen.has(n)) seen.set(n, Date.now());
    await sleep(60);
  }
  expect([...seen.keys()], "slots must be revealed one by one").toEqual([1, 2]);
  expect(seen.get(2)! - seen.get(1)!).toBeGreaterThanOrEqual(700);
  expect(seen.get(2)! - seen.get(1)!).toBeLessThanOrEqual(2500);
  await expectFits(admin, "picking");

  const revealedCodes: number[] = [];
  for (const slot of await admin.getByTestId("slot-revealed").all()) {
    const texts = await slot.locator("p").allInnerTexts();
    revealedCodes.push(Number(texts[2]));
    const a = q1Slots.find((x) => x.userCode === Number(texts[2]))!;
    expect(a, `slot ${texts} is one of the drawn leaders`).toBeTruthy();
    expect(texts[0]).toBe(a.teamName);
    expect(texts[1]).toBe(a.userName);
  }
  expect(revealedCodes.sort()).toEqual(q1Slots.map((a) => a.userCode).sort());
  await expect(admin.getByTestId("countdown")).toBeVisible();

  // exactly the revealed players get the big screen; everyone else (also the future Q2 leader) does not
  const byCode = new Map(players.map((p) => [p.code, p]));
  const q1Leaders = q1Slots.map((a) => byCode.get(a.userCode)!);
  const q2Leader = byCode.get(q2Slots[0].userCode)!;
  for (const p of q1Leaders) {
    await expect(p.page.getByTestId("takeover")).toBeVisible({ timeout: 8_000 });
    await shot(p.page, "player-takeover");
    await expect(p.page.getByTestId("takeover")).toContainText(`Ти представяш отбор ${p.team}`);
    await expect(p.page.getByTestId("takeover")).toContainText("Въпрос В1");
    await expect(p.page.getByTestId("takeover")).toContainText(QUESTIONS[0]);
  }
  await sleep(1200);
  for (const p of players.filter((x) => !q1Leaders.includes(x))) {
    await expect(p.page.getByTestId("takeover"), `${p.name} was not revealed yet`).toHaveCount(0);
    await expect(p.page.getByTestId("leader-bar")).toHaveCount(0);
  }

  // question 2 starts by itself: new question text, one slot
  await expect(admin.getByTestId("picking-question")).toHaveText(QUESTIONS[1], { timeout: 20_000 });
  await expect(admin.getByTestId("slot")).toHaveCount(1);
  await expectFits(admin, "picking");
  await expect(q2Leader.page.getByTestId("takeover")).toBeVisible({ timeout: 20_000 });
  await expect(q2Leader.page.getByTestId("takeover")).toContainText("Въпрос В2");

  // closing the big screen leaves the reminder at the bottom; a reload does not bring the big screen back
  for (const p of [...q1Leaders, q2Leader]) {
    await p.page.getByRole("button", { name: "Разбрах" }).click();
    await expect(p.page.getByTestId("takeover")).toBeHidden();
    await expect(p.page.getByTestId("leader-bar")).toContainText(`Ти представяш отбор ${p.team} по въпрос В`);
    await p.page.reload();
    await expect(p.page.getByTestId("leader-bar")).toBeVisible();
    await expect(p.page.getByTestId("takeover")).toHaveCount(0);
  }
  await expectNoHorizontalScroll(q2Leader.page);

  // ── results ──
  await expect(admin.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expectFits(admin, "results");
  await expectFits(admin, "results-body");
  await expect(admin.getByTestId("result-1").getByRole("listitem")).toHaveCount(2);
  await expect(admin.getByTestId("result-2").getByRole("listitem")).toHaveCount(1);
  await expect(admin.getByTestId("result-1")).toContainText(QUESTIONS[0]);
  for (const a of q1Slots) await expect(admin.getByTestId("result-1")).toContainText(a.userName);
  await expect(admin.getByRole("button", { name: "Започни презентацията на В1" })).toBeVisible();

  // ── presentation of question 1 ──
  await admin.getByTestId("start-presentation").click();
  await expect(admin.getByTestId("presenting")).toBeVisible();
  await expect(admin.getByTestId("presenting-question")).toHaveText(QUESTIONS[0]);
  await expect(admin.getByTestId("speakers").locator(":scope > div")).toHaveCount(2);
  for (const a of q1Slots) {
    await expect(admin.getByTestId("speakers")).toContainText(a.userName);
    await expect(admin.getByTestId("speakers")).toContainText(String(a.userCode));
    await expect(admin.getByTestId("speakers")).toContainText(a.teamName);
  }
  await expectFits(admin, "presenting");
  const first = clockSeconds(await admin.getByTestId("timer").innerText());
  expect(first).toBeLessThanOrEqual(4);
  expect(first).toBeGreaterThanOrEqual(2);
  await expect(admin.getByTestId("timeup")).toHaveText("Времето изтече", { timeout: 15_000 });
  await expectCentered(admin.getByRole("dialog", { name: "Времето изтече" }));
  await expect(admin.getByTestId("timer")).toHaveText("0:00");
  await expect(admin.getByTestId("continue")).toHaveText("Продължи към В2");
  await admin.getByTestId("continue").click();

  // ── question 2 ──
  await expect(admin.getByTestId("presenting-question")).toHaveText(QUESTIONS[1]);
  await expect(admin.getByTestId("timeup")).toBeHidden();
  await expect(admin.getByTestId("speakers").locator(":scope > div")).toHaveCount(1);
  await expectFits(admin, "presenting");
  await expect(admin.getByTestId("timeup")).toBeVisible({ timeout: 15_000 });
  await expect(admin.getByTestId("continue")).toHaveText("Завърши играта");
  await admin.getByTestId("continue").click();

  // ── thanks ──
  await expect(admin.getByTestId("thanks")).toContainText("Благодаря за активността");
  await shot(admin, "admin-thanks");
  await expectFits(admin, "thanks");
  for (const p of players) await expect(p.page.getByText("Играта приключи.")).toBeVisible({ timeout: 15_000 });
  const after = await api.state();
  expect(after.game.status).toBe("finished");
  expect(after.playerCount).toBe(0); // player data is gone ...
  expect(after.teams.map((t) => t.name)).toEqual(TEAMS); // ... the setup stays
  expect(after.questions.map((q) => q.text)).toEqual(QUESTIONS);
  await admin.getByTestId("new-game").click();
  await expect(admin.getByRole("heading", { name: "Отбори" })).toBeVisible();
  await expect(admin.getByTestId("team-list")).toContainText("Червени");

  for (const p of players) await p.context.close();
  await adminCtx.close();
});

async function expectNoHorizontalScroll(page: Page) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.iw + 1);
}

// ───────────── 3. things going wrong in the middle of the show ─────────────

test("chaos: reloads, double clicks, network loss and a flaky admin tab", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const api = new Admin(request);
  await api.setup({ teams: ["А", "Б", "В", "Г"], questions: ["Първи въпрос?", "Втори въпрос?"], speak: 8, pause: 3, reveal: 1, scroll: 2 });
  await api.ok("start");
  const joined = await Promise.all(Array.from({ length: 12 }, (_, i) => join(request, `Играч ${i + 1}`)));
  const gid = joined[0].body.gameId as number;

  // a phone with a stored session
  const phoneCtx = await playerContext(browser);
  await phoneCtx.addInitScript(([code, g]) => localStorage.setItem("asm.player", JSON.stringify({ code, gameId: g })), [joined[0].body.code, gid] as const);
  const phone = await phoneCtx.newPage();
  await phone.goto("/");
  await expect(phone.getByTestId("player-code")).toHaveText(String(joined[0].body.code));

  // network goes away: the phone says so, then recovers by itself and catches up on what it missed
  await phoneCtx.setOffline(true);
  await expect(phone.getByRole("status")).toHaveText("Връзката се възстановява…", { timeout: 20_000 });
  const s0 = await api.state();
  const target = s0.teams.find((t) => t.members.some((m) => m.code === joined[0].body.code))!;
  const dest = s0.teams.find((t) => t.id !== target.id)!;
  const me = target.members.find((m) => m.code === joined[0].body.code)!;
  await api.ok("move", { userId: me.id, teamId: dest.id }); // happens while the phone is offline
  await phoneCtx.setOffline(false);
  await expect(phone.getByTestId("player-team")).toHaveText(dest.name, { timeout: 20_000 });
  await expect(phone.getByRole("status")).toHaveCount(0);

  // admin: assign, then hammer reload in the middle of picking
  const { context: adminCtx, page: admin } = await adminPage(browser);
  await expect(admin.getByRole("button", { name: "Определи лидери" })).toBeEnabled();
  await admin.getByRole("button", { name: "Определи лидери" }).dblclick(); // double click: one assignment only
  await expect(admin.getByTestId("picking")).toBeVisible();
  expect((await api.state()).assignments).toHaveLength(4);
  for (let i = 0; i < 3; i++) {
    await sleep(1800);
    await admin.reload();
    await expect(admin.getByTestId("picking").or(admin.getByTestId("results"))).toBeVisible();
  }
  await expect(admin.getByTestId("results")).toBeVisible({ timeout: 40_000 });
  const done = await api.state();
  expect(done.assignments.every((a) => a.revealed)).toBe(true);
  expect(done.assignments).toHaveLength(4);
  expect(done.game.stage).toBe("results");

  // presentation: double click start, reload mid-timer (it must not restart), double click continue
  await admin.getByTestId("start-presentation").dblclick();
  await expect(admin.getByTestId("presenting")).toBeVisible();
  await sleep(2500);
  const before = clockSeconds(await admin.getByTestId("timer").innerText());
  await admin.reload();
  await expect(admin.getByTestId("presenting")).toBeVisible();
  const afterReload = clockSeconds(await admin.getByTestId("timer").innerText());
  expect(afterReload).toBeLessThanOrEqual(before);
  expect(afterReload).toBeLessThan(8);
  await expect(admin.getByTestId("timeup")).toBeVisible({ timeout: 15_000 });
  await admin.reload(); // the popup survives a reload too
  await expect(admin.getByTestId("timeup")).toBeVisible({ timeout: 15_000 });
  await admin.getByTestId("continue").dblclick();
  await expect(admin.getByTestId("presenting-question")).toHaveText("Втори въпрос?");
  expect((await api.state()).game).toMatchObject({ stage: "presenting", qIndex: 1 }); // exactly one step

  // a second admin tab sees the same truth and cannot break anything
  const second = await adminCtx.newPage();
  await second.goto("/admin");
  await expect(second.getByTestId("presenting-question")).toHaveText("Втори въпрос?");
  await second.close();

  // the secret gets changed on the server while the page is open: back to the login screen, no crash
  await admin.route("**/api/admin/state", (route) => route.fulfill({ status: 401, json: { error: "Грешен таен ключ." } }));
  await expect(admin.getByRole("heading", { name: "Администрация" })).toBeVisible({ timeout: 10_000 });
  expect(await admin.evaluate(() => localStorage.getItem("asm.admin"))).toBeNull();

  await phoneCtx.close();
  await adminCtx.close();
  await api.post("advance", { action: "reset" });
});

// ───────────── 3b. the leader picker, the waiting ring and the skip buttons ─────────────

test("picker: every drum has 7 names and stops exactly on the chosen leader; the waiting ring runs down to nothing", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const api = new Admin(request);
  await api.setup({ teams: ["А", "Б", "В", "Г", "Д", "Е"], questions: ["Първи въпрос?", "Втори въпрос?"], speak: 60, pause: 3, reveal: 1, scroll: 2 });
  await api.ok("start", { simulate: true });
  await api.ok("assign");
  const draw = await api.state();
  const q1 = draw.assignments.filter((a) => a.questionId === draw.questions[0].id).sort((a, b) => a.slot - b.slot);
  expect(q1).toHaveLength(3);

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "bg-BG" });
  await context.addInitScript((key) => localStorage.setItem("asm.admin", key), SECRET());
  // Record, the moment each drum comes to rest, which name sits in the middle of it.
  await context.addInitScript(() => {
    const landed: { slot: number; name: string | null; off: number }[] = [];
    (window as unknown as { __landed: typeof landed }).__landed = landed;
    new MutationObserver((muts) => {
      for (const m of muts) {
        const reel = m.target as HTMLElement;
        if (reel.getAttribute("data-landed") !== "true") continue;
        const lit = reel.querySelector(".reel-lit")!.getBoundingClientRect();
        const mid = lit.top + lit.height / 2;
        let best: HTMLElement | null = null;
        let off = Infinity;
        for (const li of reel.querySelectorAll<HTMLElement>(".reel-lit li")) {
          const r = li.getBoundingClientRect();
          const d = Math.abs(r.top + r.height / 2 - mid);
          if (d < off) {
            off = d;
            best = li;
          }
        }
        const slot = [...document.querySelectorAll('[data-testid="slot"]')].indexOf(reel.closest('[data-testid="slot"]')!);
        landed.push({ slot, name: best?.textContent ?? null, off });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-landed"] });
  });
  const page = await context.newPage();
  await page.goto("/admin");
  await expect(page.getByTestId("picking")).toBeVisible();

  // a drum: 7 different names (3 copies for the seamless loop), the chosen leader among them
  const reels = page.locator(".reel");
  await expect(reels).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const names = await reels.nth(i).locator(".reel-lit li").allInnerTexts();
    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(7);
    expect(names).toContain(q1[i].userName);
  }
  await expectFits(page, "picking");

  // all three come to rest on the leader that is revealed next, in the middle of the drum
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __landed: unknown[] }).__landed.length)), { timeout: 20_000 }).toBe(3);
  const landed = await page.evaluate(() => (window as unknown as { __landed: { slot: number; name: string; off: number }[] }).__landed);
  for (const l of landed) {
    expect(l.name, `drum ${l.slot} rests on the chosen leader`).toBe(q1[l.slot].userName);
    expect(l.off, `drum ${l.slot} is centred`).toBeLessThan(1);
  }
  expect(landed.map((l) => l.slot)).toEqual([0, 1, 2]); // one after another, like the reveals
  await shot(page, "picker-landed");

  // the ring: full when the wait starts, completely empty (and gone) when it reaches 0
  await expect(page.getByTestId("countdown")).toBeVisible({ timeout: 15_000 });
  const c = 2 * Math.PI * 46;
  const samples: { n: string; off: number; op: number }[] = [];
  for (let i = 0; i < 80 && (await page.getByTestId("countdown").count()) > 0; i++) {
    const smp = await page
      .evaluate(() => {
        const el = document.querySelector('[data-testid="countdown"]');
        const ring = el?.querySelectorAll("svg circle")[1];
        if (!el || !ring) return null;
        const cs = getComputedStyle(ring);
        return { n: el.getAttribute("aria-label") ?? "", off: parseFloat(cs.strokeDashoffset), op: parseFloat(cs.opacity) };
      })
      .catch(() => null);
    if (smp) samples.push(smp);
    await sleep(80);
  }
  expect(samples.length).toBeGreaterThan(10);
  expect(samples[0].off, "starts (nearly) full").toBeLessThan(c * 0.36);
  const last = samples.at(-1)!;
  expect(last.n.endsWith(": 1"), "the last sample is from the last second").toBe(true);
  expect(last.off, "the arc is used up when the number would hit 0").toBeGreaterThan(c * 0.9);
  expect(last.op, "and it has faded out, no stray dot").toBeLessThan(0.5);
  for (let i = 1; i < samples.length; i++) expect(samples[i].off, "the ring only ever drains").toBeGreaterThanOrEqual(samples[i - 1].off - 1e-6 - (samples[i].n === samples[i - 1].n ? 0 : c * 0.01));

  await context.close();
  await api.post("advance", { action: "reset" });
});

test("skip: the wait between questions and the speaking timer can be skipped, safely", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const api = new Admin(request);
  await api.setup({ teams: ["А", "Б", "В", "Г"], questions: ["Първи въпрос?", "Втори въпрос?"], speak: 90, pause: 40, reveal: 1, scroll: 1 });
  await api.ok("start", { simulate: true });
  const { context, page } = await adminPage(browser);
  await page.getByRole("button", { name: "Определи лидери" }).click();
  await expect(page.getByTestId("picking")).toBeVisible();
  await expect(page.getByTestId("picking-question")).toHaveText("Първи въпрос?");

  // the waiting badge shows its number; hovering turns the number into a skip button
  const badge = page.getByTestId("countdown");
  await expect(badge).toBeVisible({ timeout: 20_000 });
  const skip = page.getByTestId("countdown-skip");
  const number = skip.locator("span").first();
  await expect(number).toHaveCSS("opacity", "1");
  await skip.hover();
  await expect(number).toHaveCSS("opacity", "0");
  await expect(skip.locator("svg")).toHaveCSS("opacity", "1");
  await shot(page, "countdown-skip-hover");
  // 40 s of waiting is cut short: Q2 is on screen within a few seconds
  await skip.click();
  await expect(page.getByTestId("picking-question")).toHaveText("Втори въпрос?", { timeout: 6_000 });
  expect((await api.state()).game).toMatchObject({ stage: "picking", qIndex: 1 });

  // the last wait leads to the results
  await expect(page.getByTestId("countdown")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("countdown-skip").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 6_000 });
  expect((await api.state()).assignments.every((a) => a.revealed)).toBe(true);

  // presentation: a faint skip icon next to the big timer, with a question first
  await page.getByTestId("start-presentation").click();
  await expect(page.getByTestId("presenting")).toBeVisible();
  const startedAt = (await api.state()).game.timerStartedAt;
  await page.getByTestId("skip-timer").click();
  const ask = page.getByRole("dialog", { name: "Пропускане на времето" });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Да минем ли към В2?");
  await shot(page, "skip-confirm");
  await ask.getByRole("button", { name: "Отказ" }).click();
  await expect(ask).toBeHidden();
  expect((await api.state()).game).toMatchObject({ stage: "presenting", qIndex: 0, timerStartedAt: startedAt }); // nothing changed

  await page.getByTestId("skip-timer").click();
  await page.getByTestId("skip-confirm").dblclick(); // a double click still skips exactly once
  await expect(page.getByTestId("presenting-question")).toHaveText("Втори въпрос?");
  const after = (await api.state()).game;
  expect(after).toMatchObject({ stage: "presenting", qIndex: 1 });
  expect(after.timerStartedAt!).toBeGreaterThan(startedAt!); // Q2 has its own, full timer
  expect(clockSeconds(await page.getByTestId("timer").innerText())).toBeGreaterThanOrEqual(85);
  await expectFits(page, "presenting");

  // skipping the last question ends the game, so it says so
  await page.getByTestId("skip-timer").click();
  await expect(ask).toContainText("Да завършим ли играта?");
  await expect(ask).toContainText("данните на участниците се изтриват");
  await ask.getByRole("button", { name: "Отказ" }).click();
  expect((await api.state()).game.status).toBe("live");
  await page.getByTestId("skip-timer").click();
  await page.getByTestId("skip-confirm").click();
  await expect(page.getByTestId("thanks")).toBeVisible();
  const done = await api.state();
  expect(done.game.status).toBe("finished");
  expect(done.playerCount).toBe(0);

  await context.close();
  await api.post("advance", { action: "reset" });
});

test("stop presentation: back to the game board from the picking, results and presentation screens", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const api = new Admin(request);
  await api.setup({ teams: ["А", "Б", "В", "Г"], questions: ["Първи въпрос?", "Втори въпрос?"], speak: 90, pause: 1, reveal: 1, scroll: 1 });
  await api.ok("start", { simulate: true });
  const { context, page } = await adminPage(browser);
  const stop = page.getByTestId("stop-presentation");
  const board = page.getByText("Играта тече");

  // 1. while the draw is running
  await page.getByRole("button", { name: "Определи лидери" }).click();
  await expect(page.getByTestId("picking")).toBeVisible();
  await expect(stop).toBeVisible();
  await expect(page.getByRole("button", { name: "Изход" })).toBeVisible(); // still next to it
  await shot(page, "stop-button");
  await stop.click();
  const dialog = page.getByRole("dialog", { name: "Спиране на презентацията" });
  await expect(dialog).toBeVisible();
  await shot(page, "stop-confirm");
  await dialog.getByRole("button", { name: "Отказ" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("picking")).toBeVisible(); // "Отказ" changes nothing
  expect((await api.state()).assignments).toHaveLength(4);
  await stop.click();
  await page.getByTestId("confirm-stop").click();
  await expect(board).toBeVisible();
  let s = await api.state();
  expect(s.game).toMatchObject({ status: "live", stage: "lobby", qIndex: 0, timerStartedAt: null });
  expect(s.assignments).toHaveLength(0);
  expect(s.playerCount).toBe(100);
  await expect(page.getByTestId("player-count")).toHaveText("100");

  // 2. a new draw runs through to the results, and stops there
  await page.getByRole("button", { name: "Определи лидери" }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60_000 });
  await stop.click();
  await page.getByTestId("confirm-stop").click();
  await expect(board).toBeVisible();
  expect((await api.state()).assignments).toHaveLength(0);

  // 3. ... and while a question is being presented
  await page.getByRole("button", { name: "Определи лидери" }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("start-presentation").click();
  await expect(page.getByTestId("presenting")).toBeVisible();
  await expectFits(page, "presenting");
  await stop.click();
  await page.getByTestId("confirm-stop").click();
  await expect(board).toBeVisible();
  s = await api.state();
  expect(s.game).toMatchObject({ status: "live", stage: "lobby", qIndex: 0, timerStartedAt: null });
  expect(s.assignments).toHaveLength(0);
  expect(s.playerCount).toBe(100);
  // the board is fully usable again: the draw can be made once more
  await expect(page.getByRole("button", { name: "Определи лидери" })).toBeEnabled();
  await page.getByRole("button", { name: "Определи лидери" }).click();
  await expect(page.getByTestId("picking")).toBeVisible();

  await context.close();
  await api.post("advance", { action: "reset" });
});

test("presentation screen: at most 5 speakers per row, narrow badges, the code centred", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const api = new Admin(request);
  // 10 teams, one question: all ten leaders speak on it, so there are two rows
  await api.setup({ teams: ["Един", "Два", "Три", "Четири", "Пет", "Шест", "Седем", "Осем", "Девет", "Десет"], questions: ["Единствен въпрос?"], speak: 90, pause: 1, reveal: 1, scroll: 1 });
  await api.ok("start");
  const names = ["Александра-Константина Петрова-Иванова", "Ив", "Ж", "Христофор Христофоров", "Ана-Мария", "Борислав", "Цветелина", "Гергана", "Владислав", "Мария"];
  for (let i = 0; i < 20; i++) await join(request, names[i % names.length].slice(0, 30));
  await api.ok("assign");
  const s = await api.state();
  for (const a of s.assignments) await api.ok("reveal", { assignmentId: a.id });
  await api.ok("advance", { action: "next-pick", qIndex: 0 });
  await api.ok("advance", { action: "start-presentation" });

  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const { context, page } = await adminPage(browser, size);
    await expect(page.getByTestId("presenting")).toBeVisible();
    const badges = page.getByTestId("speakers").locator(":scope > div");
    await expect(badges).toHaveCount(10);
    await expectFits(page, "presenting");
    const boxes = await Promise.all((await badges.all()).map((b) => b.boundingBox()));
    const rows = new Map<number, number>();
    for (const b of boxes) rows.set(Math.round(b!.y), (rows.get(Math.round(b!.y)) ?? 0) + 1);
    expect([...rows.values()].sort(), "5 badges per row").toEqual([5, 5]);
    for (const b of boxes) expect(b!.width, "5 comfortably fit").toBeLessThan(size.width / 5);
    // the code sits in the vertical middle of its badge
    for (const badge of await badges.all()) {
      const bb = (await badge.boundingBox())!;
      const code = (await badge.locator("span.tnum").boundingBox())!;
      expect(Math.abs(code.y + code.height / 2 - (bb.y + bb.height / 2)), "code centred vertically").toBeLessThan(3);
    }
    // long names break between words, not inside them
    const broken = await page.getByTestId("speakers").evaluate((el) => {
      const out: string[] = [];
      for (const p of el.querySelectorAll<HTMLElement>("p.display")) {
        const words = (p.textContent ?? "").split(/[\s-]+/).filter(Boolean);
        const range = document.createRange();
        const text = p.firstChild!;
        let at = 0;
        for (const w of words) {
          at = (p.textContent ?? "").indexOf(w, at);
          range.setStart(text, at);
          range.setEnd(text, at + w.length);
          if (range.getClientRects().length > 1) out.push(w);
          at += w.length;
        }
      }
      return out;
    });
    expect(broken, `${size.width}: no word is split across lines`).toEqual([]);
    await shot(page, `${size.width}-speakers-two-rows`);
    await context.close();
  }
  await api.post("advance", { action: "reset" });
});

// ───────────── 4. projector screens at real-world sizes with worst-case content ─────────────

for (const size of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  test(`projector screens never scroll at ${size.width}x${size.height} (long texts, many slots)`, async ({ browser, request }) => {
    test.setTimeout(240_000);
    const api = new Admin(request);
    const longQ = "Как според вас Интеракт клубовете могат да привлекат и задържат нови членове, като същевременно развиват устойчиви проекти, които наистина променят общностите около тях и вдъхновяват другите? ".repeat(2).trim().slice(0, 400);
    const teams = ["Много дълго име на отбор номер едно", "Отбор 2", "Отбор 3", "Отбор 4", "Отбор 5", "Отбор 6", "Отбор 7", "Отбор 8"];
    await api.setup({ teams, questions: [longQ, "Кратък въпрос?"], speak: 4, pause: 2, reveal: 1, scroll: 1 });
    await api.ok("start");
    const names = ["Александра-Константина Петрова-Иванова", "Ив", "Ж", "Христофор Христофоров", "Ана-Мария", "Борислав", "Цветелина", "Гергана"];
    for (let i = 0; i < 24; i++) await join(request, names[i % names.length].slice(0, 30));

    const { context, page } = await adminPage(browser, size);
    await page.getByRole("button", { name: "Определи лидери" }).click();
    await expect(page.getByTestId("picking")).toBeVisible();
    // Q1 has 4 of 8 slots; check at several moments of the show
    for (let i = 0; i < 6; i++) {
      await expectFits(page, "picking");
      await expectInViewport(page.getByTestId("slot"));
      if (i === 0 || i === 5) await shot(page, `${size.width}-picking-${i}`);
      await sleep(700);
    }
    await expect(page.getByTestId("picking-question")).toHaveText("Кратък въпрос?", { timeout: 40_000 });
    await expectFits(page, "picking");
    await expect(page.getByTestId("results")).toBeVisible({ timeout: 40_000 });
    await expectFits(page, "results");
    await expectFits(page, "results-body");
    await shot(page, `${size.width}-results`);
    await page.getByTestId("start-presentation").click();
    await expect(page.getByTestId("presenting")).toBeVisible();
    await expectFits(page, "presenting");
    await shot(page, `${size.width}-presenting`);
    await expectInViewport(page.getByTestId("timer"));
    await expectInViewport(page.getByTestId("speakers").locator(":scope > div"));
    await expect(page.getByTestId("timeup")).toBeVisible({ timeout: 15_000 });
    await expectInViewport(page.getByTestId("continue"));
    await expectCentered(page.getByRole("dialog", { name: "Времето изтече" }));
    await shot(page, `${size.width}-timeup`);
    await context.close();
    await api.post("advance", { action: "reset" });
  });
}
