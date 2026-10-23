import Link from "next/link";
import type { CharacterPublic } from "@/lib/characters/types";
import Face from "./Face";
import { CheckIcon, LockIcon } from "./Icons";

export type UserState = {
  character: string; nickname: string; stage: number; stageName: string; score: number; stageMin: number;
  stages: { name: string; unlock: string; min: number }[];
  nextMin: number | null; nextName: string | null; nextUnlock: string | null;
  dayGainLeft: number; dayGainMax: number; dayTurnsLeft: number; doneToday: boolean; mood: string; eventTitle: string | null; mock: boolean;
  choices: { kind: string; text: string }[];
  rules: string;
};

export function progress(u: UserState) {
  if (u.nextMin === null) return 100;
  return Math.max(0, Math.min(100, ((u.score - u.stageMin) / (u.nextMin - u.stageMin)) * 100));
}

export default function IdCard({ c, u, thump = false, compact = false }: { c: CharacterPublic; u: UserState; thump?: boolean; compact?: boolean }) {
  return (
    <div>
      <div className="idcard">
        <div className="idcard-top"><span>{c.idCard.title}</span><span>{u.rules.startsWith("test") ? "테스트판" : ""}</span></div>
        <div className="who" style={{ marginTop: 12 }}>
          <Face c={c} mood="base" />
          <div>
            <h3>{u.nickname}</h3>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{c.idCard.issuer}</div>
          </div>
        </div>
        <div className={`stamp ${thump ? "thump" : ""}`}>{u.stageName}</div>

        <div style={{ marginTop: 16 }}>
          <div className="kv"><span>호감</span><b>{u.score}{u.nextMin !== null ? ` / ${u.nextMin}` : ""}</b></div>
          <div className="big-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(u))} aria-label="다음 단계까지">
            <i style={{ width: `${progress(u)}%` }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {u.nextName ? `${u.nextName}까지 ${u.nextMin! - u.score}` : "가장 높은 단계"}
          </div>
        </div>

        {!compact && (
          <>
            <div style={{ marginTop: 12 }}>
              <div className="kv"><span>오늘 더 오를 수 있는 호감</span><b>{u.dayGainLeft} / {u.dayGainMax}</b></div>
              <div className="kv"><span>오늘 남은 대화</span><b>{u.dayTurnsLeft}번</b></div>
              {u.eventTitle && <div className="kv"><span>{c.ui.eventBadge}</span><b>{u.eventTitle}</b></div>}
            </div>
            <ul className="ladder">
              {u.stages.map((s, i) => {
                const on = u.stage >= i + 1;
                return (
                  <li key={s.name} className={on ? "on" : "off"}>
                    <span className="dot">{on ? <CheckIcon /> : <LockIcon />}</span>
                    <span>{s.name}<small>{s.unlock}</small></span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {!compact && (
        <>
          <p className="side-note">호감은 하루에 오를 수 있는 양이 정해져 있고, 단계는 내려가지 않아요.</p>
          <Link href={`/memory?c=${c.id}`} className="icon-btn" style={{ textDecoration: "none" }}>{c.shortName}의 기억 노트 보기</Link>
        </>
      )}
    </div>
  );
}
