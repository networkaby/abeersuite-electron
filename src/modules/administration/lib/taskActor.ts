// The actor-snapshot helper now lives in shared (reused by CRM). Re-exported
// here under the original name so existing admin-tasks imports keep working.
export { buildActorSnapshot as buildTaskActor } from "@/shared/lib/auth/actorSnapshot";
