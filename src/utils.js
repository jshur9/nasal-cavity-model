export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
