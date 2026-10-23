// Offline contract checks. All request destinations are numeric loopback; no real keys are inherited.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const packet = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("provide_return_packet_directory");
fs.mkdirSync(path.join(packet, "results"), { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "haruhi-bfix-"));
const output = path.join(repo, "eval");
fs.mkdirSync(path.join(temp, "eval"));
fs.copyFileSync(path.join(repo, "eval/judge-set.json"), path.join(temp, "eval/judge-set.json"));
fs.writeFileSync(path.join(temp, ".env.local"), "ANTHROPIC_API_KEY=sk-fixture-env-only\nCHAT_MODEL=env-fixture-model\nJUDGE_MODEL=env-fixture-judge\n");
const key = "sk-fixture-active-key-not-real";
const cases = [];
const commands = [];
const items = JSON.parse(fs.readFileSync(path.join(repo, "eval/judge-set.json"), "utf8")).items;
const actions = [...new Set(items.map((x) => x.label))];
let mode = "probabilities", sessions = 0, judgeRequests = 0;
const served = { requests: 0, remoteRequests: 0 };
function json(res, status, body) { res.writeHead(status, { "content-type": "application/json", "x-should-retry": "false" }); res.end(JSON.stringify(body)); }
const fixture = http.createServer(async (req, res) => {
  served.requests++;
  let body = ""; for await (const part of req) body += part;
  const data = body ? JSON.parse(body) : {};
  if (req.url.startsWith("/api/session")) {
    sessions++;
    if (mode === "mixed-chat" && sessions === 1) return json(res, 401, {});
    if (mode === "mixed-chat" && sessions === 2) return json(res, 200, {});
    res.setHeader("set-cookie", "fixture=local-session; HttpOnly; SameSite=Lax");
    return json(res, 200, { user: { mock: true } });
  }
  if (req.url.startsWith("/api/chat")) {
    if (mode === "mixed-chat" && [3, 4, 5].includes(sessions)) return json(res, { 3: 401, 4: 429, 5: 503 }[sessions], {});
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    if (mode === "mixed-chat" && sessions === 6) return res.end(JSON.stringify({ t: "error", message: key }));
    if (mode === "mixed-chat" && sessions === 7) return res.end(JSON.stringify({ t: "d", v: "중간에 끊김" }));
    if (mode === "mixed-chat" && sessions === 8) return res.end(JSON.stringify({ t: "meta" }));
    if (mode === "mixed-chat" && sessions === 9) return res.end("invalid-json\n");
    if (mode === "mixed-chat" && sessions === 10) return res.end(JSON.stringify({ t: "d", v: 4 }));
    return res.end(JSON.stringify({ t: "d", v: "검증용 응답 " + key }) + "\n" + JSON.stringify({ t: "meta" }) + "\n");
  }
  if (req.url === "/v1/systemone") {
    if (mode === "http500") return json(res, 500, { error: key });
    const action = items.find((item) => item.user === data.state.user_message)?.label ?? "neutral";
    const answer = { choice: mode === "invalid-action" ? "unknown_action" : action };
    if (mode === "confidence") answer.confidence = 0.1;
    else if (mode !== "no-confidence") answer.probabilities = Object.fromEntries(actions.map((name) => [name, name === action ? 0.19 : 0.09]));
    return json(res, 200, { model: "fixture-local", answers: { action: answer, has_fact: { noul: 0 } }, ...(mode === "no-tokens" ? {} : { usage: { input_tokens: mode === "zero-tokens" ? 0 : 25, output_tokens: 0 } }) });
  }
  if (req.url === "/v1/messages") {
    judgeRequests++;
    if (mode === "judge-http500" || mode === "haiku-error") return json(res, 500, { type: "error", error: { type: "api_error", message: key + "0123456789".repeat(20) } });
    let text = JSON.stringify({ grade: "캐릭터답다", why: key });
    if (mode === "judge-empty") text = "";
    if (mode === "judge-json") text = "not-json " + key;
    if (mode === "judge-grade") text = JSON.stringify({ grade: "좋음", why: key });
    if (mode === "haiku-success") {
      const query = data.messages[0].content.split("\n사용자: ").at(-1);
      text = JSON.stringify({ action: items.find((x) => x.user === query)?.label ?? "neutral", facts: [], reason: key });
    }
    return json(res, 200, { id: "msg_fixture", type: "message", role: "assistant", model: data.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 25, output_tokens: 7 } });
  }
  return json(res, 404, {});
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixtureBase = "http://127.0.0.1:" + fixture.address().port;
const preload = path.join(repo, "scripts/test-fixtures/loopback-only.mjs");
const loader = path.join(repo, "node_modules/tsx/dist/loader.mjs");
function env(extra = {}) {
  const safe = Object.fromEntries(["PATH", "HOME", "TMPDIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  return { ...safe, B_FIX_FIXTURE: "1", NEXT_TELEMETRY_DISABLED: "1", TZ: "Asia/Seoul", NODE_ENV: "test", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", TYPESAFE_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", DATABASE_URL: "", LOCAL_LLM_URL: "", LOCAL_JUDGE_URL: "", ADMIN_KEY: "", ANTHROPIC_BASE_URL: fixtureBase, CHAT_MODEL: "shell-fixture-model", EVAL_TIMEOUT_MS: "5000", EVAL_OUTPUT_DIR: output, ...extra };
}
async function execute(name, script, args = [], extra = {}, onOutput) {
  const before = new Set(fs.readdirSync(output));
  const childEnv = env(extra);
  for (const [k, v] of Object.entries(childEnv)) if (v === null) delete childEnv[k];
  const child = spawn(process.execPath, ["--import", preload, "--import", loader, path.join(repo, script), ...args], { cwd: temp, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const timeout = setTimeout(() => child.kill("SIGKILL"), 90000);
  child.stdout.on("data", (b) => { stdout += b; onOutput?.(stdout); });
  child.stderr.on("data", (b) => { stderr += b; });
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));
  clearTimeout(timeout);
  assert.equal(exitCode, 0, name + " failed: " + stderr.replaceAll(key, "[REDACTED]"));
  const created = fs.readdirSync(output).filter((file) => !before.has(file) && /\.(json|md)$/.test(file));
  assert.equal(created.length, 2, name + " should save exactly one md/json pair");
  let result;
  for (const file of created) {
    const text = fs.readFileSync(path.join(output, file), "utf8");
    assert.equal(text.includes(key), false, name + " leaked fixture key");
    assert.equal(text.includes("sk-fixture-env-only"), false, name + " leaked env-file key");
    fs.copyFileSync(path.join(output, file), path.join(packet, "results", name + "--" + file));
    if (file.endsWith(".json")) result = JSON.parse(text);
  }
  const record = { name, script, args, exitCode, files: created.map((f) => "results/" + name + "--" + f), summary: result.summary ?? result.summaries };
  cases.push(record);
  console.log("PASS files " + name);
  return result;
}
const failures = (data, n = 60) => { const s = Object.values(data.summaries)[0]; assert.equal(s.failures, n); assert.equal(s.accuracyAll, "0.0%"); assert.equal(s.success, 0); };
let app;
try {
  // Verify the fixture's guard itself; a forbidden URL must fail before DNS/network.
  const guard = spawn(process.execPath, ["--import", preload, "--input-type=module", "-e", "try { await fetch('https://api.openai.com/v1/decisions'); process.exit(2); } catch(e) { if(e.message !== 'fixture_non_loopback_blocked') process.exit(3); }"], { cwd: temp, env: env(), stdio: "ignore" });
  assert.equal(await new Promise((resolve) => guard.on("exit", resolve)), 0);
  failures(await execute("V1-no-key", "scripts/judge-eval.mts", ["haiku"]));
  failures(await execute("V1-unreachable", "scripts/judge-eval.mts", ["haiku"], { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: "http://127.0.0.1:9" }));
  for (const variant of ["probabilities", "confidence", "no-tokens", "http500", "zero-tokens", "no-confidence", "invalid-action"]) {
    mode = variant;
    const data = await execute("V2-" + variant, "scripts/judge-eval.mts", ["local"], { LOCAL_JUDGE_URL: fixtureBase });
    const s = data.summaries.local;
    if (["http500", "invalid-action"].includes(variant)) failures(data);
    else {
      assert.equal(s.success, 60); assert.equal(s.accuracyAll, "100.0%");
      assert.equal(s.confidenceProvided, variant === "no-confidence" ? 0 : 60);
      assert.equal(s.held, variant === "no-confidence" ? 0 : 54);
      assert.equal(s.costDisplay, variant === "no-tokens" ? "알 수 없음" : "0 (로컬)");
      if (variant === "no-tokens") assert.ok(data.results.local.every((r) => r.inputTokens === null));
      if (variant === "zero-tokens") assert.ok(data.results.local.every((r) => r.inputTokens === 0));
      if (variant === "no-confidence") assert.equal(s.holdRate, "해당 없음");
    }
  }
  mode = "haiku-success";
  const hs = await execute("F-haiku-success", "scripts/judge-eval.mts", ["haiku"], { ANTHROPIC_API_KEY: key });
  assert.equal(hs.summaries.haiku.success, 60); assert.equal(hs.summaries.haiku.holdRate, "해당 없음");
  assert.ok(Math.abs(hs.summaries.haiku.costPer1000 - 0.06) < 1e-12);
  mode = "haiku-error";
  failures(await execute("F-haiku-error", "scripts/judge-eval.mts", ["haiku"], { ANTHROPIC_API_KEY: key }));
  for (const variant of ["judge-http500", "judge-empty", "judge-json", "judge-grade"]) {
    mode = variant; sessions = 0;
    const d = await execute("V4-" + variant, "scripts/eval.mjs", [], { BASE: fixtureBase, ANTHROPIC_API_KEY: key });
    assert.equal(d.summary.judgeFailures, 20); assert.equal(d.summary.judged, 0); assert.equal(d.summary.groupTotal, 20);
    assert.ok(d.rows.every((r) => r.status === "judge_failed"));
  }
  mode = "mixed-chat"; sessions = 0; judgeRequests = 0;
  const mixed = await execute("E1-mixed-failures", "scripts/eval.mjs", [], { BASE: fixtureBase, ANTHROPIC_API_KEY: key });
  assert.equal(mixed.summary.chatFailures, 10); assert.equal(judgeRequests, 10); assert.equal(mixed.summary.groupTotal, 20);
  assert.deepEqual(mixed.rows.slice(0, 10).map((r) => r.failure), ["session_http_401", "session_cookie_missing", "chat_http_401", "chat_http_429", "chat_http_503", "stream_error", "stream_meta_missing", "empty_reply", "stream_json_invalid", "stream_delta_invalid"]);
  mode = "judge-success";
  const loaded = await execute("G1-env-file-and-shell", "scripts/eval.mjs", [], { BASE: fixtureBase, ANTHROPIC_API_KEY: null, CHAT_MODEL: "shell-model-priority" });
  assert.equal(loaded.summary.judged, 20); assert.equal(loaded.declaredModel, "shell-model-priority"); assert.equal(loaded.judgeModel, "env-fixture-judge");
  const shortSecrets = await execute("G-secret-scalar-types", "scripts/eval.mjs", [], { BASE: fixtureBase, ANTHROPIC_API_KEY: key, SHORT_SECRET: "1", TEST_TOKEN: "false", TOKENIZERS_PARALLELISM: "false" });
  assert.equal(shortSecrets.serverModelVerified, false); assert.equal(shortSecrets.summary.examples, 20); assert.equal(shortSecrets.summary.judged, 20); assert.equal(shortSecrets.rows[0].n, 1);
  mode = "probabilities";
  const shortJudge = await execute("F-secret-scalar-types", "scripts/judge-eval.mts", ["local"], { LOCAL_JUDGE_URL: fixtureBase, SHORT_SECRET: "1", TEST_TOKEN: "false", TOKENIZERS_PARALLELISM: "false" });
  assert.equal(shortJudge.summaries.local.success, 60); assert.equal(shortJudge.results.local[0].n, 1); assert.equal(shortJudge.summaries.local.accuracyAll, "100.0%");
  // Refuse starting Next if any real local environment file exists; never read one.
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) assert.equal(fs.existsSync(path.join(repo, name)), false, "real env file exists; app launch withheld");
  const reserving = http.createServer(); await new Promise((resolve) => reserving.listen(0, "127.0.0.1", resolve));
  const port = reserving.address().port; await new Promise((resolve) => reserving.close(resolve));
  const appBase = "http://127.0.0.1:" + port;
  const appArgs = ["--import", preload, path.join(repo, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)];
  app = spawn(process.execPath, appArgs, { cwd: repo, env: env({ NODE_ENV: "production", PGLITE_DIR: path.join(temp, "app-db") }), stdio: ["ignore", "pipe", "pipe"] });
  let appLog = ""; app.stdout.on("data", (b) => { appLog += b; }); app.stderr.on("data", (b) => { appLog += b; });
  commands.push({ role: "V3/V5 real Next production build in mock mode", executable: process.execPath, args: appArgs, noProviderKeys: true, isolatedDatabase: true });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) throw new Error("mock_app_exited: " + appLog);
    try { const r = await fetch(appBase + "/api/session", { signal: AbortSignal.timeout(500) }); if (r.status === 200) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "mock_app_not_ready");
  const proof = await (await fetch(appBase + "/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: "연습확인", consent: true }) })).json();
  assert.equal(proof.user.mock, true);
  const v3 = await execute("V3-real-app-mock", "scripts/eval.mjs", [], { BASE: appBase, ANTHROPIC_API_KEY: "", CHAT_MODEL: "declared-only-fixture" });
  assert.equal(v3.summary.noJudge, 20); assert.equal(v3.summary.chatFailures, 0); assert.equal(v3.summary.groupTotal, 20);
  let stopped = false;
  const v5 = await execute("V5-app-stopped", "scripts/eval.mjs", [], { BASE: appBase, ANTHROPIC_API_KEY: "" }, (text) => { if (!stopped && /(?:^| )3 /.test(text)) { stopped = true; app.kill("SIGTERM"); } });
  assert.ok(stopped); assert.ok(v5.summary.chatFailures > 0); assert.equal(v5.summary.groupTotal, 20); assert.equal(v5.rows.length, 20);
  fs.writeFileSync(path.join(packet, "VERIFICATION.json"), JSON.stringify({ status: "passed", finishedAt: new Date().toISOString(), cases, appCommands: commands, fixtureRequests: served.requests, realProviderRequests: 0, loopbackGuardChecked: true, secretsInherited: false, note: "Fixture classifications are deterministic test answers, not model performance. SDK retry options were reduced only by the fixture preload." }, null, 2) + "\n");
  console.log("B_FIX_VERIFICATION passed " + cases.length + " cases; real provider requests 0");
} catch (error) {
  fs.writeFileSync(path.join(packet, "VERIFICATION.json"), JSON.stringify({ status: "failed", error: String(error).replaceAll(key, "[REDACTED]"), cases, appCommands: commands, realProviderRequests: 0 }, null, 2) + "\n");
  throw error;
} finally {
  app?.kill("SIGTERM");
  await new Promise((resolve) => fixture.close(resolve));
  // Isolated temporary inputs and database only; all evaluation results are preserved above.
  fs.rmSync(temp, { recursive: true, force: true });
}
