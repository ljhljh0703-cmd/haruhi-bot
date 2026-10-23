"use client";
import { useEffect, useState } from "react";
import { getPublicCharacter } from "@/lib/characters/public";
import type { CharacterPublic } from "@/lib/characters/types";

// 주소의 ?c= 로 캐릭터를 고른다(없으면 하루히). 서버 렌더와 어긋나지 않게 마운트 뒤에 정한다.
export function useChar(): CharacterPublic | null {
  const [c, setC] = useState<CharacterPublic | null>(null);
  useEffect(() => { setC(getPublicCharacter(new URLSearchParams(window.location.search).get("c"))); }, []);
  return c;
}
export const withC = (path: string, c: CharacterPublic) => `${path}${path.includes("?") ? "&" : "?"}c=${c.id}`;
