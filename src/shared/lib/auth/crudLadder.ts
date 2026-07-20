// CRUD ladder — a higher action implies the lower ones on the SAME resource:
// delete ⇒ edit ⇒ create. Single source for both sides of the contract:
//   • authorizeStaff expands the session's effective set with implied lowers,
//   • the Role editor cascades ticks so the checkboxes mirror what a holder
//     actually gets (tick Delete → Edit + Create tick too; untick a lower →
//     the highers that implied it untick too).
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
