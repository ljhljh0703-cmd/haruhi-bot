import Anthropic from "@anthropic-ai/sdk";
import { ACTION_KEYS, ActionKey, CHAT_MODEL, JUDGE_MODEL, LOCAL_LLM_MODEL, LOCAL_LLM_URL } from "./config";
import { fixedPrompt, judgePrompt, summaryPrompt } from "./persona";
import type { CharacterServer } from "./characters/types";
import { primaryProvider, runJudge, shadowProvider } from "./judges";
import type { Msg } from "./db";

export const mockMode = () => !process.env.ANTHROPIC_API_KEY && !LOCAL_LLM_URL;
export const chatModelName = () => (LOCAL_LLM_URL ? `local:${LOCAL_LLM_MODEL}` : CHAT_MODEL);

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic());

type ApiMsg = { role: "user" | "assistant"; content: string };

// 저장된 메시지를 API 형식으로. 같은 쪽이 이어지면 합치고, 첫 줄은 user로 맞춘다.
export function toApiMessages(history: Msg[], tailUserNote?: string): ApiMsg[] {
  const out: ApiMsg[] = [];
  for (const m of history) {
    let role: ApiMsg["role"];
    let text: string;
    if (m.role === "user") { role = "user"; text = m.kind === "action" ? `*${m.content}*` : m.content; }
    else if (m.role === "char") { role = "assistant"; text = m.content; }
    else if (m.kind === "action") { role = "assistant"; text = `(상황: ${m.content})`; }
    else continue; // 단계 알림 같은 화면용 메시지는 넣지 않는다
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + text;
    else out.push({ role, content: text });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "(대화 시작)" });
  if (tailUserNote && out[out.length - 1].role === "assistant") out.push({ role: "user", content: tailUserNote });
  return out;
}

export type Usage = { in: number; out: number };

// hint는 연습 모드에서 정해진 답을 고를 때만 쓴다.
export type MockHint = "greet" | "dayEnd" | { episode: string } | null;

