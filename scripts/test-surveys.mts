import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never use the deployed database or call any model/provider in this test process.
process.env.DATABASE_URL = "";
const directory = await mkdtemp(join(tmpdir(), "haruhi-survey-test-"));
process.env.PGLITE_DIR = directory;
const { q, createUser, saveUser, getUser, deleteUserData, addMessage, addTurn, addReport } = await import("../lib/db");
const { createSurveyStore, readSurveyFeedback, buildFeedbackExport, validateSurveyAnswers, ensureSurveyForeignKeys } = await import("../lib/surveys");
const { RULES_VERSION, kstDay, LIMITS } = await import("../lib/config");
const store = createSurveyStore(q);
let passed = 0;
const check = (name: string) => { passed++; console.log(`PASS ${name}`); };
const user = async (nickname: string, character = "haruhi", turns = 0) => {
  const created = await createUser(crypto.randomUUID(), nickname, character);
  assert.ok(created);
  const u = { ...created, dayTurns: turns };
  await saveUser(u);
  return u;
};
const base = { q1: 5, q2: "yes", q3: "좋았어요" };
async function answer(u: Awaited<ReturnType<typeof user>>, trigger: "manual" | "turn10" | "day_end", body: Record<string, unknown>) {
  const p = await store.open(u, trigger); assert.ok(p);
  assert.equal(await store.shown(u, p.id), true);
  assert.equal(await store.submit(u, p.id, body), "ok");
  return p;
}
try {
  const u = await user("첫 친구", "haruhi", 9);
  assert.equal(await store.available(u), null);
  assert.equal(await store.open(u, "turn10"), null);
  u.dayTurns = 10; await saveUser(u);
  assert.equal(await store.available(u), "turn10");
  const beforeGet = await q("select count(*)::int as n from survey_presentations");
  await store.available(u); await store.available(u);
  assert.deepEqual(await q("select count(*)::int as n from survey_presentations"), beforeGet);
  check("9→10 completed turns; availability reads do not mutate");

  const opened = await Promise.all([store.open(u, "turn10"), store.open(u, "turn10")]);
  assert.equal(opened.filter(Boolean).length, 1);
  const p = opened.find(Boolean)!;
  assert.equal(await store.available(u), null);
  assert.equal((await readSurveyFeedback(q, "all", "all")).summary.shown, 0);
  assert.equal(await store.submit(u, p.id, base), "not_shown");
  await store.shown(u, p.id); await store.shown(u, p.id);
  assert.equal((await readSurveyFeedback(q, "all", "all")).summary.shown, 1);
  check("concurrent automatic opens are unique; only shown ACK enters denominator");

  const other = await user("다른 친구");
  assert.equal(await store.shown(other, p.id), false);
  assert.equal(await store.submit(other, p.id, base), "not_found");
  assert.equal(await store.shown({ ...u, character: "jaeheon" }, p.id), false);
  assert.equal(await store.skip(u, p.id), true);
  assert.equal(await store.skip(u, p.id), true);
  assert.equal(await store.submit(u, p.id, base), "skipped");
  u.dayTurns = 11;
  assert.equal(await store.open(u, "turn10"), null);
  await q("update survey_presentations set rules_version='older-rule' where id=$1", [p.id]);
  assert.equal(await store.open(u, "turn10"), null);
  check("owner/character isolation; skipped automatic prompts stay closed across rules versions");

  u.dayTurns = LIMITS.dayTurns;
  assert.equal(await store.available(u), "day_end");
  assert.equal(await store.open(u, "turn10"), null);
  const end = await store.open(u, "day_end"); assert.ok(end);
  assert.equal(await store.open(u, "day_end"), null);
  assert.equal(await store.available(u), null);
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  assert.equal(await store.available(u, tomorrow), null);
  assert.equal(await store.available({ ...u, day: kstDay(tomorrow), dayTurns: 10 }, tomorrow), "turn10");
  assert.equal(kstDay(new Date("2026-10-23T14:59:59Z")), "2026-10-23");
  assert.equal(kstDay(new Date("2026-10-23T15:00:00Z")), "2026-10-24");
  check("day_end takes priority; next KST day requires new completed turns");

  assert.ok(validateSurveyAnswers({ ...base, q3: "가".repeat(500), q4: 0 }, "manual"));
  assert.ok(validateSurveyAnswers({ ...base, q3: "", q4: 10 }, "manual"));
  assert.equal(validateSurveyAnswers({ ...base, q3: "가".repeat(501), q4: 5 }, "manual"), null);
  for (const bad of [{ q1: 0 }, { q1: 6 }, { q1: 2.5 }, { q1: "5" }, { q2: "maybe" }, { q4: -1 }, { q4: 11 }, { q4: 0.5 }, { q4: undefined }]) {
    assert.equal(validateSurveyAnswers({ ...base, q4: 5, ...bad }, "manual"), null);
  }
  assert.equal(validateSurveyAnswers({ ...base, q4: 10 }, "turn10")?.q4, null);
  check("answer validation, optional text, 500-character boundary and recommendation zero");

  const manual = await store.open(other, "manual"); assert.ok(manual);
  await store.shown(other, manual.id);
  const unchangedBefore = await getUser(other.id);
  const replies = await Promise.all([store.submit(other, manual.id, { ...base, q4: 0 }), store.submit(other, manual.id, { ...base, q4: 0 })]);
  assert.deepEqual(replies, ["ok", "ok"]);
  assert.equal(Number((await q("select count(*)::int as n from surveys where presentation_id=$1", [manual.id]))[0].n), 1);
  assert.deepEqual(await getUser(other.id), unchangedBefore);
  assert.equal(Number((await q("select count(*)::int as n from turns where user_id=$1", [other.id]))[0].n), 0);
  assert.equal(await store.skip(other, manual.id), false);
  check("concurrent submit is idempotent and cannot change affinity, turns or judge records");

  const recovery = await user("복구 표본", "haruhi", 10);
  const ownerRequest = crypto.randomUUID();
  const anotherTab = crypto.randomUUID();
  const reserved = await store.open(recovery, "turn10", new Date(), ownerRequest); assert.ok(reserved);
  // Treat the first response as lost and recover solely from the saved request token.
  assert.equal(await store.available(recovery, new Date(), ownerRequest), "turn10");
  assert.equal(await store.available(recovery, new Date(), anotherTab), null);
  assert.equal(await store.open(recovery, "turn10", new Date(), anotherTab), null);
  const recovered = await store.open(recovery, "turn10", new Date(), ownerRequest);
  assert.deepEqual(recovered, reserved);
  assert.equal(Number((await q("select count(*)::int as n from survey_presentations where user_id=$1", [recovery.id]))[0].n), 1);
  await store.shown(recovery, reserved.id);
  assert.equal(await store.available(recovery, new Date(), ownerRequest), null);
  assert.equal(await store.open(recovery, "turn10", new Date(), ownerRequest), null);
  check("lost open response replays the same unshown reservation; other tabs and shown replays are blocked");

  const replaySkip = await user("건너뛰기 복구 차단", "haruhi", 10);
  const skippedRequest = crypto.randomUUID();
  const skipReservation = await store.open(replaySkip, "turn10", new Date(), skippedRequest); assert.ok(skipReservation);
  await store.skip(replaySkip, skipReservation.id);
  assert.equal(await store.available(replaySkip, new Date(), skippedRequest), null);
  assert.equal(await store.open(replaySkip, "turn10", new Date(), skippedRequest), null);
  check("same-token replay cannot reopen a skipped reservation");

  // A separate character/rules cohort with six shown cards, four responses and two skips.
  const cohort = await user("숫자 표본", "jaeheon", 10);
  const sample1 = await answer(cohort, "turn10", { q1: 5, q2: "yes", q3: "첫 답" });
  cohort.dayTurns = LIMITS.dayTurns;
  await answer(cohort, "day_end", { q1: 4, q2: "yes", q3: "" });
  await answer(cohort, "manual", { q1: 3, q2: "no", q3: "수동 0점", q4: 0 });
  await answer(cohort, "manual", { q1: 2, q2: "unsure", q3: "수동 10점", q4: 10 });
  for (let i = 0; i < 2; i++) { const card = await store.open(cohort, "manual"); assert.ok(card); await store.shown(cohort, card.id); await store.skip(cohort, card.id); }
  const feedback = await readSurveyFeedback(q, RULES_VERSION, "jaeheon");
  assert.deepEqual(feedback.summary, { shown: 6, responses: 4, skipped: 2, responseRate: 66.7, characterAvg: 3.5, returnYesRate: 50, recommendAvg: 5, recommendResponses: 2 });
  assert.equal(feedback.recent.length, 3);
  const empty = await readSurveyFeedback(q, "no-such-version", "all");
  assert.equal(empty.summary.responseRate, null);
  assert.equal(empty.summary.characterAvg, null);
  assert.equal(empty.summary.recommendAvg, null);
  check("known denominators and means; missing values stay null; character/rules filters");

  const contentUser = await addMessage(cohort.id, "user", "탐사할까요?");
  const contentReply = await addMessage(cohort.id, "char", "그러자!");
  await q("update messages set created_at=now()-interval '2 hours' where id in ($1,$2)", [contentUser.id, contentReply.id]);
  await addTurn({ user_id: cohort.id, user_message_id: contentUser.id, reply_message_id: contentReply.id, action: "engaged", score_after: 12, stage_after: 2, rules_version: RULES_VERSION, rep_score: 0.75, correction: "fun_idea", event_id: "test-event", flags: "day_end", chat_in: 100, chat_out: 10, judge_in: 50, judge_out: 2, judge_provider: "local", shadow_action: "engaged" });
  await addReport(cohort.id, contentReply.id, "같은 말 반복");
  const oldReply = await addMessage(other.id, "char", "옛날 판의 답");
  await addTurn({ user_id: other.id, reply_message_id: oldReply.id, action: "neutral", score_after: 0, stage_after: 1, rules_version: "test-old", rep_score: 0.8, correction: "engaged" });
  await addReport(other.id, oldReply.id, "캐릭터 같지 않아요");
  const unknownReply = await addMessage(other.id, "char", "첫 인사");
  await addReport(other.id, unknownReply.id, "기타");
  const exported = await buildFeedbackExport(q, RULES_VERSION, "jaeheon");
  assert.equal(exported.reports.length, 1);
  assert.equal(exported.corrections.length, 1);
  assert.equal(exported.highRepetitionTurns.length, 1);
  assert.equal(exported.dropPoints.length, 1);
  assert.equal(exported.activity[0].stageAfter, 2);
  assert.equal(exported.activity[0].eventId, "test-event");
  assert.equal(exported.activitySummaries[0].shadowAgreeRate, 100);
  const oldExport = await buildFeedbackExport(q, "test-old", "all");
  assert.equal(oldExport.reports.length, 1);
  assert.equal(oldExport.reports[0].content, "옛날 판의 답");
  const unknownExport = await buildFeedbackExport(q, "unknown", "all");
  assert.equal(unknownExport.reports.length, 1);
  assert.equal(unknownExport.reports[0].content, "첫 인사");
  const legacy = await user("레거시 표본");
  const legacyReply = await addMessage(legacy.id, "char", "판 번호가 없던 답");
  await q("update messages set created_at=now()-interval '2 hours' where id=$1", [legacyReply.id]);
  await addTurn({ user_id: legacy.id, reply_message_id: legacyReply.id, action: "neutral", score_after: 0, stage_after: 1, correction: "engaged", rep_score: 0.6 });
  await addReport(legacy.id, legacyReply.id, "기타");
  const legacyExport = await buildFeedbackExport(q, "old", "all");
  assert.equal(legacyExport.reports.length, 1);
  assert.equal(legacyExport.reports[0].rulesVersion, "old");
  assert.equal(legacyExport.corrections.length, 1);
  assert.equal(legacyExport.highRepetitionTurns.length, 1);
  assert.equal(legacyExport.dropPoints.length, 1);
  assert.equal(legacyExport.activitySummaries[0].rulesVersion, "old");
  assert.equal((await buildFeedbackExport(q, "unknown", "all")).reports.length, 1);
  check("null legacy turn versions use old; unlinked reports remain unknown");

  const serialized = JSON.stringify(exported);
  for (const secret of [cohort.id, other.id, u.id, sample1.id, "user_id", "presentation_id", "request_id", "ADMIN_KEY", "sos_admin", "uid_haruhi"]) assert.equal(serialized.includes(secret), false);
  check("export keeps correct rules attribution, failure evidence and activity without internal identifiers");

  // Only the newest 20 nonempty comments, after filtering.
  for (let i = 0; i < 22; i++) await answer(cohort, "manual", { ...base, q3: `최근 답 ${i}`, q4: 5 });
  assert.equal((await readSurveyFeedback(q, RULES_VERSION, "jaeheon")).recent.length, 20);
  check("recent comments are limited to twenty after filtering");

  await deleteUserData(cohort.id);
  for (const table of ["users", "surveys", "survey_presentations", "reports", "turns", "facts", "messages"]) {
    const column = table === "users" ? "id" : "user_id";
    assert.equal(Number((await q(`select count(*)::int as n from ${table} where ${column}=$1`, [cohort.id]))[0].n), 0);
  }
  assert.ok(await getUser(other.id));
  check("existing delete-user path removes surveys and presentations only for that user");

  // Simulate upgrading the already-created local tables, exclusively in this isolated DB.
  await q("alter table surveys drop constraint surveys_user_fk");
  await q("alter table survey_presentations drop constraint survey_presentations_user_fk");
  await ensureSurveyForeignKeys(q);
  await ensureSurveyForeignKeys(q);
  const constraints = await q("select conname,confdeltype from pg_constraint where conname in ('surveys_user_fk','survey_presentations_user_fk')");
  assert.equal(constraints.length, 2);
  assert.ok(constraints.every((r) => r.confdeltype === "c"));
  check("existing local tables receive idempotent user foreign-key migrations");

  const deleted = await user("삭제 레이스 표본", "haruhi", 10);
  const stale = await store.open(deleted, "turn10"); assert.ok(stale);
  await store.shown(deleted, stale.id);
  await answer(deleted, "manual", { ...base, q4: 7 });
  await q("delete from users where id=$1", [deleted.id]);
  for (const table of ["surveys", "survey_presentations"]) assert.equal(Number((await q(`select count(*)::int as n from ${table} where user_id=$1`, [deleted.id]))[0].n), 0);
  assert.equal(await store.open(deleted, "turn10"), null);
  assert.equal(await store.open(deleted, "manual"), null);
  assert.equal(await store.submit(deleted, stale.id, base), "not_found");
  assert.equal(await store.shown(deleted, stale.id), false);
  await assert.rejects(q("insert into survey_presentations (id,user_id,character,rules_version,day,trigger) values ($1,$2,'haruhi','test-1',$3,'manual')", [crypto.randomUUID(), deleted.id, kstDay()]), (error: any) => error.code === "23503");
  const validPresentation = await store.open(other, "manual"); assert.ok(validPresentation);
  await assert.rejects(q("insert into surveys (presentation_id,user_id,character,rules_version,trigger,q1,q2,q4) values ($1,$2,'haruhi','test-1','manual',5,'yes',5)", [validPresentation.id, deleted.id]), (error: any) => error.code === "23503");
  const allSerialized = JSON.stringify(await buildFeedbackExport(q, "all", "all"));
  assert.equal(allSerialized.includes(ownerRequest), false);
  assert.equal(allSerialized.includes(skippedRequest), false);
  check("user deletion cascades; stale open/submit and direct orphan inserts cannot restore deleted data");

  console.log(`SURVEY_TESTS ${passed}/${passed} passed; isolated PGlite, no provider/network calls`);
} finally {
  await (globalThis as any).__pglite?.close();
  await rm(directory, { recursive: true, force: true });
}
