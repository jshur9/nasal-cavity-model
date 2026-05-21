import { clamp } from "./utils.js";
import { mulberry32 } from "./random.js";

// ─────────────────────────────────────────────────────────────────────────────
// Region colour palette (used for overlays + labels in both themes).
// ─────────────────────────────────────────────────────────────────────────────
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

const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";

// ─────────────────────────────────────────────────────────────────────────────
// Canvas resize
// ─────────────────────────────────────────────────────────────────────────────
export function resizeCanvas(canvas, ctx) {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = r.width  * dpr;
  canvas.height = r.height * dpr;
  canvas.style.width  = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cast geometry — SVG path-based, normalised to [0,1] × [0,1].
// Sagittal projection of the right nasal cavity. Anterior (nostril) at x=0,
// nasopharynx at x=1. Skull-base at y=0, nasal floor at y=1.
//
// All path strings use only M/L/C/Q/Z commands with explicit absolute (x,y)
// pairs so they can be scaled to pixel coordinates by a simple regex replace.
// See ASSUMPTIONS.md §1 for anatomical sources and simplifications.
// ─────────────────────────────────────────────────────────────────────────────
const CAST = {
  // Outer cavity outline (vestibule → skull base → posterior wall → floor → back)
  outer:
    "M 0.020 0.320 " +
    "C 0.040 0.140, 0.180 0.040, 0.360 0.040 " +
    "C 0.520 0.030, 0.640 0.070, 0.770 0.140 " +
    "C 0.880 0.200, 0.970 0.300, 1.000 0.440 " +
    "C 1.010 0.580, 1.000 0.720, 0.970 0.820 " +
    "C 0.880 0.900, 0.650 0.920, 0.400 0.920 " +
    "C 0.220 0.920, 0.100 0.900, 0.040 0.860 " +
    "C 0.020 0.780, 0.010 0.580, 0.020 0.450 " +
    "C 0.020 0.400, 0.020 0.350, 0.020 0.320 Z",

  // Septum (medial wall) — drawn as a faint gentle arc through the cavity
  // midline; visually distinguishes the two nasal passages on the projection.
  septum:
    "M 0.060 0.480 " +
    "C 0.220 0.460, 0.420 0.450, 0.620 0.460 " +
    "C 0.780 0.470, 0.880 0.500, 0.940 0.560",

  // Inferior turbinate — prominent shelf descending from lateral wall
  infTurb:
    "M 0.170 0.540 " +
    "C 0.300 0.480, 0.560 0.470, 0.720 0.540 " +
    "C 0.720 0.650, 0.550 0.720, 0.340 0.720 " +
    "C 0.240 0.720, 0.170 0.650, 0.170 0.540 Z",

  // Middle turbinate
  midTurb:
    "M 0.210 0.270 " +
    "C 0.350 0.210, 0.580 0.210, 0.730 0.280 " +
    "C 0.730 0.370, 0.560 0.420, 0.370 0.420 " +
    "C 0.270 0.420, 0.210 0.360, 0.210 0.270 Z",

  // Superior turbinate (small, above middle)
  supTurb:
    "M 0.460 0.130 " +
    "C 0.560 0.105, 0.680 0.115, 0.740 0.160 " +
    "C 0.720 0.200, 0.600 0.220, 0.500 0.210 " +
    "C 0.450 0.200, 0.440 0.160, 0.460 0.130 Z",

  // Inferior meatus separation line (beneath inferior turbinate)
  infMeatus:
    "M 0.180 0.745 C 0.340 0.785, 0.560 0.785, 0.710 0.745",

  // Middle meatus separation line (between inferior and middle turbinates)
  midMeatus:
    "M 0.220 0.450 C 0.360 0.460, 0.580 0.460, 0.720 0.450",

  // Choana / posterior opening to nasopharynx
  choana:
    "M 0.920 0.500 " +
    "C 0.985 0.500, 1.000 0.580, 0.980 0.680 " +
    "C 0.945 0.720, 0.905 0.680, 0.910 0.580 " +
    "C 0.910 0.540, 0.910 0.510, 0.920 0.500 Z",
};

// Map a normalised SVG path string to pixel coordinates via the scaler.
function scalePath(svg, sc) {
  return svg.replace(/(-?\d*\.?\d+)\s*[,\s]\s*(-?\d*\.?\d+)/g,
    (_, a, b) => `${sc.X(+a).toFixed(2)} ${sc.Y(+b).toFixed(2)}`);
}

// Build (and cache) a Path2D from a normalised cast path, keyed by scaler.
let _pathCacheKey = "";
let _pathCache = {};
function getCastPath(key, sc) {
  const k = `${sc.W}x${sc.H}`;
  if (k !== _pathCacheKey) { _pathCacheKey = k; _pathCache = {}; }
  if (!_pathCache[key]) _pathCache[key] = new Path2D(scalePath(CAST[key], sc));
  return _pathCache[key];
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinate scaler: maps normalised [0,1] cavity coords to canvas pixels
// with consistent margins.
// ─────────────────────────────────────────────────────────────────────────────
function makeSc(W, H) {
  const ml = 0.08, mr = 0.06, mt = 0.07, mb = 0.10;
  const cw = W * (1 - ml - mr), ch = H * (1 - mt - mb);
  const ox = W * ml, oy = H * mt;
  return {
    X: nx => ox + nx * cw,
    Y: ny => oy + ny * ch,
    W, H, ox, oy, cw, ch,
  };
}

// Region zone definitions (normalised cavity bounding boxes).
const ZONES = {
  anterior:  { x0: 0.00, x1: 0.13, y0: 0.00, y1: 1.00 },
  front:     { x0: 0.10, x1: 0.26, y0: 0.00, y1: 1.00 },
  inferior:  { x0: 0.17, x1: 0.73, y0: 0.45, y1: 1.00 },
  middle:    { x0: 0.20, x1: 0.74, y0: 0.20, y1: 0.50 },
  olfactory: { x0: 0.18, x1: 0.56, y0: 0.00, y1: 0.20 },
  superior:  { x0: 0.45, x1: 0.88, y0: 0.00, y1: 0.20 },
  naso:      { x0: 0.80, x1: 1.00, y0: 0.00, y1: 1.00 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Particle pool — single Float32Array, reused across frames.
// Fields per particle: [x, y, age, kind, size, alpha, _]
// Stored in normalised (cavity) coordinates so the pool is resolution-agnostic.
// ─────────────────────────────────────────────────────────────────────────────
const STRIDE = 7;
const MAX_PARTICLES = 1600;
const pool = new Float32Array(MAX_PARTICLES * STRIDE);
let poolActive = 0;

// Compute the plume's geometric anchor and direction in normalised coords.
function plumeAnchor(inp) {
  const angleFrac = clamp(inp.angle / 80, 0, 1);
  const depthN   = clamp(inp.depth / 20, 0, 1);
  // Nozzle origin: just inside the nostril, shifted slightly by depth.
  const nx0 = 0.040 + 0.060 * depthN;
  // Vertical entry: higher angle → aim more superior.
  const ny0 = clamp(0.420 + 0.200 * (1 - angleFrac) - 0.040 * depthN, 0.18, 0.78);
  // Aim direction: 0° → horizontal toward posterior; 80° → mostly upward.
  // Head tilt nudges aim a few degrees.
  const tiltRad = clamp((inp.headTilt || 0) * Math.PI / 180 * 0.3, -0.2, 0.2);
  const aim = (inp.angle * Math.PI / 180) * 0.85 - tiltRad;
  return { nx0, ny0, aim };
}

// Fill the pool from a deterministic seed.
function fillPool(inp, m, prog, seed) {
  const rand0 = mulberry32(seed);
  const { nx0, ny0, aim } = plumeAnchor(inp);

  // Cone half-angle responds to pressure, dv50, and the model plumeAngle:
  //   higher pressure → tighter
  //   larger dv50    → narrower jet (larger inertia)
  //   model plumeAngle is the master scale.
  const halfAngle0 = (m.plumeAngle * Math.PI) / 360;
  const dv50 = m.dv50 || 5;
  const pressBar = inp.pressureBar || 8;
  const widenScale = clamp(
    (1 - 0.03 * (pressBar - 8)) / (1 + 0.06 * (dv50 - 4)),
    0.55, 1.45
  );
  const halfAngle = halfAngle0 * widenScale;

  // Speed scaling — particles cross the cavity in ~55% of spray duration.
  const distNorm = 0.90;
  const travelTime = Math.max(60, m.durationMs * 0.55);
  const baseSpeed = distNorm / travelTime; // norm-units per ms

  // Drag decay per ms — derived from model dragRatio (Eq. 20).
  const dragK = clamp(Math.log10(Math.max(m.dragRatio, 10)) * 0.0022, 0.001, 0.018);
  // Tiny ballistic gravity in normalised cavity space.
  const gravity = 1.2e-6;

  // Particle count scales with jets and progress, capped at MAX_PARTICLES.
  const target = Math.floor(Math.min(MAX_PARTICLES, inp.jets * 10 * (0.35 + 0.65 * prog)));
  poolActive = target;

  // Use a single PRNG with stable advance per particle to avoid GC pressure.
  // For non-deterministic mode we re-seed each frame from time but particle
  // ordering remains stable within a frame.
  const r = rand0;

  for (let i = 0; i < target; i++) {
    const u1 = r(), u2 = r(), u3 = r(), u4 = r(), u5 = r();
    const off = i * STRIDE;

    // 70% high-density core, 30% outer mist
    const kind = u1 < 0.70 ? 0 : 1;

    // Emission time staggered across the active spray duration so the plume
    // grows from the nozzle outward and tail decays at the end.
    const tEmit = u2 * m.durationMs * 0.88;
    const age   = inp.tMs - tEmit;
    if (age < 0 || age > m.durationMs * 1.1) {
      // Inactive: park offscreen so the draw loop can skip cheaply.
      pool[off + 0] = -9999;
      pool[off + 1] = -9999;
      pool[off + 2] = 0;
      pool[off + 3] = 0;
      pool[off + 4] = 0;
      pool[off + 5] = 0;
      pool[off + 6] = 0;
      continue;
    }

    // Initial direction within the cone.
    //   Core → tight, biased to axis
    //   Mist → wide, biased to outer edge
    let angOff;
    if (kind === 0) {
      // Triangular distribution centred on axis: u4*u3 keeps mass near 0.
      const t = (u4 - 0.5) * 2 * Math.sqrt(u3);
      angOff = halfAngle * 0.55 * t;
    } else {
      // Outer mist: square-rooted radius for uniform area at the edge.
      const t = (u4 - 0.5) * 2;
      angOff = halfAngle * (0.55 + 0.45 * Math.sqrt(u3)) * t;
    }
    const dir = aim + angOff;
    const cs = Math.cos(dir);
    const sn = -Math.sin(dir); // canvas Y is inverted

    // Per-particle speed: core slightly faster than mist.
    const speed = baseSpeed * (kind === 0 ? 0.95 + 0.20 * u5 : 0.65 + 0.35 * u5);

    // Analytic ballistic + linear-drag solution:
    //   x(t) = x0 + v0 * (1 - e^{-k t}) / k
    //   y(t) = y0 + v0y * (1 - e^{-k t}) / k + ½ g t²
    const k = dragK;
    const decay = (1 - Math.exp(-k * age)) / k;
    let nx = nx0 + cs * speed * decay;
    let ny = ny0 + sn * speed * decay + 0.5 * gravity * age * age;

    // Defensive: guard against any NaN/Inf propagation.
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      nx = nx0; ny = ny0;
    }

    // Cone-distance-dependent rendering size:
    //   Near nozzle → smaller, dense core; downstream → grows, becomes mist.
    const distAxis = Math.min(1, Math.hypot(nx - nx0, ny - ny0) / distNorm);
    const sizeBase = kind === 0
      ? 0.85 + dv50 / 28        // ~0.85..1.3
      : 0.55 + dv50 / 36;       // ~0.55..0.95
    const size = sizeBase * (0.65 + 0.55 * distAxis) * (0.85 + 0.30 * u5);

    // Alpha: brighter close to nozzle, fades along trajectory and over age.
    const ageFrac = clamp(age / m.durationMs, 0, 1);
    const alphaBase = kind === 0 ? 0.78 : 0.40;
    const alpha = alphaBase * (1 - 0.55 * distAxis) * (1 - 0.50 * ageFrac);

    pool[off + 0] = nx;
    pool[off + 1] = ny;
    pool[off + 2] = age;
    pool[off + 3] = kind;
    pool[off + 4] = size;
    pool[off + 5] = clamp(alpha, 0, 1);
    pool[off + 6] = distAxis;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cast drawing
// ─────────────────────────────────────────────────────────────────────────────
function drawCast(ctx, sc, opts = {}) {
  const dark = isDark();
  const { showTurbinates = true, showDetail = true, dim = false } = opts;

  const wallFill   = dark ? "rgba(58,54,48,0.92)"  : "rgba(220,215,205,0.94)";
  const wallStroke = dark ? "rgba(170,164,152,0.78)" : "rgba(70,66,58,0.78)";
  const turbFill   = dark ? "rgba(74,70,62,0.95)"  : "rgba(190,185,175,0.96)";
  const turbStroke = dark ? "rgba(150,144,132,0.85)" : "rgba(95,90,80,0.85)";
  const detail     = dark ? "rgba(180,176,164,0.55)" : "rgba(80,75,65,0.55)";
  const septum     = dark ? "rgba(190,184,170,0.35)" : "rgba(80,75,65,0.30)";

  // Outer shell
  const outer = getCastPath("outer", sc);
  ctx.fillStyle = wallFill;
  ctx.fill(outer);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = wallStroke;
  ctx.stroke(outer);

  if (showDetail) {
    // Septum (faint medial contour)
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = septum;
    ctx.setLineDash([3, 3]);
    ctx.stroke(getCastPath("septum", sc));
    ctx.setLineDash([]);
  }

  if (showTurbinates) {
    ["infTurb", "midTurb", "supTurb"].forEach(key => {
      const p = getCastPath(key, sc);
      ctx.fillStyle = turbFill;
      ctx.fill(p);
      ctx.lineWidth = 1;
      ctx.strokeStyle = turbStroke;
      ctx.stroke(p);
    });
  }

  if (showDetail) {
    // Meatus separation lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = detail;
    ctx.stroke(getCastPath("infMeatus", sc));
    ctx.stroke(getCastPath("midMeatus", sc));

    // Choana / posterior opening
    ctx.fillStyle = dark ? "rgba(20,18,16,0.55)" : "rgba(160,154,142,0.55)";
    ctx.fill(getCastPath("choana", sc));
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = turbStroke;
    ctx.stroke(getCastPath("choana", sc));
  }

  if (dim) {
    ctx.fillStyle = dark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.25)";
    ctx.fill(outer);
  }
}

function clipToCavity(ctx, sc, fn) {
  ctx.save();
  ctx.clip(getCastPath("outer", sc));
  fn();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Region overlays and labels
// ─────────────────────────────────────────────────────────────────────────────
function drawRegionOverlays(ctx, sc, m, alpha = 0.22) {
  clipToCavity(ctx, sc, () => {
    Object.keys(ZONES).forEach(key => {
      const z = ZONES[key];
      const v = Number.isFinite(m[key]) ? m[key] : 0;
      ctx.fillStyle = rc(key, clamp(alpha * (v / 26), 0, 0.9));
      ctx.fillRect(sc.X(z.x0), sc.Y(z.y0), sc.X(z.x1) - sc.X(z.x0), sc.Y(z.y1) - sc.Y(z.y0));
    });
  });
}

function drawRegionLabels(ctx, sc) {
  const { X, Y, W } = sc;
  ctx.font = `bold ${Math.max(10, W * 0.013)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels = [
    { key: "anterior",  lx: 0.06, ly: 0.50, text: "Ant" },
    { key: "front",     lx: 0.19, ly: 0.88, text: "Front" },
    { key: "inferior",  lx: 0.44, ly: 0.62, text: "Inf. turb." },
    { key: "middle",    lx: 0.46, ly: 0.32, text: "Mid. turb." },
    { key: "olfactory", lx: 0.36, ly: 0.11, text: "Olfactory" },
    { key: "superior",  lx: 0.66, ly: 0.16, text: "Sup. turb." },
    { key: "naso",      lx: 0.91, ly: 0.78, text: "NP" },
  ];
  const dark = isDark();
  labels.forEach(({ key, lx, ly, text }) => {
    const [r, g, b] = RCOL[key];
    // Halo for readability across both themes.
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = dark ? "rgba(10,10,10,0.85)" : "rgba(255,255,255,0.90)";
    ctx.strokeText(text, X(lx), Y(ly));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillText(text, X(lx), Y(ly));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Nozzle stub
// ─────────────────────────────────────────────────────────────────────────────
function drawNozzle(ctx, sc, inp) {
  const { X, Y } = sc;
  const { nx0, ny0, aim } = plumeAnchor(inp);
  const tipX = X(nx0), tipY = Y(ny0);
  const len = Math.max(28, sc.cw * 0.045);
  const bx  = tipX - Math.cos(aim) * len;
  const by  = tipY + Math.sin(aim) * len;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = isDark() ? "rgba(220,238,248,0.75)" : "rgba(30,40,50,0.75)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // Tip highlight
  ctx.fillStyle = isDark() ? "rgba(240,250,255,0.85)" : "rgba(20,30,40,0.85)";
  ctx.beginPath();
  ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Plume rendering (uses the pool, in normalised coords).
// ─────────────────────────────────────────────────────────────────────────────
function drawPlume(ctx, sc, inp, m, prog, opts = {}) {
  const { heat = false } = opts;
  const { X, Y } = sc;

  // Seed depends on tMs for determinism and on Date.now() otherwise.
  const seed = inp.deterministic
    ? ((inp.tMs | 0) * 1009 + Math.round(m.plumeAngle * 13) + Math.round(m.dv50 * 7))
    : (Date.now() & 0x7fffffff);
  fillPool(inp, m, prog, seed);

  // Faint cone envelope to give shape continuity.
  const { nx0, ny0, aim } = plumeAnchor(inp);
  const halfAngleRad = (m.plumeAngle * Math.PI) / 360;
  const dv50 = m.dv50 || 5;
  const widenScale = clamp(
    (1 - 0.045 * ((inp.pressureBar || 8) - 8)) / (1 + 0.08 * (dv50 - 4)),
    0.45, 1.20);
  const ha = halfAngleRad * widenScale;
  const coneLen = 0.78;

  ctx.save();
  ctx.clip(getCastPath("outer", sc));

  // Cone gradient envelope (skip on heatmap mode)
  if (!heat && prog > 0.02) {
    const tipX = X(nx0), tipY = Y(ny0);
    const farX = X(nx0 + Math.cos(aim) * coneLen);
    const farY = Y(ny0 - Math.sin(aim) * coneLen);
    const upperX = X(nx0 + Math.cos(aim + ha) * coneLen);
    const upperY = Y(ny0 - Math.sin(aim + ha) * coneLen);
    const lowerX = X(nx0 + Math.cos(aim - ha) * coneLen);
    const lowerY = Y(ny0 - Math.sin(aim - ha) * coneLen);
    const grad = ctx.createLinearGradient(tipX, tipY, farX, farY);
    grad.addColorStop(0.0, "rgba(156,214,235,0.20)");
    grad.addColorStop(1.0, "rgba(156,214,235,0.02)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(upperX, upperY);
    ctx.lineTo(lowerX, lowerY);
    ctx.closePath();
    ctx.fill();
  }

  // Draw particles. We avoid per-particle ctx.save/restore. We sort visually
  // by drawing mist first, then core, by doing two passes over the pool.
  ctx.globalCompositeOperation = heat ? "lighter" : "source-over";

  for (let pass = 0; pass < 2; pass++) {
    const wantKind = pass === 0 ? 1 : 0; // mist first, then core on top
    for (let i = 0; i < poolActive; i++) {
      const off = i * STRIDE;
      const x = pool[off + 0];
      if (x === -9999) continue;
      const k = pool[off + 3];
      if ((k | 0) !== wantKind) continue;
      const y = pool[off + 1];
      const size = pool[off + 4];
      const alpha = pool[off + 5];
      const distAxis = pool[off + 6];

      const px = X(x), py = Y(y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

      if (heat) {
        // Heatmap colouring — bluer near nozzle, hotter downstream.
        const hot = distAxis;
        const r = Math.round(60 + 195 * hot);
        const g = Math.round(180 - 60 * hot);
        const b = Math.round(220 - 180 * hot);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.55})`;
      } else if (k === 0) {
        // Core: warm-white near nozzle, cool cyan farther out.
        const t = distAxis;
        const r = Math.round(220 - 60 * t);
        const g = Math.round(238 - 38 * t);
        const b = Math.round(245 - 5 * t);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      } else {
        // Mist: cool diffuse blue
        ctx.fillStyle = `rgba(167,220,240,${alpha *0.72})`;
      }

      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab renderers
// ─────────────────────────────────────────────────────────────────────────────
function drawCavityTab(ctx, sc, inp, m, prog) {
  drawCast(ctx, sc, { showTurbinates: true, showDetail: true });
  drawRegionOverlays(ctx, sc, m, 0.18);
  drawPlume(ctx, sc, inp, m, prog);
  drawNozzle(ctx, sc, inp);
  drawRegionLabels(ctx, sc);
}

function drawHeatmapTab(ctx, sc, inp, m, prog) {
  drawCast(ctx, sc, { showTurbinates: true, showDetail: true, dim: true });
  // Strong region overlays (heatmap is the headline)
  drawRegionOverlays(ctx, sc, m, 0.55);
  // Light plume in additive mode for context.
  drawPlume(ctx, sc, inp, m, prog * 0.5, { heat: true });
  drawNozzle(ctx, sc, inp);
  drawRegionLabels(ctx, sc);
}

function drawPlumeTab(ctx, sc, inp, m, prog) {
  // Plume-focused: keep the cast as faint reference, hide region overlays.
  drawCast(ctx, sc, { showTurbinates: true, showDetail: true, dim: true });
  drawPlume(ctx, sc, inp, m, prog);
  drawNozzle(ctx, sc, inp);
}

function drawSweepTab(ctx, sc, inp, m, prog) {
  // Show multiple angles to visualise the nozzle sweep envelope.
  drawCast(ctx, sc, { showTurbinates: true, showDetail: true });
  const baseAngle = inp.angle;
  const sweepN = 5;
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let s = 0; s < sweepN; s++) {
    const a = baseAngle + (s - (sweepN - 1) / 2) * 8;
    const inp2 = { ...inp, angle: clamp(a, 0, 80) };
    drawPlume(ctx, sc, inp2, m, prog);
  }
  ctx.restore();
  drawNozzle(ctx, sc, inp);
  drawRegionLabels(ctx, sc);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────
export function draw(canvas, ctx, inp, m, activeTab = "cavity") {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;

  // Clear
  const dark = isDark();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = dark ? "rgba(20,19,17,1)" : "rgba(247,246,242,1)";
  ctx.fillRect(0, 0, W, H);

  // Defensive — guard against bad model outputs.
  const safeM = {
    dv50:      Number.isFinite(m.dv50)      ? m.dv50      : 5,
    plumeAngle:Number.isFinite(m.plumeAngle)? m.plumeAngle: 17,
    durationMs:Number.isFinite(m.durationMs)? m.durationMs: 180,
    jetVelocity:Number.isFinite(m.jetVelocity)? m.jetVelocity: 1,
    dragRatio: Number.isFinite(m.dragRatio) ? m.dragRatio : 1e4,
    anterior:  m.anterior  || 0,
    front:     m.front     || 0,
    inferior:  m.inferior  || 0,
    middle:    m.middle    || 0,
    olfactory: m.olfactory || 0,
    superior:  m.superior  || 0,
    naso:      m.naso      || 0,
  };

  const sc = makeSc(W, H);
  const prog = clamp((inp.tMs || 0) / safeM.durationMs, 0, 1);

  const mode = activeTab || inp.viewMode || "cavity";
  switch (mode) {
    case "heatmap": drawHeatmapTab(ctx, sc, inp, safeM, prog); break;
    case "plume":   drawPlumeTab(ctx, sc, inp, safeM, prog);   break;
    case "sweep":   drawSweepTab(ctx, sc, inp, safeM, prog);   break;
    case "cavity":
    default:        drawCavityTab(ctx, sc, inp, safeM, prog);  break;
  }
}
