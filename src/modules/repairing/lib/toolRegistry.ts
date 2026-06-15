// Server-side tool runtime. A tool runs HEADLESS (no browser, no human) and returns a
// typed result: { success, outputs }. Mirrors the client-safe catalog in actionTools.ts.
// An Action (a Work with kind="auto") names a toolType; autoAdvance runs it on the server
// when a ticket lands on that worker, then routes on the Success/Unsuccess result.

import { spawnChild } from "./spawnChild";

export type ToolResult = { success: boolean; outputs: Record<string, string> };

// Runtime ticket context — supplied to "privileged" server tools that act ON the
// ticket (create a child, etc.), not just on their string inputs. Pure tools
// (open_tab, navigate) ignore it.
export type ToolContext = {
    ticketId: number;
    status: string;
    workerId: string;
    deviceId: number;
    userId: number;
};

type ToolRunner = (inputs: Record<string, string>, ctx?: ToolContext) => Promise<ToolResult>;

// "open_tab": we can't pop a real browser tab on the server, so we DEEM the tab openable
// by checking the URL is reachable — Success when it responds OK (2xx), Unsuccess on a
// 404/error/unreachable. Saves the URL so a human can still open it later.
async function openTab(inputs: Record<string, string>): Promise<ToolResult> {
    const url = (inputs.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return { success: false, outputs: {} };
    try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
        return { success: res.ok, outputs: { openedUrl: url, statusCode: String(res.status) } };
    } catch {
        // DNS / timeout / network error → treat as Unsuccess (URL not reachable).
        return { success: false, outputs: { openedUrl: url, statusCode: "0" } };
    }
}

// "navigate": an in-app client navigation (router.push in the browser). The server
// can't drive the SPA router, so it only VALIDATES the target — Success when the path
// is an in-app route ("/…") or an absolute URL. The browser performs the actual move
// using the path echoed back in outputs.
async function navigate(inputs: Record<string, string>): Promise<ToolResult> {
    const path = (inputs.path ?? "").trim();
    const ok = path.startsWith("/") || /^https?:\/\//i.test(path);
    return { success: ok, outputs: ok ? { navigatedTo: path } : {} };
}

// "create_child": spawn a child on another pipeline, linked back to this ticket.
// Wraps the existing spawnChild (idempotent — one open child per parent+worker).
// Needs the runtime ticket context; Success when a child is created this run.
async function createChild(inputs: Record<string, string>, ctx?: ToolContext): Promise<ToolResult> {
    if (!ctx) return { success: false, outputs: {} };
    const pipelineId = (inputs.pipelineId ?? "").trim();
    if (!pipelineId) return { success: false, outputs: {} };
    const child = await spawnChild({
        parentId: ctx.ticketId,
        parentStatus: ctx.status,
        parentWorkerId: ctx.workerId,
        spawnPipelineId: pipelineId,
        deviceId: ctx.deviceId,
        userId: ctx.userId,
    });
    if (!child) return { success: false, outputs: {} };
    return { success: true, outputs: { childId: String(child.id), childType: child.type } };
}

const TOOL_REGISTRY: Record<string, ToolRunner> = {
    open_tab: openTab,
    navigate,
    create_child: createChild,
};

// Run a tool by type. Unknown tool → null (caller decides; never throws).
export async function runServerTool(toolType: string, inputs: Record<string, string>, ctx?: ToolContext): Promise<ToolResult | null> {
    const runner = TOOL_REGISTRY[toolType];
    if (!runner) return null;
    return runner(inputs, ctx);
}
