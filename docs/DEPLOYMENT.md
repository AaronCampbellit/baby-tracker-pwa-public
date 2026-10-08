# Deployment and operations

Deploy on a host you control, using your own HTTPS origin and private configuration. This public source snapshot is separate from earlier private deployments; it contains no host inventory or production recovery receipts.

The app and reminder worker run as unprivileged Node containers. Postgres is on the internal Compose network. Only the app is published, to loopback port 4174. A reverse proxy or Cloudflare Tunnel on the host can reach `http://localhost:4174`; configure your HTTPS hostname to use that origin. Do not publish the database.

## Configuration

Copy .env.example to a mode-0600 .env. Generate a random hex database password. Set APP_ORIGIN to the exact HTTPS origin and SESSION_SECURE=true. VAPID keys must be generated once and preserved across releases; rotating them requires enrolling devices again. VAPID_SUBJECT can be the HTTPS app origin. Do not commit .env files.

For Owlet collection, generate a 32-byte random key as base64 and set OWLET_TOKEN_KEY in the private .env. Also supply OWLET_FIREBASE_API_KEY, OWLET_AYLA_APP_ID, OWLET_AYLA_APP_SECRET, OWLET_ANDROID_PACKAGE and OWLET_ANDROID_CERT from a client configuration you are authorized to use. All fields are required; the publication candidate bundles no third-party mobile-client key/shared secret and leaves real collection disabled when fields are missing. Do not paste private configuration into screenshots, source or Git history. Preserve this key with database backups: losing it makes saved Owlet access tokens unreadable and requires each account to reconnect. The app and owlet-worker receive the key; the reminder worker does not. The Owlet worker also receives the VAPID keys to send custom threshold notifications. It is separate so slow provider calls do not delay reminders.

For source builds, run `docker compose up -d --build`. For a prebuilt image, adapt `compose.deploy.yaml` to your own reviewed image tag and load or pull that image before running `docker compose up -d`. The template's `pilot` tag identifies an example convention, not a published image. The API applies versioned migrations before listening. The worker applies the same migrations under a shared advisory lock.

Create a family with `docker compose exec app node api/src/admin.ts create-family 'Household name'`. Hand the activation link to the owner privately. It expires in seven days and works once. Owners create caregiver links in Family. Invitations are copied manually; email delivery is not configured yet.

Reset a forgotten password with `docker compose exec app node api/src/admin.ts reset-password 'user@example.com'`. Give the one-hour link to that user privately. Resetting invalidates their existing sessions.

## Backups

Run `scripts/backup.sh /absolute/backup/destination` to produce a private-format Postgres dump. Set BABY_ENV_FILE=.env.local for the local development stack. The backup includes users, password hashes, household records, all Owlet archives, downloaded log bytes and alert levels, and push subscriptions: keep it private.

For off-host backup, run the script on a separate backup machine with SSH access to the deployment. Configure `BABY_BACKUP_SSH_HOST` and `BABY_BACKUP_REMOTE_PROJECT_DIR`; the latter must be an absolute directory containing the deployed Compose file and its private `.env`. `scripts/backup.env.example` uses fictional destination values. Set `BABY_BACKUP_DIR` or pass an absolute destination argument; otherwise the script uses `$XDG_DATA_HOME/baby-tracker-backups` (or `$HOME/.local/share/baby-tracker-backups`). Choose a private destination outside the checkout.

```sh
export BABY_BACKUP_SSH_HOST=app-host.example.test
export BABY_BACKUP_REMOTE_PROJECT_DIR=/srv/baby-tracker
scripts/backup-offhost.sh /absolute/private/backup-directory
```

Replace the example SSH destination with your own. Each dump has a matching `.owlet-key` recovery file; both use mode 0600. The script requires a valid configured `OWLET_TOKEN_KEY`, verifies the dump header and 32-byte key, removes partial files after failure, and prevents concurrent runs with a local lock. It never copies the complete remote `.env`. There is no automatic deletion or cloud replication: arrange retention, encryption at rest and an independent recovery location for your household's needs.

The optional systemd user-service convention installs the checkout at `$HOME/.local/share/baby-tracker-pwa` (or a symlink to your checkout) and private backup configuration at `$HOME/.config/baby-tracker/backup.env`. Copy `scripts/backup.env.example` to that configuration path, replace the fictional values and set mode 0600. Copy `baby-tracker-backup.service` and `baby-tracker-backup.timer` from `scripts/` into `$HOME/.config/systemd/user/`. The templates use systemd's `%h` home-directory specifier, with no owner-specific machine path.

