# MyTasker.io — Architecture

A control center for life, business, projects, prompts, time, routine, teams, Telegram and AI.
Production-grade backend, extremely minimal monochrome frontend.

## 1. Runtime topology

```
Browser (SolidJS SPA)  ──HTTPS──┐
Telegram Bot API  ──webhook──┐  │
                             ▼  ▼
                          nginx (TLS, static SPA, /api + /ws proxy)
                             │
                    uvicorn (Django ASGI, 127.0.0.1:8015)
                     │        │            │
              PostgreSQL 16  Redis     Celery worker + beat
              (source of     (cache/    (notifications, telegram,
               truth)         broker/    analytics, reminders,
                              channels)  recurrence, cleanup)
```

Redis is never a source of truth: it holds cache, the Celery broker, the Channels layer,
rate-limit counters and short-lived locks only.

## 2. Repository layout

```
backend/    Django project (config/, common/, apps/*)
frontend/   SolidJS SPA (src/app, routes, layouts, components, features, api, stores, hooks)
backend/deploy/  systemd units, nginx vhost, deploy.sh
docs/       this document
```

## 3. Backend layering

```
HTTP view / WS consumer / Telegram handler / AI tool
        │  (thin: parse + authorize + delegate)
        ▼
    services.py      business rules, transactions, domain events
        │
        ▼
    models.py        persistence + `visible_to` managers (single visibility source)
    selectors.py     read queries, annotations, aggregations
```

Rules:
- No business logic in serializers or views.
- Every mutating service takes an `Actor` (`common/actors.py`).
- Every mutation that matters emits a `DomainEvent` (`common/events.py`).

## 4. Authorization model

`common/permissions.py` is the only place that answers "may X do Y".

| Capability | Minimum role |
| --- | --- |
| view, view activity, view shared prompts | viewer |
| create/edit/complete task, comment, track time, edit shared prompts | member |
| delete task, manage members, manage project | admin |
| change project mode, delete project | owner |

Object visibility (`Task`, `Prompt`, `Comment`, `ActivityEvent`) is enforced by a
`visible_to(user)` queryset method on each model manager. REST, global search, AI tools,
WebSocket fan-out, Telegram messages and exports all go through it — there is no second
implementation to keep in sync.

Group Plus rule: an object with `visibility=private` inside a `group_plus` project is returned to
its owner only. Private items are filtered at the SQL level, never hidden in the frontend.

## 5. Project modes

- `private` — owner only, memberships ignored.
- `group` — collaborative; all items are group-visible.
- `group_plus` — collaborative, but the owner may mark individual tasks/prompts `private`.

## 6. Domain events

`emit(DomainEvent)` writes an `ActivityEvent` + `AuditLog` inside the caller's transaction, then
schedules post-commit handlers via `transaction.on_commit`. Handlers publish to WebSocket groups
and enqueue the Celery notification fan-out. Nothing calls Telegram directly from a view.

```
service mutation → emit() → ActivityEvent + AuditLog (same transaction)
                          → on_commit → realtime publish
                                      → Celery: dispatch_event
                                             → recipients × preferences
                                             → Notification rows
                                             → TelegramDelivery (idempotency_key)
                                             → Celery: send_telegram (retry-safe)
```

## 7. Telegram

- Linking uses a one-time hashed token consumed by `/start <token>`; usernames are never trusted.
- Webhook path contains a secret and validates `X-Telegram-Bot-Api-Secret-Token`.
- `TelegramDelivery.idempotency_key` (unique) + `select_for_update` status check make retries
  duplicate-free.
- Owner alerts: for events in projects the recipient owns/administers, when the actor is someone
  else (member, guest, AI). Private Group Plus events go to the owner only.

## 8. AI

Claude never touches the database. `apps/ai/tools/` exposes an explicit registry; each tool
validates input with pydantic, resolves the actor, checks permissions, calls the same services the
REST API uses, and records an `AIAction` + `AuditLog`. Destructive or bulk operations become
`proposed` actions that require an explicit confirm call.

## 9. Timers

`TimeEntry` is authoritative. A partial unique index (`owner` where `ended_at IS NULL`) guarantees
a single running timer per user, which also prevents double counting. Pause/resume is modelled as
stop + a new entry linked through `resumed_from`. The browser only renders `now - started_at`.

## 10. Analytics

Nightly Celery writes `DailySummary` per user per local day. Weekly and monthly reviews aggregate
those rows. Today's numbers are computed live with SQL aggregation and cached in Redis for 60s.

## 11. Frontend

- Solid Router SPA; no full page reloads during navigation.
- `src/api/client.ts` centralises base URL, credentials, CSRF, error normalisation and 401 handling.
- Server state via `createQuery` (resource + cache + invalidation); UI, auth, timer and notification
  state live in separate small stores.
- Strict monochrome tokens in `src/styles/tokens.css`. State is communicated by contrast, borders,
  opacity, weight and icons — never hue.
- Mobile-first: bottom navigation, sheets and drawers; desktop uses a fixed sidebar with internal
  scrolling panels.

## 12. Deployment

Native systemd on the host (no Docker in production), all running as the unprivileged `mytasker` user:

| Unit | Command | Notes |
|------|---------|-------|
| `mytasker-web` | `uvicorn config.asgi:application --workers 2` on 127.0.0.1:8015 | HTTP + WebSockets, `--proxy-headers` trusted from 127.0.0.1 only |
| `mytasker-worker` | `celery -A config worker -Q default,notify` | 4 procs, recycled every 500 tasks |
| `mytasker-beat` | `celery -A config beat` with `DatabaseScheduler` | static `CELERY_BEAT_SCHEDULE` seeds the DB on first run |

Unit files live in `backend/deploy/systemd/`; the nginx vhost in `backend/deploy/nginx/mytasker.io.conf`.
nginx serves `frontend/dist` (SPA fallback to `index.html`, hashed `/assets/` cached for a year, `index.html` `no-cache`),
proxies `/api/`, `/admin/`, `/ws/`, `/health/` to uvicorn and serves `/backend-static/` from `staticfiles/`.
Security headers (HSTS, `X-Frame-Options: DENY`, strict CSP with `script-src 'self'`) are set by nginx; Django's
`prod.py` mirrors them for responses that bypass nginx. TLS is CloudPanel-managed.

Runbook:

```bash
backend/deploy/deploy.sh              # deps → check --deploy → migrate → collectstatic → SPA build → restart → health
backend/deploy/deploy.sh --frontend   # SPA only
python manage.py telegram_webhook     # once TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET are set in .env
journalctl -u mytasker-web -f         # JSON logs with secret redaction
curl https://mytasker.io/health/      # {"status":"ok","checks":{"db":true,"cache":true}}
```

Secrets are only in `backend/.env` (mode 640, owner `mytasker`). Local development runs the same
stack directly (`manage.py runserver` / `celery worker` / `vite dev` with the proxy in `vite.config.ts`).
