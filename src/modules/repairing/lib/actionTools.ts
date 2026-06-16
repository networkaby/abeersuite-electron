// Client-safe catalog of ACTION TOOLS for the "Action = an automated Work" model
// (no prisma import — usable in the Actions settings UI and the runtime later).
//
// A TOOL is a hardcoded, read-only function with a typed contract:
//
//     run(inputs: Record<string, string>):
//         { success: boolean; outputs: Record<string, string> }
//
// It READS its declared `inputs` (each bound on the Action to either a FIXED value or
// a CONTEXT source — customer.phone, device.serial, context.<key>, …), performs its
// effect, and RETURNS a Success/Unsuccess boolean plus named `outputs` that flow back
// into the ticket context for later steps. Because every tool yields Success/Unsuccess,
// a worker routes an Action exactly like a Work.
//
// Tools are defined HERE in code (read-only catalog). Runtime handlers (the actual
// effect) are wired separately when the Action model is connected — this file is the
// schema the UI reads to render input bindings + output previews.

export type ToolFieldKind = "text" | "number" | "url";

export type ToolField = {
    key: string;
    label: string;
    kind: ToolFieldKind;
    hint?: string;          // placeholder / example shown in the editor
};

export type ActionToolDef = {
    type: string;
    label: string;
    description: string;
    // WHERE the tool runs: "client" needs the browser (and a user gesture — e.g. open a
    // tab); "server" runs headless. The outcome chain is orchestrated on the client for
    // client tools (inside the human's click) and server-side for server tools (deferred).
    runtime: "client" | "server";
    inputs: ToolField[];    // what the tool needs (bind each to a fixed value or a context source)
    outputs: ToolField[];   // what it returns into context (besides the Success/Unsuccess boolean)
};

export const ACTION_TOOLS: ActionToolDef[] = [
    {
        type: "open_tab",
        label: "Open a new tab",
        description: "Opens the resolved URL in a new browser tab. Reports Success if the tab opened, Unsuccess otherwise.",
        runtime: "client",
        inputs: [
            { key: "url", label: "URL", kind: "url", hint: "e.g. https://imei.info/?q={device.serial}" },
        ],
        outputs: [
            { key: "openedUrl", label: "Opened URL", kind: "url" },
        ],
    },
    {
        type: "navigate",
        label: "Navigate to a page",
        description: "Navigates the current browser tab to a page inside the app (same window). Reports Success if the path is valid.",
        runtime: "client",
        inputs: [
            { key: "path", label: "Path", kind: "text", hint: "e.g. /office/repairing/tickets or /office/work-inbox" },
        ],
        outputs: [
            { key: "navigatedTo", label: "Navigated to", kind: "text" },
        ],
    },
    {
        type: "create_child",
        label: "Create a child ticket",
        description: "Spawns a child on another pipeline, linked back to this ticket (inherits the device). Success when a child is created (idempotent — won't duplicate an open child).",
        runtime: "server",
        inputs: [
            { key: "pipelineId", label: "Target pipeline", kind: "text", hint: "the pipeline id the child rides, e.g. P2" },
        ],
        outputs: [
            { key: "childId", label: "Child id", kind: "text" },
            { key: "childType", label: "Child type", kind: "text" },
        ],
    },
    {
        // PIPELINE-WISE create-child: target pipeline (Customer Support) is baked in —
        // no pipeline picker. Inputs are this pipeline's own worker context, carried
        // INTO the child so the support agent opens with the parent's framing.
        type: "create_support_ticket",
        label: "Create a support ticket",
        description: "Opens a Customer Support child for this ticket, carrying the subject / priority / details into it. Linked back to this ticket (inherits the device). Idempotent — won't duplicate an open child.",
        runtime: "server",
        inputs: [
            { key: "subject", label: "Subject", kind: "text", hint: "what the support request is about, e.g. {device.problem}" },
            { key: "priority", label: "Priority", kind: "text", hint: "normal | high | urgent" },
            { key: "details", label: "Details", kind: "text", hint: "extra context for the support agent" },
        ],
        outputs: [
            { key: "childId", label: "Child id", kind: "text" },
            { key: "childType", label: "Child type", kind: "text" },
        ],
    },
];

export const ACTION_TOOL_MAP: Record<string, ActionToolDef> = Object.fromEntries(ACTION_TOOLS.map((t) => [t.type, t]));

export function isKnownTool(type: string): boolean {
    return type in ACTION_TOOL_MAP;
}
