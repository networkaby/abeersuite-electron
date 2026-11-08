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
     * Repair pipeline (P1) statuses where the "Create Shipping Slip" action is
     * offered — the decision-to-send point and while already out (a device may
     * loop through several centres). Live labels:
     *   S62 "Escalated - Need Help" · S65 "Sent To Service"
     */
    shipToService: ["S62"] as string[],

    /**
     * Repair pipeline (P1) statuses meaning the device is CURRENTLY out at an
     * external service centre (sent, awaiting return) → counted on the Repairs
     * dashboard "At Service Centre" card + the device-audit grouping. Narrower
     * than `shipToService`; this is "physically gone right now". Live label:
     *   S65 "Sent To Service"  (S5 "Received Back" = already back, so excluded)
     */
    atServiceCentre: ["S65"] as string[],

    /**
     * Repair pipeline (P1) statuses where the job is far enough along to raise
     * the customer's bill → the "Generate Bill" button (opens POS preloaded) is
     * shown. The Bill Details worksheet itself is always editable; only the
     * final bill action is gated here. Seed labels for reference:
     *   S3 "Repairing" · S5 "Received Back" · S6 "Ready"
     */
    readyToBill: ["S6"] as string[],

    /**
     * Repair pipeline (P1) statuses where the manual "WhatsApp: Repair received"
     * button is offered — the intake stage only. Seed label: S1 "Received".
     */
    repairReceived: ["S1"] as string[],

    /**
     * Repair pipeline (P1) statuses where the manual "WhatsApp: Repair ready"
     * button is offered — the device is done and waiting for the customer.
     * Seed label: S6 "Ready".
     */
    repairReady: ["S6"] as string[],
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
