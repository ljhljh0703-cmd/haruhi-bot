import { ACTIONS, ActionKey, LIMITS, MAX_SCORE, STAGE_MINS, kstDay, stageFor } from "./config";

export type DayState = { day: string; dayGain: number; dayLoss: number; dayTurns: number };

export type AffinityResult = {
  raw: number;
  applied: number;
  scoreAfter: number;
  stageBefore: number;
  stageAfter: number;
  capped: null | "turn" | "day_gain" | "day_loss" | "stage_floor" | "max";
};

export function rollDay<T extends DayState>(u: T): T {
  const today = kstDay();
  if (u.day === today) return u;
  return { ...u, day: today, dayGain: 0, dayLoss: 0, dayTurns: 0 };
}

// 점수 계산은 전부 규칙. AI 판단은 action 하나만 들어온다.
export function applyAffinity(
  u: { score: number; stage: number } & DayState,
  action: ActionKey,
): AffinityResult {
  const raw = ACTIONS[action]?.delta ?? 0;
  let d = Math.max(LIMITS.turnMin, Math.min(LIMITS.turnMax, raw));
  let capped: AffinityResult["capped"] = d !== raw ? "turn" : null;

  if (d > 0) {
    const room = Math.max(0, LIMITS.dayGain - u.dayGain);
    if (d > room) { d = room; capped = "day_gain"; }
  } else if (d < 0) {
    const room = Math.max(0, LIMITS.dayLoss - u.dayLoss);
    if (-d > room) { d = -room; capped = "day_loss"; }
  }

  // 단계는 떨어지지 않는다. 단계 안에서만 내려간다.
  const floor = STAGE_MINS[u.stage - 1] ?? 0;
  let after = u.score + d;
  if (after < floor) { after = floor; capped = "stage_floor"; }
  if (after > MAX_SCORE) { after = MAX_SCORE; capped = "max"; }

  const applied = after - u.score;
  const stageAfter = Math.max(u.stage, stageFor(after));
  return { raw, applied, scoreAfter: after, stageBefore: u.stage, stageAfter, capped };
}
