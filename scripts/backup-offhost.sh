#!/usr/bin/env bash
set -euo pipefail
# Run on an operator-managed backup machine. Never print credentials.
backup_host="${BABY_BACKUP_SSH_HOST:?Set BABY_BACKUP_SSH_HOST to your deployment SSH destination}"
remote_project_dir="${BABY_BACKUP_REMOTE_PROJECT_DIR:?Set BABY_BACKUP_REMOTE_PROJECT_DIR to the absolute remote Compose directory}"
case "$remote_project_dir" in /*) ;; *) echo 'Remote project directory must be absolute' >&2; exit 1;; esac
backup_dir="${1:-${BABY_BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/baby-tracker-backups}}"
case "$backup_dir" in /*) ;; *) echo 'Backup destination must be absolute' >&2; exit 1;; esac
# SSH receives one remote shell command. Quote the configured path as a literal,
# including embedded apostrophes, rather than letting it become shell syntax.
remote_project_quoted="'${remote_project_dir//\'/\'\\\'\'}'"
umask 077
mkdir -p "$backup_dir"
exec 9>"$backup_dir/.lock"
flock -n 9 || exit 0
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="$backup_dir/baby-$stamp"
trap 'rm -f "$base.dump.partial" "$base.owlet-key.partial"' EXIT
ssh -- "$backup_host" "cd -- $remote_project_quoted && docker compose exec -T db pg_dump -U baby -d baby -Fc" > "$base.dump.partial"
# The encryption key is required to restore saved Owlet sessions. Keep it private
# alongside the dump; do not copy the host .env or any account password.
ssh -- "$backup_host" "cd -- $remote_project_quoted && docker compose exec -T app node -p 'process.env.OWLET_TOKEN_KEY || \"\"'" > "$base.owlet-key.partial"
test -s "$base.dump.partial"
test -s "$base.owlet-key.partial"
python3 - "$base.dump.partial" "$base.owlet-key.partial" <<'PY'
import sys, base64
from pathlib import Path
with open(sys.argv[1], 'rb') as dump:
    if dump.read(5) != b'PGDMP': raise SystemExit('Invalid backup header')
if len(base64.b64decode(Path(sys.argv[2]).read_text().strip(), validate=True)) != 32:
    raise SystemExit('Invalid Owlet recovery key')
PY
mv "$base.owlet-key.partial" "$base.owlet-key"
mv "$base.dump.partial" "$base.dump"
printf 'Off-host database backup completed: %s\n' "$stamp"
