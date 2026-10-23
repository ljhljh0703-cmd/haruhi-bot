"use client";

// 미연시형 대화 화면(작가 결정 2026-10-23 「미연시처럼 만들기」).
// 배경 + 스탠딩 + 이름표 대사창 + 가운데 선택지. 메신저형 화면은 「기록」에서 본다.
import { iga } from "@/lib/josa";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Face from "../components/Face";
import IdCard, { UserState, progress } from "../components/IdCard";
import { NoteIcon, SendIcon } from "../components/Icons";
import RichText from "../components/RichText";
import { AutomaticSurvey } from "../components/SurveyCard";
import { REPORT_REASONS } from "@/lib/reports";
import { sceneFor, spriteFor } from "@/lib/characters/public";
import type { CharacterPublic } from "@/lib/characters/types";
import { useChar, withC } from "../components/useChar";

type M = { id: number | string; role: "char" | "user" | "system"; kind: string; content: string; created_at?: string; failed?: boolean; streaming?: boolean };

const dayLabel = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" });
};

// 대사창용: *행동*은 지문 줄로, 나머지는 대사로.
function VNText({ text }: { text: string }) {
  const parts: { t: string; narr: boolean }[] = [];
  let narr = false;
  for (const seg of text.split("*")) {
    if (seg.trim()) parts.push({ t: seg.trim(), narr });
    narr = !narr;
  }
  return <>{parts.map((p, i) => (p.narr ? <span key={i} className="vn-narr">{p.t}</span> : <span key={i} className="vn-say">{p.t} </span>))}</>;
}

const LogIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>);
const FlagIcon = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>);
const HeartIcon = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.6 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.7 1.3-1.6 2.8-2.7 4.8-2.7C20.4 4.5 23 8 21.5 11.8 19.5 16.4 12 21 12 21z" /></svg>);

function Sprite({ c, mood }: { c: CharacterPublic; mood: string }) {
  const src = spriteFor(c, mood);
  return src ? <img className="vn-sprite" src={src} alt={c.name} /> : <div className="vn-sprite-empty" aria-hidden="true"><span>{c.shortName} 그림 자리</span></div>;
}

