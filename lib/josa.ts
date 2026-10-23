// 한국어 조사: 이름 끝 글자에 받침이 있으면 앞 것, 없으면 뒤 것.
const hasBatchim = (w: string) => {
  const ch = w.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
};
export const iga = (w: string) => `${w}${hasBatchim(w) ? "이" : "가"}`;
export const eunneun = (w: string) => `${w}${hasBatchim(w) ? "은" : "는"}`;
export const eulreul = (w: string) => `${w}${hasBatchim(w) ? "을" : "를"}`;
export const ege = (w: string) => `${w}에게`;
