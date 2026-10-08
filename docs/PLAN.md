# Did I Feed My Baby? — product and implementation plan

Status: the initial delivery proposal below is historical. [Confirmed owner decisions](DECISIONS.md) and the dated additions here supersede provisional scope, especially multi-family support, full base activity coverage, self-hosting, and PWA-only iOS development. This plan describes our design decisions, not additional claims about Nara.

## iOS PWA additions — October 1, 2026

Authorized scope: build badges, resilient push, invitation sharing and persistent offline storage/reconnection upload locally. Do not deploy. Media attachments are planning only. Passkeys and sharing activity summaries/exports are outside this change.

Implementation sequence:

1. Define the Home Screen badge as the count of Owlet Repeat until accepted events still awaiting explicit server-confirmed acceptance, across every household the signed-in caregiver belongs to. Normal threshold notifications and active timers do not add to this count. Set an absolute count on push; refresh it while open/on return; clear on acceptance and sign-out. A second closed device reconciles on its next push or foreground return, because iOS does not permit silent badge-clearing pushes.
2. Send timer, Owlet and test notifications with the Apple declarative `web_push: 8030` format, an absolute same-origin navigation URL, visible fallback text, stable tag and optional absolute `app_badge`. Retain legacy top-level fields for installed old workers. Use the newer window-level PushManager when available, with registration-based enrollment for older iOS. The worker understands both formats; failures to update the badge cannot prevent notification display. Keep expiry, account-specific enrollment, delivery backoff and explicit acceptance semantics.
3. Generate an invitation before enabling Share invitation. Open the iOS share sheet directly from the button tap. Copy remains available; cancellation is neutral and sharing failure leaves the link accessible. No automatic sending and no other sharing surfaces.
4. Check/request Storage API persistence when signed in and on foreground return; show granted/best-effort/unavailable status and estimated usage in Settings. Continue normal IndexedDB writes regardless of whether iOS grants protection. Reconnect, focus, visibility and page restoration trigger uploads; visible five-second retries cover unreliable connectivity events. Coalesce overlapping requests, drain edits made during uploads, retain idempotent operation IDs and stop on revision conflicts. An expired login retains the account-keyed outbox for sign-in recovery; revoked membership clears its cache.
5. Verify builds and protected runtime integrity; exercise declarative/legacy worker payloads, badge account boundaries and acceptance, sharing/cancellation/fallback, offline save/reload/reconnect, suspended-app return, storage denial and expired-login recovery. Actual iOS system UI and push fallback need physical-device acceptance before deployment.

Supported iOS baselines: Home Screen Web Push and badges from 16.4; Storage API persistence from 17; declarative push fallback from 18.4. iOS chooses whether to grant persistence and when to deliver notifications. Automatic upload runs while the app is open or immediately on return; a closed PWA cannot reliably wake just because connectivity returns. No native companion or Live Activities are planned.

