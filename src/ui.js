import { num, clamp } from "./utils.js";
import { model, regionDefs } from "./model.js";

export function initUI(els) {
  regionDefs.forEach(r => {
    const div = document.createElement("div");
    div.className = "region";
    div.innerHTML = `<div>${r.label}</div><div class="bar"><div class="fill" id="fill-${r.key}" style="width:0%"></div></div><div id="pct-${r.key}">0%</div>`;
    els.regions.appendChild(div);
  });
}

export function getInputs(els) {
  return {
    dNozUm: clamp(num(els.dNoz.value, 12), 5, 30),
    pressureBar: clamp(num(els.pressure.value, 8), 2, 20),
    muMpas: clamp(num(els.mu.value, 1.1), 0.5, 10),
    sigmaMnm: clamp(num(els.sigma.value, 72), 20, 80),
    rho: clamp(num(els.rho.value, 1000), 800, 1300),
    jets: clamp(num(els.jets.value, 120), 10, 300),
    doseUl: clamp(num(els.dose.value, 40), 10, 150),
    mech: clamp(num(els.mech.value, 1), 0.2, 3),
    angle: clamp(num(els.angle.value, 32), 0, 80),
    depth: clamp(num(els.depth.value, 6), 0, 20),
    headTilt: clamp(num(els.headTilt.value, 8), -20, 30),
    breathing: els.breathing.value,
    tMs: clamp(num(els.time.value, 0), 0, 500),
    deterministic: els.deterministic.checked
  };
}

export function updateOutputs(els, inp) {
  const m = model(inp);
  els.dv50.textContent = `${m.dv50.toFixed(2)} µm`;
  els.span.textContent = m.span.toFixed(2);
  els.plumeAngle.textContent = `${m.plumeAngle.toFixed(1)}°`;
  els.jetVel.textContent = `${m.jetVelocity.toFixed(2)} m/s`;
  els.duration.textContent = `${m.durationMs.toFixed(0)} ms`;
  els.frontLoad.textContent = m.frontLoadingIndex.toFixed(2);
  els.rayleighRegime.textContent = m.rayleighScore;
  els.primaryDrop.textContent = `${m.primaryDropUm.toFixed(1)} µm`;
  els.time.max = Math.ceil(m.durationMs);
  regionDefs.forEach(r => {
    document.getElementById(`fill-${r.key}`).style.width = `${m[r.key]}%`;
    document.getElementById(`pct-${r.key}`).textContent = `${m[r.key].toFixed(1)} %`;
  });
  return m;
}
