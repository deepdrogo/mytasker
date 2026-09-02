#!/usr/bin/env bash
# Zero-surprise production deploy for MyTasker.io. Run as root (systemctl) from any directory.
#   deploy/deploy.sh            # full: deps, migrate, collectstatic, frontend build, restart
#   deploy/deploy.sh --backend  # skip frontend build
#   deploy/deploy.sh --frontend # only rebuild the SPA (no restarts)
set -euo pipefail

ROOT=/home/mytasker/htdocs/mytasker.io
BACKEND=$ROOT/backend
FRONTEND=$ROOT/frontend
PY=$BACKEND/.venv/bin/python
APP_USER=mytasker

DO_BACKEND=1
DO_FRONTEND=1
case "${1:-}" in
  --backend) DO_FRONTEND=0 ;;
  --frontend) DO_BACKEND=0 ;;
  "") ;;
  *) echo "unknown flag: $1" >&2; exit 2 ;;
esac

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ $DO_BACKEND == 1 ]]; then
  log "Backend: dependencies"
  "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"

  log "Backend: checks"
  (cd "$BACKEND" && "$PY" manage.py check --deploy)
  (cd "$BACKEND" && "$PY" manage.py makemigrations --check --dry-run >/dev/null) || {
    echo "Unapplied model changes: run makemigrations first." >&2; exit 1; }

  log "Backend: migrate + collectstatic"
  (cd "$BACKEND" && "$PY" manage.py migrate --noinput)
  (cd "$BACKEND" && "$PY" manage.py collectstatic --noinput >/dev/null)
fi

if [[ $DO_FRONTEND == 1 ]]; then
  log "Frontend: build"
  (cd "$FRONTEND" && npm ci --silent && npx tsc --noEmit -p . && npm run build --silent)
fi

log "Permissions"
chown -R "$APP_USER:$APP_USER" "$ROOT"
chmod 640 "$BACKEND/.env"
chmod -R o+rX "$FRONTEND/dist" "$BACKEND/staticfiles"

if [[ $DO_BACKEND == 1 ]]; then
  log "Services"
  cp "$BACKEND"/deploy/systemd/*.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --quiet mytasker-web mytasker-worker mytasker-beat
  systemctl restart mytasker-web mytasker-worker mytasker-beat

  if ! cmp -s "$BACKEND/deploy/nginx/mytasker.io.conf" /etc/nginx/sites-enabled/mytasker.io.conf; then
    log "nginx vhost changed - installing"
    cp "$BACKEND/deploy/nginx/mytasker.io.conf" /etc/nginx/sites-enabled/mytasker.io.conf
    nginx -t && systemctl reload nginx
  fi

  log "Health"
  sleep 2
  for i in 1 2 3 4 5; do
    if curl -fsS https://mytasker.io/health/ >/dev/null; then echo "ok"; break; fi
    [[ $i == 5 ]] && { echo "health check failed" >&2; journalctl -u mytasker-web -n 30 --no-pager; exit 1; }
    sleep 2
  done
  systemctl --no-pager --lines=0 status mytasker-web mytasker-worker mytasker-beat | grep -E "●|Active:"
fi

log "Done"
