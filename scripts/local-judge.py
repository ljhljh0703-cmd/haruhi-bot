"""로컬 판정기 서버: JevK5(공개 가중치, Apache-2.0)를 TypeSafe /v1/systemone 형식으로 연다.

비교 실험 전용이다. 친구 테스트용 배포(Vercel)는 이 컴퓨터에 닿지 않는다.
필요한 것: llama-server(llama.cpp)가 JevK5 GGUF를 띄운 상태, `pip install --no-deps jevk5`.
실행: python3 scripts/local-judge.py --llama http://127.0.0.1:8080 --port 8090
앱 쪽: LOCAL_JUDGE_URL=http://127.0.0.1:8090 npm run judge-eval -- local
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from jevk5.gguf import JevK5GGUF


def normalized(q: dict) -> dict:
    if q.get("type") not in ("noul", "choice", "score"):
        raise ValueError(f"unknown question type {q.get('type')!r}")
    crit = q.get("criteria")
    if q["type"] == "choice" and isinstance(crit, list):
        crit = dict.fromkeys(crit)
    return {**q, "criteria": crit}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llama", default="http://127.0.0.1:8080")
    ap.add_argument("--port", type=int, default=8090)
    # JevK5 README 표의 v0.3 4B GGUF 값
    ap.add_argument("--temperature", type=float, default=1.22)
    ap.add_argument("--knockout-temperature", type=float, default=0.93)
    a = ap.parse_args()
    model = JevK5GGUF(a.llama, temperature=a.temperature, knockout_temperature=a.knockout_temperature)
    lock = threading.Lock()

    class H(BaseHTTPRequestHandler):
        def _send(self, status: int, payload: dict) -> None:
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            self._send(200, {"ok": True, "model": "jevk5-gguf"})

        def do_POST(self) -> None:
            if self.path.rstrip("/") != "/v1/systemone":
                return self._send(404, {"error": "not found"})
            t = time.perf_counter()
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                state = body["state"]
                state = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
                with lock:
                    answers = {k: model.decide(state, normalized(q)) for k, q in body["questions"].items()}
            except (ValueError, KeyError, TypeError) as e:
                return self._send(400, {"error": str(e)})
            tokens = sum(x.pop("input_tokens", 0) for x in answers.values())
            self._send(200, {"model": "jevk5-gguf", "answers": answers,
                             "usage": {"input_tokens": tokens, "output_tokens": 0},
                             "latency_ms": round((time.perf_counter() - t) * 1e3, 1)})

        def log_message(self, *args) -> None:
            pass

    print(f"local judge on http://127.0.0.1:{a.port}/v1/systemone (llama-server {a.llama})")
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