export default function ChatPage() {
  const router = useRouter();
  const c = useChar();
  const [user, setUser] = useState<UserState | null>(null);
  const [msgs, setMsgs] = useState<M[]>([]);
  const [text, setText] = useState("");
  const [actionMode, setActionMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // 첫 글자 오기 전
  const [sheet, setSheet] = useState<null | "log" | "card">(null);
  const [levelUp, setLevelUp] = useState<UserState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pop, setPop] = useState<{ v: number; k: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [hasSurvey, setHasSurvey] = useState(false);
  const [reported, setReported] = useState<Record<number, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => { const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, waiting]);
  useLayoutEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [sheet]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!pop) return; const t = setTimeout(() => setPop(null), 1800); return () => clearTimeout(t); }, [pop]);

  useEffect(() => {
    if (!c) return;
    (async () => {
      const r = await fetch(withC("/api/session", c), { cache: "no-store" });
      const data = await r.json();
      if (!data.user) return router.replace(withC("/", c));
      setUser(data.user);
      setMsgs(data.messages);
      if (data.shouldGreet) {
        setWaiting(true);
        try {
          const g = await (await fetch(withC("/api/greet", c), { method: "POST" })).json();
          if (g.message) setMsgs((m) => [...m, g.message]);
        } finally {
          setWaiting(false);
        }
      }
    })();
  }, [router, c]);

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  async function send(body: string, kind: "talk" | "action", retryId?: number | string) {
    if (!body.trim() || busy || !c) return;
    setReportOpen(false);
    const tempId = retryId ?? `u${Date.now()}`;
    setMsgs((m) =>
      retryId ? m.map((x) => (x.id === retryId ? { ...x, failed: false } : x))
              : [...m, { id: tempId, role: "user", kind, content: body, created_at: new Date().toISOString() }],
    );
    setBusy(true);
    setWaiting(true);
    const replyId = `h${Date.now()}`;
    let started = false;
    try {
      const res = await fetch(withC("/api/chat", c), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body, kind }) });
      if (res.status === 429) {
        const d = await res.json();
        setUser(d.user);
        setMsgs((m) => m.filter((x) => x.id !== tempId));
        return;
      }
      if (res.status === 503) {
        setToast((await res.json()).message);
        throw new Error("busy");
      }
      if (!res.ok || !res.body) throw new Error("http");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const ln = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!ln.trim()) continue;
          const ev = JSON.parse(ln);
          if (ev.t === "d") {
            if (!started) {
              started = true;
              setWaiting(false);
              setMsgs((m) => [...m, { id: replyId, role: "char", kind: "talk", content: ev.v, streaming: true, created_at: new Date().toISOString() }]);
            } else {
              setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, content: x.content + ev.v } : x)));
            }
          } else if (ev.t === "meta") {
            finished = true;
            const up = ev.notice && ev.user.stage > (user?.stage ?? 0);
            setMsgs((m) => {
              const out = m.map((x) =>
                x.id === replyId ? { ...x, id: ev.replyId, streaming: false, content: x.content.replace(new RegExp(`^\\s*(${c.shortName}|${c.name})\\s*[:：]\\s*`), "").trim() }
                : x.id === tempId ? { ...x, id: ev.userId } : x);
              if (up) out.push({ id: `s${Date.now()}`, role: "system", kind: "stage", content: `${ev.notice.title} · ${ev.notice.body}` });
              return out;
            });
            if (ev.delta) setPop({ v: ev.delta, k: Date.now() });
            if (up) setLevelUp(ev.user);
            else if (ev.notice) setToast(`${ev.notice.title}. ${ev.notice.body}`);
            setUser(ev.user);
          } else if (ev.t === "error") {
            throw new Error(ev.message);
          }
        }
      }
      if (!finished) throw new Error("cut");
    } catch {
      setMsgs((m) => m.filter((x) => x.id !== replyId).map((x) => (x.id === tempId ? { ...x, failed: true } : x)));
    } finally {
      setBusy(false);
      setWaiting(false);
    }
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    setText("");
    requestAnimationFrame(autosize);
    send(body, actionMode ? "action" : "talk");
    setActionMode(false);
  }

  async function report(messageId: number, reason: string) {
    if (!c) return;
    const r = await fetch(withC("/api/report", c), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, reason }) });
    setReportOpen(false);
    if (r.ok) { setReported((x) => ({ ...x, [messageId]: reason })); setToast("알려 줘서 고마워요. 고칠 때 참고할게요."); }
  }

  if (!user || !c) return <div className="vn-app"><main className="vn-stage" /></div>;

  // 대사창에 띄울 줄: 마지막 대화 줄(단계 알림 제외). 바로 앞이 장면 설명이면 같이 보인다.
  const lines = msgs.filter((m) => !(m.role === "system" && m.kind === "stage"));
  const cur = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  const scene = sceneFor(c, user.stage, !!user.eventTitle);
  const bg = scene.image ? `center / cover no-repeat url(${scene.image})` : `linear-gradient(180deg, ${scene.from}, ${scene.to})`;
  const curId = cur && typeof cur.id === "number" ? cur.id : null;
  const showChoices = !busy && !waiting && !user.doneToday && user.choices?.length > 0;

  let lastDay = "";
  let prevRole = "";

  return (
    <div className="vn-app">
      <div className="vn-main">
      <main className="vn-stage" style={{ background: bg }}>
        {user.mock && <div className="banner vn-banner">연습 모드 · AI를 연결하기 전이라 정해진 답만 나와요</div>}
        <header className="vn-top">
          <button className="vn-who" onClick={() => setSheet("card")} aria-label={`${c.idCard.title} 열기`}>
            <span className="vn-heart"><HeartIcon /></span>
            <span className="vn-stagename">{user.stageName}</span>
            <span className="meter vn-meter" aria-hidden="true"><i style={{ width: `${progress(user)}%` }} /></span>
            {pop && <span key={pop.k} className={`vn-pop ${pop.v < 0 ? "down" : ""}`}>호감 {pop.v > 0 ? "+" : ""}{pop.v}</span>}
          </button>
          <div className="vn-top-btns">
            <button className="vn-btn" onClick={() => setSheet("log")}><LogIcon />기록</button>
            <Link href={withC("/memory", c)} className="vn-btn"><NoteIcon />기억</Link>
          </div>
        </header>
        <div className="vn-scene-label">{scene.label}{user.eventTitle ? ` · ${c.ui.eventBadge} 「${user.eventTitle}」` : ""}</div>

        <div className="vn-figure"><Sprite c={c} mood={user.mood} /></div>

        {showChoices && (
          <div className="vn-choices" role="group" aria-label="선택지">
            {user.choices.map((ch) => (
              <button key={ch.text} className="vn-choice" onClick={() => send(ch.text, ch.kind === "action" ? "action" : "talk")}>
                {ch.kind === "action" && <b>행동</b>}{ch.text}
              </button>
            ))}
          </div>
        )}

        <section className="vn-box" aria-live="polite">
          {cur && (cur.role === "user" ? (
            <div className="vn-name me">{user.nickname}</div>
          ) : cur.role === "char" ? (
            <div className="vn-name">{c.shortName}</div>
          ) : null)}
          <div className="vn-text" ref={boxRef}>
            {cur?.role === "char" && prev?.role === "system" && prev.kind === "action" && <span className="vn-narr">{prev.content}</span>}
            {cur?.role === "system" && <span className="vn-narr">{cur.content}</span>}
            {cur?.role === "user" && (cur.kind === "action" ? <span className="vn-narr">{cur.content}</span> : <VNText text={cur.content} />)}
            {cur?.role === "char" && <VNText text={cur.content} />}
            {waiting && <span className="typing vn-typing" aria-label={`${iga(c.shortName)} 입력 중`}><i /><i /><i /></span>}
          </div>
          {cur?.role === "user" && cur.failed && (
            <div className="failed">전송 실패
              <button onClick={() => send(cur.content, cur.kind === "action" ? "action" : "talk", cur.id)}>다시 보내기</button>
            </div>
          )}
          {cur?.role === "char" && curId && !cur.streaming && (
            reported[curId] ? <div className="report-done">신고함 · {reported[curId]}</div> :
            reportOpen ? (
              <div className="report-row" role="group" aria-label="이상한 점 알리기">
                {REPORT_REASONS.map((r) => <button key={r} onClick={() => report(curId, r)}>{r}</button>)}
              </div>
            ) : <button className="vn-flag" onClick={() => setReportOpen(true)}><FlagIcon />이상해요</button>
          )}
        </section>

        <div className="vn-input">
          {user.doneToday ? (
            <div className="done-card"><strong>{c.ui.doneTitle}</strong><span>{c.ui.doneBody}</span></div>
          ) : (
            <div className="compose-row">
              <button className="act-toggle" aria-pressed={actionMode} onClick={() => { setActionMode((v) => !v); inputRef.current?.focus(); }}>행동</button>
              <textarea
                id="msg"
                aria-label="메시지"
                ref={inputRef}
                className={`input ${actionMode ? "action-mode" : ""}`}
                rows={1}
                value={text}
                maxLength={500}
                placeholder={actionMode ? `${c.ui.action} (예: ${c.ui.actionExample})` : c.ui.input}
                onChange={(e) => { setText(e.target.value); autosize(); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              />
              <button className="send" onClick={submit} disabled={!text.trim() || busy} aria-label="보내기"><SendIcon /></button>
            </div>
          )}
          {hasSurvey && <a className="survey-jump" href="#chat-survey">짧은 테스트 소감 남기기 ↓</a>}
          <div className="disclose">AI로 만든 캐릭터예요 · 실제 인물이 아니고 대화는 허구예요</div>
        </div>
      </main>
      <AutomaticSurvey c={c} checkKey={String(user.dayTurnsLeft) + ":" + String(user.doneToday)} paused={busy || waiting || sheet !== null || levelUp !== null} onOpenChange={setHasSurvey} />
      </div>

      <aside className="side-col"><IdCard c={c} u={user} /></aside>

      {sheet === "card" && (
        <div className="sheet-back" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={c.idCard.title}>
            <div className="sheet-grip" />
            <IdCard c={c} u={user} />
          </div>
        </div>
      )}

      {sheet === "log" && (
        <div className="sheet-back" onClick={() => setSheet(null)}>
          <div className="sheet log-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="대화 기록">
            <div className="sheet-grip" />
            <div className="log-head"><b>대화 기록</b><button className="icon-btn" onClick={() => setSheet(null)}>닫기</button></div>
            <div className="log" ref={logRef}>
              {msgs.map((m) => {
                const d = dayLabel(m.created_at);
                const sep = d !== lastDay ? <div className="day-sep">{d}</div> : null;
                lastDay = d;
                let node: React.ReactNode;
                if (m.role === "system") {
                  node = m.kind === "stage" ? <div className="stage-line">{m.content}</div> : <div className="scene">{m.content}</div>;
                  prevRole = "system";
                } else if (m.role === "char") {
                  const first = prevRole !== "char";
                  prevRole = "char";
                  node = (
                    <div className="row her">
                      {first ? <Face c={c} mood="base" /> : <span className="spacer" />}
                      <div className="col">
                        {first && <div className="name">{c.shortName}</div>}
                        <div className={`bubble ${first ? "first" : ""}`}><RichText text={m.content} /></div>
                      </div>
                    </div>
                  );
                } else {
                  const first = prevRole !== "user";
                  prevRole = "user";
                  node = (
                    <div className="row me">
                      <div className="col">
                        {m.kind === "action" ? <div className="me-action"><b>행동</b>{m.content}</div>
                          : <div className={`bubble ${first ? "first" : ""}`}><RichText text={m.content} /></div>}
                      </div>
                    </div>
                  );
                }
                return <div key={m.id}>{sep}{node}</div>;
              })}
            </div>
          </div>
        </div>
      )}

      {levelUp && (
        <div className="levelup-back" onClick={() => setLevelUp(null)} role="dialog" aria-label="단계가 올랐어요">
          <div className="levelup">
            <IdCard c={c} u={levelUp} thump compact />
            <div className="unlock"><span>새로 열림</span><b>{levelUp.stages[levelUp.stage - 1]?.unlock}</b></div>
            <button className="btn btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => setLevelUp(null)}>계속하기</button>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
