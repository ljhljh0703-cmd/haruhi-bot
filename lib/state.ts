import { cookies } from "next/headers";
import { LIMITS, RULES_VERSION, STAGE_MINS } from "./config";
import { User, getUser } from "./db";
import { mockMode } from "./llm";
import { getCharacter } from "./characters";
import { rollDay } from "./rules";

// 캐릭터마다 따로 입장한다(쿠키도 캐릭터별).
export const cookieName = (charId: string) => `uid_${charId}`;

export async function currentUser(charId: string) {
  const id = (await cookies()).get(cookieName(charId))?.value;
  if (!id) return null;
  const u = await getUser(id);
  return u && u.character === charId ? rollDay(u) : null;
}

export const charFromUrl = (req: Request) => getCharacter(new URL(req.url).searchParams.get("c"));

export function publicState(u: User) {
  const c = getCharacter(u.character);
  const i = u.stage - 1;
  return {
    character: c.id,
    nickname: u.nickname,
    stage: u.stage,
    stageName: c.stages[i].name,
    stages: c.stages.map((s, k) => ({ ...s, min: STAGE_MINS[k] })),
    score: u.score,
    stageMin: STAGE_MINS[i],
    nextMin: STAGE_MINS[i + 1] ?? null,
    nextName: c.stages[i + 1]?.name ?? null,
    nextUnlock: c.stages[i + 1]?.unlock ?? null,
    dayGainLeft: Math.max(0, LIMITS.dayGain - u.dayGain),
    dayGainMax: LIMITS.dayGain,
    dayTurnsLeft: Math.max(0, LIMITS.dayTurns - u.dayTurns),
    doneToday: u.dayTurns >= LIMITS.dayTurns,
    mood: u.mood,
    eventTitle: u.event?.active?.title ?? null,
    choices: u.event?.active ? c.eventChoices : u.total_turns === 0 ? c.openingChoices : [],
    mock: mockMode(),
    rules: RULES_VERSION,
  };
}
export type PublicState = ReturnType<typeof publicState>;

export function moodFor(action: string, stage: number) {
  if (action === "fun_idea" || action === "follows_order") return "excited";
  if (action === "dismiss" || action === "rude" || action === "boring") return "angry";
  if ((action === "personal_share" || action === "compliment") && stage >= 3) return "shy";
  return "base";
}
