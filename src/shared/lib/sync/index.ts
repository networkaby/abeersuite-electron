// The replica sync ENGINE is not here — it lives in `sync-engine/` at the repo root and
// runs as a supervised child process (see electron/syncManager.ts). It was a separate
// product until 2026-08-26 (`tools/counter-sync`) and moved in whole rather than being
// rewritten, because it is proven against real data.
//
// What lives in this folder is the counter's own push side — `outbox.ts`, `push.ts` and
// `flusher.ts`, reached by direct path from `/api/sync/*` and `instrumentation.ts`, not
// through this barrel — plus the shared types below.
//
// There is NO change channel in this folder. The one channel the app broadcasts on is
// `app:changes`, in `../realtime/appChannel.ts`. The worker listens on that same channel
// (`sync-engine/lib/signal.js`) to sync sooner than its timer would, and
// `useRealtimeTopics` listens to it to refetch. One channel, both consumers.
//
// `realtimeSync.ts` used to sit beside this file, opening a SECOND Supabase channel
// ("abeersuite:sync-events") in every tab — outside the tab-leader election, so it cost
// a connection per TAB rather than per computer. It was removed on 2026-09-01 because
// nothing ever published on it: `broadcastTableMutation` had no callers anywhere, the
// `app:live-delta` window event it also listened for was never dispatched, and the
// worker was already on `app:changes`. A design the sync-engine move superseded, left
// subscribing to silence.
export * from "./types";
export * from "./replicaProgress";
