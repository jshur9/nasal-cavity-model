import { clamp } from "./utils.js";
import { mulberry32 } from "./random.js";

// ── Colour palette per region ────────────────────────────────────────────────
const RCOL = {
  anterior:  [255, 150,  50],
  front:     [255, 210,  60],
  inferior:  [ 60, 200, 100],
  middle:    [ 60, 150, 255],
  olfactory: [200,  60, 240],
  superior:  [255,  80, 120],
  naso:      [ 80, 230, 200],
};
const rc = (key, a) => { const [r, g, b] = RCOL[key]; return `rgba(${r},${g},${b},${a})`; };

// ── Canvas resize ────────────────────────────────────────────────────────────
export function resizeCanvas(canvas, ctx) {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = r.width  * dpr;
  canvas.height = r.height * dpr;
  canvas.style.width  = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Nasal cast geometry helpers ──────────────────────────────────────────────
// Sagittal right nasal cavity silhouette, derived from the CT nasal cast
// reference image. Anterior (nostril) at canvas LEFT, nasopharynx at RIGHT.
// Superior (skull base) at TOP, nasal floor at BOTTOM.
//
// All coordinates are normalised [0,1] and mapped through the helpers below
// so the silhouette fills the usable canvas area with consistent margins.

function makeSc(W, H) {
  const ml = 0.08, mr = 0.06, mt = 0.07, mb = 0.10;
  const cw = W * (1 - ml - mr), ch = H * (1 - mt - mb);
  const ox = W * ml, oy = H * mt;
  return { X: nx => ox + nx * cw, Y: ny => oy + ny * ch };
}

// Outer cavity silhouette path
function pathOuter(ctx, sc) {
  const { X, Y } = sc;
  ctx.beginPath();
  ctx.moveTo(X(0.00), Y(0.32));                               // nostril top

  // ── Skull base / roof (anterior → posterior) ───────────────────────────
  ctx.bezierCurveTo(X(0.04), Y(0.14), X(0.18), Y(0.04), X(0.36), Y(0.04)); // frontal recess
  ctx.bezierCurveTo(X(0.52), Y(0.03), X(0.64), Y(0.07), X(0.77), Y(0.14)); // ethmoid plate
  ctx.bezierCurveTo(X(0.88), Y(0.20), X(0.97), Y(0.30), X(1.00), Y(0.44)); // sphenoid / posterior

  // ── Posterior wall (nasopharynx) ───────────────────────────────────────
  ctx.bezierCurveTo(X(1.01), Y(0.58), X(1.00), Y(0.72), X(0.97), Y(0.82));

  // ── Nasal floor (posterior → anterior) ────────────────────────────────
  ctx.bezierCurveTo(X(0.88), Y(0.90), X(0.65), Y(0.92), X(0.40), Y(0.92));
  ctx.bezierCurveTo(X(0.22), Y(0.92), X(0.10), Y(0.90), X(0.02), Y(0.86));

  // ── Anterior face / vestibule ─────────────────────────────────────────
  ctx.bezierCurveTo(X(0.00), Y(0.78), X(-0.01), Y(0.58), X(0.00), Y(0.45));
  ctx.bezierCurveTo(X(0.00), Y(0.40), X(0.00), Y(0.35), X(0.00), Y(0.32));
  ctx.closePath();
}

// Inferior turbinate – prominent shelf from lateral wall
function pathInfTurb(ctx, sc) {
  const { X, Y } = sc;
  ctx.beginPath();
  ctx.moveTo(X(0.17), Y(0.54));
  ctx.bezierCurveTo(X(0.30), Y(0.48), X(0.56), Y(0.47), X(0.72), Y(0.54));
  ctx.bezierCurveTo(X(0.72), Y(0.65), X(0.55), Y(0.72), X(0.34), Y(0.72));
  ctx.bezierCurveTo(X(0.24), Y(0.72), X(0.17), Y(0.65), X(0.17), Y(0.54));
  ctx.closePath();
}

// Middle turbinate – smaller shelf above inferior
function pathMidTurb(ctx, sc) {
  const { X, Y } = sc;
  ctx.beginPath();
  ctx.moveTo(X(0.21), Y(0.27));
  ctx.bezierCurveTo(X(0.35), Y(0.21), X(0.58), Y(0.21), X(0.73), Y(0.28));
  ctx.bezierCurveTo(X(0.73), Y(0.37), X(0.56), Y(0.42), X(0.37), Y(0.42));
  ctx.bezierCurveTo(X(0.27), Y(0.42), X(0.21), Y(0.36), X(0.21), Y(0.27));
  ctx.closePath();
}

// Clip context to the outer cavity outline then draw fn
function withCavityClip(ctx, sc, fn) {
  ctx.save();
  pathOuter(ctx, sc);
  ctx.clip();
  fn();
  ctx.restore();
}

// ── Region zone definitions (normalised x0,x1,y0,y1) ─────────────────────────
// These represent the approximate anatomical locations of each deposition region
// within the sagittal cavity silhouette, based on CT nasal cast reference.
const ZONES = {
  anterior:  { x0: 0.00, x1: 0.13, y0: 0.00, y1: 1.00 },
  front:     { x0: 0.10, x1: 0.26, y0: 0.00, y1: 1.00 },
  inferior:  { x0: 0.17, x1: 0.73, y0: 0.45, y1: 1.00 },
  middle:    { x0: 0.20, x1: 0.74, y0: 0.20, y1: 0.50 },
  olfactory: { x0: 0.18, x1: 0.56, y0: 0.00, y1: 0.20 },
  superior:  { x0: 0.45, x1: 0.88, y0: 0.00, y1: 0.20 },
  naso:      { x0: 0.80, x1: 1.00, y0: 0.00, y1: 1.00 },
};

function zoneRect(sc, z, W, H) {
  return [sc.X(z.x0), sc.Y(z.y0), sc.X(z.x1) - sc.X(z.x0), sc.Y(z.y1) - sc.Y(z.y0)];
}

// ── Particle system ──────────────────────────────────────────────────────────
// Particles follow a simplified trajectory through the cavity:
// horizontal drift (anterior→posterior) with angle/turbinate influence.

function spawnParticle(rand, inp, W, H, sc) {
  const { X, Y } = sc;
  const angleFrac = inp.angle / 80;
  // Nostril entry: y varies with insertion angle & depth
  const entryY = Y(0.38 + 0.30 * (1 - angleFrac) - 0.08 * (inp.depth / 20));
  const entryX = X(0.02);
  // Target x: spreads further with higher pressure
  const targetXn = 0.55 + 0.35 * clamp((inp.pressureBar - 8) / 10, 0, 1) + rand() * 0.15;
  // Target y: higher angle → higher y (superior target)
  const targetYn = 0.65 - 0.45 * angleFrac + rand() * 0.25;
  return {
    x: entryX, y: entryY,
    tx: X(targetXn), ty: Y(targetYn),
    r: 1.2 + rand() * 1.0,
    life: 0.3 + rand() * 0.7,
    alpha: 0.6 + rand() * 0.4,
  };
}

// ── Dark-mode aware stroke/fill colour ──────────────────────────────────────
const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";

// ── Draw helpers ─────────────────────────────────────────────────────────────
function drawCastShell(ctx, sc) {
  const dark = isDark();
  // Outer wall
  pathOuter(ctx, sc);
  ctx.fillStyle = dark ? "rgba(58,54,48,0.90)" : "rgba(220,215,205,0.90)";
  ctx.fill();
  ctx.strokeStyle = dark ? "rgba(160,155,145,0.70)" : "rgba(80,75,65,0.70)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Turbinates
  const turbFill = dark ? "rgba(72,68,60,0.95)" : "rgba(190,185,175,0.95)";
  const turbStroke = dark ? "rgba(140,135,125,0.80)" : "rgba(100,95,85,0.80)";
  [pathInfTurb, pathMidTurb].forEach(fn => {
    fn(ctx, sc);
    ctx.fillStyle = turbFill;
    ctx.fill();
    ctx.strokeStyle = turbStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawRegionOverlays(ctx, sc, m, alpha = 0.22) {
  withCavityClip(ctx, sc, () => {
    Object.keys(ZONES).forEach(key => {
      const z = ZONES[key];
      const { X, Y } = sc;
      ctx.fillStyle = rc(key, alpha * (m[key] / 26));
      ctx.fillRect(X(z.x0), Y(z.y0), X(z.x1) - X(z.x0), Y(z.y1) - Y(z.y0));
    });
  });
}

function drawSprayParticles(ctx, sc, inp, m, rand, prog) {
  const { X, Y } = sc;
  const n = Math.floor(inp.jets * 3.5 * prog);
  ctx.save();
  pathOuter(ctx, sc);
  ctx.clip();
  for (let i = 0; i < n; i++) {
    const p = spawnParticle(mulberry32(i * 7919 + (inp.deterministic ? 0 : rand() * 1e9 | 0)), inp, 0, 0, sc);
    const t = clamp(prog - (i / n) * 0.6, 0, 1);
    const px = p.x + (p.tx - p.x) * t;
    const py = p.y + (p.ty - p.y) * t;
    // Darken/lighten based on mode
    ctx.fillStyle = `rgba(120,200,240,${p.alpha * Math.min(t * 4, 1) * prog})`;
    ctx.beginPath();
    ctx.arc(px, py, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRegionLabels(ctx, sc, W, H) {
  const { X, Y } = sc;
  const dark = isDark();
  ctx.font = `bold ${Math.max(9, W * 0.013)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  const labels = [
    { key: "anterior",  lx: 0.06, ly: 0.50, text: "Ant" },
    { key: "front",     lx: 0.19, ly: 0.88, text: "Front" },
    { key: "inferior",  lx: 0.44, ly: 0.82, text: "Inf. turb." },
    { key: "middle",    lx: 0.46, ly: 0.30, text: "Mid. turb." },
    { key: "olfactory", lx: 0.36, ly: 0.11, text: "Olfactory" },
    { key: "superior",  lx: 0.66, ly: 0.11, text: "Superior" },
    { key: "naso",      lx: 0.90, ly: 0.62, text: "NP" },
  ];
  labels.forEach(({ key, lx, ly, text }) => {
    const [r, g, b] = RCOL[key];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillText(text, X(lx), Y(ly));
  });
}

// ── TAB: Cavity ──────────────────────────────────────────────────────────────
function drawCavity(ctx, W, H, inp, m) {
  const sc = makeSc(W, H);
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

