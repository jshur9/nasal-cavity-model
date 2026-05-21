# Modelling Assumptions

This document records the assumptions and data sources used in the physics
update and nasal-cast rendering integration.

---

## 1. Nasal cast geometry (render)

**Source:** CT-derived 3-D nasal cast reference image (right nasal cavity,
angled view) provided by user.

**Assumptions made for 2-D sagittal reconstruction:**

- The 3-D cast is projected onto a sagittal cross-section for the canvas view.
  Anterior (nostril entry) is placed at the LEFT of the canvas; the
  nasopharynx is at the RIGHT.
- The cast shows a single (right) nasal cavity airway. The lumen spans from
  the nostril vestibule through the inferior and middle meatus to the
  nasopharynx.
- The two rounded lobes visible in the lower-left of the 3-D image correspond
  to the inferior and middle turbinate remnants at the vestibular end; in the
  2-D sagittal schematic these appear as the inferior and middle turbinate
  "shelves" descending from the lateral wall.
- Absolute anatomical dimensions are not available from the image alone.
  The silhouette is normalised to fill the canvas; no physical scale (mm) is
  encoded.
- The superior olfactory cleft is placed in the anterior-superior quadrant,
  consistent with typical adult anatomy (posterior to the anterior skull base,
  superior to the middle turbinate insertion).

**Region zones (approximate, normalised to cavity bounding box):**

| Region | Anterior x | Posterior x | Superior y | Inferior y |
|---|---|---|---|---|
| Anterior (vestibule) | 0.00 | 0.13 | – | – |
| Front | 0.10 | 0.26 | – | – |
| Inferior turbinate | 0.17 | 0.73 | 0.45 | 1.00 |
| Middle turbinate | 0.20 | 0.74 | 0.20 | 0.50 |
| Olfactory | 0.18 | 0.56 | 0.00 | 0.20 |
| Superior residual | 0.45 | 0.88 | 0.00 | 0.20 |
| Nasopharynx-C1 | 0.80 | 1.00 | – | – |

---

## 2. Droplet size calibration

**Source:** Table 5 of Powtec 2025 paper (DOI: 10.1016/j.powtec.2025.121852),
"Parameters of droplet size at the outlet with three inlet pressures."

| Inlet pressure (bar) | D10 (µm) | D50 (µm) | D90 (µm) | Span | D [3,4] (µm) |
|---|---|---|---|---|---|
| 10 | 3.88 | 4.79 | 6.58 | 0.56 | 5.83 |
| 12 | 3.87 | 4.27 | 5.57 | 0.40 | 4.79 |
| 14 | 3.89 | 4.27 | 5.52 | 0.38 | 4.71 |

**Model equations used:**
- For P ≥ 12 bar: Dv50 = 4.27 µm (plateau observed in data).
- For 10 ≤ P < 12 bar: linear interpolation Dv50 = 4.79 − 0.26(P − 10).
- For P < 10 bar: linear extrapolation upward from 4.79 µm at 10 bar.
- Span follows a similar piecewise-linear model.

---

## 3. Aerodynamic drag on droplets

**Source:** Equations 18–20 from the same Powtec 2025 paper.

- **Eq. 18:** F_drag = −½ ρ_g C_d A u²
- **Eq. 19:** C_d ≈ 23.5/Re + 4.6/√Re + 0.3
- **Eq. 20:** ε = F_drag / F_inertia = 8 ρ_g u² C_d / (ρ_l a R)

where ρ_g = 1.2 kg/m³ (air), ρ_l = formulation density, a = droplet radius,
R = nozzle diameter (used as reference length), u = jet velocity.

**Assumptions:**
- Gas properties are fixed at ambient (20 °C, 1 atm).
- The jet velocity used for Re is the nozzle-exit velocity from the discharge
  coefficient model.
- The drag ratio ε is a breakup-characterisation parameter; large ε (≫1)
  confirms that aerodynamic drag dominates droplet inertia, consistent with the
  micro-Rayleigh regime reported in the paper.

---

## 4. Region deposition model

The deposition fractions (anterior, front, inferior turbinate, middle turbinate,
olfactory, superior, nasopharynx) are computed from a parametric model calibrated
qualitatively to the CT nasal cast geometry:

- **Pressure effect:** higher pressure → smaller droplets → less inertial
  impaction anteriorly, better penetration posteriorly.
- **Insertion angle effect:** larger angle (toward olfactory) → greater
  olfactory and middle turbinate targeting.
- **Head tilt effect:** positive tilt enhances superior/olfactory deposition.
- **Breathing pattern:** vigorous sniff increases turbinate and nasopharyngeal
  deposition through increased impaction velocity.
- Fractions are normalised to 100 % after parametric adjustment.

No CFD simulation is performed; the model is a simplified engineering estimate
suitable for interactive exploration, not clinical dosimetry.

---

## 5. Nozzle discharge coefficient

The nozzle discharge coefficient Cd_noz = 0.17 is retained from the prior model.
This low value (relative to a sharp-edged orifice ~0.61) reflects the specific
geometry of the micro-orifice atomiser modelled (e.g., recessed or tapered
orifice reducing vena-contracta loss).
