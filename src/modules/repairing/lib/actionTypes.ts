// Client-safe catalog of ACTION HOOKS (no prisma import — usable in the Actions
// catalog page and the worker dialog). Actions are CODE hooks, not DB rows: this
// list is the read-only catalog. Each action is an independent function with its
// own parameters (arguments, filled in on the worker) and an output. The runtime
// behaviour lives server-side in actions.ts (RUN_HANDLERS, keyed by `type`).

export type ActionFieldKind = "pipeline" | "status" | "text" | "schedule";

export type ActionTypeDef = {
    type: string;
    label: string;
    description: string;
    output: string;                 // what the hook produces (for the catalog)
    fields: { key: string; label: string; kind: ActionFieldKind }[];  // parameters / arguments
};

export const ACTION_TYPES: ActionTypeDef[] = [
    {
        type: "spawn",
        label: "Create on another pipeline",
        description: "Spawns a child entity (ticket / task / deal) on the chosen pipeline, linked back to this ticket.",
        output: "A linked child entity",
        fields: [{ key: "pipelineId", label: "Target pipeline", kind: "pipeline" }],
    },
    {
        type: "move_status",
        label: "Move to status",
        description: "Moves the ticket to the given status — pipeline-agnostic, it just sets the status.",
        output: "Ticket now on the target status",
        fields: [{ key: "statusId", label: "Target status", kind: "status" }],
    },
    {
        type: "email",
        label: "Send email (stub)",
        description: "Emails the ticket's customer. Stub for now — logs the email as an activity; real provider wires in later.",
        output: "An email activity (message-id later)",
        fields: [{ key: "subject", label: "Subject", kind: "text" }],
    },
    {
        type: "retry",
        label: "Retry later",
        description: "Snoozes the ticket on this worker and re-surfaces it in the Work Inbox after the interval — a simple follow-up timer.",
        output: "Ticket parked until due (wakeAt set)",
        fields: [{ key: "after", label: "After (e.g. 2d, 6h, 30m)", kind: "schedule" }],
    },
];

export const ACTION_TYPE_MAP: Record<string, ActionTypeDef> = Object.fromEntries(ACTION_TYPES.map((t) => [t.type, t]));

export function isKnownActionType(type: string): boolean {
    return type in ACTION_TYPE_MAP;
}
