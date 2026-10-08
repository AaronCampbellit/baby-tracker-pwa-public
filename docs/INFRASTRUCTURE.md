# Hosting and storage guidance

Run the app, reminder worker, Owlet worker and PostgreSQL in an isolated Docker Compose project on infrastructure you control. The checked-in Compose file keeps PostgreSQL on the internal network and publishes only the app to a loopback address. Route an operator-owned HTTPS origin through a reverse proxy or tunnel; do not expose the database.

Choose resources using your expected household count, notification workload, archive growth and other services on the host. The repository does not publish a benchmark or guarantee a minimum host capacity. Check available RAM, sustained CPU load, disk headroom and database growth before rollout. Build images separately when host capacity is limited.

Owlet polls, detailed readings and downloaded provider logs are retained without automatic expiry. Database archives and images also consume storage. Set operational monitoring and a retention/recovery plan before relying on this as a durable record store. Media uploads and household storage quotas remain future work; the current source does not implement the attachment plan in `PLAN.md`.

Keep the database volume, stable VAPID keys and `OWLET_TOKEN_KEY` through upgrades and host moves. Use private off-host backups, and test restoration into a disposable database before a recovery event. Backups contain household records, password hashes and push subscriptions; the matching recovery key permits access to saved Owlet sessions.

[Deployment and backup instructions](DEPLOYMENT.md) describe portable configuration and optional systemd templates. Historical private machine inventories, SSH aliases, tunnel configuration versions and disk observations are withheld. Earlier pilot observations do not qualify this public snapshot for a new deployment.
