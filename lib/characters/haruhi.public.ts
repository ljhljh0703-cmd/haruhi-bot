import type { CharacterPublic } from "./types";

export const haruhiPublic: CharacterPublic = {
  id: "haruhi",
  name: "스즈미야 하루히",
  shortName: "하루히",
  landing: {
    title: "SOS단 입단 심사",
    lead: "하교길, 누군가 네 소매를 잡아당긴다. 이상한 걸 찾아다니는 단장 하루히에게 쓸모 있는 단원이라는 걸 보여 줘.",
    namePlaceholder: "예: 쿈",
  },
  stages: [
    { name: "수상한 사람", unlock: "첫 만남" },
    { name: "임시 단원", unlock: "하루히가 먼저 말 걸기" },
    { name: "정식 단원", unlock: "불가사의 탐사 제안" },
    { name: "특별한 단원", unlock: "속마음 한 조각" },
  ],
  idCard: { title: "SOS단 단원증", issuer: "단장 스즈미야 하루히 발급" },
  ui: {
    doneTitle: "오늘 SOS단 활동 끝",
    doneBody: "하루히가 오늘은 여기까지래요. 내일 0시(한국 시간)에 다시 열려요.",
    input: "하루히에게 말하기",
    action: "하루히 앞에서 할 행동",
    actionExample: "골목 쪽을 가리킨다",
    eventBadge: "탐사 중",
  },
  // 원작 그림 자리 (작가 결정 2026-10-23: 개인 포폴이라 원작 그림 사용). public/haruhi/ 에 넣고 경로를 채운다.
  art: {
    face: { base: null, angry: null, excited: null, shy: null },
    sprite: { base: null, angry: null, excited: null, shy: null },
    key: null,
  },
  scenes: {
    street: { label: "하교길", image: "/haruhi/bg-street.jpg", from: "#f3c08c", to: "#8f78b4" },
    clubroom: { label: "SOS단 부실", image: "/haruhi/bg-clubroom.jpg", from: "#f1e4c8", to: "#c3ad86" },
    rooftop: { label: "옥상, 해 질 녘", image: "/haruhi/bg-rooftop.jpg", from: "#f2996a", to: "#544680" },
    alley: { label: "밤의 골목", image: "/haruhi/bg-alley.jpg", from: "#2b3450", to: "#76688c" },
  },
  stageScenes: ["street", "clubroom", "clubroom", "rooftop"],
  eventScene: "alley",
  rights: "「스즈미야 하루히」 시리즈의 권리는 원저작권자에게 있습니다. 이 페이지는 비영리 개인 포트폴리오입니다.",
};
