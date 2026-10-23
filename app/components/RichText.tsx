// *행동* 부분을 지문으로 보이게 나눈다. 스트리밍 중 닫히지 않은 별표도 지문으로 본다.
export default function RichText({ text }: { text: string }) {
  const parts: { t: string; act: boolean }[] = [];
  let act = false;
  for (const seg of text.split("*")) {
    if (seg) parts.push({ t: seg, act });
    act = !act;
  }
  return (
    <>
      {parts.map((p, i) => (p.act ? <em key={i}>{p.t.trim() ? `(${p.t.trim()})` : ""}</em> : <span key={i}>{p.t}</span>))}
    </>
  );
}