export async function* streamReply(c: CharacterServer, context: string, messages: ApiMsg[], usage: Usage, hint: MockHint = null) {
  if (mockMode()) {
    const text = mockReply(c, messages[messages.length - 1]?.content ?? "", hint);
    for (const piece of text.match(/.{1,3}/gsu) ?? []) {
      await new Promise((r) => setTimeout(r, 25));
      yield piece;
    }
    usage.in = 0; usage.out = 0;
    return;
  }
  if (LOCAL_LLM_URL) {
    yield* streamLocal(c, context, messages, usage);
    return;
  }
  const stream = api().messages.stream({
    model: CHAT_MODEL,
    max_tokens: 400,
    system: [
      { type: "text", text: fixedPrompt(c), cache_control: { type: "ephemeral" } },
      { type: "text", text: context },
    ],
    messages,
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
  const final = await stream.finalMessage();
  usage.in = (final.usage.input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0);
  usage.out = final.usage.output_tokens ?? 0;
}

// 로컬 모델(OpenAI 호환 /v1/chat/completions, 스트리밍). 비교 실험 전용.
async function* streamLocal(c: CharacterServer, context: string, messages: ApiMsg[], usage: Usage) {
  const res = await fetch(`${LOCAL_LLM_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: LOCAL_LLM_MODEL,
      stream: true,
      max_tokens: 400,
      messages: [{ role: "system", content: fixedPrompt(c) + "\n\n" + context }, ...messages],
    }),
  });
  if (!res.ok || !res.body) throw new Error("local_llm_" + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const ln = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!ln.startsWith("data:")) continue;
      const data = ln.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const piece = JSON.parse(data).choices?.[0]?.delta?.content;
        if (piece) { out++; yield piece as string; }
      } catch {}
    }
  }
  usage.in = 0; // 로컬은 비용 0으로 기록
  usage.out = out;
}

export type Judgement = {
  action: ActionKey; reason: string; facts: string[]; usage: Usage; error?: string;
  provider: string; confidence: number | null; shadow: ActionKey | null; extra: Usage; flags: string[];
};

export const judgeProviderName = () => primaryProvider() ?? "mock";

// 판정: 판정 전용 모델(Jev 계열)이 행동을 고르고, 확신이 낮으면 점수 보류.
// 사실 문장 뽑기만 Haiku. 그림자 판정기가 켜져 있으면 같은 턴을 같이 판정해 일치율을 남긴다.
export async function judge(c: CharacterServer, lastHaruhi: string, userText: string, stageName: string): Promise<Judgement> {
  const p = primaryProvider();
  const zero = { in: 0, out: 0 };
  if (!p) return { ...mockJudge(userText), usage: zero, provider: "mock", confidence: null, shadow: null, extra: zero, flags: [] };
  const input = { char: c, stageName, lastHaruhi, userText };
  const sp = shadowProvider();
  const shadowRun = sp ? (sp === "haiku" ? judgeHaiku(c, lastHaruhi, userText, stageName).then((h) => h.action) : runJudge(sp, input).then((r) => r.action)).catch(() => null) : Promise.resolve(null);

  let out: Judgement;
  if (p === "haiku") {
    out = await judgeHaiku(c, lastHaruhi, userText, stageName);
  } else {
    try {
      const r = await runJudge(p, input);
      const minConf = Number(process.env.JEV_MIN_CONF || 0.3);
      const flags: string[] = [];
      let action = r.action;
      let reason = `${p} 확신 ${r.confidence?.toFixed(2) ?? "?"} · ${r.ms}ms`;
      // 확신이 낮으면 점수를 움직이지 않고 보류. 기준값은 오분류 표시로 다시 잡는다.
      if (r.confidence !== null && r.confidence < minConf && action !== "off_limits") {
        flags.push("low_conf");
        reason = `보류(원래 ${action}) · ${p} 확신 ${r.confidence.toFixed(2)}`;
        action = "neutral";
      }
      if ((r.factProb ?? 0) >= 0.6) flags.push("has_fact");
      out = { action, reason, facts: [], usage: { in: r.inTokens, out: 0 }, provider: p, confidence: r.confidence, shadow: null, extra: { in: 0, out: 0 }, flags };
      if (flags.includes("has_fact") && process.env.ANTHROPIC_API_KEY) {
        const ex = await extractFacts(userText);
        out.facts = ex.facts;
        out.extra = ex.usage;
      }
    } catch (e: any) {
      // 판정기가 실패하면 Haiku가 대신, 그것도 없으면 점수를 움직이지 않는다.
      if (process.env.ANTHROPIC_API_KEY) {
        out = await judgeHaiku(c, lastHaruhi, userText, stageName);
        out.flags.push("judge_fallback");
      } else {
        out = { action: "neutral", reason: "분류 실패", facts: [], usage: zero, provider: p, confidence: null, shadow: null, extra: zero, flags: ["judge_error"] };
      }
      out.error = String(e?.message ?? e).slice(0, 80);
    }
  }
  out.shadow = await shadowRun;
  return out;
}

export async function judgeHaiku(c: CharacterServer, lastHaruhi: string, userText: string, stageName: string): Promise<Judgement> {
  const base = { provider: "haiku", confidence: null, shadow: null, extra: { in: 0, out: 0 } };
  try {
    const res = await api().messages.create({
      model: JUDGE_MODEL,
      max_tokens: 200,
      system: judgePrompt(c, stageName),
      messages: [{ role: "user", content: `${c.shortName}: ${lastHaruhi || "(없음)"}\n사용자: ${userText}` }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const action = (ACTION_KEYS as string[]).includes(json.action) ? (json.action as ActionKey) : "neutral";
    return {
      ...base,
      action,
      reason: String(json.reason ?? "").slice(0, 40),
      facts: Array.isArray(json.facts) ? json.facts.map(String).filter(Boolean).slice(0, 3) : [],
      usage: { in: res.usage.input_tokens, out: res.usage.output_tokens },
      error: action !== json.action ? "unknown_action" : undefined,
      flags: action !== json.action ? ["judge_error"] : [],
    };
  } catch (e: any) {
    // 분류가 실패하면 점수를 움직이지 않는다.
    return { ...base, action: "neutral", reason: "분류 실패", facts: [], usage: { in: 0, out: 0 }, error: String(e?.message ?? e).slice(0, 80), flags: ["judge_error"] };
  }
}

// Jev는 글을 쓰지 못하므로, 사실이 있다고 판정된 턴만 Haiku로 사실 문장을 뽑는다.
async function extractFacts(userText: string): Promise<{ facts: string[]; usage: Usage }> {
  try {
    const res = await api().messages.create({
      model: JUDGE_MODEL,
      max_tokens: 120,
      system: "사용자 발화에서 사용자가 자기 자신에 대해 직접 말한 사실만 짧은 한 줄씩 뽑는다. 추측 금지. JSON 배열로만 답한다. 예: [\"고양이를 키운다\"]",
      messages: [{ role: "user", content: userText }],
    });
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return { facts: Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 3) : [], usage: { in: res.usage.input_tokens, out: res.usage.output_tokens } };
  } catch {
    return { facts: [], usage: { in: 0, out: 0 } };
  }
}

export async function summarize(c: CharacterServer, prev: string, recent: Msg[], forget: string[] = []) {
  if (mockMode()) return prev;
  const convo = recent
    .filter((m) => m.role !== "system" || m.kind === "action")
    .map((m) => `${m.role === "user" ? "사용자" : m.role === "char" ? c.shortName : "상황"}: ${m.content}`)
    .join("\n");
  const res = await api().messages.create({
    model: JUDGE_MODEL,
    max_tokens: 400,
    system: summaryPrompt(c),
    messages: [{ role: "user", content: `[지난 요약]\n${prev || "(없음)"}\n\n[최근 대화]\n${convo}${forget.length ? `\n\n[사용자가 지워 달라고 한 내용. 새 요약에 넣지 않는다]\n- ${forget.join("\n- ")}` : ""}` }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().slice(0, 800);
}

// ---- 연습 모드 (API 키 연결 전 화면·흐름 점검용) ----
function mockReply(c: CharacterServer, last: string, hint: MockHint) {
  if (hint === "dayEnd") return c.mock.dayEnd;
  if (hint === "greet") return c.mock.greet;
  if (hint && typeof hint === "object") return c.mock.episode(hint.episode);
  if (/몰라|ㅇㅇ|그냥/.test(last)) return c.mock.boring;
  if (/외계|유령|이상|미스터리|봤/.test(last)) return c.mock.fun;
  return c.mock.default;
}

function mockJudge(t: string): { action: ActionKey; reason: string; facts: string[] } {
  if (/씨발|병신|꺼져/.test(t)) return { action: "rude", reason: "욕설", facts: [] };
  if (/한심|유치|관심없/.test(t)) return { action: "dismiss", reason: "무시", facts: [] };
  if (/^(ㅇㅇ|몰라|그냥|ㅇ)$/.test(t.trim())) return { action: "boring", reason: "단답", facts: [] };
  if (/외계|유령|이상한|미스터리|소문/.test(t)) return { action: "fun_idea", reason: "신기한 이야기", facts: [] };
  if (/알았어|갈게|할게|따라/.test(t)) return { action: "follows_order", reason: "지시에 따름", facts: [] };
  const m = t.match(/(?:나는|난|내가)\s*(.{2,20}?)(?:야|이야|해|거든|다)/);
  if (m) return { action: "personal_share", reason: "자기 이야기", facts: [m[1]] };
  return { action: t.length > 12 ? "engaged" : "neutral", reason: t.length > 12 ? "성의 있는 답" : "짧은 반응", facts: [] };
}
