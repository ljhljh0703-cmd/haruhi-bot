// 반복 답 측정: 이번 답과 최근 답들의 글자 3개 묶음이 얼마나 겹치는지(0~1, 가장 많이 겹친 값).
const grams = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  const g = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
};

export function repetitionScore(reply: string, recent: string[]) {
  const a = grams(reply);
  if (!a.size) return 0;
  let best = 0;
  for (const r of recent) {
    const b = grams(r);
    if (!b.size) continue;
    let inter = 0;
    a.forEach((x) => { if (b.has(x)) inter++; });
    best = Math.max(best, inter / (a.size + b.size - inter));
  }
  return +best.toFixed(3);
}
