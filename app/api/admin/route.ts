import { cookies } from "next/headers";
import { ACTIONS, ACTION_KEYS, LIMITS, PRICE_PER_MTOK, RULES_VERSION, STAGE_MINS } from "@/lib/config";
import { CHARACTERS } from "@/lib/characters";
import { listFacts, listMessages, q, setCorrection, usingLocalDb } from "@/lib/db";
import { chatModelName, judgeProviderName, mockMode } from "@/lib/llm";
import { shadowProvider } from "@/lib/judges";
import { buildFeedbackExport, readSurveyFeedback } from "@/lib/surveys";

export const dynamic = "force-dynamic";
const ADMIN_COOKIE = "sos_admin";

async function authed() {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production"; // 내 컴퓨터에서는 키 없이 열림
  return (await cookies()).get(ADMIN_COOKIE)?.value === key;
}

const judgeCost = (r: any) => {
  const pr = (PRICE_PER_MTOK as any)[r.judge_provider] ?? PRICE_PER_MTOK.judge;
  return (Number(r.judge_in) * pr.in + Number(r.judge_out) * pr.out +
    Number(r.extra_in ?? 0) * PRICE_PER_MTOK.judge.in + Number(r.extra_out ?? 0) * PRICE_PER_MTOK.judge.out) / 1e6;
};
const chatCost = (r: any) =>
  String(r.chat_model ?? "").startsWith("local:") ? 0
    : (Number(r.chat_in) * PRICE_PER_MTOK.chat.in + Number(r.chat_out) * PRICE_PER_MTOK.chat.out) / 1e6;
const cost = (r: any) => chatCost(r) + judgeCost(r);