After reviewing the configuration, run `systemctl --user daemon-reload` and `systemctl --user enable --now baby-tracker-backup.timer` on the backup machine. The example timer runs at 04:00 UTC daily and catches up after a missed run. Verify with `systemctl --user list-timers baby-tracker-backup.timer` and `journalctl --user -u baby-tracker-backup.service`. The machine and its user service manager must remain available; the template does not create an independent backup service or configure user lingering.

Restore into a NEW database for verification using `pg_restore --no-owner --no-acl`; never restore over the active database without a separate recovery decision. Keep the database volume, VAPID keys, and OWLET_TOKEN_KEY when moving hosts. Restore OWLET_TOKEN_KEY from the matching private recovery file without displaying it. App exports supplement, but do not replace, a database backup. Owlet CSV/JSON Lines exports are separate from care activity exports and exclude account connection tokens.

## Owlet collection operations

The collector targets five seconds between fetch starts, with a one-second scheduler tick. A slow request can exceed that target. Each normal fetch sends APP_ACTIVE then retrieves properties. Screen refreshes query our database and never multiply provider polls. Hidden screens pause polling and visible screens resume. The collector is independent of any open browser. Consecutive errors back off from five seconds to five minutes; 429 waits at least a minute and honors a longer Retry-After.

`owlet_polls` preserves complete parsed provider response objects, metadata and duplicate timestamps. Each poll has a duration and success/error state. Authentication headers and credentials are excluded. `owlet_readings` holds unique normalized measurement snapshots for graphs. `owlet_log_files` stores original downloaded bytes and metadata separately. Downloads permit HTTPS Ayla metadata and Ayla/S3 content hosts, refuse redirects, and enforce 10 MB per file. Pending or unsupported downloads remain visible; the archive does not claim to decode proprietary logs or recover missed historical readings. All three tables are preserved without automatic expiry. Runtime Docker console logs remain operational diagnostics; database poll records are the durable collection log.

## Mobile acceptance

Open the HTTPS site in Safari, activate your household, then Add to Home Screen. Open the installed app and use Your settings → Notifications → Enable this device, then send a test notification. Start a timer, verify Synced, switch apps, lock the phone, and tap a reminder to return. Test stop, corrected start/end time, offline start, reconnect, and a second caregiver stopping the timer. During an existing Owlet alert, open another enrolled phone and verify its Accept panel and bell history; accepting should update the same history entry with the original start and acceptance times. Delivery remains best effort; offline starts cannot schedule server reminders until synchronized.

## Current implementation boundaries

The pilot uses whole-household optimistic revisions. A conflict preserves local records and requests review rather than silently overwriting. Export unsynced changes before choosing the shared version. Fine-grained merge UI is not implemented. Forms record explicit caregiver input; growth percentiles, predictive guidance and photo uploads are not complete. Native iOS integrations are intentionally excluded. Nara Baby CSV import preserves original source files and source fields; supported export categories are mapped into the timeline, while unassigned Pump records require an explicit caregiver choice.

## Public snapshot verification and release boundaries

Prepublication checks used isolated builds, regression tests, disposable databases and synthetic browser fixtures. API/PWA builds and targeted care, notification and ownership regression suites passed in that preparation. Earlier private operational evidence, family onboarding details, machine capacity snapshots, deployed image receipts and backup filenames are withheld from this public repository.

The public candidate removes the legacy device-frame prototype and downloaded research/device images. Both frontend build commands produce the native PWA, with full library and OFL notices in `dist/pwa/third-party-licenses/`. The Docker image includes root terms/notices and retained API dependency licenses; the unmodified MPL-covered `web-push` source is included in `api/node_modules/web-push` and linked in the third-party notice.

These publication changes have not been deployed or authenticated against a real provider. Physical iPhone/iPad background push, audible alerts, standalone appearance, multi-caregiver recovery and live Owlet integration require acceptance on your own authorized setup. A notification already in transit can arrive after acceptance. Keep the provider's official app/base-station alarms enabled; this software does not guarantee emergency monitoring or uninterrupted phone alarms.
