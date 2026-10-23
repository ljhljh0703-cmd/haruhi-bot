import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/config";
import { addMessage, createUser, deleteUserData, lastMessageAt, listMessages, touchVisit } from "@/lib/db";
import { charFromUrl, cookieName, currentUser, publicState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = charFromUrl(req);
  const u = await currentUser(c.id);
  if (!u) return NextResponse.json({ user: null });
  const last = await lastMessageAt(u.id);
  const hoursAway = last ? (Date.now() - last.getTime()) / 3600_000 : 0;
  if (Date.now() - new Date(u.last_seen).getTime() > LIMITS.sessionGapMin * 60_000) await touchVisit(u.id);
  const messages = await listMessages(u.id, 120);
  // 인사를 하면 마지막 메시지 시각이 갱신되므로 두 번 인사하지 않는다.
  const shouldGreet = u.stage >= 2 && hoursAway >= LIMITS.greetAfterHours && u.dayTurns < LIMITS.dayTurns;
  return NextResponse.json({ user: publicState(u), messages, shouldGreet, hoursAway });
}

export async function POST(req: Request) {
  const c = charFromUrl(req);
  const body = await req.json().catch(() => ({}));
  const nickname = String(body.nickname ?? "").trim().slice(0, 12);
  if (!nickname) return NextResponse.json({ error: "이름을 적어 주세요." }, { status: 400 });
  if (!body.consent) return NextResponse.json({ error: "기록 사용에 동의해야 시작할 수 있어요." }, { status: 400 });
  const id = crypto.randomUUID();
  const u = await createUser(id, nickname, c.id);
  for (const m of c.opening) await addMessage(id, m.kind === "action" ? "system" : "char", m.content, m.kind);
  (await cookies()).set(cookieName(c.id), id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 180, path: "/", secure: process.env.NODE_ENV === "production" });
  return NextResponse.json({ user: publicState(u!) });
}

// 내 기록 지우기: 대화·기억·판정 기록·신고를 모두 지우고 처음 화면으로.
export async function DELETE(req: Request) {
  const c = charFromUrl(req);
  const u = await currentUser(c.id);
  if (u) await deleteUserData(u.id);
  (await cookies()).delete(cookieName(c.id));
  return NextResponse.json({ ok: true });
}
