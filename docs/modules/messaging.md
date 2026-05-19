# Messaging & Social

> Internal chat (per-user inbox + room types), notifications (bell + toast), and a small Orkut/old-Facebook-style staff wall + customer privacy circles.

## URLs

### UI pages
- `/office/message/inbox` — chat rooms list + unread counts.
- `/office/message/inbox/[roomId]` — message thread.
- `/office/me` — staff profile / wall view.
- `/office/social/users/[id]` — staff profile + wall page (also rendered from notifications).
- `/portal/social` — customer-side social feed (privacy circles). See [customer-portal.md](./customer-portal.md).

### API routes
- `/api/inbox/rooms[/[id]]` — room CRUD.
- `/api/inbox/rooms/[id]/messages` — paginated message read/send.
- `/api/notifications` — list bell items.
- `/api/notifications/[id]/read` — mark read.
- `/api/posts[/[id]]` — staff wall posts.
- `/api/posts/[id]/comments` — threaded comments.

## Prisma models

- `ChatRoom` (in `prisma/schema/inbox.prisma`) — `kind` enum: `SYSTEM_INBOX` (broadcast), `PERSONAL`, `ROLE_GROUP` (everyone in role X), `DIRECT_MESSAGE`.
- `ChatRoomMember` — membership + `lastReadAt` for unread counting.
- `ChatMessage` — body, attachments, timestamps.
- `Notification` — bell items.
- `Post` + `Comment` (in `prisma/schema/social.prisma`) — staff wall.
- `WallPost` — see `social.prisma`; customer privacy circles modelled here.

## Key components / library

- `src/modules/message/components/InboxModule.tsx` — Slack-style real-time chat UI mounted at `/office/message/inbox`.
- `src/modules/message/components/NotificationBell.tsx` — bell with Supabase Realtime listener for live unread counts.
- `src/modules/message/lib/inbox.ts` — room membership helpers (`listAccessibleRooms`, `markRoomRead`, etc.).

## Common workflows (wiring)

1. **Send a DM** — `/office/message/inbox/[roomId]` → POST `/api/inbox/rooms/[id]/messages` → Supabase Realtime broadcasts → recipient's `NotificationBell` increments and `MessageThread` appends in real time.
2. **System inbox notification** — server emits via `prisma.notification.create` + Supabase channel publish; bell listener picks it up.
3. **Customer wall post** — privacy circles control who sees: `inner` (close contacts) or `outer` (broader).

## Recent decisions / gotchas

- **Supabase Realtime** is the live channel; not WebSockets directly. Connections are established in `NotificationBell` mount.
- **No push notifications** to phones — bell only.
- **System inbox is broadcast-only** — staff can't reply to it.

## Out of scope / deferred

- Email / SMS / WhatsApp notification fan-out.
- Reactions, threading, file uploads in messages.

## Reusable helpers — DO NOT duplicate

| Symbol | File | Purpose |
|---|---|---|
| `listAccessibleRooms(user)`, `getAccessibleRoom(user, id)`, `markRoomRead(userId, roomId, at?)`, plus room/membership helpers | `src/modules/message/lib/inbox.ts` | Everything room-scoped: filtering by membership, computing unread counts, marking read. Use these from any route that reads or mutates inbox rooms — don't reach into the Prisma `ChatRoom` / `ChatRoomMember` / `ChatMessage` tables directly. |

_Last updated: 2026-05-19 — Prisma model names corrected (`ChatRoom`/`ChatRoomMember`/`ChatMessage` not `Room`/`RoomMember`/`Message`); customer social route corrected (`/portal/social` not `/(external)/customer/social`); added `InboxModule.tsx` component reference._
