# Confirmed requirements — September 16, 2026

Publication note: this is a historical decision record. Private family exports,
operator infrastructure names and production endpoints are withheld. Current
local setup and implemented screenshots are documented in the repository README.

These owner decisions supersede earlier provisional scope in the initial research plan.

- Audience: owner's family and grandparents first, with isolated additional families such as the sister-in-law's family supported from the beginning.
- Registration: administrator issues a family ID for a new family; users access their family using its ID and establish children/caregivers. Confirmed flow: the recipient sets up their household and invites caregivers, each with an individual login.
- Confirmed access model: the platform administrator creates and hands over a family ID; its recipient sets up the household and invites caregivers, each using an individual login. Implementation recommendation: use one-time activation alongside the family identifier, and enforce membership authorization rather than treating a reusable family ID as the sole credential. Activation mechanics remain an implementation detail, not a separately confirmed requirement.
- Maximum five children per family. Editable child details include birth date, sex, and other profile information; calculate age from birth date. Store height/weight and other growth measurements as dated history rather than overwriting previous measurements.
- All base Nara baby activities belong in product scope, including nursing, bottles, pumping, diapers, sleep, solids, growth, health, milestones and routines. Delivery may be phased; these are not optional simply because the earlier MVP was narrower. Pregnancy and postpartum tracking are also confirmed in scope.
- Import existing Nara records and provide export. Two real CSV exports have now been inspected; other Nara export variants and photo attachments remain unverified.
- Closely follow Nara's visual structure, with room to explore colors/design. No final visual direction selected.
- Focus specifically on iPhone and installed PWA use.
- Lock-screen timers are a major requested feature. Background notifications/Notification Center presence should be core when supported. Resolve the native-versus-PWA constraint before committing to parity.
- Self-host on owner's infrastructure, exposed through Cloudflare Tunnel. Host, domain and deployment details remain unspecified. No server changes authorized or performed in this planning step.
- Product name: Did I Feed My Baby? Keep the existing project folder path for continuity. No deadline confirmed.

## Lock-screen feasibility

An installed iPhone PWA can receive Web Push with permission. Notifications can appear on the Lock Screen and in Notification Center according to user settings. This supports event/reminder messages while the app is closed, but does not provide a continuously updating, pinned elapsed-time widget. Do not simulate a live timer by sending repeated pushes.

Sources: [WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/).

Apple's documented route for a genuine Live Activity is native ActivityKit with a widget extension. There is no documented PWA API equivalent in the reviewed Apple/WebKit material. A small native iOS companion or wrapper with a native widget extension is the proposed route if live lock-screen timers are essential. A web wrapper by itself does not provide Live Activities. Keep the PWA as the primary app and share the same authenticated backend; assess native distribution and push plumbing separately before implementation.

