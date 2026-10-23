import { LIMITS, PRICE_PER_MTOK, RULES_VERSION, kstDay } from "./config";

export type SurveyTrigger = "turn10" | "day_end" | "manual";
export type SurveyQuery = (sql: string, params?: any[]) => Promise<Record<string, any>[]>;
type SurveyUser = { id: string; character: string; day: string; dayTurns: number };
export type SurveyAnswers = { q1: number; q2: "yes" | "unsure" | "no"; q3: string; q4: number | null };
export const SURVEY_SCHEMA = `
create table if not exists survey_presentations (
  id text primary key,
  user_id text not null constraint survey_presentations_user_fk references users(id) on delete cascade,
  character text not null,
  rules_version text not null,
  day text not null,
  trigger text not null check (trigger in ('turn10','day_end','manual')),
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  skipped_at timestamptz,
  submitted_at timestamptz
);
alter table survey_presentations add column if not exists request_id text;
create unique index if not exists survey_manual_request on survey_presentations (user_id,character,request_id) where trigger='manual' and request_id is not null;
create unique index if not exists survey_auto_once on survey_presentations (user_id, character, day, trigger) where trigger <> 'manual';
create index if not exists survey_presentations_user on survey_presentations (user_id);
create table if not exists surveys (
  id bigserial primary key,
  presentation_id text not null unique references survey_presentations(id) on delete cascade,
  user_id text not null constraint surveys_user_fk references users(id) on delete cascade,
  character text not null,
  rules_version text not null,
  trigger text not null check (trigger in ('turn10','day_end','manual')),
  q1 int not null check (q1 between 1 and 5),
  q2 text not null check (q2 in ('yes','unsure','no')),
  q3 text not null default '' check (char_length(q3) <= 500),
  q4 int check (q4 between 0 and 10),
  created_at timestamptz not null default now(),
  check ((trigger = 'manual' and q4 is not null) or (trigger <> 'manual' and q4 is null))
);
create index if not exists surveys_user on surveys (user_id);
`;

// CREATE TABLE IF NOT EXISTS does not upgrade the earlier local schema.
export async function ensureSurveyForeignKeys(q: SurveyQuery) {
  for (const [table, constraint] of [["survey_presentations", "survey_presentations_user_fk"], ["surveys", "surveys_user_fk"]]) {
    const existing = await q(`select 1 from pg_constraint where conrelid=$1::regclass and conname=$2`, [table, constraint]);
    if (existing.length) continue;
    try {
      await q(`alter table ${table} add constraint ${constraint} foreign key (user_id) references users(id) on delete cascade`);
    } catch (error) {
      // Concurrent server starts may install the same named constraint after the read.
      if ((error as { code?: string }).code !== "42710") throw error;
    }
  }
}

const autoTrigger = (u: SurveyUser, day: string): SurveyTrigger | null => {
  const turns = u.day === day ? u.dayTurns : 0;
  return turns >= LIMITS.dayTurns ? "day_end" : turns >= 10 ? "turn10" : null;
};
export function validateSurveyAnswers(body: Record<string, unknown>, trigger: SurveyTrigger): SurveyAnswers | null {
  if (typeof body.q1 !== "number" || !Number.isInteger(body.q1) || body.q1 < 1 || body.q1 > 5) return null;
  if (body.q2 !== "yes" && body.q2 !== "unsure" && body.q2 !== "no") return null;
  if (body.q3 !== undefined && typeof body.q3 !== "string") return null;
  const text = (body.q3 as string | undefined) ?? "";
  if (Array.from(text).length > 500) return null;
  if (trigger === "manual" && (typeof body.q4 !== "number" || !Number.isInteger(body.q4) || body.q4 < 0 || body.q4 > 10)) return null;
  return { q1: body.q1, q2: body.q2, q3: text.trim(), q4: trigger === "manual" ? body.q4 as number : null };
}

