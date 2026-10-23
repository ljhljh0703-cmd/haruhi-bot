// 화면용 캐릭터 목록(프롬프트 없음).
import { haruhiPublic } from "./haruhi.public";
import { jaeheonPublic } from "./jaeheon.public";
import type { CharacterPublic } from "./types";

export const PUBLIC_CHARACTERS: Record<string, CharacterPublic> = { haruhi: haruhiPublic, jaeheon: jaeheonPublic };
export const getPublicCharacter = (id?: string | null) => PUBLIC_CHARACTERS[id ?? ""] ?? PUBLIC_CHARACTERS.haruhi;
export const faceFor = (c: CharacterPublic, mood?: string) => c.art.face[mood ?? "base"] ?? c.art.face.base ?? null;
export const spriteFor = (c: CharacterPublic, mood?: string) => c.art.sprite[mood ?? "base"] ?? c.art.sprite.base ?? null;
export const sceneFor = (c: CharacterPublic, stage: number, eventActive: boolean) =>
  c.scenes[eventActive ? c.eventScene : c.stageScenes[Math.max(0, Math.min(stage - 1, c.stageScenes.length - 1))]];
