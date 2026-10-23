"use client";

import { iga } from "@/lib/josa";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BackIcon } from "../components/Icons";
import { ManualSurvey } from "../components/SurveyCard";
import { useRouter } from "next/navigation";
import { useChar, withC } from "../components/useChar";

type Fact = { id: number; text: string; created_at: string };

export default function MemoryPage() {
  const c = useChar();
  const router = useRouter();
  const [wipe, setWipe] = useState(false);
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [summary, setSummary] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!c) return;
    fetch(withC("/api/memory", c), { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return setErr("먼저 첫 화면에서 입장해 주세요.");
      const d = await r.json();
      setFacts(d.facts);
      setSummary(d.summary);
    }).catch(() => setErr("불러오지 못했어요. 다시 시도해 주세요."));
  }, [c]);

  async function remove(id: number) {
    if (!c) return;
    const r = await fetch(withC(`/api/memory?id=${id}`, c), { method: "DELETE" });
    if (r.ok) setFacts((await r.json()).facts);
    setConfirm(null);
  }

  async function wipeAll() {
    if (!c) return;
    await fetch(withC("/api/session", c), { method: "DELETE" });
    router.replace(withC("/", c));
  }

  if (!c) return <div className="page" />;
  return (
    <div className="page">
      <header className="page-head">
        <Link href={withC("/chat", c)} className="icon-btn" aria-label="대화로 돌아가기" style={{ textDecoration: "none" }}><BackIcon /></Link>
        <h1>{c.shortName}의 기억 노트</h1>
      </header>
      <div className="page-body">
        <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>
          {iga(c.shortName)} 대화에서 기억해 둔 너의 이야기예요. 틀렸거나 잊었으면 하는 건 지우면 다음 대화부터 {iga(c.shortName)} 몰라요.
        </p>
        {err && <p className="err" style={{ marginTop: 16 }}>{err}</p>}

        <div className="section-title">{iga(c.shortName)} 기억하는 너</div>
        {facts === null && !err && <div className="empty">불러오는 중</div>}
        {facts?.length === 0 && <div className="empty">아직 기억한 게 없어요. {c.shortName}에게 네 이야기를 해 봐.</div>}
        {facts?.map((f) => (
          <div key={f.id} className={`fact ${confirm === f.id ? "confirm" : ""}`}>
            <p>{f.text}<small>{new Date(f.created_at).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}</small></p>
            {confirm === f.id ? (
              <>
                <button className="btn del" onClick={() => setConfirm(null)}>취소</button>
                <button className="btn del" style={{ color: "var(--warn)" }} onClick={() => remove(f.id)}>지우기</button>
              </>
            ) : (
              <button className="btn btn-ghost del" onClick={() => setConfirm(f.id)}>지우기</button>
            )}
          </div>
        ))}

        <div className="section-title">지난 이야기 요약</div>
        {summary ? <div className="summary-box">{summary}</div> : <div className="empty">대화를 조금 더 하면 {iga(c.shortName)} 정리해 둬요.</div>}
        <p className="side-note">지운 기억은 다음 대화부터 {c.shortName}에게 넘기지 않아요. 요약은 몇 번 대화할 때마다 새로 쓰고, 그때 지운 내용을 빼고 써요.</p>

        {facts !== null && <ManualSurvey c={c} />}

        <div className="section-title">내 기록</div>
        {wipe ? (
          <div className="fact confirm">
            <p>대화, 기억, 호감도, 설문 답변이 모두 지워지고 처음부터 시작해요. 되돌릴 수 없어요.</p>
            <button className="btn del" onClick={() => setWipe(false)}>취소</button>
            <button className="btn del" style={{ color: "var(--warn)" }} onClick={wipeAll}>모두 지우기</button>
          </div>
        ) : (
          <button className="danger-link" onClick={() => setWipe(true)}>내 기록 모두 지우기</button>
        )}
      </div>
    </div>
  );
}
