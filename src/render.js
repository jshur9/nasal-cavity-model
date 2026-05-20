import { clamp } from "./utils.js";
import { mulberry32 } from "./random.js";

export function resizeCanvas(canvas, ctx) {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function draw(canvas, ctx, inp, m) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const rand = inp.deterministic ? mulberry32((inp.tMs | 0) + 1337) : Math.random;
  const prog = clamp(inp.tMs / m.durationMs, 0, 1);
  ctx.fillStyle = "rgba(160,220,240,.35)";
  for (let i = 0; i < 450 * prog; i++) {
    const x = 120 + rand() * (w - 220) * prog;
    const y = h * 0.5 + (rand() * 2 - 1) * 90 * prog;
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
  }
}
