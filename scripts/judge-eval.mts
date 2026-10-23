// 같은 합성 예문을 비교한다. 실패/미제공 값은 정답이나 0으로 바꾸지 않는다.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JudgeProvider } from "../lib/judges";

const shell = { ...process.env };
if (fs.existsSync(".env.local")) { process.loadEnvFile(".env.local"); Object.assign(process.env, shell); }
// Import after environment loading: config exports read environment values at import time.
const { ACTION_KEYS, PRICE_PER_MTOK } = await import("../lib/config");
const { available, runJudge } = await import("../lib/judges");
const { judgeHaiku } = await import("../lib/llm");
const { getCharacter } = await import("../lib/characters");
const secretValues = Object.entries(process.env).filter(([k, v]) => /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|DATABASE_URL)$/i.test(k) && v).map(([, v]) => v!).sort((a, b) => b.length - a.length);
const redact = (value: string) => secretValues.reduce((s, secret) => secret.length >= 8 ? s.split(secret).join("[REDACTED]") : s === secret ? "[REDACTED]" : s, value).replace(/\bBearer\s+[^\s"\\]+/gi, "Bearer [REDACTED]").replace(/\bsk-[\w-]+/g, "[REDACTED]");
const redactTree = (value: unknown): unknown => typeof value === "string" ? redact(value) : Array.isArray(value) ? value.map(redactTree) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactTree(child)])) : value;
const cell = (value: unknown) => redact(String(value ?? "")).replace(/\|/g, "/").replace(/[\r\n]+/g, " ");
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const confidence = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
const char = getCharacter(process.env.CHAR || "haruhi");
const set = JSON.parse(fs.readFileSync("eval/judge-set.json", "utf8")).items as { stage: string; haruhi: string; user: string; label: string }[];
const args = process.argv.slice(2);
if (args.some((p) => !["jev", "openai", "local", "haiku"].includes(p))) throw new Error("unknown_judge_provider");
const providers = [...new Set(args.length ? args : available())] as JudgeProvider[];
const minConf = Number(process.env.JEV_MIN_CONF || 0.3);
if (!Number.isFinite(minConf)) throw new Error("invalid_confidence_threshold");
if (!providers.length) { console.error("키가 있는 판정기가 없음"); process.exit(1); }

type Wire = { provider: JudgeProvider; observed: boolean; action: unknown; probabilitiesProvided: boolean; inputTokens: number | null; outputTokens: number | null; responseModel: string | null };
type Row = { n: number; label: string; result: string | null; success: boolean; confidence: number | null; probabilitiesProvided: boolean; inputTokens: number | null; outputTokens: number | null; ms: number; failure: string | null; responseModel: string | null };
let wire: Wire | null = null;
const originalFetch = globalThis.fetch;
// Observe a clone only. The provider receives its original response unchanged.
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await originalFetch(...args);
  const observation = wire;
  if (observation && response.status === 200) {
    try {
      const data = await response.clone().json();
      observation.observed = true;
      observation.inputTokens = numeric(data.usage?.input_tokens);
      observation.outputTokens = numeric(data.usage?.output_tokens);
      observation.responseModel = typeof data.model === "string" ? data.model : null;
      if (observation.provider !== "haiku") {
        const a = Array.isArray(data.answers) ? data.answers.find((x: any) => x.name === "action") ?? data.answers[0] ?? {} : data.answers?.action ?? {};
        const entries: [string, unknown][] = Array.isArray(a.probabilities)
          ? a.probabilities.map((x: any) => [String(x.value), x.probability])
          : a.probabilities && typeof a.probabilities === "object" ? Object.entries(a.probabilities) : [];
        const valid = entries.length > 0 && entries.every(([, v]) => confidence(v) !== null);
        observation.probabilitiesProvided = valid;
        observation.action = a.choice ?? (valid ? entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0][0] : null);
      }
    } catch { /* A malformed body is handled by the actual provider call. */ }
  }
  return response;
};

const results: Record<string, Row[]> = {};
try {
  for (const p of providers) {
    const rows: Row[] = [];
    for (const [index, item] of set.entries()) {
      const start = Date.now();
      wire = { provider: p, observed: false, action: null, probabilitiesProvided: false, inputTokens: null, outputTokens: null, responseModel: null };
      const row: Row = { n: index + 1, label: item.label, result: null, success: false, confidence: null, probabilitiesProvided: false, inputTokens: null, outputTokens: null, ms: 0, failure: null, responseModel: null };
      try {
        if (p === "haiku") {
          if (!process.env.ANTHROPIC_API_KEY) throw new Error("missing_api_key");
          const h = await judgeHaiku(char, item.haruhi, item.user, item.stage);
          if (h.error || h.flags.includes("judge_error")) throw new Error(h.error === "unknown_action" ? "invalid_action" : /connection/i.test(h.error || "") ? "haiku_connection_error" : "haiku_judge_error");
          if (!(ACTION_KEYS as string[]).includes(h.action)) throw new Error("invalid_action");
          row.result = h.action;
          row.inputTokens = wire.observed ? wire.inputTokens : numeric(h.usage.in);
          row.outputTokens = wire.observed ? wire.outputTokens : numeric(h.usage.out);
        } else {
          const r = await runJudge(p, { char, stageName: item.stage, lastHaruhi: item.haruhi, userText: item.user });
          // runJudge normalizes missing tokens to 0 and invalid labels to neutral; use wire evidence.
          if (!wire.observed) throw new Error("response_not_observed");
          if (typeof wire.action !== "string" || !(ACTION_KEYS as string[]).includes(wire.action) || !(ACTION_KEYS as string[]).includes(r.action)) throw new Error("invalid_action");
          row.result = r.action;
          row.confidence = confidence(r.confidence);
          row.inputTokens = wire.inputTokens;
          row.outputTokens = wire.outputTokens;
        }
        row.success = true;
      } catch (error: unknown) {
        row.result = null;
        const message = error instanceof Error ? error.message : "";
        row.failure = /^(missing_api_key|invalid_action|response_not_observed|haiku_connection_error|haiku_judge_error|(local|openai|jev)_[0-9]{3})$/.test(message)
          ? message : error instanceof SyntaxError ? "response_json_invalid" : "request_exception";
      }
      row.ms = Date.now() - start;
      row.inputTokens ??= wire.inputTokens;
      row.outputTokens ??= wire.outputTokens;
      row.probabilitiesProvided = wire.probabilitiesProvided;
      row.responseModel = wire.responseModel;
      rows.push(row);
      process.stdout.write(".");
    }
    results[p] = rows;
    console.log(" " + p);
  }
} finally { globalThis.fetch = originalFetch; wire = null; }

