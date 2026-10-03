# Data and asset provenance

Publication review: 2026-10-03. No project source license is selected here.

## Authored simulation material

`data/synthetic_agent_history.json` and all five JSON files under `data/agent_scenarios/` are **project-generated synthetic telemetry**, not measured HP or industrial production data. Each contains 24 simulated records. `data/agent_response_example.json` and `data/agent_llm_context_example.json` are project-generated agent/context examples. They do not establish predictive accuracy or real maintenance recommendations.

`docs/exp.jpeg`, `docs/lineal.jpeg` and `docs/weibull.jpeg` are project-generated simulation/chart illustrations. Authored source, configuration and tests remain. Model constants are project assumptions, not demonstrated factory calibration. Historical screenshots/results were not regenerated.

## External 3D assets excluded

The historical frontend referenced external/third-party models through Vite's `publicDir`, pointing to `3d-models/`. Original CAD authorship/license and redistribution permission were not established. GLB metadata identifies ImageToStl as converter; **conversion is not a redistribution license**. No GLBs are bundled now.

Separately supplied authorized assets would need these historical paths; no original-source or permission claim is implied:

- `3d-models/Axial Thermal Fuse Horizontal.glb`
- `3d-models/Blade.glb`
- `3d-models/Heating_Element.glb`
- `3d-models/Nozzle_Plate.glb`
- `3d-models/Stepper Motor.glb`
- `3d-models/brusher.glb`
- `3d-models/isolatingPanel.glb`
- `3d-models/linear_guide.glb`
- `3d-models/temperature_sensor.glb`

All nine paths are ignored. Source references/frontend behavior remain: the historical 3D view can fail or be incomplete until authorized local assets are provided. No frontend fallback/redesign was implemented.

## Supplied challenge material excluded

`docs/hackathon.md`, `docs/stage-1.md`, `docs/stage-2.md` and `docs/stage-3.md` were supplied challenge/phase briefs. Publication permission was unresolved, so original texts are excluded and preserved privately. No missing scoring artifact was recreated.

Project-authored summary: this prototype implements component degradation models, simulated histories/historian services, and dashboard/agent interaction. This describes repository implementation, not an official brief, judging rubric, or verified organizer requirements. Project setup is in the README.

Historian/migration, simulation, LLM, UI race, packaging and integration findings remain unresolved; runtime validation remains incomplete. Excluded originals are preserved outside the public tree. Prior Git copies remain; historical cleanup is a separate manual owner decision.
