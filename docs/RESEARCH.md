# Nara Baby research

Research date: September 16, 2026. Scope: public evidence about Nara Baby's current functionality, visual language, caregiver workflows, user friction, and implications for a predominantly mobile PWA replacement. Audience: parents and caregivers, with the owner's household as the provisional first audience.

## Executive read

Nara's central value is making repeated daily logging easy while keeping caregivers informed. A replacement should make the last feed, last diaper, and current sleep state immediately visible. Public screenshots show activity cards and sheets that keep complex entry forms close to that daily overview. Its broader feature set now extends into solids, growth, routines, pregnancy, and postpartum tracking. Paid access is confirmed, although transition offers differ from standard pricing. The best initial scope is a dependable shared daily tracker, with migration and deeper history treated as first-class decisions rather than afterthoughts.

## Subscription change: confirmed versus reported

The official FAQ lists $9.99/month or $99.99 lifetime, promotional eligibility, and a seven-day trial. One payment covers a family. Without paid access, existing records remain viewable and exportable but new logging stops. It documents CSV export from the child's avatar on Activity → Export Data. [Official FAQ](https://nara.com/pages/nara-baby-app-faqs)

September 16 user reports describe an October 8, 2026 transition and existing-user offers around $6.99/month or $69.99 lifetime. These dates and discounts are user reports, not independently verified rollout terms for this household. [Transition discussion](https://www.reddit.com/r/beyondthebump/comments/1wi5rez/rip_free_nara_baby_app/), [second discussion](https://www.reddit.com/r/NewParents/comments/1wi8obr/nara_app_changed_to_subscription_model/)

Some indexed store descriptions still call the app free. The live FAQ explicitly describes paid access; store marketing can lag the transition. Do not assume every user sees the same offer.

## Feature inventory

Confirmed advertised features below do not imply that every flow was tested hands-on.

| Area | Nara capability | Proposed priority |
|---|---|---|
| Breastfeeding | Left/right timing and last-side context | MVP if used |
| Bottles | Milk/formula type, time, quantity | MVP |
| Pumping | Timers and expressed volume | MVP if used |
| Diapers | Wet, dirty, dry, rash recording | MVP |
| Sleep | Live/manual sessions, naps, nighttime, patterns | MVP |
| Solids | Food selection and feeding records | Early expansion or MVP by age |
| Growth | Weight, length/height, head circumference | Expansion |
| Health | Medications, vaccinations, medical notes | Move into MVP if essential |
| Development | Milestones, photos and memories | Expansion |
| Routines | Tummy time, bath, story time and custom routines | Expansion |
| Parents | Pregnancy symptoms/vitals, postpartum recovery, mood, journaling | Separate optional scope |

Feature evidence: [iOS listing](https://apps.apple.com/us/app/nara-baby-pregnancy-tracker/id1444639029), [Android listing](https://play.google.com/store/apps/details?hl=en&id=com.naraorganics.nara).

Cross-cutting capabilities include multiple children, shared caregivers, notes, photos, and activity customization. Native integrations include Apple Watch, Live Activities, and Siri. Age-based feeding and sleep guides are also advertised. [Official product page](https://nara.com/pages/nara-baby-tracker-app)

The FAQ additionally documents adjustable historical entries, family invitations, multiple-family membership, recurring nap reminders, and fixed-time versus wake-window schedules. It says in-app trends are limited to 14 days and recent item lists cannot be edited directly. Family creators can remove caregivers; invited caregivers otherwise have full access. [Official FAQ](https://nara.com/pages/nara-baby-app-faqs)

## Look and feel: inspected evidence

Eight external reference images were visually inspected; see the [source-link index](references/README.md). Downloaded copies were removed from this publication candidate because their public redistribution permission was unverified. Studio assets live under a 2021 upload path, so treat them as historical design evidence. The current official product page's sleep and solids images offer a more recent comparison. These are promotional examples, not captured sessions from the currently installed iOS app.

Observed visual traits:

- Warm pale background, white cards, serif display text, sans-serif controls.
- Colored section bands: pale blue sleep, yellow feeding, muted rose pumping.
- Large elapsed times and quantities; circular add buttons and rounded sheets.
- The historical home has Activity, History, Trends, and Family tabs.
- History is a seven-column day/time visualization; sleep trends offer calendar, graph, and entry views.
- Older examples use green text; current official examples use blue text and an orange timer action.

The studio describes research with parents, adjustable activity ordering, shared use, and support for light/dark modes. A dark-mode screen was not captured. [Design case study](https://everydayindustries.com/casestudy/mobile-app-ui-design-case-study/)

Design inference for our app: preserve scanability, familiar categories, and short logging paths. Use our own name and visual assets. Exact typography, colors, current navigation, and animations remain unverified; do not claim pixel-perfect parity.

## Ranked opportunities

These ranks reflect likely impact on this replacement, not a statistically representative survey.

| Priority | Problem / user goal | Evidence and frequency | Confidence / impact | Product response |
|---|---|---|---|---|
| 1 | Continue daily logging without a new subscription | Several same-day public transition threads; official paid model | High on change; unknown population frequency / high impact | Decide funding/hosting model; keep core scope sustainable |
| 2 | Know what another caregiver just did | Shared care appears in official positioning and user reviews | High on use case; no measured failure rate / high impact | Shared latest events, author labels, clear sync state |
| 3 | Keep useful historical data when switching | Official export flow; trends limit documented | High on export availability, unknown import demand / high impact | Ask for migration need; inspect an export before promising parity |
| 4 | Correct a time quickly without accidental dismissal | One Android review reports time-picker button placement problems | Medium, single anecdote / medium impact | Direct time entry; separate Save/Cancel from input interaction |
| 5 | Coordinate twins with less repeated work | One August 2026 review requests multi-child copying and caregiver alerts | Medium, single anecdote / situational impact | Clear child context; consider explicit copy-to-child later |
| 6 | Remove irrelevant food/formula/routine suggestions | FAQ documents recent-list restrictions | High on restriction, unknown frustration frequency / low-medium impact | Editable favorites and archived suggestions |

Review evidence: [Google Play reviews](https://play.google.com/store/apps/details?hl=en&id=com.naraorganics.nara). Pricing evidence: [user reports](https://www.reddit.com/r/beyondthebump/comments/1wi5rez/rip_free_nara_baby_app/). Product restrictions: [FAQ](https://nara.com/pages/nara-baby-app-faqs).

Reliability is a proposed engineering priority, not a claim that Nara loses records. This scan did not establish a recurring sync or data-loss defect. There is insufficient evidence to rank onboarding failures, support quality, or developer/API friction. We did not access private support records or accounts.

## PWA implications

Home Screen web apps support standalone presentation; iOS/iPadOS 16.4 introduced Web Push for installed web apps. Notifications require permission and appropriate user interaction. [WebKit overview](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

Service workers are event-driven and may be stopped. We should persist timer timestamps and reconstruct elapsed time on resume rather than relying on continuous JavaScript execution. Offline writes should retry on reopen and reconnect; background execution must be an enhancement, not a prerequisite. [MDN background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

Browser storage can be evicted. Requesting persistence is useful, but local storage alone is not a backup strategy. Recommend server synchronization plus user exports and tested server backups. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

Apple documents Web Push separately from native integrations. The PWA plan does not promise Watch apps, Siri intents, Dynamic Island timers, or Live Activities; native parity needs a later feasibility decision. Push reminders are best effort and should not be treated as guaranteed alarms. [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

## Opportunity roadmap

- Next working phase: confirm household needs, choose a visual direction, inspect migration format if needed, and prove timer recovery/offline logging on a real iPhone.
- Initial release cycle: reliable core tracking, caregiver access, import/export, history, installation guidance, and backup/restore.
- Subsequent quarter-sized scope: richer trends, routines/solids/growth, configurable reminders, and broader family rollout according to usage.
- Deeper research: actual Nara export schema and attachment availability, detailed caregiver permissions, current installed-app navigation, device baseline, and whether native-only features are essential.

## Source map and limits

| Source | Contribution | Limit |
|---|---|---|
| Nara live FAQ | Pricing, export, reminders, access rules | Contains unfinished pregnancy text; no household-specific offer verification |
| Apple/Google listings | Broad feature coverage and native integrations | Advertised features; stale free wording exists |
| Official product page | Current marketing images, care-sharing positioning | Promotional selection |
| Everyday Industries | Design rationale and detailed screen references | Historical screenshots mixed with ongoing case study |
| Reddit parent/caregiver/pumping threads | Immediate reaction to transition | Self-selected anecdotes; no prevalence estimates |
| Google Play reviews | Concrete input and coordination requests | Isolated reviews, Android-specific details |
| WebKit, MDN, Apple | PWA platform constraints | Real-device testing still required |

Searches focused on Nara features, subscription changes, export, screenshots, design studio work, parent/caregiver feedback, and iOS PWA behavior. No app account was created and no authenticated native app session was tested. Exact data formats, attachment migration, notification timing, and field-level parity remain open.
