// 서버용 캐릭터 목록. 새 캐릭터 = 파일 두 개(<id>.public.ts, <id>.ts) 추가 후 여기 등록.
import { haruhi } from "./haruhi";
import { jaeheon } from "./jaeheon";
import type { CharacterServer } from "./types";

export const CHARACTERS: Record<string, CharacterServer> = { haruhi, jaeheon };
export const DEFAULT_CHARACTER = "haruhi";
export const getCharacter = (id?: string | null) => CHARACTERS[id ?? ""] ?? CHARACTERS[DEFAULT_CHARACTER];
