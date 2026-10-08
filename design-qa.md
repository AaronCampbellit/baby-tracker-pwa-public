# Owlet landscape standby design review

Historical private design-review record. Temporary artifacts and personal machine
paths are withheld; this does not certify a current live deployment. Current
implemented publication captures are documented in [the screenshot guide](docs/screenshots/README.md).

final result: passed

## Evidence

- Selected visual: privately retained landscape reference (1849 × 851); not included in the public source.
- Historical browser-rendered tablet capture: 1194 × 550 CSS/pixels, density 1; temporary artifact withheld.
- Historical browser-rendered phone capture: 844 × 390 CSS/pixels, density 1; temporary artifact withheld.
- Historical inspection-state capture: temporary artifact withheld.
- Historical detailed-graph capture: temporary artifact withheld.
- Local sample-data preview: `http://127.0.0.1:4186/pwa.html`.
- State: dark mode, selected sample profile, sample heart rate 123 bpm / oxygen 98% / battery 84%, live 10-minute window, September 30 2026.
- Source and final renders were opened together in one comparison input. The source ratio is approximately the same as the tablet viewport; compare app content at proportional scale, without device chrome. Final renders explicitly mark the sample child; production uses the actual selected child's name. Times and freshness are current, not fixed mock timestamps.
- Inspection capture makes the controls and historical reading text visible for a focused readability comparison. No raster artwork is needed; the source heart uses the installed Radix icon library, O₂ is the approved semantic text, and trend graphics are data visualizations.

## Comparison history

1. Initial capture: P1 existing sheet-body height cap clipped the graph and hid the footer. P2 standby content exceeded both landscape viewport heights. Fixed sheet-body sizing for standby only and made the trend region flex into remaining space.
2. Second capture: P2 display numbers left too little height for the tablet chart and graph labels were compressed. Reduced tablet number size and section spacing and increased axis typography. Retained compact phone spacing.
3. Final capture: the entire monitoring screen fits 1194 × 550 and 844 × 390. Exit, live values, graph controls, trends and freshness footer remain visible. No actionable P0/P1/P2 visual issues remain.

## Fidelity surfaces

- Fonts/typography: existing Lora heading and DM Sans readings/controls retained. Large numeric hierarchy and smaller units match the chosen design; phone text uses the compact responsive scale.
- Spacing/layout: selected two-column readings, combined full-width plot, top-right Exit and footer retained. Additional inspection text sits below the plot, separately from live readings.
- Colors/tokens: existing navy, cream, rose heart and teal oxygen tokens retained. Light mode follows existing theme tokens; these captures review the approved dark state.
- Assets: installed heart and battery icons are sharp. O₂ replaces the rejected droplet. Chart lines use saved data and do not simulate ECG waveforms.
- Copy/content: real selected-child context, explicit units and reading age. Refresh is described as a target. Screen-awake status is truthful; it displayed “Screen may sleep” in headless Chromium. Missing intervals are blank rather than mock dashed bridges; summary whiskers preserve extrema.

## Capture walkthrough and build checks

- Opened Owlet from Today, entered standby, dragged the paired graph and captured the inspection state.
- Opened Inspect saved reading, rendered the existing individual-reading graph, returned to all graphs, reopened standby, selected 30 min, and used Exit.
- Capture walkthrough produced no browser console errors or uncaught page errors.
- Production PWA TypeScript/build passed; protected mobile runtime integrity passed (28 files).
- No automated test suite was added or run for this task.

## Remaining limits / follow-up polish

- Physical iPhone/iPad gestures, wake-lock availability and urgent alert behavior during standby have not been device-tested. Existing alert UI/delivery behavior is reused; its explicit Accept contract remains unchanged.
- Small landscape phone graph text is more compact than tablet text; full metric details remain available by tapping a reading.
- Long selected-child names may need extra header wrapping on narrow devices in a future polish pass.
- Preview server uses synthetic data and does not authenticate to Owlet or change live household data.

## Combined UI release verification — September 30, 2026

This release combines the approved standby view, completed Quick action colors/icons and More activities placement, stable Owlet loading, and the revised graph overview. Heart rate and oxygen appear together by default; independent toggles overlay up to five metrics with separate colored scales. Main-chart touches allow scrolling, and explicit detail buttons open reading inspection. Numeric graphs now show closer Y-axis increments. Unsigned local demo mode includes labeled synthetic Owlet history; authenticated households continue to use their server data.

The combined diff changes app UI, documentation and tests. It does not change authentication, server endpoints, migrations, notification delivery, dependencies or the protected mobile runtime. All 28 protected-file integrity checks pass. Frontend/PWA builds and API TypeScript checking pass. Chromium checks cover delayed history, cached reopening, range changes, metric overlays, touch scrolling, detail scrubbing, standby live-value separation, and an urgent panel that remains above standby and only closes after explicit server-confirmed acceptance. Runtime gestures, timer calculations, CSV escaping and packaging checks also pass.

Physical iPhone behavior, audible push delivery and provider polling cadence remain outside these browser fixture checks. The legacy installed-app flow test has obsolete activity selectors and was not included in this release's focused test run. Screenshots and temporary verification scripts remain outside the repository.
