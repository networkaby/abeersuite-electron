# Messaging & Social

> Internal chat (per-user inbox + room types), notifications (bell + toast), and a small Orkut/old-Facebook-style staff wall + customer privacy circles.

## URLs

### UI pages
- `/office/inbox` — chat rooms list + unread counts
- `/office/inbox/[roomId]` — message thread
- `/office/me` — staff profile / wall view
- `/(external)/customer/social` — customer-side social feed (privacy circles)

### API routes
- `/api/inbox/rooms[/[id]]` — room CRUD.
- `/api/inbox/rooms/[id]/messages` — paginated message read/send.
- `/api/notifications` — list bell items.
- `/api/notifications/[id]/read` — mark read.
- `/api/posts[/[id]]` — staff wall posts.
- `/api/posts/[id]/comments` — threaded comments.

## Prisma models

- `Room` — `kind` enum: `SYSTEM_INBOX` (broadcast), `PERSONAL`, `ROLE_GROUP` (everyone in role X), `DIRECT_MESSAGE`.
- `RoomMember` — membership + lastReadAt for unread counting.
- `Message` — body, attachments, timestamps.
- `Notification` — bell items.
- `Post` + `Comment` — staff wall.
- `CustomerCircle` — inner / outer ring for customer privacy controls.

## Key components / library

- `src/modules/message/components/NotificationBell.tsx` — bell with Supabase Realtime listener for live unread counts.
- `src/modules/message/components/InboxRoomList.tsx`, `MessageThread.tsx`.
- `src/modules/social/components/Wall.tsx`, `Profile.tsx`.

## Common workflows (wiring)

1. **Send a DM** — `/office/inbox/[roomId]` → POST `/api/inbox/rooms/[id]/messages` → Supabase Realtime broadcasts → recipient's `NotificationBell` increments and `MessageThread` appends in real time.
2. **System inbox notification** — server emits via `prisma.notification.create` + Supabase channel publish; bell listener picks it up.
3. **Customer wall post** — privacy circles control who sees: `inner` (close contacts) or `outer` (broader).

## Recent decisions / gotchas

- **Supabase Realtime** is the live channel; not WebSockets directly. Connections are established in `NotificationBell` mount.
- **No push notifications** to phones — bell only.
- **System inbox is broadcast-only** — staff can't reply to it.

## Out of scope / deferred

- Email / SMS / WhatsApp notification fan-out.
- Reactions, threading, file uploads in messages.

_Last updated: 2026-05-07._
