// CRUD ladder — a higher action implies the lower ones on the SAME resource:
// delete ⇒ edit ⇒ create. Only the HIGHEST rung is ever stored (DB grants and
// the session/JWT carry one id per resource, not three); lowers are implied at
// check time. Single source for every side of the contract:
//   • hasPermissionWithScope passes an edit/create check when a higher rung is
//     held (server routes + client checks share it),
//   • authorizeStaff normalizes the effective set (drops stored lowers) so
//     legacy triads stop riding the JWT,
//   • the Role editor expands on load / normalizes on save, so ticking Delete
//     shows Edit + Create ticked but persists just customers:delete.
// Matching is on the LAST id segment only, so per-kind voucher gates
// (finance:voucher:<action>:<kind>), ui:sidebar:* links, and one-off toggles
// are never touched.

const LADDER = ["create", "edit", "delete"] as const;

function splitCrud(id: string): { base: string; idx: number } | null {
    const i = id.lastIndexOf(":");
    if (i < 0) return null;
    const idx = (LADDER as readonly string[]).indexOf(id.slice(i + 1));
    return idx >= 0 ? { base: id.slice(0, i), idx } : null;
}

/** Lower actions a grant confers: delete → [edit, create]; edit → [create]. */
export function crudImpliedByGrant(id: string): string[] {
    const p = splitCrud(id);
    if (!p) return [];
    return LADDER.slice(0, p.idx).map((a) => `${p.base}:${a}`);
}

/** Higher actions that imply this one (to revoke together): create → [edit, delete]. */
export function crudDependentsOnRevoke(id: string): string[] {
    const p = splitCrud(id);
    if (!p) return [];
    return LADDER.slice(p.idx + 1).map((a) => `${p.base}:${a}`);
}

/** True when `id` is held directly OR implied by a higher rung in the set. */
export function crudSatisfied(permissions: ReadonlySet<string>, id: string): boolean {
    if (permissions.has(id)) return true;
    return crudDependentsOnRevoke(id).some((higher) => permissions.has(higher));
}

/** Strip lowers implied by a higher rung present in the set — what gets STORED
 *  (role grants) and CARRIED (session/JWT): one id per resource, the highest. */
export function normalizeCrudGrants(ids: Iterable<string>): Set<string> {
    const set = new Set(ids);
    for (const id of [...set]) {
        if (crudDependentsOnRevoke(id).some((higher) => set.has(higher))) set.delete(id);
    }
    return set;
}

/** Add lowers implied by each id — for DISPLAY (Role editor load), never storage. */
export function expandCrudGrants(ids: Iterable<string>): Set<string> {
    const set = new Set(ids);
    for (const id of [...set]) {
        for (const lower of crudImpliedByGrant(id)) set.add(lower);
    }
    return set;
}
