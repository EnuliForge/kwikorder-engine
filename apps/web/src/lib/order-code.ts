// simple, human-friendly 4+4 code like AB7K-3XQM
export function newOrderCode(): string {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const pick = (n: number) => Array.from({ length: n }, () => alpha[Math.floor(Math.random() * alpha.length)]).join("");
  return `${pick(4)}-${pick(4)}`;
}
