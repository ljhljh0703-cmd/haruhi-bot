// 판정기 비교: 같은 한국어 예문을 판정기마다 돌려 정확도·보류율·속도·비용을 표로 남긴다.
// 사용: npx tsx scripts/judge-eval.mts [jev openai local haiku]   (인자 없으면 키가 있는 판정기 전부)
// 예문: eval/judge-set.json (평가 전용, 학습에 쓰지 않음)
import fs from "node:fs";
import { ACTION_KEYS, PRICE_PER_MTOK } from "../lib/config";
import { JudgeProvider, available, runJudge } from "../lib/judges";
import { judgeHaiku } from "../lib/llm";
import { getCharacter } from "../lib/characters";

const char = getCharacter(process.env.CHAR || "haruhi");

const set = JSON.parse(fs.readFileSync("eval/judge-set.json", "utf8")).items as { stage: string; haruhi: string; user: string; label: string }[];
const want = (process.argv.slice(2) as JudgeProvider[]).filter(Boolean);
const providers = want.length ? want : available();
const minConf = Number(process.env.JEV_MIN_CONF || 0.3);
if (!providers.length) { console.error("키가 있는 판정기가 없음"); process.exit(1); }

type Row = { label: string; got: string; conf: number | null; ms: number; tin: number; tout: number; err?: string };
const results: Record<string, Row[]> = {};

for (const p of providers) {
  const rows: Row[] = [];
  for (const it of set) {
    const t = Date.now();
    try {
      if (p === "haiku") {
        const h = await judgeHaiku(char, it.haruhi, it.user, it.stage);
        rows.push({ label: it.label, got: h.action, conf: null, ms: Date.now() - t, tin: h.usage.in, tout: h.usage.out });
      } else {
        const r = await runJudge(p, { char, stageName: it.stage, lastHaruhi: it.haruhi, userText: it.user });
        rows.push({ label: it.label, got: r.action, conf: r.confidence, ms: r.ms, tin: r.inTokens, tout: 0 });
      }
    } catch (e: any) {
      rows.push({ label: it.label, got: "error", conf: null, ms: Date.now() - t, tin: 0, tout: 0, err: String(e?.message ?? e) });
    }
    process.stdout.write(".");
  }
  results[p] = rows;
  console.log(` ${p}`);
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");
const lines: string[] = [];
lines.push(`# 판정기 비교 (${new Date().toISOString().slice(0, 16)})`, "");
lines.push(`예문 ${set.length}개(행동 10종 × 6, 합성·라벨 검수 전). 보류 기준 확신 < ${minConf}. 비용은 공개 단가 추정.`, "");
lines.push("| 판정기 | 정확도 | 보류 | 보류 뺀 정확도 | 평균 속도 | 1,000회 비용 | 실패 |", "|---|---|---|---|---|---|---|");
for (const [p, rows] of Object.entries(results)) {
  const ok = rows.filter((r) => r.got === r.label).length;
  const held = rows.filter((r) => r.conf !== null && r.conf < minConf);
  const kept = rows.filter((r) => !(r.conf !== null && r.conf < minConf));
  const keptOk = kept.filter((r) => r.got === r.label).length;
  const ms = rows.reduce((a, r) => a + r.ms, 0) / rows.length;
  const price = (PRICE_PER_MTOK as any)[p] ?? PRICE_PER_MTOK.judge;
  const cost = rows.reduce((a, r) => a + r.tin * price.in + r.tout * price.out, 0) / 1e6 / rows.length * 1000;
  lines.push(`| ${p} | ${pct(ok, rows.length)} | ${pct(held.length, rows.length)} | ${pct(keptOk, kept.length)} | ${Math.round(ms)}ms | $${cost.toFixed(4)} | ${rows.filter((r) => r.err).length} |`);
}
lines.push("", "## 행동별 맞힌 수 (6개 중)", "", `| 행동 | ${Object.keys(results).join(" | ")} |`, `|---|${Object.keys(results).map(() => "---").join("|")}|`);
for (const a of ACTION_KEYS) lines.push(`| ${a} | ${Object.values(results).map((rows) => rows.filter((r) => r.label === a && r.got === a).length).join(" | ")} |`);
lines.push("", "## 틀린 것", "");
for (const [p, rows] of Object.entries(results)) {
  const wrong = rows.map((r, i) => ({ ...r, i })).filter((r) => r.got !== r.label);
  lines.push(`### ${p} (${wrong.length})`);
  for (const w of wrong) lines.push(`- 「${set[w.i].user}」 정답 ${w.label} → ${w.got}${w.conf !== null ? ` (확신 ${w.conf.toFixed(2)})` : ""}${w.err ? ` 오류 ${w.err}` : ""}`);
  lines.push("");
}
const file = `eval/judge-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
fs.writeFileSync(file, lines.join("\n") + "\n");
console.log("저장:", file);
