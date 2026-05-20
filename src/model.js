import { clamp } from "./utils.js";

export const presets = [
  { name: "Resyca 40-like olfactory-leaning", dNoz: 12, pressure: 8.0, mu: 1.1, sigma: 72, rho: 1000, jets: 120, dose: 40, mech: 1.0, angle: 32, depth: 6, headTilt: 8, breathing: "gentle" }
];

export const regionDefs = [
  { key: "anterior", label: "Anterior" }, { key: "front", label: "Front" }, { key: "inferior", label: "Inferior turbinate" },
  { key: "middle", label: "Middle turbinate" }, { key: "olfactory", label: "Olfactory" }, { key: "superior", label: "Superior residual" }, { key: "naso", label: "Nasopharynx-C1" }
];

export function model(inp) {
  const D = inp.dNozUm * 1e-6, mu = inp.muMpas / 1000, sigma = inp.sigmaMnm / 1000, Cd = 0.17;
  const vJet = Cd * Math.sqrt((2 * inp.pressureBar * 1e5) / inp.rho);
  const We = (inp.rho * vJet * vJet * D) / sigma;
  const Oh = mu / Math.sqrt(inp.rho * sigma * D);
  const primaryDropUm = 1.95 * inp.dNozUm;
  const rayleighScore = We >= 0.4 && We <= 8 && Oh < 0.9 ? "Likely Rayleigh" : We <= 15 ? "Transition" : "Outside window";
  const dv50 = clamp(26.4 + 0.5 * clamp((inp.dNozUm - 10) / 8, 0, 1), 26.4, 27.5);
  const span = clamp(1.38 - 0.2 * clamp((inp.dNozUm - 10) / 8, 0, 1), 1.0, 1.4);
  const durationMs = clamp(100 + 2.2 * inp.doseUl * inp.mech, 90, 320);
  return { dv50, span, plumeAngle: 16.4, jetVelocity: clamp(vJet, 1.05, 1.24), durationMs, frontLoadingIndex: 0.55, rayleighScore, primaryDropUm, anterior: 13, front: 26, inferior: 16, middle: 19, olfactory: 10, superior: 9, naso: 7 };
}
