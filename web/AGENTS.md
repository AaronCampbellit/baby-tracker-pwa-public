# PWA Agent Guide

## App Instructions

For browser verification, start the PWA locally and exercise the requested care flow with a task-specific browser session. Do not deploy unless the owner explicitly authorizes deployment.

Before planning or implementing a mobile app change, read this `AGENTS.md` in full. It records the care workflows and supported native PWA guidance.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Keep Today’s common actions easy to reach. The Quick actions list is configurable per caregiver; do not hard-code Bottle or Diaper outside it. Timer-capable actions should start in one tap, show their running state clearly, and keep a visible stop action. All activities must remain available from More activities even when hidden from Quick actions. Place its plus icon directly to the right of the Quick actions settings icon; do not give More activities a separate Today section button. Every configurable Quick action needs its own activity icon and a coordinated colored card in light and dark mode.

Owlet custom alert levels belong to each child and are shared by household members. Show alert history in the app and offer phone push on each caregiver device that enables notifications.

Pause custom Owlet alert creation, repeating pushes and foreground alarms only when a recent poll explicitly confirms that the currently linked sock is charging. Never infer charging from battery level, missing vitals, sock-off or disconnection. Missing, invalid, contradictory, stale or failed charging reports must not suppress alerts. Charging changes apply even when measurement timestamps repeat. Preserve unaccepted events and resume them after charging ends; charging never accepts an alert.

Keep phone push, in-app panels, sound activation, timer reminders and per-child Repeat until accepted controls together on the Notifications settings page. Link it from general settings, Owlet alert levels and the home bell history. Show permission and registration status for the current account on this device, give iPhone/iPad installation guidance only when needed, and offer a test push to this device. Device preferences default on, preserve saved Off choices, and respect browser permission and audio activation requirements. Check and repair missing/expired registrations on app opening and foreground return without resetting valid delivery queues or provider backoff. Alert connection failures must be visible even with no cached alerts.

The home bell opens recent notifications for the household. Keep one record per original Owlet event, with its original start time and Active, Paused (charging), Accepted or Sent status; acceptance updates that same record with server-confirmed time. Repeated push attempts never create extra history rows. Timer reminder repeats share one history entry per timer; test pushes appear after provider acceptance. Keep history private to the signed-in account and household.

The iOS Home Screen badge counts Owlet alerts awaiting explicit acceptance across the caregiver's households. Repeated pushes set an absolute count. Support declarative push fallback alongside legacy workers. System sharing is limited to invitation links, opened from an explicit tap after link creation; retain Copy and treat cancellation neutrally. Request offline storage protection and explain automatic uploads while open/on return. Preserve pending records on expired login. Media attachments are planned in docs/PLAN.md and must not be implemented in this phase. On October 4, 2026, the user authorized committing, pushing and deploying the current notification center and prior iOS/offline changes to the existing Hank deployment.

Owlet collection and visible GUI refresh target five seconds. Keep complete poll history even when measurement timestamps repeat. Graphs need closely spaced, readable Y-axis increments and matching gridlines in overview, detail, standby and activity trends. Graphs must show missing data clearly, preserve extrema when summarizing, and allow browsing earlier dates alongside feeds, sleep and spasms.

Owlet always follows the globally selected child. Keep sock connection, custom alerts and history downloads in Settings. The main Owlet page shows one graph with independent metric toggles for heart rate, oxygen, movement, battery and signal. Overlay multiple selected metrics on the same timeline with separate color-matched numeric scales; default to heart rate and oxygen together. Keep a Full logs button. Main-chart touches must allow vertical scrolling without opening details or scrubbing. Use an explicit Open details button to enter the selected metric, with touch/mouse scrubbing and individual-reading navigation. Offer ranges from 10 minutes through one year.

Dark mode must cover app pages, portal sheets, menus, option pickers, forms and messages, including the PWA page background and browser theme color. Dismissible app overlays retain close buttons and support swipe dismissal. Downward gestures dismiss sheets; rightward gestures return from nested Owlet views. Keep scrolling, form controls and graph scrubbing independent of dismissal gestures.

Owlet Repeat until accepted is optional per child and shared by the household. Repeating alerts retain their original triggering reading and require explicit, server-confirmed Accept in the urgent panel or bell history; swipes, Escape and opening a phone notification never accept them. Pending alerts must appear across pages and child selections. Target one-second foreground sound and push delivery attempts while respecting browser audio restrictions, phone notification controls and push-service backoff. New settings default on; preserve existing saved repeat choices and never invent alert thresholds. Allow notification settings and history to open while an alert is active without accepting it.

Owlet landscape standby follows the approved Bedside glance design: large heart rate and oxygen values, rose heart icon and teal O₂ text, paired trends, range picker, freshness and sock battery. Open it from Owlet; it follows the selected child. Live values stay separate from graph inspection. Keep Exit and swipe dismissal, missing-data gaps, stale/error states, and urgent explicit-Accept alerts above standby.

## Publication candidate runtime

The owner authorized resolving the publication provenance gaps on October 8, 2026. The unverified legacy phone-frame preview, simulated keyboard, device images, Sites worker and their fixtures were removed from this isolated publication candidate. The supported runtime is the implemented native PWA at `pwa.html` / `src/pwa.tsx`; `src/ui.tsx` retains its existing native controls, scrolling and Radix sheets. Preserve the care workflows and browser-native keyboard, safe areas, dark mode, offline storage, alert acceptance and notification behavior.

`npm run dev` and `npm run dev:pwa` serve the PWA. `npm run build` and `npm run build:pwa` produce `dist/pwa`, including full third-party notices. Run the build, `node --test tests/domain/*.test.ts`, and relevant browser flows for a runtime change. Use a task-specific Playwright CLI session and preserve other sessions on this host. Do not restore the removed prototype or copied publisher/device assets without verified permission.

The install icons are original procedural drawings generated by `scripts/generate-app-icons.mjs`. Activity icons come from the separately licensed Phosphor/Radix packages; preserve their notices. Do not infer permission from an image URL or attribution alone.
