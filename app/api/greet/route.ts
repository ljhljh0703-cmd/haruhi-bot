import { LIMITS, RULES_VERSION } from "@/lib/config";
import { addMessage, addTurn, lastMessageAt, listFacts, listMessages } from "@/lib/db";
import { chatModelName, streamReply, toApiMessages, Usage } from "@/lib/llm";
import { buildContext } from "@/lib/persona";
import { charFromUrl, currentUser, publicState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 2단계부터: 오래 비웠다 돌아오면 캐릭터가 먼저 말을 건다.
export async function POST(req: Request) {
  const t0 = Date.now();
  const c = charFromUrl(req);
  const u = await currentUser(c.id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401 });
  const last = await lastMessageAt(u.id);
  const hoursAway = last ? (Date.now() - last.getTime()) / 3600_000 : 0;
  if (u.stage < 2 || hoursAway < LIMITS.greetAfterHours || u.dayTurns >= LIMITS.dayTurns)
    return Response.json({ skipped: true });

  const history = await listMessages(u.id, LIMITS.recentWindow);
  const facts = (await listFacts(u.id)).map((f) => f.text);
  const context = buildContext(c, {
    nickname: u.nickname, stage: u.stage, summary: u.summary, facts,
    episode: null, episodeStep: 0, wrapUp: false, lastTurnToday: false,
    greeting: { hoursAway },
  });
  const usage: Usage = { in: 0, out: 0 };
  let reply = "";
  try {
    for await (const p of streamReply(c, context, toApiMessages(history, "(상대가 채팅방에 들어왔다. 아직 아무 말도 안 했다)"), usage, "greet")) reply += p;
  } catch {
    return Response.json({ skipped: true });
  }
  reply = reply.trim();
  if (!reply) return Response.json({ skipped: true });
  const msg = await addMessage(u.id, "char", reply);
  await addTurn({
    user_id: u.id, reply_message_id: msg.id, action: "greet", reason: `${Math.round(hoursAway)}시간 만`,
    score_after: u.score, stage_after: u.stage, chat_in: usage.in, chat_out: usage.out,
    latency_ms: Date.now() - t0, chat_model: chatModelName(), rules_version: RULES_VERSION,
  });
  return Response.json({ message: msg, user: publicState(u) });
}
