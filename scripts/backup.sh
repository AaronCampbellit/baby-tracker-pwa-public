#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
backup_dir="${1:?Supply an absolute backup destination directory}"
case "$backup_dir" in /*) ;; *) echo 'Backup directory must be absolute' >&2; exit 1;; esac
umask 077
mkdir -p "$backup_dir"
backup_file="$backup_dir/baby-$(date -u +%Y%m%dT%H%M%SZ).dump"
cd "$project_dir"
docker compose --env-file "${BABY_ENV_FILE:-.env}" exec -T db pg_dump -U baby -d baby -Fc > "$backup_file.partial"
mv "$backup_file.partial" "$backup_file"
echo "$backup_file"
