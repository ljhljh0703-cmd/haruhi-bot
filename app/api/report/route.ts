import { addReport } from "@/lib/db";
import { REPORT_REASONS } from "@/lib/reports";
import { charFromUrl, currentUser } from "@/lib/state";

export const dynamic = "force-dynamic";

// 「이상해요」 신고: 친구가 직접 고른 실패 사례. 운영자 화면에 모이고 학습 라벨 재료가 된다.

export async function POST(req: Request) {
  const u = await currentUser(charFromUrl(req).id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const reason = REPORT_REASONS.includes(body.reason) ? body.reason : "기타";
  const ok = await addReport(u.id, Number(body.messageId), reason);
  return Response.json({ ok }, { status: ok ? 200 : 400 });
}
