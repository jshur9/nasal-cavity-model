import { presets } from "./model.js";
import { initUI, getInputs, updateOutputs } from "./ui.js";
import { draw, resizeCanvas } from "./render.js";

const ids = ["preset","viewMode","dNoz","pressure","mu","sigma","rho","jets","dose","mech","angle","depth","headTilt","breathing","time","playBtn","resetBtn","themeBtn","dv50","span","plumeAngle","jetVel","duration","frontLoad","rayleighRegime","primaryDrop","deterministic","cdAero","dragRatio"];
const els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
els.regions = document.getElementById("regions");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const tabs = Array.from(document.querySelectorAll(".tab"));

let playing = false, raf = null, lastTs = 0, activeTab = "cavity";

function applyPreset(i = 0) {
  const p = presets[i];
  Object.entries(p).forEach(([k, v]) => {
    const el = els[k];
    if (el) el.value = v;
  });
  els.time.value = 0;
  frame();
}

function frame(ts = 0) {
  if (playing) {
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs; lastTs = ts;
    const next = Number(els.time.value) + dt;
    els.time.value = `${next}`;
  }
  const inp = getInputs(els);
  const m = updateOutputs(els, inp);
  draw(canvas, ctx, inp, m, activeTab);

  if (playing && Number(els.time.value) < m.durationMs) {
    raf = requestAnimationFrame(frame);
  } else if (playing) {
    playing = false;
    els.playBtn.textContent = "Play";
    lastTs = 0;
  }
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  if (els.viewMode) els.viewMode.value = tab;
  frame();
}

function togglePlay() {
  playing = !playing;
  els.playBtn.textContent = playing ? "Pause" : "Play";
  if (playing) raf = requestAnimationFrame(frame);
  else if (raf) cancelAnimationFrame(raf);
}

initUI(els);
presets.forEach((p, i) => {
  const o = document.createElement("option");
  o.value = i; o.textContent = p.name;
  els.preset.appendChild(o);
});

// Tab button clicks
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

["input","change"].forEach(evt => {
  document.body.addEventListener(evt, (e) => {
    if (e.target.matches("input,select") && e.target.id !== "viewMode") frame();
  });
});
els.playBtn.addEventListener("click", togglePlay);
els.resetBtn.addEventListener("click", () => { playing = false; if (raf) cancelAnimationFrame(raf); els.playBtn.textContent = "Play"; els.time.value = "0"; frame(); });
els.themeBtn.addEventListener("click", () => { document.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); frame(); });
els.preset.addEventListener("change", e => applyPreset(Number(e.target.value)));
els.viewMode.addEventListener("change", () => setTab(els.viewMode.value));
window.addEventListener("resize", () => { resizeCanvas(canvas, ctx); frame(); });

resizeCanvas(canvas, ctx);
applyPreset(0);