Sources: [WebKit badges](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), [Storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [system sharing](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).

### Media attachment plan — not implemented

Purpose: add an optional photo, short video or voice note to an activity, especially milestones and Spasm Tracker entries. The caregiver confirms the attachment before it becomes a shared household record. All existing equal-access household rules apply.

Delivery phases:

1. Photos: pick from Photos/Files or take a photo from an explicit button. Show a preview, optional caption and Remove. Allow saving the entry while an attachment is still queued.
2. Video: select an existing clip or record a short clip while the app is visible. Show elapsed capture time, Stop, preview and confirm. Returning from a lock/app switch must identify interrupted recording without claiming capture continued.
3. Voice notes: start/stop from explicit taps, preview and confirm. Handle denied microphone permission and interruption without blocking the text entry.

Provisional limits for implementation review: 5 attachments per activity; photos up to 10 MiB each; videos up to 60 seconds/50 MiB; voice notes up to 2 minutes/5 MiB. Inspect actual content and duration server-side, and make household storage quotas configurable. Confirm server capacity before enabling uploads; production storage headroom has not been assessed in this change. Feature-detect recording formats on each iPhone/iPad; support library uploads even if in-app capture is unavailable. Do not assume every device can record the same codec/container. [WebKit MediaRecorder](https://webkit.org/blog/11353/mediarecorder-api/)

Data design:

- Keep binary files outside the whole-household JSON snapshot and outside public web assets. Store attachment metadata separately: UUID, family, activity, author, caption, detected MIME type, byte count, SHA-256, dimensions/duration, object key, upload state and deletion timestamp.
- Use private storage on the existing self-hosted infrastructure with a separate data volume and matching backup/restore procedures. Choose filesystem versus private object storage during implementation after capacity review; introduce no new provider now.
- Check household membership for every upload, metadata operation and download. Serve through authenticated endpoints with byte-range support for video/audio; do not expose permanent public file URLs. Apply server-side file validation, size limits and household quotas. Re-encode images when feasible to remove location metadata and produce thumbnails; retain originals only under an explicit product decision.
- Upgrade IndexedDB with a separate blob/outbox store keyed by account, family and attachment UUID. Commit blob plus queued metadata atomically. Sync the parent activity first, then upload the blob with an idempotent identifier/checksum and resumable transfer; mark complete only after server verification. Show queued/uploading/failed states and manual Retry. Reconnect/foreground triggers reuse the current upload lifecycle.
- Preserve confirmed attachment blobs on failures, expired login and app restart. Surface storage-full failures before claiming success. Cancel/remove queued blobs when the caregiver removes an attachment. Activity deletion needs attachment tombstones and eventual binary cleanup so another offline device cannot resurrect deleted files.
- Include attachment metadata and binaries in full backup/export with a manifest/checksums; keep ordinary CSV compatible by referencing attachments rather than embedding binaries. Restore must verify activity links and household boundaries.

Acceptance gates: physical iPhone/iPad Photos/Files/camera/microphone permissions and cancellation; HEIC and recorded-format handling; offline capture/reload/reconnect; interrupted/chunked upload with duplicate retries; storage-full recovery; two-caregiver edits/deletions; unauthorized and revoked access; playable range downloads; backup/restore with matching checksums. No attachment UI, schema, endpoints, capture or uploads are built in the current change.

## Original product intent

An installable mobile app that helps a caregiver answer three questions immediately: what happened last, what is happening now, and what needs recording? Default to a private family pilot, no ads, and no subscription machinery. Hosting still has an operating cost; audience and budget determine deployment.

## First usable release

1. Create a family, add children, and invite caregivers with separate accounts.
2. Home prioritizes immediately visible Feed, Diaper, Sleep and other enabled logging actions, with selected child, last-event context, active timers and secondary daily totals.
3. Log bottles, diapers, sleep, and optionally nursing/pumping with minimal input.
4. Start, pause where relevant, resume, stop, and correct timers across app closure.
5. Edit/backdate/delete with undo and visible author information.
6. Review daily history and simple seven-/30-day totals.
7. Write locally while offline, show pending status, synchronize safely later.
8. Install to Home Screen, use light/dark modes, and export records.
9. Import Nara CSV before household cutover if migration is required.

Optional release additions based on the child's needs: solids, medication logging, custom routines, growth records. Medication entries record what a caregiver entered; no dosage calculations or automated medical interpretation are proposed.

## Screen plan

| Screen | Primary content and actions |
|---|---|
| Welcome | Sign in/create account, create or join family |
| Child setup | Name, birth date, units, relevant activities |
| Today | Child switcher, prominent quick logging actions, active timers, last-event context and secondary daily totals |
| Activity sheet | Large inputs, recent values, notes, editable start/end, clear save confirmation |
| History | Day list first, filters, entry detail/edit; visual week timeline later |
| Trends | Totals, averages, feed quantities, sleep duration; text equivalents for charts |
| Family | Children, members, invitations, role/access management |
| Settings | Units, theme, installation, reminders, export/import, account and data controls |

Use Today / History / Trends / Family bottom navigation provisionally. Present Settings through a reachable account control. Preserve the selected child across navigation, but display it prominently on every entry sheet. An active timer for another child remains discoverable.

## Interaction targets

These are acceptance targets, not measured results:

- Log a usual diaper in at most two taps from Today; usual bottle in at most three using a saved amount.
- Show local save feedback immediately; never imply server delivery while pending.
- Keep common controls in comfortable thumb reach with roughly 48px targets.
- Support 320–430 CSS-pixel phone widths, larger text, safe areas, on-screen keyboards, and screen readers.
- Retain typed input if the sheet is accidentally dismissed or connectivity fails.
- Use both text and color to distinguish categories and sync states.
- Make dark mode a complete theme; do not rely on dimming the light theme.
- Prompt for notification permission only when the user enables a reminder.

## Proposed architecture

Use the confirmed React/TypeScript PWA and Node.js/TypeScript API and reminder worker, with IndexedDB for the local event store/outbox and Postgres for server persistence. Vite is a provisional build choice, to be reconciled with the selected mobile prototype template before scaffolding. Library versions remain to be selected at implementation. Self-host with Docker Compose and owner-configured HTTPS routing. The original private host and tunnel identities are withheld; this preserved plan does not establish current deployment state.

Keep UI, typed activity schemas, persistence, synchronization, and charts separate. Server-side rendering is not a priority for the signed-in tracker. Use a service worker to cache versioned app assets and support offline startup after initial setup. Avoid placing sensitive API responses into an indiscriminate HTTP cache. Clear family-local caches on sign-out and access removal when the device next connects.

Suggested entities:

| Entity | Key fields / rules |
|---|---|
| User | Identity and account preferences |
| Family / Membership | Family boundary, user role, invite state |
| Child | Family, display name, birth date, units |
| Activity | UUID, child, kind, start/end, author, notes, version, deletion state |
| Activity details | Validated type-specific fields for quantities, diaper flags, food, etc. |
| Timer segments | Nursing side, start/pause/resume intervals, active state |
| Outbox operation | Unique operation ID, entity version, pending payload, retry/error state |
| Attachment | Activity association, private object key, upload state |
| Reminder | Schedule, timezone, enabled recipients; optional phase |
| Import batch | Source hash, row status, mapping version, imported IDs |

Persist UTC instants plus the original timezone context. Define whether charts follow family or viewer timezone. Split overnight duration by day boundaries for totals while retaining one source session. Store quantities canonically and convert only for display; retain original entered units for import fidelity.

## Offline and synchronization contract

Commit the record and its outbox operation atomically. Use client-generated IDs and idempotent server operations so retries never create duplicate feeds. Apply authorization server-side on every family-scoped request. Pull changes when opening, reconnecting, and returning to the foreground; use live updates while online.

Use entity versions for concurrent edits. Preserve conflicting values and offer resolution rather than silently overwriting. Timer start/stop operations need server reconciliation: reject or surface simultaneous same-child sleep timers, while allowing independent activities across children. Mark offline timer state as provisional until synchronized. Deleted records need tombstones so an offline device cannot resurrect them.

Revoking access blocks future server reads and writes immediately. A disconnected device may still hold previously cached data; do not claim remote offline erasure. On reconnection, remove revoked-family caches and explain rejected queued writes.

## Migration and data ownership

Inspect an actual Nara export before building field mappings. Do not assume exported column names, timestamp formats, timer semantics, photo availability, or parent-record coverage. Build a preview with child mapping, units, timezone confirmation, row counts, unsupported columns, and validation errors. Preserve source rows for review locally or under the chosen retention policy. Make repeated import idempotent, allow batch rollback, and compare category counts and daily totals before recommending cutover.

Offer CSV for portability and a versioned JSON backup for full round-trip restoration. Photo export support is a separate explicit requirement. Keep automatic encrypted server backups and conduct a restore drill before using the app as the family's sole record.

## Phases and completion gates

| Phase | Deliverable | Completion gate |
|---|---|---|
| 0 — Decisions | Audience, priorities, devices, migration, hosting, visual direction | Owner answers core questions |
| 1 — Mobile proof | Selected design implemented with one real activity, local persistence, timer recovery | Real iPhone Home Screen install, offline reload, lock/resume verified |
| 2 — Daily tracker | Core forms, history, corrections, totals, themes | Complete representative daily care flows with persistent records |
| 3 — Shared family | Accounts, invitations, online updates, offline reconciliation | Two-device concurrent edits/timer tests and family isolation pass |
| 4 — Cutover readiness | Import/export, backup/restore, installation help | Migration reconciliation and restore rehearsal pass |
| 5 — Expansion | Prioritized solids/growth/routines, richer charts, push reminders | Each enabled workflow tested on target phones |

If multiple caregivers are essential on day one, phase 3 is part of the first usable release, not an optional follow-up. If no existing history needs importing, omit migration work. No calendar estimate is committed until scope and target date are known.

## Validation plan

Test timer reconstruction after lock, force-close, device restart, pause/resume, midnight, timezone changes, and daylight-saving boundaries. Verify offline saves survive reload and repeated retries. Test simultaneous caregiver changes, duplicate taps, concurrent timer starts, revoked membership, expired login, interrupted imports, export round trips, and restored backups. Test app updates with unsynced records to avoid losing outbox data.

Use meaningful automated tests for activity calculations, sync idempotency/conflicts, access boundaries, and import mapping. Use browser interaction tests for the core workflows and real iPhone/Android devices for installation, notifications, storage behavior, keyboard/safe-area layouts, and background recovery. Desktop browser emulation is insufficient for the final PWA gate.

## Explicitly deferred

Native Apple Watch/Siri/Live Activities, predictive sleep coaching, AI features, public billing, pregnancy/postpartum suite, and advanced clinical charts. These can be reprioritized after the owner's answers. There is no dependency installation, app build, or deployment in this research phase.


## Updated core requirement: recurring timer reminders

See [confirmed decisions](DECISIONS.md). Include an authenticated server scheduler and Web Push delivery in the core timer scope. Requested default sending interval is one minute, configurable per user with off control. Add a real-iPhone feasibility gate for notifications while another app is foregrounded and while locked, deep linking, timer stop/correction, offline start, delayed push, and cancellation across caregivers. Keep reminders independent from elapsed-time calculation; delivery is best effort.


## Confirmed expanded scope: parents and household onboarding

Pregnancy and postpartum tracking are included in the product, superseding the initial deferral. Add adult profiles, pregnancy/recovery episodes, vitals/symptoms, mood and journal entries, appointments, recovery and self-care records, and corresponding history/import/export coverage where the source data supports it. All household members and invited caregivers share equal access to child and adult tracking records, including mood/journals. No private adult-record or per-person sharing layer is required. Communicate this access scope when inviting caregivers.

Onboarding is admin-issued family ID → household owner registration/setup → caregiver invitations with individual authentication. Add platform provisioning controls, household ownership and membership management, a five-child limit enforced on the server, and authorization tests proving household isolation and equal member access to both child and adult records.


## Notification center — 2026-10-04

Implement centralized device notification controls and a home bell with event-based history. Retain explicit household-wide acceptance and charging pause semantics. Record Owlet history from the existing event table, never from delivery attempts; add durable deduplicated timer/test history. Register devices idempotently, retain provider-expired endpoint markers for subscription renewal, refresh capabilities on opening and foreground return, and show actionable connection failures. Browser permission, sound activation, Focus settings and unavailable server services remain outside automatic device repair. Deployment remains a separate, explicitly authorized step.