// These helpers only write survey tables. Affinity, turns and character data are untouched.
export function createSurveyStore(q: SurveyQuery) {
  async function available(u: SurveyUser, now = new Date(), requestId?: string) {
    const day = kstDay(now);
    const trigger = autoTrigger(u, day);
    if (!trigger) return null;
    const rows = await q(`select request_id,shown_at,skipped_at,submitted_at from survey_presentations where user_id=$1 and character=$2 and day=$3 and trigger=$4`, [u.id, u.character, day, trigger]);
    const p = rows[0];
    // Only the same browser reservation can recover a response lost before actual display.
    return !p || (requestId && p.request_id === requestId && !p.shown_at && !p.skipped_at && !p.submitted_at) ? trigger : null;
  }
  async function open(u: SurveyUser, trigger: SurveyTrigger, now = new Date(), requestId: string = crypto.randomUUID()) {
    const day = kstDay(now);
    if (trigger !== "manual" && autoTrigger(u, day) !== trigger) return null;
    let rows: Record<string, any>[];
    try {
      rows = await q(`insert into survey_presentations (id,user_id,character,rules_version,day,trigger,request_id) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id,trigger`, [crypto.randomUUID(), u.id, u.character, RULES_VERSION, day, trigger, requestId]);
    } catch (error) {
      // The authenticated user can be deleted between currentUser and this insert.
      if ((error as { code?: string }).code === "23503") return null;
      throw error;
    }
    if (!rows.length) rows = await q(`select id,trigger from survey_presentations where user_id=$1 and character=$2 and day=$3 and trigger=$4 and request_id=$5 and shown_at is null and skipped_at is null and submitted_at is null`, [u.id, u.character, day, trigger, requestId]);
    return rows[0] ? { id: String(rows[0].id), trigger: rows[0].trigger as SurveyTrigger } : null;
  }
  async function own(u: SurveyUser, id: string) {
    return (await q(`select * from survey_presentations where id=$1 and user_id=$2 and character=$3`, [id, u.id, u.character]))[0] ?? null;
  }
  async function shown(u: SurveyUser, id: string) {
    return (await q(`update survey_presentations set shown_at=coalesce(shown_at,now()) where id=$1 and user_id=$2 and character=$3 returning id`, [id, u.id, u.character])).length > 0;
  }
  async function skip(u: SurveyUser, id: string) {
    return (await q(`update survey_presentations set skipped_at=coalesce(skipped_at,now()) where id=$1 and user_id=$2 and character=$3 and submitted_at is null returning id`, [id, u.id, u.character])).length > 0;
  }
  async function submit(u: SurveyUser, id: string, body: Record<string, unknown>) {
    const p = await own(u, id);
    if (!p) return "not_found" as const;
    const answers = validateSurveyAnswers(body, p.trigger);
    if (!answers) return "invalid" as const;
    if (p.submitted_at) return "ok" as const;
    if (p.skipped_at) return "skipped" as const;
    if (!p.shown_at) return "not_shown" as const;
    // A single statement claims the presentation and inserts the answer, including on Neon.
    const inserted = await q(`with claimed as (
      update survey_presentations set submitted_at=now()
      where id=$1 and user_id=$2 and character=$3 and shown_at is not null and skipped_at is null and submitted_at is null
      returning id,user_id,character,rules_version,trigger
    ) insert into surveys (presentation_id,user_id,character,rules_version,trigger,q1,q2,q3,q4)
      select id,user_id,character,rules_version,trigger,$4,$5,$6,$7 from claimed returning id`,
      [id, u.id, u.character, answers.q1, answers.q2, answers.q3, answers.q4]);
    if (inserted.length) return "ok" as const;
    // A concurrent retry may have waited for another submission. Read a fresh snapshot.
    const existing = await q(`select 1 from surveys where presentation_id=$1 and user_id=$2 and character=$3`, [id, u.id, u.character]);
    return existing.length ? "ok" as const : "conflict" as const;
  }
  return { available, open, shown, skip, submit };
}

