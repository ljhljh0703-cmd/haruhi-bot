import { iga } from "@/lib/josa";
import { LIMITS, RULES_VERSION } from "@/lib/config";
import { addFacts, addMessage, addTurn, listFacts, listMessages, q, recentCharReplies, saveUser, turnsToday } from "@/lib/db";
import { chatModelName, judge, MockHint, streamReply, summarize, toApiMessages, Usage } from "@/lib/llm";
import { buildContext, pickEpisode } from "@/lib/persona";
import { repetitionScore } from "@/lib/repetition";
import { applyAffinity } from "@/lib/rules";
import { charFromUrl, currentUser, moodFor, publicState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const enc = new TextEncoder();
const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");

export async function POST(req: Request) {
  const t0 = Date.now();
  const c = charFromUrl(req);
  const u = await currentUser(c.id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401 });
  if (u.dayTurns >= LIMITS.dayTurns) return Response.json({ error: "done_today", user: publicState(u) }, { status: 429 });

  if ((await turnsToday()) >= LIMITS.globalDayTurns)
    return Response.json({ error: "busy", message: `오늘은 ${iga(c.shortName)} 너무 바빠요. 내일 다시 와 주세요.` }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "action" ? "action" : "talk";
  const text = String(body.text ?? "").trim().slice(0, 500);
  if (!text) return Response.json({ error: "empty" }, { status: 400 });

  const userMsg = await addMessage(u.id, "user", text, kind);
  const history = await listMessages(u.id, LIMITS.recentWindow);
  const facts = (await listFacts(u.id)).map((f) => f.text);
  const lastChar = [...history].reverse().find((m) => m.role === "char")?.content ?? "";
  const stageName = c.stages[u.stage - 1].name;

  // 이벤트(하루히는 불가사의 탐사) 진행 상태
  const turnNo = u.total_turns + 1;
  const ev = { active: null as null | { id: string; title: string; start: number }, done: [] as string[], ...(u.event ?? {}) };
  let episode = ev.active ? c.episodes.find((m) => m.id === ev.active!.id) ?? null : null;
  let step = ev.active ? turnNo - ev.active.start : 0;
  const lastTurnToday = u.dayTurns + 1 >= LIMITS.dayTurns;
  if (!episode && c.episodes.length > 0 && u.stage >= 3 && !lastTurnToday && turnNo - u.last_event_turn >= LIMITS.eventCooldownTurns) {
    episode = pickEpisode(c, ev.done);
    ev.active = { id: episode.id, title: episode.title, start: turnNo };
    step = 0;
  }

  const context = buildContext(c, {
    nickname: u.nickname, stage: u.stage, summary: u.summary, facts,
    episode, episodeStep: step,
    wrapUp: u.dayTurns + 1 >= LIMITS.wrapUpTurns, lastTurnToday,
  });
  const hint: MockHint = lastTurnToday ? "dayEnd" : episode && step === 0 ? { episode: episode.title } : null;

  const judging = judge(c, lastChar, kind === "action" ? `*${text}*` : text, stageName);
  const recentReplies = recentCharReplies(u.id, 5);
  const usage: Usage = { in: 0, out: 0 };

  const stream = new ReadableStream({
    async start(controller) {
      let reply = "";
      let firstToken = 0;
      try {
        for await (const piece of streamReply(c, context, toApiMessages(history), usage, hint)) {
          if (!firstToken) firstToken = Date.now() - t0;
          reply += piece;
          controller.enqueue(line({ t: "d", v: piece }));
        }
        reply = reply.replace(new RegExp(`^\\s*(${c.shortName}|${c.name})\\s*[:：]\\s*`), "").trim();
        if (!reply) throw new Error("empty_reply");
      } catch {
        await q(`delete from messages where id=$1`, [userMsg.id]);
        controller.enqueue(line({ t: "error", message: `${iga(c.shortName)} 답을 못 했어요. 다시 보내 주세요.` }));
        controller.close();
        return;
      }

      const j = await judging;
      const r = applyAffinity(u, j.action);
      const rep = repetitionScore(reply, await recentReplies);
      const replyMsg = await addMessage(u.id, "char", reply);

      // 이벤트 진행: 마무리 턴이 끝나면 닫는다
      let eventId: string | null = null;
      if (episode && ev.active) {
        eventId = episode.id;
        if (step > episode.clues.length) {
          ev.done = [...ev.done, episode.id];
          ev.active = null;
          u.last_event_turn = turnNo;
        }
      }

      const next = {
        ...u,
        score: r.scoreAfter,
        stage: r.stageAfter,
        dayGain: u.dayGain + Math.max(0, r.applied),
        dayLoss: u.dayLoss + Math.max(0, -r.applied),
        dayTurns: u.dayTurns + 1,
        total_turns: turnNo,
        event: ev,
        mood: moodFor(j.action, r.stageAfter),
      };
      if (!ev.active && !eventId && next.last_event_turn === 0 && r.stageAfter >= 3 && u.stage < 3) {
        // 3단계가 된 직후에는 몇 턴 뒤 첫 이벤트가 오도록 기준점을 잡는다
        next.last_event_turn = turnNo - LIMITS.eventCooldownTurns + 3;
      }

      let notice: null | { title: string; body: string } = null;
      if (r.stageAfter > r.stageBefore) {
        const st = c.stages[r.stageAfter - 1];
        notice = { title: `${iga(st.name)} 되었다`, body: `새로 열림: ${st.unlock}` };
        await addMessage(u.id, "system", `${iga(st.name)} 되었다 · 새로 열림: ${st.unlock}`, "stage");
      } else if (r.capped === "day_gain" && u.dayGain < LIMITS.dayGain) {
        notice = { title: "오늘 친해질 수 있는 만큼 친해졌다", body: "호감은 내일 다시 오른다" };
      }

      await saveUser(next);
      if (j.facts.length) await addFacts(u.id, j.facts);
      await addTurn({
        user_id: u.id, user_message_id: userMsg.id, reply_message_id: replyMsg.id,
        action: j.action, reason: j.reason, raw_delta: r.raw, applied_delta: r.applied, capped: r.capped,
        score_after: r.scoreAfter, stage_after: r.stageAfter,
        chat_in: usage.in, chat_out: usage.out, judge_in: j.usage.in, judge_out: j.usage.out,
        latency_ms: Date.now() - t0, first_token_ms: firstToken, event_id: eventId,
        flags: [...j.flags, lastTurnToday ? "day_end" : ""].filter(Boolean).join(","),
        judge_provider: j.provider, judge_conf: j.confidence, shadow_action: j.shadow,
        extra_in: j.extra.in, extra_out: j.extra.out, chat_model: chatModelName(),
        rules_version: RULES_VERSION, rep_score: rep,
      });

      controller.enqueue(line({ t: "meta", replyId: replyMsg.id, userId: userMsg.id, user: publicState(next), notice, delta: r.applied }));
      // 요약 기억 갱신. 화면은 meta를 받은 순간 끝난 것으로 처리하므로 기다리게 하지 않는다.
      if (turnNo % LIMITS.summaryEvery === 0) {
        try {
          const recent = await listMessages(u.id, LIMITS.summaryEvery * 2 + 2);
          const forget = (await listFacts(u.id, true)).filter((f) => f.deleted).map((f) => f.text);
          const s = await summarize(c, u.summary, recent, forget);
          if (s) await q(`update users set summary=$2 where id=$1`, [u.id, s]);
        } catch {}
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
