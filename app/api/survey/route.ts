import { q } from "@/lib/db";
import { charFromUrl, currentUser } from "@/lib/state";
import { createSurveyStore, type SurveyTrigger } from "@/lib/surveys";

export const dynamic = "force-dynamic";
const store = createSurveyStore(q);
const noStore = { "Cache-Control": "no-store" };
const validRequestId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

export async function GET(req: Request) {
  const u = await currentUser(charFromUrl(req).id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401, headers: noStore });
  const requestId = new URL(req.url).searchParams.get("requestId");
  if (requestId !== null && !validRequestId(requestId)) return Response.json({ error: "bad_request_id" }, { status: 400 });
  return Response.json({ available: await store.available(u, new Date(), requestId ?? undefined) }, { headers: noStore });
}

export async function POST(req: Request) {
  const u = await currentUser(charFromUrl(req).id);
  if (!u) return Response.json({ error: "no_user" }, { status: 401, headers: noStore });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "bad_request" }, { status: 400 });
  if (body.action === "open") {
    if (!["turn10", "day_end", "manual"].includes(body.trigger)) return Response.json({ error: "bad_trigger" }, { status: 400 });
    if ((body.trigger !== "manual" || body.requestId !== undefined) && !validRequestId(body.requestId)) return Response.json({ error: "bad_request_id" }, { status: 400 });
    return Response.json({ presentation: await store.open(u, body.trigger as SurveyTrigger, new Date(), body.requestId) }, { headers: noStore });
  }
  if (typeof body.presentationId !== "string" || !body.presentationId || body.presentationId.length > 100) return Response.json({ error: "bad_presentation" }, { status: 400 });
  if (body.action === "shown" || body.action === "skip") {
    const ok = await store[body.action as "shown" | "skip"](u, body.presentationId);
    return Response.json(ok ? { ok: true } : { error: "not_found_or_closed" }, { status: ok ? 200 : 404, headers: noStore });
  }
  if (body.action === "submit") {
    const result = await store.submit(u, body.presentationId, body);
    return Response.json(result === "ok" ? { ok: true } : { error: result }, { status: result === "ok" ? 200 : result === "not_found" ? 404 : result === "invalid" ? 400 : 409, headers: noStore });
  }
  return Response.json({ error: "bad_action" }, { status: 400 });
}
