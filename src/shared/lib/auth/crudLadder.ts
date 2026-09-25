// Permission ladders — a higher action implies the lower ones on the SAME
// resource, so ONLY the highest rung is ever stored (DB grants + session/JWT
// carry one id per resource) and the lowers are implied at check time.
//
// Three families, detected from the id shape:
//   • resource CRUD   <base>:create|edit|delete            create ⇒ edit ⇒ delete
//   • office voucher   <ns>:voucher:<action>:<kind>          create ⇒ post ⇒ cancel ⇒ delete
//   • POS voucher      pos:voucher:<action>:<kind>           create ⇒ cancel ⇒ delete   (no post)
// ("cancel" is the Cancel/Edit column.) Everything else — ui:sidebar:*, one-off
// toggles, reads — has no ladder and is left untouched.
//
// Single source consumed by: hasPermissionWithScope (check-time implication,
// shared by server routes + client pages), authorizeStaff (overrides + normalize
// the JWT), the per-person permissions screen (same overrides), the Role editor
// (expand on load / normalize on save), and canDoPosVoucher.

const RESOURCE_ORDER = ["create", "edit", "delete"] as const;
const VOUCHER_ORDER = ["create", "post", "cancel", "delete"] as const;
const POS_VOUCHER_ORDER = ["create", "cancel", "delete"] as const;

// A resolved ladder: every rung id low→high, plus this id's index in it.
type Ladder = { ids: string[]; idx: number };

function parseLadder(id: string): Ladder | null {
    const parts = id.split(":");

    // Voucher family: <ns>:voucher:<action>:<kind…>
    if (parts.length >= 4 && parts[1] === "voucher") {
        const [ns, , action] = parts;
        const kind = parts.slice(3).join(":");
        const order = ns === "pos" ? POS_VOUCHER_ORDER : VOUCHER_ORDER;
        const idx = (order as readonly string[]).indexOf(action);
        if (idx < 0) return null;
        return { ids: order.map((a) => `${ns}:voucher:${a}:${kind}`), idx };
    }

    // Resource CRUD: <base…>:<create|edit|delete>
    const i = id.lastIndexOf(":");
    if (i < 0) return null;
    const idx = (RESOURCE_ORDER as readonly string[]).indexOf(id.slice(i + 1));
    if (idx < 0) return null;
    const base = id.slice(0, i);
    return { ids: RESOURCE_ORDER.map((a) => `${base}:${a}`), idx };
}

/** Lower actions a grant confers (to auto-tick / for reference). */
export function crudImpliedByGrant(id: string): string[] {
    const l = parseLadder(id);
    return l ? l.ids.slice(0, l.idx) : [];
}

/** Higher actions that imply this one (to revoke together / satisfy a check). */
export function crudDependentsOnRevoke(id: string): string[] {
    const l = parseLadder(id);
    return l ? l.ids.slice(l.idx + 1) : [];
}

/** True when `id` is held directly OR implied by a higher rung in the set. */
export function crudSatisfied(permissions: ReadonlySet<string> | readonly string[], id: string): boolean {
    const set = Array.isArray(permissions) ? new Set(permissions) : permissions as ReadonlySet<string>;
    if (set.has(id)) return true;
    return crudDependentsOnRevoke(id).some((higher) => set.has(higher));
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

/**
 * Layer one person's overrides on top of their role grants — in place, and the
 * set is returned for chaining. GRANT adds; an explicit DENY wins last, and
 * denying a rung also drops the highers that imply it, otherwise check-time
 * implication would resurrect the denied action through the surviving higher
 * grant. Shared by sign-in (authorizeStaff) and the per-person permissions
 * screen, so the screen can never show a different answer than the session.
 */
export function applyPermissionOverrides(
    grants: Set<string>,
    overrides: readonly { permissionId: string; type: "GRANT" | "DENY" }[],
): Set<string> {
    for (const o of overrides) {
        if (o.type === "GRANT") grants.add(o.permissionId);
    }
    for (const o of overrides) {
        if (o.type === "GRANT") continue;
        grants.delete(o.permissionId);
        for (const higher of crudDependentsOnRevoke(o.permissionId)) grants.delete(higher);
    }
    return grants;
}

/** Add lowers implied by each id — for DISPLAY (Role editor load), never storage. */
export function expandCrudGrants(ids: Iterable<string>): Set<string> {
    const set = new Set(ids);
    for (const id of [...set]) {
        for (const lower of crudImpliedByGrant(id)) set.add(lower);
    }
    return set;
}
