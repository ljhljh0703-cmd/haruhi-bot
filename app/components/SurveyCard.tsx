"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CharacterPublic } from "@/lib/characters/types";
import { withC } from "./useChar";

type Trigger = "turn10" | "day_end" | "manual";
type Presentation = { id: string; trigger: Trigger };
type CloseReason = "submitted" | "skipped";

async function requestSurvey(c: CharacterPublic, body: Record<string, unknown>) {
  const response = await fetch(withC("/api/survey", c), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("survey_" + response.status);
  return response.json();
}

export default function SurveyCard({ c, presentation, onClose }: {
  c: CharacterPublic;
  presentation: Presentation;
  onClose: (reason: CloseReason) => void;
}) {
  const id = useId();
  const cardRef = useRef<HTMLElement>(null);
  const registration = useRef<Promise<boolean> | null>(null);
  const registered = useRef(false);
  const saving = useRef(false);
  const closed = useRef(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registerError, setRegisterError] = useState(false);
  const [error, setError] = useState("");
  const [q1, setQ1] = useState<number | null>(null);
  const [q2, setQ2] = useState<"yes" | "unsure" | "no" | null>(null);
  const [q3, setQ3] = useState("");
  const [q4, setQ4] = useState<number | null>(null);
  const manual = presentation.trigger === "manual";
  const valid = q1 !== null && q2 !== null && (!manual || q4 !== null);

  const acknowledge = useCallback((): Promise<boolean> => {
    if (registered.current) return Promise.resolve(true);
    if (registration.current) return registration.current;
    setRegisterError(false);
    registration.current = requestSurvey(c, { action: "shown", presentationId: presentation.id })
      .then(() => { registered.current = true; setShown(true); return true; })
      .catch(() => { setRegisterError(true); return false; })
      .finally(() => { registration.current = null; });
    return registration.current;
  }, [c, presentation.id]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // A card below the stage or in a background tab is not an impression yet.
    let visible = false;
    const recordVisible = () => {
      if (visible || document.visibilityState === "hidden") return;
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return;
      visible = true;
      void acknowledge();
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(recordVisible);
    observer?.observe(card);
    const frame = requestAnimationFrame(recordVisible);
    window.addEventListener("scroll", recordVisible, { passive: true });
    window.addEventListener("resize", recordVisible);
    document.addEventListener("visibilitychange", recordVisible);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", recordVisible);
      window.removeEventListener("resize", recordVisible);
      document.removeEventListener("visibilitychange", recordVisible);
    };
  }, [acknowledge]);

  function dismiss() {
    closed.current = true;
    onClose("skipped");
    if (saving.current) return;
    // Closing stays immediate. Persist after any impression request already in flight.
    void (async () => {
      await acknowledge();
      await requestSurvey(c, { action: "skip", presentationId: presentation.id });
    })().catch(() => {});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !shown || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await requestSurvey(c, { action: "submit", presentationId: presentation.id, q1, q2, q3: q3.trim(), ...(manual ? { q4 } : {}) });
      if (!closed.current) onClose("submitted");
    } catch {
      setError("저장하지 못했어요. 적은 답은 그대로 있으니 다시 눌러 주세요.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="survey-card" ref={cardRef} aria-labelledby={id + "-title"}>
      <div className="survey-head">
        <div><h2 id={id + "-title"}>테스트 소감 남기기</h2><p>{manual ? "생각난 점을 편하게 남겨 주세요." : presentation.trigger === "day_end" ? "오늘 대화는 어땠나요?" : "지금까지 대화는 어땠나요?"}</p></div>
        <button type="button" className="icon-btn" onClick={dismiss} aria-label="설문 닫기">닫기</button>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>1. {c.shortName} 같았나요?</legend>
          <div className="survey-scale survey-five">
            {[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name={id + "-q1"} value={value} checked={q1 === value} onChange={() => setQ1(value)} required /><span>{value}</span></label>)}
          </div>
          <div className="survey-ends"><span>1 · 전혀 아니에요</span><span>5 · 정말 같아요</span></div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>2. 내일 또 오고 싶나요?</legend>
          <div className="survey-options">
            {([{ value: "yes", text: "예" }, { value: "unsure", text: "모르겠어요" }, { value: "no", text: "아니요" }] as const).map((option) => <label key={option.value}><input type="radio" name={id + "-q2"} value={option.value} checked={q2 === option.value} onChange={() => setQ2(option.value)} required /><span>{option.text}</span></label>)}
          </div>
        </fieldset>
        <div className="survey-field">
          <label htmlFor={id + "-q3"}>3. 좋았거나 이상했던 순간 <span>(선택)</span></label>
          <textarea id={id + "-q3"} value={q3} maxLength={500} rows={3} onChange={(event) => setQ3(event.target.value)} disabled={busy} aria-describedby={id + "-privacy " + id + "-count"} placeholder="기억나는 순간을 한 줄로 남겨 주세요." />
          <div className="survey-count" id={id + "-count"}>{q3.length} / 500자</div>
        </div>
        {manual && <fieldset disabled={busy}>
          <legend>4. 친구에게 추천하겠어요?</legend>
          <div className="survey-scale survey-eleven">
            {Array.from({ length: 11 }, (_, value) => <label key={value}><input type="radio" name={id + "-q4"} value={value} checked={q4 === value} onChange={() => setQ4(value)} required /><span>{value}</span></label>)}
          </div>
          <div className="survey-ends"><span>0 · 추천하지 않아요</span><span>10 · 꼭 추천해요</span></div>
        </fieldset>}
        <p className="survey-note" id={id + "-privacy"}>실명, 연락처 등 개인정보는 적지 말아 주세요. 답변은 호감도에 영향을 주지 않아요.</p>
        {registerError && <p className="survey-error" role="alert">설문을 준비하지 못했어요. <button type="button" onClick={() => { void acknowledge(); }}>다시 시도</button></p>}
        {error && <p className="survey-error" role="alert">{error}</p>}
        <div className="survey-actions"><button type="button" className="btn btn-ghost" onClick={dismiss} disabled={busy}>건너뛰기</button><button type="submit" className="btn btn-primary" disabled={!valid || !shown || busy}>{busy ? "저장 중…" : "소감 보내기"}</button></div>
      </form>
    </section>
  );
}

export function AutomaticSurvey({ c, checkKey, paused, onOpenChange }: {
  c: CharacterPublic;
  checkKey: string;
  paused: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const active = useRef(false);
  const dismissed = useRef(new Set<string>());
  const requestIds = useRef<Record<string, string>>({});
  const retried = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const latest = useRef({ character: c.id, checkKey, revision });
  latest.current = { character: c.id, checkKey, revision };

  useEffect(() => {
    if (paused || active.current || pending.current) return;
    pending.current = true;
    const started = { character: c.id, checkKey, revision };
    if (!requestIds.current[c.id]) {
      let requestId = crypto.randomUUID();
      try {
        const storageKey = "haruhi-survey-request:" + c.id;
        const saved = sessionStorage.getItem(storageKey);
        if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved)) requestId = saved;
        else sessionStorage.setItem(storageKey, requestId);
      } catch { /* This visit still works when browser storage is unavailable. */ }
      requestIds.current[c.id] = requestId;
    }
    const requestId = requestIds.current[c.id];
    const retryKey = c.id + ":" + checkKey;
    let failed = false;
    // Keep this request alive across StrictMode's replay; queue newer turn state below.
    void (async () => {
      const response = await fetch(withC("/api/survey?requestId=" + encodeURIComponent(requestId), c), { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("survey_" + response.status);
      const available = (await response.json()).available;
      if (available !== "turn10" && available !== "day_end") return;
      const data = await requestSurvey(c, { action: "open", trigger: available, requestId });
      if (data.presentation && !dismissed.current.has(data.presentation.id)) {
        active.current = true;
        setNotice("");
        setPresentation(data.presentation);
        onOpenChange(true);
      }
    })().catch(() => { failed = true; }).finally(() => {
      pending.current = false;
      const current = latest.current;
      if (current.character !== started.character || current.checkKey !== started.checkKey || current.revision !== started.revision) {
        setRevision((value) => value + 1);
      } else if (failed && !retried.current.has(retryKey)) {
        // One bounded retry recovers a committed open whose response was lost.
        retried.current.add(retryKey);
        setRevision((value) => value + 1);
      }
    });
  }, [c, checkKey, paused, onOpenChange, revision]);

  function close(reason: CloseReason) {
    if (presentation) dismissed.current.add(presentation.id);
    active.current = false;
    setPresentation(null);
    onOpenChange(false);
    setNotice(reason === "submitted" ? "소감을 남겨 줘서 고마워요." : "");
    // A day-end trigger may have become eligible while the turn-ten card was open.
    setRevision((value) => value + 1);
  }

  if (!presentation && !notice) return null;
  return <div className="chat-survey" id="chat-survey">
    {presentation ? <SurveyCard key={presentation.id} c={c} presentation={presentation} onClose={close} /> : <p className="survey-thanks" role="status">소감을 남겨 줘서 고마워요.</p>}
  </div>;
}

export function ManualSurvey({ c }: { c: CharacterPublic }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);

  async function open() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await requestSurvey(c, { action: "open", trigger: "manual" });
      if (!data.presentation) throw new Error("no_presentation");
      setPresentation(data.presentation);
    } catch {
      setError("설문을 열지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <section className="manual-survey" aria-label="테스트 소감">
    {presentation ? <SurveyCard key={presentation.id} c={c} presentation={presentation} onClose={(reason) => { setPresentation(null); setNotice(reason === "submitted" ? "소감을 남겨 줘서 고마워요." : ""); }} /> : <>
      <button type="button" className="btn" onClick={open} disabled={busy}>{busy ? "여는 중…" : "테스트 소감 남기기"}</button>
      {notice && <p className="survey-thanks" role="status">{notice}</p>}
      {error && <p className="survey-error" role="alert">{error}</p>}
    </>}
  </section>;
}
