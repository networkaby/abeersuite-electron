/**
 * Models a counter must never push to the cloud, whatever it managed to write locally.
 *
 * Shared by two consumers that must agree:
 *   - `push.ts` refuses these at push time (defence in depth).
 *   - `scripts/gen-local-schema.ts` attaches NO `_outbox_capture` trigger to their
 *     tables, so a local write to them never enters `_outbox` in the first place.
 *
 * The second is what stops the status badge counting a dead-lettered `User` row as a
 * "sync error" forever: the row was captured, then correctly rejected, and the only
 * thing it ever did was worry the cashier.
 *
 * A denylist rather than an allowlist, deliberately. An allowlist is what the previous
 * design used, and a model missing from it failed silently — which is how 27 models
 * came to write locally and never sync. A denylist fails OPEN, so a table added
 * tomorrow syncs by default and only the genuinely dangerous ones need remembering.
 *
 * Model names as in `prisma/sync-tables.json`, not physical table names. No imports:
 * the generator runs under tsx outside the Next alias map.
 */
export const NEVER_PUSH_MODELS: readonly string[] = [
    "User", "Session", "Account_auth", "UserPermission", "UserPosition",
    "RolePermission", "DepartmentPermission", "PersonPortalCredential",
    // `OfflinePolicy` is deliberately NOT here. A counter that writes locally
    // (WRITE_MODE=local) is the web app for that shop, so an admin saving the policy
    // there must reach Supabase like any other setting. The one case where the row
    // must not be written — a live-write counter cut off from Supabase — is refused
    // by the replica guard before anything reaches the outbox.
];
