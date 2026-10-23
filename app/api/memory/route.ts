import { deleteFact, listFacts } from "@/lib/db";
import { charFromUrl, currentUser } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await currentUser(charFromUrl(req).id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401 });
  return Response.json({ facts: await listFacts(u.id), summary: u.summary, nickname: u.nickname });
}

export async function DELETE(req: Request) {
  const u = await currentUser(charFromUrl(req).id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "bad_id" }, { status: 400 });
  await deleteFact(u.id, id);
  return Response.json({ ok: true, facts: await listFacts(u.id) });
}
