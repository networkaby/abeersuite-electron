// The replica sync ENGINE is not here — it lives in `sync-engine/` at the repo root and
// runs as a supervised child process (see electron/syncManager.ts). It was a separate
// product until 2026-08-26 (`tools/counter-sync`) and moved in whole rather than being
// rewritten, because it is proven against real data.
//
// What remains here is the browser half: the realtime channel the app already
// broadcasts on after every successful write. The worker listens to the same channel to
// sync sooner than its timer would, and `useRealtimeTopics` listens to it to refetch.
//
// `syncWorker.ts` and `outbox.ts` used to sit beside this file as stubs — the worker
// returned `rowsSynced: 0` without querying anything and the outbox was an in-process
// array with no callers. Both were superseded and removed rather than left to look
// implemented. A real, durable outbox arrives with offline writes.
export * from "./types";
export * from "./realtimeSync";
