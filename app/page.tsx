"use client";

import { iga } from "@/lib/josa";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useChar, withC } from "./components/useChar";

export default function Landing() {
  const router = useRouter();
  const c = useChar();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!c) return;
    fetch(withC("/api/session", c), { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.user) router.replace(withC("/chat", c));
      else setReady(true);
    }).catch(() => setReady(true));
  }, [router, c]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!c) return;
    setErr("");
    if (!name.trim()) return setErr(`${iga(c.shortName)} 부를 이름을 적어 주세요.`);
    if (!consent) return setErr("기록 사용에 동의해야 시작할 수 있어요.");
    setBusy(true);
    const r = await fetch(withC("/api/session", c), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: name, consent }) });
    if (r.ok) router.replace(withC("/chat", c));
    else { setErr((await r.json()).error ?? "잠시 뒤 다시 시도해 주세요."); setBusy(false); }
  }

  if (!c) return <main className="landing" />;
  return (
    <main className="landing">
      <div className="landing-card" style={{ visibility: ready ? "visible" : "hidden" }}>
        <div className={`key ${c.art.key ? "" : "key-empty"}`}>{c.art.key && <img src={c.art.key} alt={c.name} />}</div>
        <h1>{c.landing.title}</h1>
        <p className="lead">{c.landing.lead}</p>
        <form onSubmit={start} noValidate>
          <label className="field">
            <span>{iga(c.shortName)} 부를 이름</span>
            <input type="text" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder={c.landing.namePlaceholder} autoComplete="nickname" />
          </label>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>대화 기록을 이 캐릭터 채팅을 고치는 데 쓰는 것에 동의해요. 이름 외 개인정보는 받지 않아요. 기록은 언제든 지울 수 있어요.</span>
          </label>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{busy ? "입장 중" : "시작하기"}</button>
        </form>
        <p className="fine">
          AI로 만든 캐릭터와의 대화예요. 실제 인물이 아니며 대화 내용은 허구입니다.<br />
          {c.rights}
        </p>
      </div>
    </main>
  );
}
