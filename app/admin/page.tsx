"use client";

import { useCallback, useEffect, useState } from "react";
import { ACTIONS } from "@/lib/config";
import RichText from "../components/RichText";

type Overview = any;
type FeedbackSummary = { shown: number; responses: number; skipped: number; responseRate: number | null; characterAvg: number | null; returnYesRate: number | null; recommendAvg: number | null; recommendResponses: number };
type FeedbackData = {
  summary: FeedbackSummary;
  byVersionCharacter: (FeedbackSummary & { rulesVersion: string; character: string })[];
  byTrigger: (FeedbackSummary & { trigger: "turn10" | "day_end" | "manual" })[];
  recent: { nickname: string; character: string; rulesVersion: string; trigger: string; q1: number; q2: "yes" | "unsure" | "no"; q3: string; q4: number | null; createdAt: string }[];
};
const feedbackValue = (value: number | null | undefined, suffix = "") => value == null || !Number.isFinite(value) ? "-" : value.toFixed(1) + suffix;
const feedbackTrigger: Record<string, string> = { turn10: "10턴째", day_end: "하루 끝", manual: "기억 노트" };
const feedbackReturn = { yes: "예", unsure: "모르겠어요", no: "아니요" };
type Detail = { messages: any[]; turns: any[]; facts: any[]; reports: { message_id: number; reason: string }[] };
const label = (a: string) => (ACTIONS as any)[a]?.label ?? (a === "greet" ? "먼저 말 걸기" : a);
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });

