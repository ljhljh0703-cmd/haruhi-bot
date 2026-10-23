import type { CharacterPublic } from "./types";

// 오리지널 캐릭터(작가 결정 2026-10-23: 까칠한 사수 → 내 편, 무뚝뚝 → 서툰 다정, 설정 「이대로」).
export const jaeheonPublic: CharacterPublic = {
  id: "jaeheon",
  name: "윤재헌",
  shortName: "재헌",
  landing: {
    title: "첫 출근",
    lead: "게임 회사 기획팀 첫 출근날. 사수는 모니터에서 눈도 안 뗀다. 말없는 사수에게 믿을 만한 후배라는 걸 보여 줘.",
    namePlaceholder: "예: 민지",
  },
  stages: [
    { name: "낯선 신입", unlock: "첫 출근" },
    { name: "손 가는 후배", unlock: "재헌이 먼저 메신저 보내기" },
    { name: "믿는 파트너", unlock: "업무 미션, 업무 밖 이야기" },
    { name: "내 사람", unlock: "서툰 진심 한 조각" },
  ],
  idCard: { title: "사원증", issuer: "기획팀 · 사수 윤재헌" },
  ui: {
    doneTitle: "퇴근 시간",
    doneBody: "재헌이 오늘은 그만 퇴근하래요. 내일 0시(한국 시간)에 다시 열려요.",
    input: "재헌에게 말하기",
    action: "재헌 앞에서 할 행동",
    actionExample: "모니터 옆에 커피를 놓는다",
    eventBadge: "업무 미션",
  },
  art: {
    face: { base: null, angry: null, excited: null, shy: null },
    sprite: { base: null, angry: null, excited: null, shy: null },
    key: null,
  },
  scenes: {
    office: { label: "기획팀, 아침", image: null, from: "#e8edf2", to: "#b5c3d1" },
    officeLate: { label: "기획팀, 오후", image: null, from: "#efe3cf", to: "#a9b5c4" },
    street: { label: "퇴근길", image: null, from: "#efc69c", to: "#666b98" },
    night: { label: "야근하는 사무실", image: null, from: "#1e2939", to: "#47577a" },
    meeting: { label: "회의실", image: null, from: "#dde4ea", to: "#9cadbe" },
  },
  stageScenes: ["office", "officeLate", "street", "night"],
  eventScene: "meeting",
  rights: "오리지널 캐릭터입니다. 이 페이지는 비영리 개인 포트폴리오입니다.",
};
