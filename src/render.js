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
  const mode = inp.viewMode || "cavity";

  const cavityY = h * 0.52;
  const nozzleX = 85;
  const nozzleY = cavityY - 4;
  const travel = (w - 190) * prog;

  // Background cavity silhouette to keep the scene visible even at t=0.
  ctx.strokeStyle = "rgba(146,198,220,.45)";
  ctx.fillStyle = "rgba(96,148,172,.10)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(140, cavityY - 110);
  ctx.bezierCurveTo(w * 0.45, cavityY - 165, w * 0.72, cavityY - 30, w - 95, cavityY - 12);
  ctx.bezierCurveTo(w * 0.78, cavityY + 66, w * 0.5, cavityY + 96, 154, cavityY + 64);
  ctx.quadraticCurveTo(118, cavityY + 24, 140, cavityY - 110);
  ctx.fill();
  if (mode !== "plume") ctx.stroke();

  ctx.strokeStyle = "rgba(220,238,248,.52)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(nozzleX - 38, nozzleY - 2);
  ctx.lineTo(nozzleX + 10, nozzleY - 2);
  ctx.stroke();

  const halfAngle = (m.plumeAngle * Math.PI) / 360;
  const spread = Math.max(12, Math.tan(halfAngle) * (travel + 55));
  const centerY = cavityY - 6;
  if (mode !== "heatmap") {
    ctx.fillStyle = "rgba(156,214,235,.20)";
    ctx.beginPath();
    ctx.moveTo(nozzleX + 10, nozzleY);
    ctx.lineTo(nozzleX + 10 + travel, centerY - spread);
    ctx.lineTo(nozzleX + 10 + travel, centerY + spread);
    ctx.closePath();
    ctx.fill();
  }

  const particleCount = Math.max(8, Math.floor(420 * prog));
  const primaryRadius = clamp(m.dv50 / 8.5, 0.7, 1.6);
  const secondaryRadius = clamp(m.dv50 / 13, 0.4, 1.1);
  const secondaryShare = clamp(m.secondaryPeakFraction || 0.15, 0.04, 0.5);
  for (let i = 0; i < particleCount; i++) {
    const x = nozzleX + 12 + rand() * travel;
    const f = travel > 1 ? (x - nozzleX - 12) / travel : 0;
    const localSpread = Math.max(8, spread * (0.2 + 0.8 * f));
    const y = centerY + (rand() * 2 - 1) * localSpread;
    const small = rand() < secondaryShare;
    const r = (small ? secondaryRadius : primaryRadius) * (0.8 + 0.4 * rand());
    if (mode === "heatmap") {
      ctx.fillStyle = small ? "rgba(95,214,224,.22)" : "rgba(121,186,226,.16)";
    } else {
      ctx.fillStyle = small ? "rgba(160,232,232,.72)" : "rgba(167,220,240,.54)";
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
