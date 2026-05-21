import { clamp } from "./utils.js";

export const presets = [
  { name: "Resyca 40-like olfactory-leaning", dNoz: 12, pressure: 8.0, mu: 1.1, sigma: 72, rho: 1000, jets: 120, dose: 40, mech: 1.0, angle: 32, depth: 6, headTilt: 8, breathing: "gentle" }
];

export const regionDefs = [
  { key: "anterior", label: "Anterior" }, { key: "front", label: "Front" }, { key: "inferior", label: "Inferior turbinate" },
  { key: "middle", label: "Middle turbinate" }, { key: "olfactory", label: "Olfactory" }, { key: "superior", label: "Superior residual" }, { key: "naso", label: "Nasopharynx-C1" }
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function safe(x, fallback) {
  return Number.isFinite(x) ? x : fallback;
}

function pressureCalibratedValue(pressureBar, v10, v12, v14, slopeLow, slopeHigh) {
  if (pressureBar <= 10) return v10 + slopeLow * (pressureBar - 10);
  if (pressureBar <= 12) return lerp(v10, v12, (pressureBar - 10) / 2);
  if (pressureBar <= 14) return lerp(v12, v14, (pressureBar - 12) / 2);
  return v14 + slopeHigh * (pressureBar - 14);
}

function normalizeRegions(parts) {
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  const safeTotal = total > 0 ? total : 1;
  return Object.fromEntries(
    Object.entries(parts).map(([k, v]) => [k, clamp((v / safeTotal) * 100, 0, 100)])
  );
}

export function model(inp) {
  const D = safe(inp.dNozUm, 12) * 1e-6;
  const mu = safe(inp.muMpas, 1.1) / 1000;
  const sigma = Math.max(safe(inp.sigmaMnm, 72) / 1000, 1e-6);
  const rho = Math.max(safe(inp.rho, 1000), 1);
  const pressureBar = clamp(safe(inp.pressureBar, 10), 2, 20);
  const Cd = 0.17;
  const vJet = Cd * Math.sqrt((2 * pressureBar * 1e5) / rho);
  const We = (rho * vJet * vJet * D) / sigma;
  const Oh = mu / Math.sqrt(rho * sigma * Math.max(D, 1e-9));

  const rayleighRegime = We >= 0.4 && We <= 8 && Oh < 0.9 ? "Rayleigh" : We <= 15 ? "Transition" : "Atomization-like";
  const regimeFactor = rayleighRegime === "Rayleigh" ? 1 : rayleighRegime === "Transition" ? 0.96 : 0.92;

  // Outlet size trends are calibrated to the paper table (10/12/14 bar), then smoothly extrapolated.
  const d10Base = pressureCalibratedValue(pressureBar, 3.88, 3.87, 3.89, -0.02, 0.01);
  const dv50Base = pressureCalibratedValue(pressureBar, 4.79, 4.27, 4.27, -0.26, -0.03);
  const d90Base = pressureCalibratedValue(pressureBar, 6.58, 5.57, 5.52, -0.505, -0.03);
  const spanBase = pressureCalibratedValue(pressureBar, 0.56, 0.40, 0.38, -0.08, -0.01);

  const nozzleDelta = clamp((safe(inp.dNozUm, 12) - 12) / 12, -0.5, 1.5);
  const nozzleSizeFactor = 1 + 0.12 * nozzleDelta;
  const spanNozzleFactor = 1 + 0.18 * nozzleDelta;

  const d10 = clamp(d10Base * nozzleSizeFactor * regimeFactor, 2.5, 8.5);
  const dv50 = clamp(dv50Base * nozzleSizeFactor * regimeFactor, d10 + 0.2, 12);
  const d90 = clamp(d90Base * nozzleSizeFactor * regimeFactor, dv50 + 0.3, 20);
  const span = clamp((d90 - d10) / Math.max(dv50, 1e-6), 0.25, Math.max(spanBase * spanNozzleFactor, 0.26));

  const coalescenceIndex = clamp(
    0.62 - 0.03 * (pressureBar - 10) - 0.12 * nozzleDelta + 0.08 * clamp((Oh - 0.1) / 0.5, 0, 1),
    0.12,
    0.85
  );
  const secondaryPeakFraction = clamp(0.28 - 0.07 * (pressureBar - 10) / 4 - 0.06 * nozzleDelta, 0.06, 0.36);

  const primaryDropUm = clamp(safe(inp.dNozUm, 12) * (1.78 - 0.035 * (pressureBar - 10)), 5, 45);
  const plumeAngle = clamp(17.4 - 0.25 * (pressureBar - 10) + 0.6 * clamp(secondaryPeakFraction - 0.15, -0.15, 0.2), 10, 22);
  const durationMs = clamp(100 + 2.2 * safe(inp.doseUl, 40) * safe(inp.mech, 1), 90, 320);

  const breathingWeight = inp.breathing === "vigorous" ? 1.12 : inp.breathing === "gentle" ? 0.95 : 1;
  const angleWeight = clamp(1 - Math.abs(safe(inp.angle, 32) - 32) / 70, 0.7, 1.05);
  const depthWeight = clamp(0.85 + safe(inp.depth, 6) / 35, 0.75, 1.25);
  const frontBias = clamp(0.42 + 0.3 * coalescenceIndex, 0.2, 0.72);
  const deepBias = clamp(0.35 + 0.25 * (1 - coalescenceIndex), 0.2, 0.65) * breathingWeight * angleWeight * depthWeight;

  const regions = normalizeRegions({
    anterior: 15 + 16 * frontBias,
    front: 20 + 21 * frontBias,
    inferior: 13 + 4 * deepBias,
    middle: 15 + 7 * deepBias,
    olfactory: 6 + 9 * deepBias * clamp((safe(inp.headTilt, 8) + 20) / 50, 0.5, 1.15),
    superior: 9 + 5 * deepBias,
    naso: 6 + 8 * deepBias
  });

  const frontLoadingIndex = clamp((regions.anterior + regions.front) / 100, 0.15, 0.9);

  return {
    d10,
    dv50,
    d90,
    span,
    plumeAngle,
    jetVelocity: clamp(vJet, 0.6, 2.2),
    durationMs,
    frontLoadingIndex,
    rayleighScore: rayleighRegime,
    primaryDropUm,
    coalescenceIndex,
    secondaryPeakFraction,
    ...regions
  };
}
