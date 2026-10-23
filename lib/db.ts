// 저장소. 배포에서는 Postgres(DATABASE_URL), 내 컴퓨터에서는 PGlite 파일 DB.
// SQL은 한 벌만 쓴다.
import { kstDay } from "./config";

type Row = Record<string, any>;
type Q = (text: string, params?: any[]) => Promise<Row[]>;

const SCHEMA = `
create table if not exists users (
  id text primary key,
  nickname text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  score int not null default 0,
  stage int not null default 1,
  day text not null default '',
  day_gain int not null default 0,
  day_loss int not null default 0,
  day_turns int not null default 0,
  total_turns int not null default 0,
  visits int not null default 1,
  summary text not null default '',
  event jsonb,
  last_event_turn int not null default 0,
  mood text not null default 'base'
);
create table if not exists messages (
  id bigserial primary key,
  user_id text not null,
  role text not null,
  kind text not null default 'talk',
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_user on messages(user_id, id);
create table if not exists facts (
  id bigserial primary key,
  user_id text not null,
  text text not null,
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);
create table if not exists turns (
  id bigserial primary key,
  user_id text not null,
  user_message_id bigint,
  reply_message_id bigint,
  action text not null,
  reason text not null default '',
  raw_delta int not null default 0,
  applied_delta int not null default 0,
  capped text,
  score_after int not null,
  stage_after int not null,
  chat_in int not null default 0,
  chat_out int not null default 0,
  judge_in int not null default 0,
  judge_out int not null default 0,
  latency_ms int not null default 0,
  first_token_ms int not null default 0,
  event_id text,
  flags text not null default '',
  correction text,
  created_at timestamptz not null default now()
);
create index if not exists turns_user on turns(user_id, id);
alter table turns add column if not exists judge_provider text;
alter table turns add column if not exists judge_conf real;
alter table turns add column if not exists shadow_action text;
alter table turns add column if not exists extra_in int not null default 0;
alter table turns add column if not exists extra_out int not null default 0;
alter table turns add column if not exists chat_model text;
alter table turns add column if not exists rules_version text;
alter table turns add column if not exists rep_score real;
alter table users add column if not exists character text not null default 'haruhi';
create table if not exists reports (
  id bigserial primary key,
  user_id text not null,
  message_id bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);
`;

let qPromise: Promise<Q> | null = null;

async function makeQ(): Promise<Q> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    const q: Q = async (text, params = []) => (await sql.query(text, params)) as Row[];
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
    return q;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const g = globalThis as any;
  if (!g.__pglite) {
    // Vercel에서 DATABASE_URL 없이 뜨면 /tmp에 임시로 둔다(재시작 때 사라짐. 운영자 화면에 경고).
    const dir = process.env.PGLITE_DIR || (process.env.VERCEL ? "/tmp/pg" : "./.data/pg");
    (await import("node:fs")).mkdirSync(dir, { recursive: true });
    g.__pglite = new PGlite(dir);
    await g.__pglite.exec(SCHEMA);
  }
  const db = g.__pglite;
  return async (text, params = []) => (await db.query(text, params)).rows as Row[];
}

export async function q(text: string, params: any[] = []) {
  if (!qPromise) qPromise = makeQ().catch((e) => { qPromise = null; throw e; });
  const fn = await qPromise;
  return fn(text, params);
}

export const usingLocalDb = () => !process.env.DATABASE_URL;

export type User = {
  id: string; nickname: string; created_at: string; last_seen: string;
  score: number; stage: number; day: string; dayGain: number; dayLoss: number; dayTurns: number;
  total_turns: number; visits: number; summary: string; event: any; last_event_turn: number; mood: string; character: string;
};

function toUser(r: Row): User {
  return {
    id: r.id, nickname: r.nickname, created_at: r.created_at, last_seen: r.last_seen,
    score: r.score, stage: r.stage, day: r.day, dayGain: r.day_gain, dayLoss: r.day_loss,
    dayTurns: r.day_turns, total_turns: r.total_turns, visits: r.visits, summary: r.summary,
    event: r.event, last_event_turn: r.last_event_turn, mood: r.mood, character: r.character ?? "haruhi",
  };
}

export async function createUser(id: string, nickname: string, character: string) {
  await q(`insert into users (id, nickname, day, character) values ($1, $2, $3, $4)`, [id, nickname, kstDay(), character]);
  return getUser(id);
}

