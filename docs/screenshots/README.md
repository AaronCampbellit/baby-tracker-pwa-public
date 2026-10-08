# PWA screenshots

Recaptured October 8, 2026 (UTC) from the current production PWA build in Chromium at **390 × 844**. These images show implemented screens and interactions, not design mockups or third-party app screenshots.

| Image | What is shown |
| --- | --- |
| [today.png](today.png) | Today, using the built-in synthetic Oliver/Alex care records |
| [history.png](history.png) | The same synthetic feed and diaper entries, filtered to their local date |
| [timer.png](timer.png) | A sleep timer started through the UI and retained after a page reload |
| [owlet-demo.png](owlet-demo.png) | The implemented graph, scrolled to its chart; values come from the built-in synthetic Owlet generator |

No account, live household, real Owlet credentials, or external provider was used. The sample care records are defined in [store.ts](../../web/src/domain/store.ts); synthetic Owlet history is generated in [Prototype.tsx](../../web/src/Prototype.tsx). The header's **Personal preview · sample records · saved locally** label identifies demo mode; the Owlet sheet also labels its readings as sample data. The graph screenshot is scrolled below that label.

## Reproduce

Install the project's locked dependencies in `web/` if needed, then build and preview:

```sh
cd web
npm run build:pwa
npx --no-install vite preview --config vite.pwa.config.ts --host 127.0.0.1 --port 44176 --strictPort
```

Open `http://127.0.0.1:44176/?demo=1` in a fresh browser context, set a 390 × 844 viewport, and wait for `document.fonts.ready`. The built output uses `/` because `finish-pwa.mjs` renames `pwa.html` to `index.html`. For a development-server preview instead, use `npm run dev:pwa` and `/pwa.html?demo=1`.

Capture Today, then History. Return to Today, start Sleep, reload, and capture the running timer. Stop and save it, open **Owlet Dream Sock · Demo**, and scroll the sheet until the chart is visible. Capture the chart with its default heart-rate and oxygen metrics. Close only your task's browser session when finished.

The October 8 recapture used the named `playwright-cli` session `publication-baby-cleanup` at UTC after removing the unpublished phone-frame runtime and replacing uncertain icon assets; the app's clock and timer were not frozen or replaced. Time labels, the child's computed age, and generated graph values naturally change between captures. All four PNGs were visually reviewed. The rendered app had no horizontal overflow; a reload retained the timer, and the production service worker restored the demo after an offline reload. These checks exercise the local demo, not authenticated household sync or physical-device notifications.
