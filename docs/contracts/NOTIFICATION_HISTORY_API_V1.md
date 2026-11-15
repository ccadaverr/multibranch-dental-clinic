# Notification history API v1 — Joevan, 2026-11-15

Implemented in source; PostgreSQL acceptance pending an owned Linux runtime. No schema, retention, archive, restore, hard-delete, clinical or provider changes.

- `GET /api/notifications`: authenticated recipient's newest 50 rows, descending existing insertion ID. Existing response rows stay `{id,kind,title,body,target,created_at,read}`; `created_at` uses the Manila offset.
- Optional `?before=<public notification ULID>` fetches up to 50 strictly older rows. Cursor lookup is limited to the signed-in recipient, including Owner. Invalid ULID:422 `{message,errors}`; missing or another recipient's cursor:404. Caller-supplied user/branch cannot widen visibility.
- Metadata: `{unread,has_more,next_before}`. `unread` is the current total across that recipient's history, independent of pagination. `next_before` is the last row's public ID when more rows exist, otherwise null. A newer insert does not shift the older cursor pages.
- `POST /api/notifications/{id}/read`: existing recipient-only idempotent update, preserving the first read timestamp. Returns the latest first-page response and `meta.read_id` identifying the exact confirmed target, which can be older than that page. Another recipient's ID:404. No revision/operation UUID is required for this monotonic transition.
- `POST /api/notifications/read-all`: unchanged recipient-only, repeat-safe transition and current first-page readback.

The Staff/Dentist/Owner shell can load older pages, retains already loaded history after a failed page request, and rejects repeated/contradictory cursor pages. A successful read refreshes to the first page; use Load older notifications again for older history. Existing account/auth-generation/unmount guards remain. The separate Patient portal is unchanged and continues showing its existing recent window. This distinction is intentional domain ownership, not a full GEN-10 closure.

GEN-10 requires archival as well as date grouping; archival is **not implemented** here. GEN-11's entity-specific archive/restore and approved retention rules must be settled before adding archive schema or exposing delete controls. There is no archive capability advertised by this response.

Acceptance source: `NotificationHistoryTest` (guarded PostgreSQL; authored, not executed), `notif01-server-feed.test.js`, and synthetic `tests/fixtures/notification-history.html`. The browser fixture proves UI paging/recovery only, not actual PostgreSQL isolation or persistence.