const pct = (n: number, d: number) => d ? (100 * n / d).toFixed(1) + "%" : "해당 없음";
const summaries = Object.fromEntries(Object.entries(results).map(([provider, rows]) => {
  const success = rows.filter((r) => r.success);
  const correct = success.filter((r) => r.result === r.label).length;
  const provided = success.filter((r) => r.confidence !== null);
  const held = success.filter((r) => r.confidence !== null && r.confidence < minConf && r.result !== "off_limits");
  const kept = success.filter((r) => !held.includes(r));
  const price = (PRICE_PER_MTOK as Record<string, { in: number; out: number }>)[provider] ?? PRICE_PER_MTOK.judge;
  const costKnown = success.length > 0 && success.every((r) => r.inputTokens !== null && (price.out === 0 || r.outputTokens !== null));
  const costPer1000 = costKnown ? success.reduce((sum, r) => sum + r.inputTokens! * price.in + (r.outputTokens ?? 0) * price.out, 0) / success.length / 1e6 * 1000 : null;
  return [provider, { examples: rows.length, success: success.length, failures: rows.length - success.length, correct, accuracyAll: pct(correct, rows.length), accuracySuccess: pct(correct, success.length), confidenceProvided: provided.length, held: held.length, holdRate: provided.length ? pct(held.length, success.length) : "해당 없음", retainedAccuracy: pct(kept.filter((r) => r.result === r.label).length, kept.length), meanSuccessMs: success.length ? Math.round(success.reduce((sum, r) => sum + r.ms, 0) / success.length) : null, costPer1000, costDisplay: costPer1000 === null ? "알 수 없음" : provider === "local" ? "0 (로컬)" : "$" + costPer1000.toFixed(4) }];
}));
const timestamp = new Date().toISOString();
const md = ["# 판정기 비교 (" + timestamp + ")", "", "합성 예문 " + set.length + "개 · 작가 라벨 검수 전. 보류: 확신 < " + minConf + ", off_limits 제외.", "비용·속도는 성공한 행만 기준. 실패한 호출의 청구 비용은 포함하지 않음. 로컬도 토큰 미제공이면 비용은 알 수 없음.", "확신 미제공 행은 보류 여부를 추정하지 않으며, 보류 뺀 정확도는 성공 중 실제 보류를 제외한 값.", "", "| 판정기 | 예문 수 | 성공 | 실패 | 정확도(전체 예문 기준, 실패는 틀림) | 정확도(성공한 것 기준) | 확신 제공 | 보류 | 보류 뺀 정확도 | 평균 속도(성공만) | 1,000회 비용(공개 단가 추정) |", "|---|---|---|---|---|---|---|---|---|---|---|"];
for (const [p, s] of Object.entries(summaries)) md.push(`| ${p} | ${s.examples} | ${s.success} | ${s.failures} | ${s.accuracyAll} | ${s.accuracySuccess} | ${s.confidenceProvided}/${s.success} | ${s.holdRate} | ${s.retainedAccuracy} | ${s.meanSuccessMs === null ? "해당 없음" : s.meanSuccessMs + "ms"} | ${s.costDisplay} |`);
for (const [p, s] of Object.entries(summaries)) if (s.failures) md.push("", p + " — 측정 불완전: 실패 " + s.failures + "건");
md.push("", "## 행별 결과", "", "| 판정기 | # | 정답 | 결과 | 확신 | 확률 제공 | 입력 토큰 | 출력 토큰 | ms | 실패 사유 |", "|---|---|---|---|---|---|---|---|---|---|");
for (const [p, rows] of Object.entries(results)) for (const r of rows) md.push(`| ${p} | ${r.n} | ${r.label} | ${r.success ? r.result : "실패"} | ${r.confidence ?? "알 수 없음"} | ${r.probabilitiesProvided ? "예" : "아니요"} | ${r.inputTokens ?? "알 수 없음"} | ${r.outputTokens ?? "알 수 없음"} | ${r.ms} | ${cell(r.failure)} |`);
const directory = process.env.EVAL_OUTPUT_DIR || "eval";
fs.mkdirSync(directory, { recursive: true });
const base = path.join(directory, "judge-" + timestamp.replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
fs.writeFileSync(base + ".md", md.join("\n") + "\n");
fs.writeFileSync(base + ".json", JSON.stringify(redactTree({ timestamp, character: char.id, threshold: minConf, syntheticLabelsUnreviewed: true, summaries, results }), null, 2) + "\n");
console.log("저장:", base + ".md", base + ".json");