type Row = Record<string, any>;
const mean = (values: number[]) => values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : null;
const percent = (n: number, d: number) => d ? +(100 * n / d).toFixed(1) : null;
function summarize(rows: Row[]) {
  const responses = rows.filter((r) => r.q1 !== null && r.q1 !== undefined);
  const recommendations = responses.filter((r) => r.q4 !== null && r.q4 !== undefined);
  const shown = rows.filter((r) => r.shown_at).length;
  return {
    shown, responses: responses.length, skipped: rows.filter((r) => r.skipped_at).length,
    responseRate: percent(responses.length, shown),
    characterAvg: mean(responses.map((r) => Number(r.q1))),
    returnYesRate: percent(responses.filter((r) => r.q2 === "yes").length, responses.length),
    recommendAvg: mean(recommendations.map((r) => Number(r.q4))),
    recommendResponses: recommendations.length,
  };
}
const answerView = (r: Row) => ({ nickname: String(r.nickname), character: String(r.character), rulesVersion: String(r.rules_version), trigger: r.trigger as SurveyTrigger, q1: Number(r.q1), q2: r.q2 as SurveyAnswers["q2"], q3: String(r.q3 ?? ""), q4: r.q4 === null ? null : Number(r.q4), createdAt: r.answered_at });
export async function readSurveyFeedback(q: SurveyQuery, rules: string, character: string) {
  const rows = await q(`select p.character,p.rules_version,p.trigger,p.day,p.created_at,p.shown_at,p.skipped_at,p.submitted_at,
    s.q1,s.q2,s.q3,s.q4,s.created_at as answered_at,u.nickname
    from survey_presentations p join users u on u.id=p.user_id left join surveys s on s.presentation_id=p.id
    where ($1='all' or p.rules_version=$1) and ($2='all' or p.character=$2)
    order by s.created_at desc nulls last,p.created_at desc`, [rules, character]);
  const versions = (await q(`select distinct rules_version from survey_presentations where ($1='all' or character=$1) order by rules_version`, [character])).map((r) => String(r.rules_version));
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.rules_version, row.character]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    summary: summarize(rows),
    byVersionCharacter: [...groups.values()].map((r) => ({ rulesVersion: String(r[0].rules_version), character: String(r[0].character), ...summarize(r) })),
    byTrigger: (["turn10", "day_end", "manual"] as SurveyTrigger[]).map((trigger) => ({ trigger, ...summarize(rows.filter((r) => r.trigger === trigger)) })),
    recent: rows.filter((r) => r.q1 !== null && String(r.q3 ?? "").trim()).slice(0, 20).map(answerView),
    versions,
    surveys: rows.filter((r) => r.q1 !== null && r.q1 !== undefined).map(answerView),
    presentations: rows.map((r) => ({ nickname: String(r.nickname), character: String(r.character), rulesVersion: String(r.rules_version), trigger: r.trigger as SurveyTrigger, day: String(r.day), createdAt: r.created_at, shownAt: r.shown_at, skippedAt: r.skipped_at, submittedAt: r.submitted_at })),
  };
}

