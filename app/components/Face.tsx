import { faceFor } from "@/lib/characters/public";
import type { CharacterPublic } from "@/lib/characters/types";

export default function Face({ c, mood, size, className = "" }: { c: CharacterPublic; mood?: string; size?: number; className?: string }) {
  const src = faceFor(c, mood);
  const style = size ? { width: size, height: size } : undefined;
  return (
    <div className={`face ${src ? "" : "face-empty"} ${className}`} style={style} aria-hidden="true">
      {src ? <img src={src} alt="" /> : null}
    </div>
  );
}