export async function GET(req: Request) {
  if (!(await authed())) return Response.json({ error: "auth" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const userId = sp.get("user");
  if (sp.get("export") === "feedback") {
    const data = await buildFeedbackExport(q, sp.get("rules") || RULES_VERSION, sp.get("char") || "all");
    return new Response(JSON.stringify(data, null, 2) + "\n", { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename=haruhi-feedback-${new Date().toISOString().slice(0, 10)}.json`, "Cache-Control": "no-store" } });
  }

  // 학습용 라벨 내보내기(JSONL). 사람이 고친 라벨(source=human)과 판정기 라벨(source=judge)을 구분한다.
  // 판정 전용 모델의 답을 그대로 학습시키면 제공사 약관(TypeSafe MCA 2.3 등)에 걸릴 수 있어, 학습에는 human만 쓴다.
  if (sp.get("export") === "labels") {
    const rows = await q(`
      select t.id, t.action, t.correction, t.judge_provider, t.judge_conf, t.rules_version, us.character, u.content as user_text, u.kind as user_kind,
        (select h.content from messages h where h.user_id = t.user_id and h.role = 'char' and h.id < t.user_message_id order by h.id desc limit 1) as haruhi_last,
        us.stage as stage_now
      from turns t join messages u on u.id = t.user_message_id join users us on us.id = t.user_id
      where t.action <> 'greet' order by t.id`);
    const body = rows.map((r) => JSON.stringify({
      id: Number(r.id), character: r.character, haruhi: r.haruhi_last ?? "", user: r.user_kind === "action" ? `*${r.user_text}*` : r.user_text,
      label: r.correction ?? r.action, source: r.correction ? "human" : "judge", judge: r.judge_provider, conf: r.judge_conf,
    })).join("\n");
    return new Response(body + "\n", { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": "attachment; filename=haruhi-labels.jsonl" } });
  }

  if (userId) {
    const [messages, turns, facts, reports] = await Promise.all([
      listMessages(userId, 1000),
      q(`select * from turns where user_id=$1 order by id`, [userId]),
      listFacts(userId, true),
      q(`select message_id, reason from reports where user_id=$1`, [userId]),
    ]);
    return Response.json({ messages, turns: turns.map((t) => ({ ...t, id: Number(t.id), cost: cost(t) })), facts, reports: reports.map((r) => ({ ...r, message_id: Number(r.message_id) })) });
  }

  // 거르기: 규칙 판(rules)과 캐릭터(char). 기본은 지금 판, 전체 캐릭터.
  const rulesF = sp.get("rules") || RULES_VERSION;
  const charF = sp.get("char") || "all";
  const feedbackData = await readSurveyFeedback(q, rulesF, charF);
  const { surveys: _surveys, presentations: _presentations, ...feedback } = feedbackData;
  const allUsers = await q(`select id, nickname, character, stage, score, total_turns, visits, created_at, last_seen, day_turns from users order by last_seen desc`);
  const users = allUsers.filter((u) => charF === "all" || u.character === charF);
  const uid = new Set(users.map((u) => u.id));
  const allTurns = await q(`select user_id, action, applied_delta, capped, correction, flags, chat_in, chat_out, judge_in, judge_out, extra_in, extra_out, judge_provider, judge_conf, shadow_action, chat_model, first_token_ms, latency_ms, rules_version, rep_score, created_at from turns`);
  const versions = [...new Set([...allTurns.map((t) => t.rules_version ?? "old"), ...feedback.versions])];
  const turns = allTurns.filter((t) => uid.has(t.user_id) && (rulesF === "all" || (t.rules_version ?? "old") === rulesF));
  const talk = turns.filter((t) => t.action !== "greet");
  const byAction: Record<string, number> = {};
  for (const t of talk) byAction[t.action] = (byAction[t.action] ?? 0) + 1;
  const stageDist = STAGE_MINS.map((_, i) => users.filter((u) => u.stage === i + 1).length);
  const corrected = talk.filter((t) => t.correction);
  const ft = talk.map((t) => Number(t.first_token_ms)).filter((n) => n > 0).sort((a, b) => a - b);
  const reps = talk.map((t) => Number(t.rep_score)).filter((n) => !Number.isNaN(n) && n > 0);

  // 세션: 사용자 메시지 사이가 일정 시간 넘게 비면 새 세션
  const um = await q(`select user_id, created_at from messages where role='user' order by user_id, id`);
  let sessions = 0, sessionTurns = 0, prevU = "", prevT = 0;
  for (const m of um) {
    if (!uid.has(m.user_id)) continue;
    const t = new Date(m.created_at).getTime();
    if (m.user_id !== prevU || t - prevT > LIMITS.sessionGapMin * 60_000) sessions++;
    sessionTurns++; prevU = m.user_id; prevT = t;
  }

  // 이탈 지점: 1시간 넘게 안 온 사람의 마지막 메시지
  const dropRows = await q(`
    select distinct on (m.user_id) m.user_id, m.content, m.role, m.created_at
    from messages m where m.role in ('char','user') order by m.user_id, m.id desc`);
  const drops = dropRows
    .filter((r) => uid.has(r.user_id) && Date.now() - new Date(r.created_at).getTime() > 3600_000)
    .map((r) => ({ user: users.find((u) => u.id === r.user_id)?.nickname ?? "?", lastRole: r.role, content: r.content }));

  const reports = (await q(`select r.reason, r.user_id, m.content, r.created_at from reports r join messages m on m.id = r.message_id order by r.id desc limit 50`)).filter((r) => uid.has(r.user_id));
  const reportBy: Record<string, number> = {};
  for (const r of reports) reportBy[r.reason] = (reportBy[r.reason] ?? 0) + 1;

  const shadowed = talk.filter((t) => t.shadow_action);
  const judgeCostTotal = turns.reduce((a, t) => a + judgeCost(t), 0);
  const chatCostTotal = turns.reduce((a, t) => a + chatCost(t), 0);
  return Response.json({
    env: { mock: mockMode(), localDb: usingLocalDb(), chatModel: chatModelName(), judge: judgeProviderName(), shadow: shadowProvider(), rules: RULES_VERSION },
    filter: { rules: rulesF, char: charF, versions, characters: Object.values(CHARACTERS).map((c) => ({ id: c.id, name: c.name, stages: c.stages.map((s) => s.name) })) },
    rules: { actions: ACTIONS, limits: LIMITS, stageMins: STAGE_MINS },
    stats: {
      users: users.length,
      returning: users.filter((u) => u.visits >= 2).length,
      turns: talk.length,
      avgTurns: users.length ? +(talk.length / users.length).toFixed(1) : 0,
      sessions,
      turnsPerSession: sessions ? +(sessionTurns / sessions).toFixed(1) : 0,
      stageDist,
      byAction,
      corrections: corrected.length,
      correctionRate: talk.length ? +((corrected.length / talk.length) * 100).toFixed(1) : 0,
      dayGainCapHits: talk.filter((t) => t.capped === "day_gain").length,
      dayEnds: talk.filter((t) => String(t.flags).includes("day_end")).length,
      judgeErrors: talk.filter((t) => String(t.flags).includes("judge_error")).length,
      costUsd: +turns.reduce((a, t) => a + cost(t), 0).toFixed(4),
      costPerTurn: talk.length ? +(turns.reduce((a, t) => a + cost(t), 0) / talk.length).toFixed(5) : 0,
      firstTokenP50: ft.length ? ft[Math.floor(ft.length / 2)] : null,
      lowConf: talk.filter((t) => String(t.flags).includes("low_conf")).length,
      jevErrors: talk.filter((t) => String(t.flags).includes("judge_fallback")).length,
      shadowN: shadowed.length,
      shadowAgree: shadowed.length ? +((shadowed.filter((t) => t.shadow_action === t.action || (String(t.flags).includes("low_conf") && t.shadow_action === "neutral")).length / shadowed.length) * 100).toFixed(1) : null,
      chatCostUsd: +chatCostTotal.toFixed(4),
      judgeCostUsd: +judgeCostTotal.toFixed(5),
      repAvg: reps.length ? +(reps.reduce((a, b) => a + b, 0) / reps.length).toFixed(2) : null,
      repHigh: reps.filter((n) => n >= 0.5).length,
      reports: reports.length,
      reportBy,
    },
    users,
    feedback,
    drops,
    reports: reports.slice(0, 20).map((r) => ({ reason: r.reason, content: r.content, user: users.find((u) => u.id === r.user_id)?.nickname ?? "?" })),
    actions: ACTION_KEYS,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.login !== undefined) {
    if (!process.env.ADMIN_KEY || body.login !== process.env.ADMIN_KEY) return Response.json({ error: "auth" }, { status: 401 });
    (await cookies()).set(ADMIN_COOKIE, body.login, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === "production" });
    return Response.json({ ok: true });
  }
  if (!(await authed())) return Response.json({ error: "auth" }, { status: 401 });
  const turnId = Number(body.turnId);
  const correction = body.correction ? String(body.correction) : null;
  if (!turnId || (correction && !(ACTION_KEYS as string[]).includes(correction))) return Response.json({ error: "bad" }, { status: 400 });
  await setCorrection(turnId, correction);
  return Response.json({ ok: true });
}
