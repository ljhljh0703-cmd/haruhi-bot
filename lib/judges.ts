// 행동 판정기. 작가 결정(2026-10-23): 대사는 LLM, 판단은 Jev 계열 판정 전용 모델.
// 판정기는 갈아 끼울 수 있다:
//   jev       TypeSafe Jev (TYPESAFE_API_KEY)
//   openai    OpenAI Decisions API (OPENAI_API_KEY, 2026-10-06 공개 베타)
//   local     /v1/systemone 형식을 말하는 로컬 서버 (LOCAL_JUDGE_URL, 예: JevK5를 scripts/local-judge.py로 띄움)
//   haiku     Claude Haiku에게 JSON으로 고르게 함 (키가 없을 때 대체)
// 작가 결정(2026-10-23): 판정 = OpenAI Decisions, 비교 = Haiku(그림자)·로컬 JevK5(실험).
// JUDGE_PROVIDER로 고르고, 없으면 키가 있는 순서(openai → jev → local → haiku)로 정한다.
import C from "./judge-criteria.json";
import { ACTION_KEYS, ActionKey } from "./config";
import type { CharacterServer } from "./characters/types";

export type JudgeProvider = "jev" | "openai" | "local" | "haiku";
export type RawJudge = {
  provider: JudgeProvider;
  action: ActionKey;
  confidence: number | null; // Jev 방식으로 맞춘 확신: (최고확률 - 1/n) / (1 - 1/n)
  probs: Record<string, number> | null;
  factProb: number | null; // 사용자가 자기 사실을 말했을 확률
  inTokens: number;
  ms: number;
};

export function available(): JudgeProvider[] {
  const out: JudgeProvider[] = [];
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.TYPESAFE_API_KEY) out.push("jev");
  if (process.env.LOCAL_JUDGE_URL) out.push("local");
  if (process.env.ANTHROPIC_API_KEY) out.push("haiku");
  return out;
}

export function primaryProvider(): JudgeProvider | null {
  const want = process.env.JUDGE_PROVIDER as JudgeProvider | undefined;
  const av = available();
  if (want && av.includes(want)) return want;
  return av[0] ?? null;
}

export function shadowProvider(): JudgeProvider | null {
  const s = process.env.JUDGE_SHADOW ?? "haiku"; // 기본: Haiku가 같은 턴을 같이 판정해 일치율 기록. 끄려면 JUDGE_SHADOW=off
  if (s === "off") return null;
  const want = (s === "1" ? "haiku" : s) as JudgeProvider;
  return available().includes(want) && want !== primaryProvider() ? want : null;
}

export const normConf = (probs: Record<string, number>) => {
  const v = Object.values(probs);
  const n = v.length;
  if (n < 2) return null;
  const p = Math.max(...v);
  return Math.max(0, (p - 1 / n) / (1 - 1 / n));
};

const argmax = (probs: Record<string, number>) => Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0];
const asAction = (k: string | undefined): ActionKey => ((ACTION_KEYS as string[]).includes(k ?? "") ? (k as ActionKey) : "neutral");

export type JudgeInput = { char: CharacterServer; stageName: string; lastHaruhi: string; userText: string };

// 공통 뜻풀이 위에 캐릭터별 뜻풀이를 덮어쓴다.
const instructions = (i: JudgeInput) => C.instructions.replace("{who}", i.char.judge.who);
const criteria = (i: JudgeInput) => ({ ...C.criteria, ...i.char.judge.criteria }) as Record<string, string>;

const state = (i: JudgeInput) => ({ relationship_stage: i.stageName, character_last_message: i.lastHaruhi || "(none)", user_message: i.userText });

// TypeSafe /v1/systemone 형식 (Jev 본가와 로컬 호환 서버 공용)
async function systemone(i: JudgeInput, url: string, key: string | undefined, model: string, provider: JudgeProvider): Promise<RawJudge> {
  const t = Date.now();
  const res = await fetch(`${url.replace(/\/$/, "")}/v1/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      state: state(i),
      questions: {
        action: { type: "choice", instructions: instructions(i), criteria: criteria(i) },
        has_fact: { type: "noul", instructions: C.fact_instructions, criteria: C.fact_criteria },
      },
    }),
  });
  if (!res.ok) throw new Error(`${provider}_${res.status}`);
  const j = await res.json();
  const a = j.answers?.action ?? {};
  const probs = a.probabilities ?? null;
  return {
    provider,
    action: asAction(a.choice ?? (probs ? argmax(probs) : undefined)),
    confidence: probs ? normConf(probs) : typeof a.confidence === "number" ? a.confidence : null,
    probs,
    factProb: j.answers?.has_fact?.noul ?? null,
    inTokens: j.usage?.input_tokens ?? 0,
    ms: Date.now() - t,
  };
}

// OpenAI Decisions API (/v1/decisions). 요청 모양은 공개 베타 문서 요약 기준, 키 연결 후 첫 호출로 확인한다.
async function openai(i: JudgeInput): Promise<RawJudge> {
  const t = Date.now();
  const res = await fetch("https://api.openai.com/v1/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_DECISION_MODEL || "gpt-6-luna",
      input: JSON.stringify(state(i)),
      questions: [
        { type: "choice", name: "action", instructions: instructions(i), choices: Object.entries(criteria(i)).map(([value, description]) => ({ value, description })) },
        { type: "predicate", name: "has_fact", instructions: `${C.fact_instructions} True: ${C.fact_criteria.true} False: ${C.fact_criteria.false}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const j = await res.json();
  const answers: any[] = j.answers ?? [];
  const a = answers.find((x) => x.name === "action") ?? answers[0] ?? {};
  const f = answers.find((x) => x.name === "has_fact") ?? answers[1] ?? {};
  const probs: Record<string, number> | null = Array.isArray(a.probabilities)
    ? Object.fromEntries(a.probabilities.map((p: any) => [String(p.value), Number(p.probability)]))
    : a.probabilities ?? null;
  return {
    provider: "openai",
    action: asAction(a.choice ?? (probs ? argmax(probs) : undefined)),
    confidence: probs ? normConf(probs) : a.confidence ?? null,
    probs,
    factProb: typeof f.probability === "number" ? f.probability : null,
    inTokens: j.usage?.input_tokens ?? 0,
    ms: Date.now() - t,
  };
}

export async function runJudge(p: Exclude<JudgeProvider, "haiku">, i: JudgeInput): Promise<RawJudge> {
  if (p === "jev") return systemone(i, process.env.JEV_BASE_URL || "https://api.typesafe.ai", process.env.TYPESAFE_API_KEY, process.env.JEV_MODEL || "jev-1.13.0", "jev");
  if (p === "local") return systemone(i, process.env.LOCAL_JUDGE_URL!, process.env.LOCAL_JUDGE_KEY, process.env.LOCAL_JUDGE_MODEL || "jevk5", "local");
  return openai(i);
}
