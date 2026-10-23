// 운영 수치는 전부 여기. 캐릭터와 무관한 규칙만 둔다(캐릭터별 내용은 lib/characters).

// 규칙 판(작가 결정 2026-10-23: 친구 테스트는 빠른 판).
// 턴마다 RULES_VERSION을 기록해, 수치를 고친 전후를 나눠 본다. 수치를 바꾸면 뒤 숫자를 올린다.
const RULESETS = {
  live: { version: 1, stageMins: [0, 15, 40, 75], dayGain: 20 },
  test: { version: 1, stageMins: [0, 10, 25, 45], dayGain: 30 }, // 2~3일 안에 4단계까지
} as const;
export const RULESET: keyof typeof RULESETS = process.env.RULESET === "live" ? "live" : "test";
const R = RULESETS[RULESET];
export const RULES_VERSION = `${RULESET}-${R.version}`;
export const STAGE_MINS: readonly number[] = R.stageMins;
export const STAGE_COUNT = STAGE_MINS.length;

export const MAX_SCORE = 100;

// AI는 행동 종류만 고른다. 점수는 이 표가 정한다. 행동의 뜻풀이는 캐릭터마다 다르다(lib/characters).
export const ACTIONS = {
  fun_idea: { label: "재밌는 제안·관심 끄는 이야기", delta: 4 },
  follows_order: { label: "요청에 따름·협조", delta: 2 },
  personal_share: { label: "자기 이야기를 털어놓음", delta: 2 },
  engaged: { label: "성의 있게 대화", delta: 1 },
  compliment: { label: "칭찬·인정", delta: 1 },
  neutral: { label: "보통", delta: 0 },
  boring: { label: "성의 없는 단답·지루함", delta: -1 },
  dismiss: { label: "무시·깎아내리기", delta: -3 },
  rude: { label: "모욕·공격", delta: -5 },
  off_limits: { label: "수위·위험 요청", delta: 0 },
} as const;
export type ActionKey = keyof typeof ACTIONS;
export const ACTION_KEYS = Object.keys(ACTIONS) as ActionKey[];

export const LIMITS = {
  turnMax: 4, // 한 턴 최대 상승
  turnMin: -5, // 한 턴 최대 하락
  dayGain: R.dayGain as number, // 하루 상승 상한 (과몰입 방지)
  dayLoss: 10, // 하루 하락 상한
  wrapUpTurns: 40, // 이 턴 수부터 캐릭터가 마무리 쪽으로 몰아감
  dayTurns: 50, // 하루 대화 턴 상한. 넘으면 내일 다시
  greetAfterHours: 3, // 2단계부터, 이만큼 비웠다 오면 캐릭터가 먼저 말 건다
  eventCooldownTurns: 12, // 3단계부터, 사건 제안 간격
  summaryEvery: 6, // 이 턴마다 요약 기억 갱신
  recentWindow: 16, // 그대로 넣는 최근 메시지 수
  sessionGapMin: 30, // 이만큼 비면 새 세션으로 센다
  globalDayTurns: Number(process.env.GLOBAL_DAY_TURNS || 1500), // 전체 참여자 합산 24시간 턴 상한(비용 안전장치)
};

// 비용은 추정. 실제 단가는 콘솔에서 확인해 고친다.
export const PRICE_PER_MTOK = {
  chat: { in: 1, out: 5 }, // Haiku 기준 추정
  judge: { in: 1, out: 5 }, // Haiku 추정
  jev: { in: 0.042, out: 0 }, // TypeSafe 공개 가격(2026-10-13 확인), 출력 무료
  openai: { in: 0.1, out: 0 }, // OpenAI Decisions API 공개 베타 가격(2026-10-23 확인)
  local: { in: 0, out: 0 },
};

// 대화 모델: 작가 결정(2026-10-23) = Claude로 서비스, Haiku로 시작해 20문항으로 Sonnet과 비교 뒤 확정.
export const CHAT_MODEL = process.env.CHAT_MODEL || "claude-haiku-5-5";
// 로컬 모델 비교용(서비스에는 안 씀): LM Studio·Ollama 같은 OpenAI 호환 주소. 있으면 대화만 로컬로 보낸다.
export const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || "";
export const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || "local-model";
export const JUDGE_MODEL = process.env.JUDGE_MODEL || "claude-haiku-5-5";

export function stageFor(score: number) {
  let s = 1;
  STAGE_MINS.forEach((min, i) => { if (score >= min) s = i + 1; });
  return s;
}

// 날짜는 한국 시간 기준으로 끊는다.
export function kstDay(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