export default function Admin() {
  const [data, setData] = useState<Overview | null>(null);
  const [need, setNeed] = useState(false);
  const [key, setKey] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rulesF, setRulesF] = useState("");
  const [charF, setCharF] = useState("all");

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ ...(rulesF ? { rules: rulesF } : {}), char: charF });
    const r = await fetch(`/api/admin?${qs}`, { cache: "no-store" });
    if (r.status === 401) return setNeed(true);
    setNeed(false);
    setData(await r.json());
  }, [rulesF, charF]);
  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id: string) => {
    setSel(id);
    setDetail(null);
    setDetail(await (await fetch(`/api/admin?user=${id}`, { cache: "no-store" })).json());
  }, []);

  async function correct(turnId: number, correction: string) {
    await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnId, correction: correction || null }) });
    if (sel) open(sel);
    load();
  }

  if (need) {
    return (
      <main className="landing">
        <form className="landing-card" onSubmit={async (e) => { e.preventDefault(); const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: key }) }); if (r.ok) load(); }}>
          <h1 style={{ fontSize: 22 }}>운영자 화면</h1>
          <label className="field"><span>운영자 키</span><input type="text" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></label>
          <button className="btn btn-primary" style={{ width: "100%" }}>열기</button>
        </form>
      </main>
    );
  }
  if (!data) return <main className="admin"><p className="empty">불러오는 중</p></main>;
  const s = data.stats;
  const feedback = data.feedback as FeedbackData | undefined;
  const feedbackExport = "/api/admin?" + new URLSearchParams({ export: "feedback", rules: data.filter.rules, char: charF });
  const reach = s.stageDist.map((_: number, i: number) => s.stageDist.slice(i).reduce((a: number, b: number) => a + b, 0));
  const chars: { id: string; name: string; stages: string[] }[] = data.filter.characters;
  const stageNames = (charF !== "all" ? chars.find((c) => c.id === charF) : chars[0])?.stages ?? [];
  const charName = (id: string) => chars.find((c) => c.id === id)?.name ?? id;
  const stageOf = (u: any) => chars.find((c) => c.id === u.character)?.stages[u.stage - 1] ?? u.stage;
  const maxStage = Math.max(1, ...reach);
  const actionEntries = Object.entries(s.byAction as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const maxAction = Math.max(1, ...actionEntries.map((e) => e[1]));

  // 턴 기록을 답 메시지 id 기준으로 붙인다
  const turnByReply = new Map<number, any>();
  detail?.turns.forEach((t) => t.reply_message_id && turnByReply.set(Number(t.reply_message_id), t));

  return (
    <main className="admin">
      <style>{ADMIN_CSS}</style>
      <header className="admin-head">
        <div>
          <h1>캐릭터 채팅 운영자 화면</h1>
          <p>
            {data.env.mock ? "연습 모드(AI 미연결)" : `대화 ${data.env.chatModel}`} · 판정 {data.env.judge}{data.env.shadow ? ` + ${data.env.shadow} 그림자 판정` : ""} · {data.env.localDb ? "로컬 저장소" : "Postgres"} · 지금 규칙 판 {data.env.rules} · 비용은 단가 추정치
          </p>
          <div className="filters">
            <label>규칙 판 <select value={data.filter.rules} onChange={(e) => setRulesF(e.target.value)}>
              <option value="all">전체</option>
              {data.filter.versions.map((v: string) => <option key={v} value={v}>{v}</option>)}
              {!data.filter.versions.includes(data.filter.rules) && data.filter.rules !== "all" && <option value={data.filter.rules}>{data.filter.rules}</option>}
            </select></label>
            <label>캐릭터 <select value={charF} onChange={(e) => setCharF(e.target.value)}>
              <option value="all">전체</option>
              {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          </div>
        </div>
        <div className="admin-tools"><a className="icon-btn" href={feedbackExport} style={{ textDecoration: "none" }}>피드백 내보내기</a><a className="icon-btn" href="/api/admin?export=labels" style={{ textDecoration: "none" }}>라벨 내보내기</a><button className="icon-btn" onClick={load}>새로고침</button></div>
      </header>
      {data.env.localDb && <p className="warn" style={{ marginTop: -8 }}>DATABASE_URL이 없어 임시 저장소를 쓰는 중. 배포에서는 기록이 사라질 수 있어요.</p>}

      <section className="tiles">
        <Tile k="참여자" v={s.users} sub={`다시 온 사람 ${s.returning}`} />
        <Tile k="대화 턴" v={s.turns} sub={`1인당 ${s.avgTurns} · 세션당 ${s.turnsPerSession}`} />
        <Tile k="오분류 표시" v={`${s.correctionRate}%`} sub={`${s.corrections}건`} />
        <Tile k="하루 상승 상한 걸림" v={s.dayGainCapHits} sub={`하루 대화 끝 ${s.dayEnds}`} />
        <Tile k="첫 글자까지" v={s.firstTokenP50 ? `${(s.firstTokenP50 / 1000).toFixed(1)}초` : "-"} sub="중앙값" />
        <Tile k="비용" v={`$${s.costUsd}`} sub={`턴당 $${s.costPerTurn} · 대화 $${s.chatCostUsd} / 판정 $${s.judgeCostUsd}`} />
        <Tile k="두 판정기 일치" v={s.shadowAgree === null ? "-" : `${s.shadowAgree}%`} sub={`비교 ${s.shadowN}턴 · 확신 낮아 보류 ${s.lowConf}`} />
        <Tile k="반복 답" v={s.repAvg === null ? "-" : s.repAvg} sub={`겹침 0.5 이상 ${s.repHigh}턴`} />
        <Tile k="「이상해요」 신고" v={s.reports} sub={Object.entries(s.reportBy).map(([k, v]) => `${k} ${v}`).join(" · ") || "없음"} />
      </section>

      <section className="panel feedback-panel" aria-labelledby="feedback-title">
        <h2 id="feedback-title">친구 피드백</h2>
        <p className="muted">위에서 고른 규칙 판·캐릭터의 답변이에요. 응답률은 실제 화면에 보인 설문 대비 제출한 비율입니다.</p>
        {!feedback && <p className="muted">친구 피드백을 불러오지 못했어요. 새로고침해 주세요.</p>}
        {feedback && <>
          <div className="tiles">
            <Tile k="캐릭터답다" v={feedbackValue(feedback.summary.characterAvg, " / 5")} sub={"응답 " + feedback.summary.responses + "개"} />
            <Tile k="내일 또 올래요 · 예" v={feedbackValue(feedback.summary.returnYesRate, "%")} sub="제출된 답변 기준" />
            <Tile k="친구 추천 점수" v={feedbackValue(feedback.summary.recommendAvg, " / 10")} sub={"기억 노트 응답 " + feedback.summary.recommendResponses + "개"} />
            <Tile k="설문 응답률" v={feedbackValue(feedback.summary.responseRate, "%")} sub={"노출 " + feedback.summary.shown + " · 제출 " + feedback.summary.responses + " · 건너뜀 " + feedback.summary.skipped} />
          </div>
          {feedback.byVersionCharacter.length > 0 && <>
            <h3>규칙 판·캐릭터별</h3>
            <div className="feedback-groups">{feedback.byVersionCharacter.map((group) => <article className="feedback-group" key={group.rulesVersion + ":" + group.character}>
              <h4>{group.rulesVersion} · {charName(group.character)}</h4>
              <dl>
                <div><dt>캐릭터답다</dt><dd>{feedbackValue(group.characterAvg, " / 5")}</dd></div>
                <div><dt>내일 또 올래요 · 예</dt><dd>{feedbackValue(group.returnYesRate, "%")}</dd></div>
                <div><dt>친구 추천</dt><dd>{feedbackValue(group.recommendAvg, " / 10")}</dd></div>
                <div><dt>응답률</dt><dd>{feedbackValue(group.responseRate, "%")}</dd></div>
              </dl>
              <p className="muted">노출 {group.shown} · 제출 {group.responses} · 추천 응답 {group.recommendResponses}</p>
            </article>)}</div>
          </>}
          {feedback.byTrigger.length > 0 && <p className="muted feedback-trigger">{feedback.byTrigger.map((group) => <span key={group.trigger}>{feedbackTrigger[group.trigger]}: 노출 {group.shown} · 제출 {group.responses}</span>)}</p>}
          <h3>좋았거나 이상했던 순간 · 최근 20개</h3>
          {feedback.recent.length === 0 && <p className="muted">아직 남긴 글이 없어요.</p>}
          {feedback.recent.map((entry, i) => <div className="drop" key={entry.createdAt + ":" + i}>
            <b>{entry.nickname}</b> · {charName(entry.character)} · {entry.rulesVersion} · {feedbackTrigger[entry.trigger] ?? entry.trigger} · {time(entry.createdAt)}
            <p className="feedback-text">{entry.q3}</p>
            <small className="muted">캐릭터답다 {entry.q1}/5 · 내일 또 올래요 {feedbackReturn[entry.q2]}{entry.q4 !== null ? " · 친구 추천 " + entry.q4 + "/10" : ""}</small>
          </div>)}
          <p className="muted feedback-export-note">피드백 내보내기는 현재 선택한 판·캐릭터의 설문, 신고, 오분류 표시, 반복 답과 끊긴 지점을 JSON 파일 하나로 내려받아요. 식별 정보는 별명만 포함해요.</p>
        </>}
      </section>

      <section className="grid2">
        <div className="panel">
          <h2>단계 도달 (그 단계 이상인 사람 수)</h2>
          {reach.map((n: number, i: number) => (
            <div className="bar" key={i}><span>{charF === "all" ? `${i + 1}단계` : stageNames[i]}</span><div><i style={{ width: `${(n / maxStage) * 100}%` }} /></div><b>{n}</b></div>
          ))}
        </div>
        <div className="panel">
          <h2>행동 분류 분포</h2>
          {actionEntries.length === 0 && <p className="muted">아직 기록 없음</p>}
          {actionEntries.map(([a, n]) => (
            <div className="bar" key={a}><span>{label(a)}</span><div><i style={{ width: `${(n / maxAction) * 100}%` }} /></div><b>{n}</b></div>
          ))}
          {s.judgeErrors > 0 && <p className="warn">분류 실패 {s.judgeErrors}건(점수 0 처리)</p>}
          {s.jevErrors > 0 && <p className="warn">판정기 호출 실패 {s.jevErrors}건(Haiku로 대신 판정)</p>}
        </div>
      </section>

      <section className="grid2">
        <div className="panel">
          <h2>참여자</h2>
          <div className="table-scroll" role="region" aria-label="참여자 표" tabIndex={0}>
          <table>
            <thead><tr><th>이름</th><th>캐릭터</th><th>단계</th><th>호감</th><th>턴</th><th>방문</th><th>마지막</th></tr></thead>
            <tbody>
              {data.users.map((u: any) => (
                <tr key={u.id} className={sel === u.id ? "on" : ""} onClick={() => open(u.id)}>
                  <td>{u.nickname}</td><td>{charName(u.character)}</td><td>{stageOf(u)}</td><td>{u.score}</td><td>{u.total_turns}</td><td>{u.visits}</td><td>{time(u.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <div className="panel">
          <h2>대화가 끊긴 지점</h2>
          <p className="muted">한 시간 넘게 안 온 사람의 마지막 메시지. 캐릭터 대사에서 끊겼다면 그 대사가 원인 후보.</p>
          {data.drops.length === 0 && <p className="muted">아직 없음</p>}
          {data.drops.map((d: any, i: number) => (
            <div className="drop" key={i}><b>{d.user}</b> · {d.lastRole === "char" ? "캐릭터 대사 뒤" : "본인 메시지 뒤"}<div><RichText text={d.content} /></div></div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>최근 「이상해요」 신고</h2>
        {data.reports.length === 0 && <p className="muted">아직 없음</p>}
        {data.reports.map((r: any, i: number) => (
          <div className="drop" key={i}><b>{r.user}</b> · {r.reason}<div><RichText text={r.content} /></div></div>
        ))}
      </section>

      {sel && (
        <section className="panel">
          <h2>대화 기록과 턴별 판정</h2>
          {!detail && <p className="muted">불러오는 중</p>}
          {detail && (
            <div className="timeline">
              {detail.messages.map((m: any) => {
                const t = m.role === "char" ? turnByReply.get(Number(m.id)) : null;
                const rep = detail.reports.find((x) => x.message_id === Number(m.id));
                return (
                  <div key={m.id} className={`tl ${m.role}`}>
                    <div className="tl-who">{m.role === "user" ? (m.kind === "action" ? "사용자 행동" : "사용자") : m.role === "char" ? "캐릭터" : "상황"}</div>
                    <div className="tl-text"><RichText text={m.content} />{rep && <span className="warn"> · 신고: {rep.reason}</span>}</div>
                    {t && (
                      <div className="judge">
                        <span className={`pill ${t.applied_delta > 0 ? "up" : t.applied_delta < 0 ? "down" : ""}`}>{label(t.action)}</span>
                        {t.action !== "greet" && <span>규칙 {t.raw_delta > 0 ? "+" : ""}{t.raw_delta} → 적용 {t.applied_delta > 0 ? "+" : ""}{t.applied_delta}{t.capped ? ` (${CAP[t.capped] ?? t.capped})` : ""}</span>}
                        <span>호감 {t.score_after}</span>
                        <span className="muted">{t.judge_provider ?? ""} {t.reason}</span>
                        {t.shadow_action && <span className={t.shadow_action === t.action ? "muted" : "warn"}>그림자 판정: {label(t.shadow_action)}</span>}
                        {t.event_id && <span className="muted">이벤트 {t.event_id}</span>}
                        {t.rep_score !== null && t.rep_score !== undefined && <span className={t.rep_score >= 0.5 ? "warn" : "muted"}>반복 {Number(t.rep_score).toFixed(2)}</span>}
                        <span className="muted">{t.rules_version}</span>
                        <span className="muted">첫 글자 {(t.first_token_ms / 1000).toFixed(1)}초 · ${t.cost.toFixed(4)}</span>
                        {t.action !== "greet" && (
                          <select value={t.correction ?? ""} onChange={(e) => correct(t.id, e.target.value)} aria-label="맞는 분류">
                            <option value="">분류 맞음</option>
                            {data.actions.map((a: string) => <option key={a} value={a}>오분류 → {label(a)}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {detail && (
            <>
              <h2 style={{ marginTop: 18 }}>기억 카드</h2>
              {detail.facts.length === 0 && <p className="muted">없음</p>}
              <ul>{detail.facts.map((f: any) => <li key={f.id} style={{ textDecoration: f.deleted ? "line-through" : "none" }}>{f.text}{f.deleted ? " (사용자가 지움)" : ""}</li>)}</ul>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h2>지금 규칙</h2>
        <p className="muted">AI는 행동 종류만 고르고, 점수는 아래 표로 계산. 오분류가 몰리는 행동은 분류 설명이나 점수를 고친다.</p>
        <table>
          <thead><tr><th>행동</th><th>점수</th></tr></thead>
          <tbody>{Object.entries(ACTIONS).map(([k, v]) => <tr key={k}><td>{v.label}</td><td>{v.delta > 0 ? "+" : ""}{v.delta}</td></tr>)}</tbody>
        </table>
        <p className="muted" style={{ marginTop: 10 }}>
          {data.env.rules} · 턴당 {data.rules.limits.turnMin}~+{data.rules.limits.turnMax} · 하루 상승 {data.rules.limits.dayGain} · 하루 하락 {data.rules.limits.dayLoss} · 마무리 시작 {data.rules.limits.wrapUpTurns}턴 · 하루 대화 {data.rules.limits.dayTurns}턴 ·
          단계 기준 {data.rules.stageMins.join(" / ")}
        </p>
      </section>
    </main>
  );
}

const CAP: Record<string, string> = { turn: "턴 폭 제한", day_gain: "하루 상승 상한", day_loss: "하루 하락 상한", stage_floor: "단계 바닥", max: "최대치" };

function Tile({ k, v, sub }: { k: string; v: any; sub?: string }) {
  return <div className="tile"><span>{k}</span><b>{v}</b>{sub && <small>{sub}</small>}</div>;
}

const ADMIN_CSS = `
.admin { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; }
.admin-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
.admin-head h1 { font-family: var(--serif); font-size: 22px; margin: 0; }
.admin-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.admin-tools { display: flex; flex-wrap: wrap; gap: 8px; flex: none; max-width: 100%; }
.feedback-panel { word-break: keep-all; overflow-wrap: anywhere; }
.feedback-panel h3 { margin: 20px 0 8px; font-size: 13px; }
.feedback-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 10px; }
.feedback-group { min-width: 0; padding: 12px; border: 0.5px solid var(--line); border-radius: 12px; }
.feedback-group h4 { margin: 0 0 8px; font-size: 13px; }
.feedback-group dl { margin: 0; font-size: 12.5px; }
.feedback-group dl > div { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; }
.feedback-group dt { color: var(--muted); }
.feedback-group dd { margin: 0; flex: none; font-variant-numeric: tabular-nums; }
.feedback-group p { margin: 8px 0 0; }
.feedback-trigger { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.feedback-text { white-space: pre-wrap; max-width: 60ch; margin: 4px 0; }
.feedback-export-note { margin: 16px 0 0; max-width: 60ch; }
@media (max-width: 760px) { .admin-head { flex-direction: column; } .admin-tools .icon-btn { font-size: 12px; } }
.filters { display: flex; gap: 12px; margin-top: 8px; font-size: 13px; color: var(--ink-2); }
.filters select { height: 30px; border-radius: 8px; border: 0.5px solid var(--line); background: var(--card); margin-left: 4px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 14px; }
.tile { background: var(--card); border: 0.5px solid var(--line); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 2px; }
.tile span { font-size: 12px; color: var(--muted); }
.tile b { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tile small { font-size: 12px; color: var(--muted); }
.grid2 { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 14px; }
@media (min-width: 900px) { .grid2 { grid-template-columns: 1fr 1fr; } }
.panel { background: var(--card); border: 0.5px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 14px; min-width: 0; }
.grid2 .panel { margin-bottom: 0; }
.panel h2 { font-size: 14px; margin: 0 0 10px; }
.muted { color: var(--muted); font-size: 12.5px; }
.warn { color: var(--warn); font-size: 12.5px; }
.bar { display: grid; grid-template-columns: 150px 1fr 36px; align-items: center; gap: 10px; font-size: 13px; margin: 6px 0; }
.bar div { height: 8px; background: var(--line-2); border-radius: 8px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); border-radius: 8px; }
.bar b { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.table-scroll table { min-width: max-content; }
.table-scroll th, .table-scroll td { white-space: nowrap; word-break: keep-all; overflow-wrap: normal; }
th { text-align: left; font-weight: 500; color: var(--muted); border-bottom: 0.5px solid var(--line); padding: 6px 8px; }
td { border-bottom: 0.5px solid var(--line-2); padding: 7px 8px; font-variant-numeric: tabular-nums; }
tbody tr { cursor: pointer; }
tbody tr:hover, tbody tr.on { background: var(--accent-soft); }
.drop { font-size: 13px; padding: 8px 0; border-bottom: 0.5px solid var(--line-2); }
.drop div { color: var(--ink-2); margin-top: 2px; }
.drop em, .tl-text em { font-style: normal; color: var(--muted); }
.timeline { display: flex; flex-direction: column; gap: 2px; }
.tl { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; padding: 8px 0; border-bottom: 0.5px solid var(--line-2); font-size: 13.5px; }
.tl-who { color: var(--muted); font-size: 12px; padding-top: 2px; }
.tl.user .tl-text { color: var(--accent); }
.judge { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 12px; }
.pill { padding: 1px 8px; border-radius: 999px; background: var(--line-2); font-weight: 600; }
.pill.up { background: var(--accent-soft); color: var(--accent); }
.pill.down { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
.judge select { height: 28px; border-radius: 8px; border: 0.5px solid var(--line); background: var(--paper); font-size: 12px; padding: 0 6px; }
`;
