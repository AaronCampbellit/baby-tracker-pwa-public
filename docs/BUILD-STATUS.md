# Pilot build status

Updated 2026-09-25. This is a working pilot, not complete Nara feature parity.

## Implemented

- Route-two Today, History, Trends and Family UI; real mobile viewport and installable PWA.
- Household activation, individual login, one-time caregiver invitations, owner removal, manual reset links; isolated households and five-child cap.
- Feed, diaper, sleep and supplementary category forms, dated growth entries, pregnancy/postpartum adult records, editable profiles and records.
- Spasm Tracker with start/stop timing, selectable signs, history editing and offline sync.
- Nara CSV import for all categories in the supplied exports, with duplicate detection, profile mapping, original-field review and byte-preserved source downloads; per-child Nara-format CSV export using the supplied template columns.
- Timestamp-based timers, nursing segments/pause/resume, stop/correction and reminder deep links.
- Postgres persistence, durable local IndexedDB outbox, retry idempotence, optimistic revision conflicts with local export/recovery; offline reload and sync.
- Per-user reminders and Web Push enrollment, durable server reminder worker, CSV/JSON export, light/dark preference.
- Docker deployment and database backup command.

## Previously verified — 2026-09-16

Frontend production build, API TypeScript, 28 protected runtime files, three domain tests and backend integration test pass. Backend tests cover activation, household isolation, invitation permissions, idempotent retry, revision conflict, child limit and reminder cancellation. Playwright passes the authenticated mobile flow including notification-link navigation, timer stop/reload, offline entry/reload/reconnect and parent logging; no page errors. Visual pilot review passed, see web/design-qa.md. A local Postgres dump restored successfully into a separate verification database.

## Spasm Tracker release — 2026-09-25

Mobile runtime integrity check and Docker production build passed. The updated pilot is deployed; local and public `/api/health` both return `{"status":"ok"}`. The public PWA bundle includes the tracker and its signs.

## Nara import implementation — 2026-09-25

The production PWA build and TypeScript check pass. The importer accepts the two supplied Nara CSV schemas, keeps original files in household sync and full JSON backup, and exposes original profile/activity fields for review. The supplied records have not been imported into a household.

## Nara importer pilot release — 2026-09-25

The Docker production build and mobile runtime integrity check pass. The native importer is live on Hank; the public health endpoint returns `{"status":"ok"}` and the served PWA bundle contains the import and original-export controls. No Nara records have been loaded into the household.

## Nara-format export pilot release — 2026-09-25

Per-child CSV exports matching the supplied Nara column template are live on Hank. Imported source columns and profile metadata are retained, and application-only Spasm entries are included as Medical notes. Pregnancy and Postpartum entries remain in the full CSV and JSON exports. Nara has not confirmed whether its app can import generated CSV files.

## Still pending

- Real iPhone install, keyboard/background/lock-screen behavior and actual push delivery/cadence.
- Caregiver review and import of the supplied exports into a household; other Nara export variants, photo attachments and direct CSV re-import into Nara remain unverified. Growth percentiles, richer trends and night view are also pending.
- Automatic email, backup schedule and off-host destination.
- Fine-grained conflict merging and broader accessibility/security review.

Push is best effort. Offline timers remain accurate, but cannot trigger server reminders until synced. Deployment and public health verification are recorded separately in docs/DEPLOYMENT.md.

## iOS PWA additions — 2026-10-01, local only

Implemented in the local working tree; not deployed:

- Home Screen badges count server-confirmed Owlet alerts awaiting acceptance across the signed-in caregiver's households. Pushes set absolute counts, with reconciliation on foreground return, acceptance and sign-out. A second closed device updates on its next push or return.
- Timer, Owlet and device-test pushes include Apple's declarative fallback notification format and retain legacy fields for installed older workers. Enrollment prefers the window-level PushManager where supported and retains registration-based enrollment for older iOS. Existing delivery expiry/backoff, endpoint ownership and explicit acceptance remain in place.
- Invitation links have a system Share button after creation, neutral cancellation and Copy fallback. No other sharing surfaces were added.
- Storage API persistence is requested when signed in/on return, with granted/best-effort/unavailable status and estimated usage in Settings. Uploads retry on reconnect, focus, visibility and page restoration while the app is visible. Concurrent triggers coalesce and edits made during upload drain afterwards. Expired login preserves pending records for the same account; revision conflicts stop automatic upload.
- The service worker precaches the built script/style assets during installation, so first-install offline reload no longer depends on another online visit. Sensitive API responses stay outside its HTTP cache.
- Media attachments have an implementation plan in [PLAN.md](PLAN.md#media-attachment-plan--not-implemented); no media UI, capture, uploads, schema or endpoints were implemented.

Validation: API TypeScript and the PWA production build pass; the 28 protected runtime files pass integrity checks; 6 web/domain tests, 4 API tests (including an isolated database/provider-mocked device/badge integration test), and 21 Chromium Playwright tests pass. Browser plugin not available; existing Playwright supplied phone (390×844) and iPad (1024×768) coverage. Checks include declarative enrollment with an unavailable worker, installed-device notification regressions, badge account boundaries/acceptance/sign-out, invitation sharing/cancellation/failure/copy, storage refusal/unavailability, actual first-install offline reload/reconnect, expired-login outbox recovery, conflicts and concurrent uploads. Page identity, meaningful render, absent framework overlay, relevant console health and screenshots were reviewed; artifacts stay outside the repository under /tmp/baby-ios-*.

Actual iPhone/iPad Home Screen badges, permission settings, declarative fallback delivery and native share-sheet appearance still require physical-device acceptance. On iOS automatic uploads run while open or immediately on return; a closed PWA cannot reliably wake only because connectivity returns. No production services were changed and no deployment was performed.

## Notification center and device recovery — 2026-10-04, local only

Implemented locally; not deployed:

- A dedicated Notifications page combines phone permission/registration/test controls, in-app panels, sound activation, timer cadence and per-child repeat behavior. General settings and Owlet thresholds link here. Device preferences and new repeat settings default on while honoring existing saved choices and browser activation requirements.
- The home bell opens recent household notifications with one original entry per Owlet event, original start time, Active/Paused/Accepted/Sent status and server-confirmed acceptance time. Acceptance is available here and in the urgent panel. Timer repeats share one history record per timer; successful provider-accepted device tests also appear. Server and cache scopes keep accounts/households separate.
- App opening, foreground return and online events reconcile capabilities, subscription keys and account registration. Missing registrations are restored; expired subscriptions and old VAPID keys trigger renewal. Enrollment is idempotent and retains valid delivery IDs, queues and backoff. Temporary errors retry with bounded delays. Switching phone notifications off unregisters only this account’s endpoint on this device and retains the Off preference.
- Owlet alert connection failures now appear even with no cached alerts. History retains cached records offline. Repeating sounds and acceptance retain the existing charging policy and require confirmed server acceptance.

Validation: 32 Chromium browser tests passed across notification controls/recovery, late session startup, deduplicated history/acceptance, dark mode, Owlet interaction and existing iOS/offline flows; 4 API device/payload tests passed using an isolated local database and mocked push provider; all 14 charging regression checks passed. API TypeScript, the PWA production build and all 28 protected-runtime integrity checks passed. Phone visual checks at 360×732 and iPad checks at 1024×768 cover meaningful content, modal navigation, light/dark rendering, no horizontal overflow and no relevant application errors. Browser plugin is not available; Playwright CLI and the repository Playwright suite were used. Screenshots and temporary QA scripts are under /tmp/baby-notification-*.

Migration 010 adds idempotent endpoint enrollment, expired endpoint markers and timer/test history, and changes the default only for new Owlet repeat settings. Physical iPhone/iPad permission, background push display and audio behavior remain unverified. No production changes were made.

## Notification center deployment — 2026-10-04

The user subsequently authorized commit, push and deployment. Implementation commit `20e7720` is pushed to main and deployed on Hank as `did-i-feed-my-baby-app:pilot-notifications-20261004`/`pilot`, including the prior iOS/offline changes. App and both workers are running; the existing database remains healthy and migration 010 is applied. Local/public health and served asset checks pass. Production Chromium fixture checks cover the home bell, history and light/dark notification settings without page errors or horizontal overflow. An off-host database backup and previous rollback image are retained; full details are in DEPLOYMENT.md. No live device push or physical iPhone acceptance is claimed.

## Owlet acceptance fix deployed — 2026-10-05

Commit `e706def` is pushed to main and deployed on Hank as `did-i-feed-my-baby-app:pilot-owlet-acceptance-20261005-e706def`/`pilot`. Acceptance waits for in-flight push sends before confirming success, repeating pushes cannot accumulate at the provider, and foreground sound/vibration stop after confirmed acceptance. Remaining active alerts and failed acceptance preserve their alarms; one-shot delivery retention and the charging policy remain intact.

Validation passed 17 device-notification browser tests, five isolated database acceptance checks, 14 charging checks and five payload/service-worker checks. API TypeScript, PWA/Docker production builds and protected runtime integrity passed. Both acceptance browser regressions passed against production assets using fixture API data and instrumented audio, without page errors. Host-local/public health, bundle identity and container revision checks passed; app and both workers have zero restarts, the existing database remains healthy, and a read-only query found no unfinished deliveries for accepted events. A fresh off-host backup and rollback image are retained; details are in DEPLOYMENT.md. Physical iPhone delivery remains unverified, and a push already in transit may still arrive briefly after acceptance.

## Publication candidate — October 8, 2026

The unverified legacy phone-frame prototype/runtime, simulated keyboard/device assets, Sites worker and runtime fixtures are removed from this candidate. The implemented native PWA remains supported; `build` / `build:pwa` emit the same PWA with full third-party notices and OFL files. Original procedural install icons replace the previously unverified icon PNGs; activity marks use the existing separately licensed icon libraries. All real Owlet authentication client values are deployer configuration with no bundled fallback. Older protected-runtime/preview checks recorded above describe earlier private revisions and are not current candidate checks. Physical-device acceptance and real-provider authorization remain separate requirements.
