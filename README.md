# nasal-cavity-model
Static browser nasal spray simulation.

## Physics notes
- Outlet droplet trends are calibrated to the paper table values shown for 10/12/14 bar (D10, D50, D90, span), then smoothly extrapolated outside that range.
- Regime classification is explicit (`Rayleigh`, `Transition`, `Atomization-like`) from Weber/Ohnesorge windows.
- Coalescence and secondary-peak behavior are implemented as constrained heuristic terms so trends remain monotonic and numerically stable when controls move outside paper conditions.

## Rendering notes
- Rendering is fully client-side (no backend).
- The canvas always draws a cavity silhouette + nozzle baseline first, then mode-dependent plume/particles, so the scene remains visible at `t=0` and during animation.
