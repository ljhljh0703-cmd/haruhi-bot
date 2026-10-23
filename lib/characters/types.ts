import type { ActionKey } from "../config";

// 화면에 보여도 되는 것(클라이언트 번들에 들어감)
export type CharacterPublic = {
  id: string;
  name: string; // 전체 이름
  shortName: string; // 말풍선 위 이름
  landing: { title: string; lead: string; namePlaceholder: string };
  stages: { name: string; unlock: string }[]; // 단계 수는 config의 STAGE_MINS와 같아야 함
  idCard: { title: string; issuer: string };
  ui: { doneTitle: string; doneBody: string; input: string; action: string; actionExample: string; eventBadge: string };
  // 그림: face = 작은 얼굴(기록 화면), sprite = 미연시 스탠딩(표정별), key = 첫 화면
  art: { face: Record<string, string | null>; sprite: Record<string, string | null>; key: string | null };
  // 배경: 그림이 없으면 두 색 그라데이션으로 대신한다. 단계별 배경과 이벤트 중 배경.
  scenes: Record<string, Scene>;
  stageScenes: string[];
  eventScene: string;
  rights: string; // 첫 화면 아래 권리 표기
};

export type Scene = { label: string; image: string | null; from: string; to: string };

export type Episode = { id: string; title: string; hook: string; clues: string[]; truth: string };
export type Choice = { kind: "talk" | "action"; text: string };

// 서버에서만 쓰는 것(프롬프트·이벤트)
export type CharacterServer = CharacterPublic & {
  persona: string; // 고정 설정. 프롬프트 캐시 대상
  stageGuide: string[]; // 단계별 태도, stages와 같은 길이
  opening: { kind: "action" | "talk"; content: string }[];
  openingChoices: Choice[];
  episodes: Episode[];
  eventChoices: Choice[];
  prompts: {
    eventName: string; // 예: SOS단 활동
    episodeStart: (e: Episode) => string;
    episodeClue: (e: Episode, clue: string) => string;
    episodeEnd: (e: Episode) => string;
    greet: (hours: number) => string;
    dayEnd: string;
    wrapUp: string;
  };
  judge: {
    who: string; // 판정 모델에게 줄 영어 한 줄: 누구와의 대화인지
    criteria: Partial<Record<ActionKey, string>>; // 캐릭터에 맞춘 행동 뜻풀이(영어, 한국어 예시)
    hintsKo: Partial<Record<ActionKey, string>>; // Haiku 판정용 한국어 뜻풀이
  };
  mock: { default: string; boring: string; fun: string; greet: string; dayEnd: string; episode: (t: string) => string };
};
