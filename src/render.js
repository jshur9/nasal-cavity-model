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
  const prog  = clamp(inp.tMs / m.durationMs, 0, 1);

  drawCastShell(ctx, sc);
  drawRegionOverlays(ctx, sc, m, 0.28);
  drawSprayParticles(ctx, sc, inp, m, rand, prog);
  drawRegionLabels(ctx, sc, W, H);

  // Nozzle indicator at nostril
  const { X, Y } = sc;
  ctx.save();
  ctx.translate(X(0.00), Y(0.38 + 0.25 * (1 - inp.angle / 80)));
  ctx.rotate((-inp.angle * Math.PI) / 180 + Math.PI / 2);
  ctx.fillStyle = isDark() ? "rgba(79,152,163,0.90)" : "rgba(1,105,111,0.90)";
  ctx.fillRect(-3, -10, 6, 10);
  ctx.restore();
}

// ── TAB: Heatmap ─────────────────────────────────────────────────────────────
function drawHeatmap(ctx, W, H, inp, m) {
  const sc = makeSc(W, H);
  const { X, Y } = sc;
  const maxDep = Math.max(...Object.keys(ZONES).map(k => m[k]));

  // Solid-filled region zones, intensity ∝ deposition %
  withCavityClip(ctx, sc, () => {
    // Background fill (canvas rect clipped to cavity outline)
    ctx.fillStyle = isDark() ? "#1b1a18" : "#f0ede7";
    ctx.fillRect(0, 0, W, H);

    Object.keys(ZONES).forEach(key => {
      const z = ZONES[key];
      const t = m[key] / maxDep;
      // Heat: low → cool blue, high → warm red
      const r2 = Math.round(30  + 200 * t);
      const g2 = Math.round(80  + 40  * (1 - Math.abs(t - 0.5) * 2));
      const b2 = Math.round(200 - 170 * t);
      ctx.fillStyle = `rgba(${r2},${g2},${b2},0.72)`;
      ctx.fillRect(X(z.x0), Y(z.y0), X(z.x1) - X(z.x0), Y(z.y1) - Y(z.y0));
    });
  });

  drawCastShell(ctx, sc);

  // Deposition percentage labels inside zones
  ctx.font = `bold ${Math.max(8, W * 0.011)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  const labPos = [
    { key: "anterior",  lx: 0.06, ly: 0.50 },
    { key: "front",     lx: 0.19, ly: 0.80 },
    { key: "inferior",  lx: 0.44, ly: 0.80 },
    { key: "middle",    lx: 0.47, ly: 0.32 },
    { key: "olfactory", lx: 0.36, ly: 0.12 },
    { key: "superior",  lx: 0.66, ly: 0.12 },
    { key: "naso",      lx: 0.90, ly: 0.62 },
  ];
  labPos.forEach(({ key, lx, ly }) => {
    ctx.fillStyle = isDark() ? "#e8e4de" : "#1a1814";
    ctx.fillText(`${m[key].toFixed(1)}%`, X(lx), Y(ly));
  });

  // Colour scale legend
  const lw = W * 0.12, lh = 10, lx = W * 0.84, ly = H * 0.88;
  const grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
  grad.addColorStop(0, "rgba(30,80,200,0.8)");
  grad.addColorStop(1, "rgba(230,80,30,0.8)");
  ctx.fillStyle = grad;
  ctx.fillRect(lx, ly, lw, lh);
  ctx.font = `${Math.max(8, W * 0.010)}px Inter, sans-serif`;
  ctx.fillStyle = isDark() ? "#d8d4ce" : "#27241d";
  ctx.textAlign = "left";  ctx.fillText("Low", lx, ly + lh + 12);
  ctx.textAlign = "right"; ctx.fillText("High", lx + lw, ly + lh + 12);
}

// ── TAB: Plume ───────────────────────────────────────────────────────────────
function drawPlume(ctx, W, H, inp, m) {
  const cx = W * 0.20, cy = H * 0.55;
  const halfAngle = (m.plumeAngle / 2) * (Math.PI / 180);
  const plumeLen  = W * 0.62;

  // Plume cone
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + plumeLen * Math.cos(-halfAngle), cy + plumeLen * Math.sin(-halfAngle));
  ctx.arc(cx + plumeLen, cy, plumeLen * Math.sin(halfAngle), -Math.PI / 2 + halfAngle, Math.PI / 2 - halfAngle, true);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  const pg = ctx.createLinearGradient(cx, cy, cx + plumeLen, cy);
  pg.addColorStop(0, "rgba(79,152,163,0.80)");
  pg.addColorStop(0.5, "rgba(120,200,240,0.35)");
  pg.addColorStop(1, "rgba(120,200,240,0.05)");
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.restore();

  // Droplet size distribution overlay (simplified log-normal bar)
  const bx = W * 0.55, by = H * 0.72, bw = W * 0.32, bh = H * 0.18;
  ctx.fillStyle = isDark() ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  ctx.fillRect(bx, by, bw, bh);
  const steps = 30;
  const dv50  = m.dv50, dv10 = dv50 * (1 - m.span * 0.6), dv90 = dv50 * (1 + m.span * 0.6);
  for (let i = 0; i < steps; i++) {
    const d = dv10 + (dv90 - dv10) * (i / steps);
    const logN = Math.exp(-0.5 * Math.pow((Math.log(d) - Math.log(dv50)) / 0.35, 2));
    ctx.fillStyle = "rgba(79,152,163,0.60)";
    ctx.fillRect(bx + (i / steps) * bw, by + bh * (1 - logN), bw / steps - 1, bh * logN);
  }
  ctx.font = `${Math.max(9, W * 0.012)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = isDark() ? "#d8d4ce" : "#27241d";
  ctx.fillText(`Dv50 = ${dv50.toFixed(2)} µm   Span = ${m.span.toFixed(2)}`, bx + bw / 2, by - 8);
  ctx.fillText(`Plume angle: ${m.plumeAngle.toFixed(1)}°`, cx + plumeLen * 0.4, cy - plumeLen * Math.tan(halfAngle) - 10);

  // Nozzle rectangle
  ctx.fillStyle = isDark() ? "rgba(79,152,163,0.90)" : "rgba(1,105,111,0.90)";
  ctx.fillRect(cx - 6, cy - 14, 12, 18);
}

// ── TAB: Sweep ───────────────────────────────────────────────────────────────
function drawSweep(ctx, W, H, inp, m) {
  const keys   = ["anterior", "front", "inferior", "middle", "olfactory", "superior", "naso"];
  const labels = ["Ant.", "Front", "Inf.T.", "Mid.T.", "Olfact.", "Sup.", "NP"];
  const n = keys.length;
  const padL = W * 0.10, padR = W * 0.06;
  const padT = H * 0.12, padB = H * 0.18;
  const bw = (W - padL - padR) / n;
  const maxH = H - padT - padB;
  const maxVal = 35; // y-axis cap

  // Grid
  ctx.strokeStyle = isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  [0, 10, 20, 30].forEach(v => {
    const gy = padT + maxH * (1 - v / maxVal);
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    ctx.font = `${Math.max(8, W * 0.010)}px Inter, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillStyle = isDark() ? "#98948b" : "#6d6a63";
    ctx.fillText(`${v}%`, padL - 4, gy + 4);
  });

  // Bars
  keys.forEach((key, i) => {
    const val  = m[key];
    const barH = (val / maxVal) * maxH;
    const bx   = padL + i * bw + bw * 0.15;
    const by   = padT + maxH - barH;
    const [r, g, b] = RCOL[key];
    ctx.fillStyle = `rgba(${r},${g},${b},0.75)`;
    ctx.fillRect(bx, by, bw * 0.70, barH);
    ctx.font = `bold ${Math.max(8, W * 0.011)}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = isDark() ? "#d8d4ce" : "#27241d";
    ctx.fillText(`${val.toFixed(1)}%`, bx + bw * 0.35, by - 4);
    ctx.font = `${Math.max(8, W * 0.010)}px Inter, sans-serif`;
    ctx.fillStyle = isDark() ? "#98948b" : "#6d6a63";
    ctx.fillText(labels[i], bx + bw * 0.35, padT + maxH + 16);
  });

  ctx.font = `bold ${Math.max(10, W * 0.013)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = isDark() ? "#d8d4ce" : "#27241d";
  ctx.fillText(`Deposition sweep – angle ${inp.angle}° | pressure ${inp.pressureBar} bar`, W / 2, padT - 14);
}

// ── Main draw entry point ────────────────────────────────────────────────────
export function draw(canvas, ctx, inp, m, tab = "cavity") {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.clearRect(0, 0, W, H);
  switch (tab) {
    case "heatmap": drawHeatmap(ctx, W, H, inp, m); break;
    case "plume":   drawPlume(ctx, W, H, inp, m);   break;
    case "sweep":   drawSweep(ctx, W, H, inp, m);   break;
    default:        drawCavity(ctx, W, H, inp, m);
  }
}

