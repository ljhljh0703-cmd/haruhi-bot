// Local browser regressions only. Creates synthetic sessions; never deletes existing users.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_BASE || "http://127.0.0.1:3123";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local test target only");
const output = process.env.RECOVERY_OUTPUT;
assert.ok(output, "RECOVERY_OUTPUT must name the authorized result file");
const previous = await fs.readFile(output, "utf8").then(JSON.parse).catch(() => null);
const result = { retryReason: process.env.RECOVERY_SCENARIO === "day_end" ? "Retry only the failed scenario after fixing the accessible-name selector; product sources unchanged" : null, startedAt: new Date().toISOString(), mode: "isolated-chrome-local-mock", status: "running", scenarios: [], checks: [], errors: [], externalRequestsBlocked: 0, sourceHashes: {}, syntheticUsersRetained: true };
const pass = (name, details = {}) => { result.checks.push({ name, ...details }); console.log("PASS " + name); };
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const contexts = [];
const stamp = Date.now().toString(36);
async function waitUntil(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 80)); }
  throw new Error(message);
}
async function session(character, suffix, dropFirstOpen = false) {
  const nickname = "복구" + stamp + suffix;
  assert.ok(nickname.length <= 12);
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  contexts.push(context);
  const observed = { dropped: 0, openCount: 0, requestIds: new Set(), committedId: null, replayIds: [] };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) { result.externalRequestsBlocked++; return route.abort(); }
    if (url.pathname === "/api/survey" && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body?.action === "open" && body.trigger === "turn10") {
        observed.openCount++;
        observed.requestIds.add(body.requestId);
        if (dropFirstOpen && observed.dropped === 0) {
          observed.dropped++;
          const response = await route.fetch();
          assert.equal(response.status(), 200, "Server must commit the initial open");
          const data = await response.json();
          assert.ok(data.presentation?.id, "Initial open must have a committed presentation");
          observed.committedId = data.presentation.id;
          await route.abort("failed");
          return;
        }
      }
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => result.errors.push("pageerror: " + error.message));
  page.on("response", async (response) => {
    try {
      if (new URL(response.url()).pathname !== "/api/survey" || response.request().method() !== "POST") return;
      const body = response.request().postDataJSON();
      if (body?.action !== "open" || body.trigger !== "turn10" || !response.ok()) return;
      const data = await response.json();
      if (data.presentation) observed.replayIds.push(data.presentation.id);
    } catch { /* The one deliberately aborted response has no browser body. */ }
  });
  await page.goto(base + "/?c=" + character, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox").fill(nickname);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "시작하기", exact: true }).click();
  await page.locator(".vn-input").waitFor();
  return { context, page, character, nickname, observed };
}
async function sayApi(s) {
  const response = await s.context.request.post(base + "/api/chat?c=" + s.character, { data: { text: "검증 대화입니다" }, timeout: 20000 });
  assert.equal(response.status(), 200);
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const meta = events.find((event) => event.t === "meta");
  assert.ok(meta, "API turn must reach meta");
  assert.ok(!events.some((event) => event.t === "error"));
  assert.equal(meta.user.mock, true, "Never run this regression against a real AI provider");
  return meta.user;
}
async function sayUi(s) {
  await s.page.locator("#msg").fill("검증 대화입니다");
  const started = s.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/chat" && r.request().method() === "POST");
  await s.page.getByRole("button", { name: "보내기", exact: true }).click();
  await started;
  // Response.finished can hang on the local intercepted stream. The flag only exists after streaming ends.
  await s.page.locator(".vn-flag").waitFor();
}
async function exportOwn(s) {
  const response = await s.context.request.get(base + "/api/admin?export=feedback&rules=all&char=" + s.character);
  assert.equal(response.status(), 200);
  const body = await response.json();
  return { presentations: body.presentations.filter((p) => p.nickname === s.nickname), surveys: body.surveys.filter((p) => p.nickname === s.nickname) };
}
async function assertOffscreen(s) {
  const box = await s.page.locator(".survey-card").evaluate((element) => ({ top: element.getBoundingClientRect().top, height: window.innerHeight, scrollY: window.scrollY }));
  assert.ok(box.top >= box.height, "Card must remain below the viewport until explicitly scrolled");
  return box;
}
try {
  if (process.env.RECOVERY_SCENARIO !== "day_end") {
  const a = await session("haruhi", "A", true);
  const firstScenario = { name: "committed-open response loss and refresh recovery", nickname: a.nickname, status: "running" };
  result.scenarios.push(firstScenario);
  for (let turn = 0; turn < 9; turn++) await sayApi(a);
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.locator(".vn-input").waitFor();
  await sayUi(a);
  await a.page.locator(".survey-card").waitFor({ state: "attached" });
  await waitUntil(() => a.observed.replayIds.includes(a.observed.committedId), "Bounded retry did not recover the committed presentation");
  assert.equal(a.observed.dropped, 1);
  assert.equal(a.observed.openCount, 2, "Exactly one retry should recover the lost response");
  assert.equal(a.observed.requestIds.size, 1);
  const beforeReloadPosition = await assertOffscreen(a);
  let own = await exportOwn(a);
  assert.equal(own.presentations.length, 1);
  assert.equal(own.presentations[0].shownAt, null);
  pass("Dropped first open response recovers the same unshown reservation with one retry", { nickname: a.nickname, openRequests: a.observed.openCount, requestTokens: a.observed.requestIds.size, position: beforeReloadPosition });

  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.locator(".vn-input").waitFor();
  await a.page.locator(".survey-card").waitFor({ state: "attached" });
  await waitUntil(() => a.observed.replayIds.length >= 2, "Reload did not recover the presentation");
  assert.ok(a.observed.replayIds.every((id) => id === a.observed.committedId));
  assert.equal(a.observed.openCount, 3);
  assert.equal(a.observed.requestIds.size, 1);
  await assertOffscreen(a);
  own = await exportOwn(a);
  assert.equal(own.presentations.length, 1);
  assert.equal(own.presentations[0].shownAt, null);
  pass("Reload before viewport exposure recovers one reservation without counting a display", { nickname: a.nickname, presentations: 1, shown: 0 });

  await a.page.locator(".survey-card").scrollIntoViewIfNeeded();
  await waitUntil(async () => Boolean((await exportOwn(a)).presentations[0]?.shownAt), "Visible card did not record shown");
  const availability = a.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/survey" && r.request().method() === "GET");
  await a.page.reload({ waitUntil: "domcontentloaded" });
  const available = await (await availability).json();
  assert.equal(available.available, null);
  await a.page.locator(".vn-input").waitFor();
  assert.equal(await a.page.locator(".survey-card").count(), 0);
  own = await exportOwn(a);
  assert.equal(own.presentations.length, 1);
  assert.equal(own.presentations.filter((p) => p.shownAt).length, 1);
  assert.equal(own.surveys.length, 0);
  pass("Reload after actual exposure does not reopen; export has one reservation and one shown", { nickname: a.nickname, presentations: 1, shown: 1, surveys: 0 });
  firstScenario.status = "passed";
  firstScenario.finalCounts = { presentations: own.presentations.length, shown: own.presentations.filter((p) => p.shownAt).length, surveys: own.surveys.length };
  await a.context.close();
  }

  const b = await session("jaeheon", "B");
  const secondScenario = { name: "day-end eligibility after closing a retained tenth-turn card", nickname: b.nickname, status: "running" };
  result.scenarios.push(secondScenario);
  for (let turn = 0; turn < 9; turn++) await sayApi(b);
  await b.page.reload({ waitUntil: "domcontentloaded" });
  await b.page.locator(".vn-input").waitFor();
  await sayUi(b);
  await b.page.getByText("지금까지 대화는 어땠나요?", { exact: true }).waitFor();
  for (let turn = 10; turn < 49; turn++) {
    const state = await sayApi(b);
    if ((turn + 1) % 10 === 0 || turn + 1 === 49) console.log("PROGRESS retained turn10 card; completed turns=" + (turn + 1) + "; remaining=" + state.dayTurnsLeft);
  }
  await sayUi(b);
  await b.page.locator(".done-card").waitFor();
  await b.page.getByText("지금까지 대화는 어땠나요?", { exact: true }).waitFor();
  await b.page.locator(".survey-card").scrollIntoViewIfNeeded();
  await b.page.locator(".survey-card").getByRole("button", { name: "설문 닫기", exact: true }).click();
  await b.page.getByText("오늘 대화는 어땠나요?", { exact: true }).waitFor();
  assert.equal(await b.page.locator(".survey-card").count(), 1);
  await b.page.locator(".survey-card").scrollIntoViewIfNeeded();
  await waitUntil(async () => {
    const data = await exportOwn(b);
    return data.presentations.some((p) => p.trigger === "turn10" && p.skippedAt) && data.presentations.some((p) => p.trigger === "day_end" && p.shownAt);
  }, "Closing turn10 did not persist skip and expose day_end");
  const final = await exportOwn(b);
  assert.equal(final.presentations.filter((p) => p.trigger === "turn10").length, 1);
  assert.equal(final.presentations.filter((p) => p.trigger === "day_end").length, 1);
  pass("Retained tenth-turn card closes at turn fifty and immediately reveals one day-end card", { nickname: b.nickname, turn10: 1, dayEnd: 1, turn10Skipped: true, dayEndShown: true });
  secondScenario.status = "passed";
  secondScenario.finalCounts = { presentations: final.presentations.length, turn10: 1, dayEnd: 1, skipped: final.presentations.filter((p) => p.skippedAt).length };
  await b.context.close();
  assert.deepEqual(result.errors, []);
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.errors.push(String(error.stack || error));
  console.error("FAIL " + error.message);
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  for (const name of ["scripts/test-survey-recovery.mjs", "app/components/SurveyCard.tsx", "lib/surveys.ts", "app/api/survey/route.ts"]) {
    result.sourceHashes[name] = createHash("sha256").update(await fs.readFile(path.resolve(name))).digest("hex");
  }
  result.finishedAt = new Date().toISOString();
  const attempts = [...(previous?.attempts ?? (previous ? [previous] : [])), result];
  const scenarioMap = new Map();
  for (const attempt of attempts) for (const scenario of attempt.scenarios) scenarioMap.set(scenario.name, scenario);
  const scenarios = [...scenarioMap.values()];
  const report = {
    schemaVersion: "browser-recovery-1", startedAt: attempts[0].startedAt, finishedAt: result.finishedAt,
    mode: result.mode, status: result.status === "passed" && scenarios.length === 2 && scenarios.every((s) => s.status === "passed") ? "passed" : "failed",
    scenarios, checks: attempts.flatMap((a) => a.checks), attempts,
    resolvedHarnessFailure: attempts.length > 1 ? "The first attempt used button text instead of aria-label. Only the failed second scenario was repeated after correcting its selector." : null,
    sourceHashes: result.sourceHashes, syntheticUsersRetained: true,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, scenarios: report.scenarios.length, checks: report.checks.length, output }));
}