export async function getUser(id: string) {
  const rows = await q(`select * from users where id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function saveUser(u: User) {
  await q(
    `update users set score=$2, stage=$3, day=$4, day_gain=$5, day_loss=$6, day_turns=$7,
     total_turns=$8, visits=$9, summary=$10, event=$11, last_event_turn=$12, mood=$13, last_seen=now()
     where id=$1`,
    [u.id, u.score, u.stage, u.day, u.dayGain, u.dayLoss, u.dayTurns, u.total_turns, u.visits,
     u.summary, u.event ? JSON.stringify(u.event) : null, u.last_event_turn, u.mood],
  );
}

export async function touchVisit(id: string) {
  await q(`update users set visits = visits + 1, last_seen = now() where id = $1`, [id]);
}

export type Msg = { id: number; role: "char" | "user" | "system"; kind: string; content: string; created_at: string };

export async function addMessage(userId: string, role: Msg["role"], content: string, kind = "talk") {
  const rows = await q(
    `insert into messages (user_id, role, kind, content) values ($1,$2,$3,$4) returning id, created_at`,
    [userId, role, kind, content],
  );
  return { id: Number(rows[0].id), role, kind, content, created_at: rows[0].created_at } as Msg;
}

export async function listMessages(userId: string, limit = 200) {
  const rows = await q(
    `select id, role, kind, content, created_at from messages where user_id=$1 order by id desc limit $2`,
    [userId, limit],
  );
  return rows.reverse().map((r) => ({ ...r, id: Number(r.id) })) as Msg[];
}

export async function lastMessageAt(userId: string) {
  const rows = await q(`select created_at from messages where user_id=$1 order by id desc limit 1`, [userId]);
  return rows[0]?.created_at ? new Date(rows[0].created_at) : null;
}

export async function addFacts(userId: string, texts: string[]) {
  const existing = (await listFacts(userId, true)).map((f) => norm(f.text));
  for (const t of texts) {
    const n = norm(t);
    if (!n || existing.some((e) => e === n || e.includes(n) || n.includes(e))) continue;
    await q(`insert into facts (user_id, text) values ($1,$2)`, [userId, t.trim().slice(0, 120)]);
    existing.push(n);
  }
}
const norm = (s: string) => s.replace(/\s+/g, "").replace(/[.!?。]/g, "");

export async function listFacts(userId: string, includeDeleted = false) {
  const rows = await q(
    `select id, text, created_at, deleted from facts where user_id=$1 ${includeDeleted ? "" : "and deleted=false"} order by id`,
    [userId],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) })) as { id: number; text: string; created_at: string; deleted: boolean }[];
}

export async function deleteFact(userId: string, id: number) {
  await q(`update facts set deleted=true where user_id=$1 and id=$2`, [userId, id]);
}

export async function addTurn(t: Record<string, any>) {
  const cols = Object.keys(t);
  await q(
    `insert into turns (${cols.join(",")}) values (${cols.map((_, i) => "$" + (i + 1)).join(",")})`,
    cols.map((c) => t[c]),
  );
}

export async function setCorrection(turnId: number, correction: string | null) {
  await q(`update turns set correction=$2 where id=$1`, [turnId, correction]);
}

// 전체 하루 턴 수. 링크가 퍼져도 비용이 끝없이 나가지 않게 막는다.
export async function turnsToday() {
  const rows = await q(`select count(*)::int as n from turns where created_at > now() - interval '24 hours' and action <> 'greet'`);
  return Number(rows[0]?.n ?? 0);
}

export async function addReport(userId: string, messageId: number, reason: string) {
  const own = await q(`select 1 from messages where id=$1 and user_id=$2 and role='char'`, [messageId, userId]);
  if (!own.length) return false;
  await q(`insert into reports (user_id, message_id, reason) values ($1,$2,$3)`, [userId, messageId, reason.slice(0, 40)]);
  return true;
}

// 사용자가 요청하면 그 사람 기록을 전부 지운다.
export async function deleteUserData(userId: string) {
  for (const t of ["reports", "turns", "facts", "messages"]) await q(`delete from ${t} where user_id=$1`, [userId]);
  await q(`delete from users where id=$1`, [userId]);
}

export async function recentCharReplies(userId: string, n = 5) {
  const rows = await q(`select content from messages where user_id=$1 and role='char' order by id desc limit $2`, [userId, n]);
  return rows.map((r) => String(r.content));
}
