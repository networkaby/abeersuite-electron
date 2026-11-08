// Client-safe catalog of ACTION HOOKS (no prisma import — usable in the Actions
// catalog page and the worker dialog). Actions are CODE hooks, not DB rows: this
// list is the read-only catalog. Each action is an independent function with its
// own parameters (arguments, filled in on the worker) and an output. The runtime
// behaviour lives server-side in actions.ts (RUN_HANDLERS, keyed by `type`).

export type ActionFieldKind = "pipeline" | "status" | "text" | "schedule" | "wa_template" | "email_template";

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
        type: "send_whatsapp_template",
        label: "Send WhatsApp template",
        description: "Sends the customer one of your own WhatsApp templates (Settings → WhatsApp Templates → Your templates). Goes only when it is approved and switched on; once per ticket.",
        output: "A WhatsApp message, once per ticket",
        fields: [{ key: "template", label: "Template", kind: "wa_template" }],
    },
    {
        type: "send_email_template",
        label: "Send email template",
        description: "Emails the customer one of your own email templates (Settings → Email Templates → Your templates), to a verified email only. Goes only when it is switched on; once per ticket.",
        output: "An email, once per ticket",
        fields: [{ key: "template", label: "Template", kind: "email_template" }],
    },
    {
        type: "retry",
        label: "Retry later",
        description: "Snoozes the ticket on this worker and re-surfaces it in the Work Inbox after the interval — a simple follow-up timer.",
        output: "Ticket parked until due (wakeAt set)",
        fields: [{ key: "after", label: "After (e.g. 2d, 6h, 30m)", kind: "schedule" }],
    },
    {
        type: "notify_repair_received",
        label: "Tell customer: repair received",
        description: "Sends the customer the \"Repair received\" message — app notification and WhatsApp (Settings → WhatsApp Templates). Put it on the intake stage.",
        output: "App notification + WhatsApp, once per ticket",
        fields: [],
    },
    {
        type: "notify_repair_ready",
        label: "Tell customer: repair ready",
        description: "Sends the customer the \"Repair ready\" message — app notification and WhatsApp (Settings → WhatsApp Templates). Put it on the stage that ends the repair.",
        output: "App notification + WhatsApp, once per ticket",
        fields: [],
    },
];

export const ACTION_TYPE_MAP: Record<string, ActionTypeDef> = Object.fromEntries(ACTION_TYPES.map((t) => [t.type, t]));

export function isKnownActionType(type: string): boolean {
    return type in ACTION_TYPE_MAP;
}
