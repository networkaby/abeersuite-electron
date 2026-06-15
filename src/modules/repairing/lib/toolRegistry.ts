// Server-side tool runtime. A tool runs HEADLESS (no browser, no human) and returns a
// typed result: { success, outputs }. Mirrors the client-safe catalog in actionTools.ts.
// An Action (a Work with kind="auto") names a toolType; autoAdvance runs it on the server
// when a ticket lands on that worker, then routes on the Success/Unsuccess result.

export type ToolResult = { success: boolean; outputs: Record<string, string> };

type ToolRunner = (inputs: Record<string, string>) => Promise<ToolResult>;

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

const TOOL_REGISTRY: Record<string, ToolRunner> = {
    open_tab: openTab,
};

// Run a tool by type. Unknown tool → null (caller decides; never throws).
export async function runServerTool(toolType: string, inputs: Record<string, string>): Promise<ToolResult | null> {
    const runner = TOOL_REGISTRY[toolType];
    if (!runner) return null;
    return runner(inputs);
}