Source: [Apple: Live Activities and widget extensions](https://developer.apple.com/documentation/appclip/offering-live-activities-with-your-app-clip), [Apple: displaying live data](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities).

## Subsequent owner decision: PWA only

The owner explicitly rejected an installed native iOS app due to added scope. Do not propose or build a native companion/wrapper. Live Activities are outside the selected architecture.

Proposed alternative design, awaiting design preference: a persistent active-timer strip inside the PWA, an optional full-screen timer view, and sparse server-sent notifications that link directly to the active session. Notifications show a recorded start time or a snapshot, not a continuously updating elapsed counter. Respect notification settings; do not promise persistent/pinned notifications or lock-screen stop controls. Timers continue logically through saved timestamps while the PWA is closed. Notify at user-selected milestones rather than sending frequent timer updates.


## Accepted timer workflow and requested reminder cadence

The owner accepts the PWA timer design provided elapsed time remains accurate while navigating to another app or locking the phone. Notifications should reopen the relevant timer so the user can stop it and correct its times. Requested default interval: one minute, adjustable in each user's settings rather than family-wide. Persistent timer bar and night view remain the selected proposed presentation.

Implement reminders through a server scheduler and Web Push, never a background browser interval. Persist timer start and pause segments locally and synchronize with the server. Once the timer reaches the server, reminders may be sent while the PWA is closed. An offline start cannot schedule server reminders until synchronized; show that distinction. Notification delivery is best effort, subject to connectivity, permissions, Focus and OS behavior; one minute is a requested sending cadence, not a delivery guarantee. Validate this cadence on an actual iPhone before declaring the feature ready.

Notification settings should include enabled/off, interval, and device-specific push enrollment. Interpret the owner's per-user-instance setting as a per-user preference with explicit device enrollment; decide multi-device fan-out during implementation. By default notify the user who started the timer, not every caregiver.

Each message links to a stable authenticated timer route. Display the start time or a clearly timestamped elapsed snapshot, since delayed delivery can make a snapshot stale. On open, load the latest session state; a stopped timer opens its completed entry for correction. Cancel scheduled reminders when stopped, deduplicate jobs, suppress obsolete pending jobs, and use short message expiry. A push already delivered may still be visible after the timer stops. Ensure another caregiver stopping the timer also cancels future reminders.


## Confirmed parent tracking and household onboarding

The owner explicitly includes pregnancy and postpartum tracking. Model parent records separately from child activities, associated with the relevant adult and pregnancy/recovery episode. Scope includes the researched Nara categories: pregnancy vitals and symptoms, mood/journal entries, appointments and notes, postpartum recovery, hydration, food, sleep and self-care routines. Delivery can be phased, but the suite is committed product scope.

Household onboarding is confirmed: platform admin creates family ID → recipient establishes household using their own account → household invites caregivers → each caregiver uses their own login. Distinguish platform administration, household ownership, and caregiver membership.

Confirmed sharing model: all invited household members and caregivers have the same access to household tracking records, including child activities, pregnancy, postpartum, mood and journal entries. Do not implement private adult records or per-person sharing controls. Family boundaries still isolate unrelated households. This replaces the earlier privacy recommendation.


## Confirmed shared household access

The owner explicitly chose equal household record access for caregivers to avoid added sharing complexity. Caregivers can view and manage the same tracking records as other household members. State this plainly in the caregiver invitation/setup flow. Platform administrator provisioning remains separate from household tracking access; this decision does not automatically grant platform administrators access to every family's records. Ownership-only destructive family/account operations remain distinct from ordinary record access.


## Confirmed name and interaction direction

Product name: **Did I Feed My Baby?** The owner chose a humorous name and a simple, action-first interface inspired by Nara.

Home-screen priority: immediately visible, directly actionable controls for feeding, diaper changes, sleep and other enabled tracking categories. Logging actions must be the primary tap targets, not buried behind summary cards or menus. Show latest activity context alongside each action so a caregiver can answer the product's title and record the next event quickly. Keep analytics secondary to logging. Preserve prominent active timers and the selected child's identity.

Specific palette, typography and screen composition remain to be explored; this establishes the visual brief rather than approving a particular mockup. No new mockups or app code were generated in this decision-recording step.


## Selected visual direction

Owner selected the second displayed home mockup (One-Tap Sunshine). The original selected reference and subsequent History, Trends and Family concepts were private static design materials, not working app pages. Unverified reference assets are excluded from this publication candidate; current implemented screenshots are in `docs/screenshots/`. Generated via built-in image generation, with selected home attached. Original mock names/child data are illustrative.


## Initial host selected

The owner initially selected an existing private self-hosted server. Machine names and capacity/cleanup instructions are withheld from this public record. Keep deployment portable; host selection alone does not resolve HTTPS routing, email delivery or backup configuration.

## Nara CSV import fidelity — September 25, 2026

The owner requires the Nara CSV import to retain every piece of source information. Preserve each original CSV byte-for-byte with the family backup, map supported rows into child activity history, and retain all non-empty source columns on each imported record. Retain profile-row source fields on the child. Use Nara `_familyKey` and `_activityKey` values to make repeated and cross-profile imports idempotent. Never guess the child for rows that Nara leaves unassigned; ask the caregiver to map them or keep them in the original source file only. The privately supplied exports exposed repeated, unassigned activity keys; the original family exports and their record-level evidence are not included in this public source.

Confirmed stack: TypeScript across the React PWA and Node.js API/reminder worker, with Postgres and Docker Compose. Vite remains the proposed frontend build tool and IndexedDB the planned offline store. No dependencies or services have been installed or deployed.


## Backend language decision

After discussing Node versus Go, the owner selected Node.js with TypeScript for development speed and shared frontend/backend definitions. Go is not the selected backend. Keep reminder jobs durable in Postgres and independent of browser execution. Language choice does not change best-effort iOS push delivery.

## Public hostname

A private production hostname was selected; it is withheld from the public source. Configure the deployment's own HTTPS application origin for activation links and push deep links. A reverse proxy or tunnel can reach the app's loopback-bound HTTP service; keep PostgreSQL private.

## Public origin and pilot deployment

The original private pilot used an isolated Docker Compose project behind HTTPS routing. Its hostname, machine/tunnel identity and current deployment state are withheld; this historical record does not attest a live public deployment. Real iPhone notification acceptance remained pending at the recorded review. Initial owner onboarding uses a one-time activation link with household association; a family ID alone is not an authentication credential.

## iOS PWA additions — October 1, 2026

Owner-authorized scope: plan and build Home Screen badges, resilient push notifications, system sharing limited to invitations, and persistent offline storage with automatic upload on reconnection. Plan media attachments, but do not implement them. Do not deploy.

Implementation semantics: badge counts represent Owlet Repeat until accepted events still awaiting explicit acceptance across the caregiver's households; timers and ordinary one-shot notifications do not increment the count. Push messages retain old-worker compatibility and include Apple's declarative visible fallback, with window-level PushManager enrollment when supported. Share is invoked from a tap only after an invitation exists; Copy remains available and cancellation is neutral. Persistence refusal does not prevent IndexedDB saves. Uploads resume when the app is connected and visible, including foreground return; iOS cannot guarantee a closed-PWA wake on reconnection. Preserve the outbox on expired login and retain conflict review. Media capture, private storage, quotas, retry/deletion and backup design are documented in [the current plan](PLAN.md#media-attachment-plan--not-implemented).


## Notification center and recovery — 2026-10-04

Owner requested a dedicated Notifications page for phone permission and registration, in-app alerts, sound activation, timer reminders and per-child Repeat until accepted. The home bell opens household notification history. Owlet repeats use one original event row that changes from Active or Paused to Accepted with server-confirmed acceptance time. Timer repeats share one row per timer; provider-accepted test pushes also appear.

Device preferences and new Owlet repeat settings default on wherever supported, while retaining already-saved Off choices and existing alert thresholds. Permission requests remain tied to a tap; sound is armed on a trusted app interaction and can be enabled/tested explicitly. Opening/returning checks server capabilities and existing subscriptions, restores missing registration, renews provider-expired subscriptions or subscriptions using an old VAPID key, and retries temporary failures. Re-registration preserves valid IDs, delivery schedules and provider backoff. Expose alert-fetch failures even when no pending alerts were previously cached. Implementation and verification are local; no deployment was requested.
