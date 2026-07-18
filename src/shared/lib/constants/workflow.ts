/**
 * Workflow semantic map — status IDs grouped by the ROLE they play in a flow,
 * pinned HERE (a constant) instead of a DB column.
 *
 * Why a constant, not the DB: while the workflow is still being shaped in
 * Settings → Workflow, a few features need to know "which status means X".
 * Rather than add a flag column per behaviour (and migrate the prod DB every
 * time), we map the OPAQUE status IDs here. Once the workflow config is LOCKED,
 * this file is the single place that pins those mappings — relieving the DB.
 *
 * Rules:
 *  • Key by status **ID** (e.g. "S62"), never by label — IDs survive renames,
 *    labels don't. (That's exactly what broke the old label-matched gate.)
 *  • An EMPTY set means "not configured yet" → the reader falls back to
 *    always-on, so a feature never silently disappears while the flow is in flux.
 *  • Add more roles here as other features need status awareness (e.g. a
 *    "ready to bill" or "device returned" set) — one home for the whole map.
 */

export const WORKFLOW_STATUS = {
    /**
     * Repair pipeline (P1) statuses where the device has LEFT the shop for an
     * external service centre → the "Create Shipping Slip" action is offered.
     * Current seed labels for reference (edit the IDs to lock your set):
     *   S61 "Need Help" · S62 "Escalated - Send to service" · S4 "Escalated -Visit"
     */
    shipToService: ["S61", "S62", "S4"] as string[],

    /**
     * Repair pipeline (P1) statuses where the job is far enough along to raise
     * the customer's bill → the "Generate Bill" button (opens POS preloaded) is
     * shown. The Bill Details worksheet itself is always editable; only the
     * final bill action is gated here. Seed labels for reference:
     *   S3 "Repairing" · S5 "Received Back" · S6 "Ready"
     */
    readyToBill: ["S6"] as string[],
} as const;

export type WorkflowStatusRole = keyof typeof WORKFLOW_STATUS;

/**
 * True when `statusId` carries the given workflow role. An empty mapping is
 * treated as "not locked yet" and returns true, so the feature stays visible
 * until the workflow is pinned.
 */
export function statusHasWorkflowRole(
    role: WorkflowStatusRole,
    statusId: string | null | undefined,
): boolean {
    const ids = WORKFLOW_STATUS[role];
    if (ids.length === 0) return true; // unlocked → always on
    return statusId != null && ids.includes(statusId);
}
