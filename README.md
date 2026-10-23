# SOS단 입단 심사 · 하루히 캐릭터 채팅

스즈미야 하루히와 나누는 AI 캐릭터 채팅. 컴투스 캐릭터 채팅 플랫폼 시스템 기획자 지원용 개인 포트폴리오(비영리). 원작 권리는 원저작권자에게 있다.

## 무엇을 보여 주나
| 시스템 | 어떻게 | 파일 |
|---|---|---|
| 호감도 | 대사는 LLM, 판단은 판정 전용 모델. 판정기가 사용자 발화의 **행동 종류만** 고르고(Jev / OpenAI Decisions / 로컬 JevK5 / Haiku 중 선택), 점수는 서버 규칙표가 계산. Jev 확신이 낮으면 점수 보류. 턴당 -5~+4, 하루 상승 20·하락 10 상한 | `lib/config.ts` `lib/rules.ts` |
| 관계 단계 | SOS단 입단 서사 4단계. 단계는 내려가지 않고, 단계마다 말투 지침과 열리는 것이 바뀜 | `lib/persona.ts` |
| 기억 | 3층: 최근 대화 16개 그대로 / 6턴마다 요약 / 사용자가 직접 말한 사실 카드(기억 노트에서 보고 지움) | `lib/db.ts` `app/memory` |
| 이벤트 | 2단계부터 오래 비웠다 오면 하루히가 먼저 말 걸기, 3단계부터 불가사의 탐사(단서 3개 → 평범한 진상) | `app/api/greet` `lib/events.ts` |
| 과몰입 방지 | 하루 상승 상한, 40턴부터 하루히가 먼저 마무리, 50턴에 오늘 활동 끝, 전체 24시간 턴 상한 | `lib/config.ts` |
| 안전 | 사용자 대사·행동 대신 쓰기 금지, 내부 수치 노출 금지, 위험 신호 때 캐릭터를 잠시 내려놓고 도움 권함, AI 고지 상시 | `lib/persona.ts` |
| 운영 | 운영자 화면: 턴마다 분류·규칙 점수·적용 점수·상한 사유·첫 글자 시간·비용, 오분류 표시, 단계 도달, 끊긴 지점 | `app/admin` |
| 판정기 비교 | 서비스 중: 그림자 판정기와의 일치율·보류 수·판정 비용. 실험: 한국어 예문 60개로 판정기별 정확도·보류율·속도·비용(`npm run judge-eval`) | `lib/judges.ts` `scripts/judge-eval.mts` `eval/judge-set.json` |
| 학습 준비 | 운영자 화면 「라벨 내보내기」(JSONL). 사람이 고친 라벨만 학습에 씀(판정 모델 답을 그대로 학습시키는 건 제공사 약관 제한) | `app/api/admin` |
| 평가 | 캐릭터다움 20문항(7범주) 자동 실행, 고치기 전·후 비교 | `scripts/eval.mjs` |

## 구조
- Next.js(App Router) + Claude API(대화 Haiku로 시작해 20문항으로 Sonnet과 비교, 분류·요약 Haiku). 로컬 모델은 `LOCAL_LLM_URL`(LM Studio·Ollama)로 대화만 바꿔 비교 실험. 답은 글자 단위로 흘려 보냄(NDJSON 스트림), 고정 설정에 프롬프트 캐시.
- 저장: 배포는 Postgres(`DATABASE_URL`, Neon), 내 컴퓨터는 PGlite 파일 DB. SQL 한 벌.
- `ANTHROPIC_API_KEY`가 없으면 연습 모드(정해진 답)로 화면·흐름만 돌아감.

## 돌리기
```
npm install
npm run build && ADMIN_KEY=아무거나 npm start   # http://localhost:3000
BASE=http://localhost:3000 npm run eval          # 20문항
```

## 배포 때 넣을 값 (Vercel 프로젝트 설정 > Environment Variables, 작가가 직접 입력)
- `ANTHROPIC_API_KEY` 대화용 키
- `DATABASE_URL` Vercel Storage에서 Neon을 붙이면 자동으로 들어감
- `ADMIN_KEY` 운영자 화면 비밀번호
- `OPENAI_API_KEY` 행동 판정(OpenAI Decisions API). Haiku가 같은 턴을 같이 판정해 일치율을 남김(기본, `JUDGE_SHADOW=off`로 끔). Jev를 쓰려면 `TYPESAFE_API_KEY` + `JUDGE_PROVIDER=jev`
- 로컬 판정기 실험: `docs/LOCAL-JUDGE.md`
- (선택) `CHAT_MODEL` `JUDGE_MODEL` `GLOBAL_DAY_TURNS`

## 그림
원작 그림 사용(작가 결정). `public/haruhi/`에 넣고 `lib/art.ts` 경로를 채운다. 비어 있으면 빈 자리로 보인다.