// Export a deliberate allowlist; internal IDs and authentication data never enter this object.
export async function buildFeedbackExport(q: SurveyQuery, rules: string, character: string, now = new Date()) {
  const feedback = await readSurveyFeedback(q, rules, character);
  const turns = await q(`select t.*,u.nickname,u.character,um.content as user_text,rm.content as reply_text
    from turns t join users u on u.id=t.user_id
    left join messages um on um.id=t.user_message_id left join messages rm on rm.id=t.reply_message_id
    where ($1='all' or coalesce(t.rules_version,'old')=$1) and ($2='all' or u.character=$2)
    order by t.created_at,t.id`, [rules, character]);
  const reports = await q(`select r.reason,r.created_at,u.nickname,u.character,m.content,case when t.id is null then 'unknown' else coalesce(t.rules_version,'old') end as rules_version
    from reports r join users u on u.id=r.user_id join messages m on m.id=r.message_id
    left join lateral (select id,rules_version from turns where reply_message_id=r.message_id order by id desc limit 1) t on true
    where ($1='all' or (case when t.id is null then 'unknown' else coalesce(t.rules_version,'old') end)=$1) and ($2='all' or u.character=$2)
    order by r.created_at desc`, [rules, character]);
  const drops = await q(`select m.*,u.nickname,u.character,case when t.id is null then 'unknown' else coalesce(t.rules_version,'old') end as rules_version
    from (select distinct on (user_id) user_id,id,role,content,created_at from messages where role in ('user','char') order by user_id,id desc) m
    join users u on u.id=m.user_id
    left join lateral (select id,rules_version from turns where user_message_id=m.id or reply_message_id=m.id order by id desc limit 1) t on true
    where ($1='all' or (case when t.id is null then 'unknown' else coalesce(t.rules_version,'old') end)=$1) and ($2='all' or u.character=$2) and m.created_at < $3::timestamptz - interval '1 hour'`, [rules, character, now.toISOString()]);
  const evidence = (t: Row) => ({ nickname: String(t.nickname), character: String(t.character), rulesVersion: String(t.rules_version ?? "old"), createdAt: t.created_at, userText: t.user_text ?? "", replyText: t.reply_text ?? "", action: t.action, correction: t.correction ?? null, repScore: t.rep_score === null ? null : Number(t.rep_score) });
  const groups = new Map<string, Row[]>();
  for (const t of turns) {
    const key = JSON.stringify([t.rules_version ?? "old", t.character]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const activitySummaries = [...groups.values()].map((group) => {
    const talk = group.filter((t) => t.action !== "greet");
    const shadow = talk.filter((t) => t.shadow_action);
    const judgeCost = group.reduce((sum, t) => { const price = (PRICE_PER_MTOK as Record<string, { in: number; out: number }>)[t.judge_provider] ?? PRICE_PER_MTOK.judge; return sum + (Number(t.judge_in) * price.in + Number(t.judge_out) * price.out + Number(t.extra_in ?? 0) * PRICE_PER_MTOK.judge.in + Number(t.extra_out ?? 0) * PRICE_PER_MTOK.judge.out) / 1e6; }, 0);
    const chatCost = group.reduce((sum, t) => sum + (String(t.chat_model ?? "").startsWith("local:") ? 0 : (Number(t.chat_in) * PRICE_PER_MTOK.chat.in + Number(t.chat_out) * PRICE_PER_MTOK.chat.out) / 1e6), 0);
    return { rulesVersion: group[0].rules_version ?? "old", character: group[0].character, turns: talk.length, corrections: talk.filter((t) => t.correction).length, dayGainCapTurns: talk.filter((t) => t.capped === "day_gain").length, dayEnds: talk.filter((t) => String(t.flags).split(",").includes("day_end")).length, highRepetitionTurns: talk.filter((t) => Number(t.rep_score) >= 0.5).length, shadowCompared: shadow.length, shadowAgreeRate: percent(shadow.filter((t) => t.shadow_action === t.action || (String(t.flags).includes("low_conf") && t.shadow_action === "neutral")).length, shadow.length), estimatedChatCostUsd: +chatCost.toFixed(6), estimatedJudgeCostUsd: +judgeCost.toFixed(6) };
  });
  return {
    schemaVersion: "haruhi-feedback-1", exportedAt: now.toISOString(), filters: { rules, character },
    definitions: { responseRate: "submitted / shown * 100", returnIntention: "survey intention, not observed next-day return", dropPoint: "latest message followed by at least one hour without a new message; not proven cause", repetitionThreshold: 0.5, timezone: "Asia/Seoul", cost: "estimated using configured token prices", identity: "nicknames only; duplicate nicknames may represent different people; free text is user supplied" },
    summary: feedback.summary, summaries: feedback.byVersionCharacter, byTrigger: feedback.byTrigger, activitySummaries,
    surveys: feedback.surveys, presentations: feedback.presentations,
    reports: reports.map((r) => ({ nickname: String(r.nickname), character: String(r.character), rulesVersion: String(r.rules_version), reason: String(r.reason), content: String(r.content), createdAt: r.created_at })),
    corrections: turns.filter((t) => t.correction).map(evidence),
    highRepetitionTurns: turns.filter((t) => t.rep_score !== null && Number(t.rep_score) >= 0.5).map(evidence),
    dropPoints: drops.map((r) => ({ nickname: String(r.nickname), character: String(r.character), rulesVersion: String(r.rules_version), lastRole: r.role, content: r.content, createdAt: r.created_at })),
    // State observations support the four hypotheses without exporting internal identifiers.
    activity: turns.map((t) => ({ nickname: String(t.nickname), character: String(t.character), rulesVersion: String(t.rules_version ?? "old"), createdAt: t.created_at, action: t.action, stageAfter: Number(t.stage_after), eventId: t.event_id ?? null, capped: t.capped ?? null, dayEnd: String(t.flags).split(",").includes("day_end") })),
  };
}
