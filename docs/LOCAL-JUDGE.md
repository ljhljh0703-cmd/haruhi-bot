# 로컬 판정기(JevK5) 맥에서 띄우기

판정기 비교 실험용이다. 친구 테스트 배포에는 쓰지 않는다(배포 서버가 이 맥에 닿지 않음).
JevK5 = TypeSafe Jev를 흉내 낸 공개 가중치 모델(Apache-2.0, Qwen3.5-4B 바탕). 영어 위주라 한국어 정확도는 직접 재야 한다.

## 1. llama.cpp 설치 (한 번만)
```bash
set -e
brew install llama.cpp
which llama-server   # 경로가 찍히면 성공
```

## 2. 판정기 파이썬 패키지 (한 번만)
```bash
set -e
cd "/Users/godju/Downloads/AI AGENT/haruhi-bot"
python3 -m venv .venv-judge
source .venv-judge/bin/activate
pip install --no-deps "jevk5 @ git+https://github.com/allebee/jevk5@v0.3.0"
python3 -c "import jevk5.gguf; print('ok')"   # ok가 찍히면 성공
```
`.venv-judge` 폴더는 지우면 되돌아간다.

## 3. 모델 띄우기 (터미널 창 1)
```bash
llama-server --hf-repo alibiserikbay/JevK5-GGUF --hf-file jevk5-4b-v0.3-Q8_0.gguf -c 8192 -ngl 99
```
- 처음 한 번은 4.48GB를 내려받는다. `server is listening` 이 보이면 성공.
- 16GB 맥에서 메모리가 빠듯하면 `jevk5-4b-v0.3-Q4_K_M.gguf`(2.71GB)로 바꾼다.

## 4. /v1/systemone 형식으로 열기 (터미널 창 2)
```bash
cd "/Users/godju/Downloads/AI AGENT/haruhi-bot"
source .venv-judge/bin/activate
python3 scripts/local-judge.py --llama http://127.0.0.1:8080 --port 8090
```
`local judge on http://127.0.0.1:8090/v1/systemone` 가 보이면 성공.

## 5. 비교 돌리기 (터미널 창 3)
```bash
cd "/Users/godju/Downloads/AI AGENT/haruhi-bot"
npm install
LOCAL_JUDGE_URL=http://127.0.0.1:8090 npm run judge-eval -- local
```
결과는 `eval/judge-날짜.md`. 다른 판정기 키가 있으면 `npm run judge-eval -- local jev openai haiku` 로 한 표에 같이 나온다.
