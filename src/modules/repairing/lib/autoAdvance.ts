import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { resolveTicketSource, type TicketLike } from "./ticketSources";
import { runServerTool } from "./toolRegistry";
import { runWorkerActions } from "./actions";
import { spawnChild } from "./spawnChild";
import { findEntryWorker } from "./entryWorker";

// ── Server-side outcome chain (auto-run) ──────────────────────────────────────
// When a ticket LANDS on a worker whose Work is an Action (kind="auto"), the tool runs
// HEADLESS on the server, reports Success/Unsuccess, saves its outputs into Ticket.context,
// and the ticket routes via that worker's success/fail target — repeating through further
// Actions until it reaches a human Work, a missing route, or the safety bound. This keeps
// the human routing path (worker/route.ts PATCH) untouched: autoAdvance is called AFTER a
// move and only acts when the landed worker is an Action.

const MAX_AUTO_HOPS = 20;

type ToolConfig = {
    bindings?: Record<string, { mode?: string; value?: string }>;
    outputs?: Record<string, string>;
};

const ticketSelect = {
    id: true, status: true, workerId: true, deviceId: true, context: true,
    ticketStatus: { select: { label: true } },
    device: {
        select: {
            type: true, brand: true, model: true, problem: true,
            account: {
                select: {
                    person: { select: { name: true, phones: selectPrimaryPhone, emails: selectPrimaryEmail } },
                    company: { select: { name: true, phones: selectPrimaryPhone, emails: selectPrimaryEmail } },
                },
            },
        },
    },
} as const;

// Returns the URL(s) of any client-openable tools (open_tab) it ran with Success, so the
// caller's browser can pop the tab in the user's gesture (the server can't open tabs).
export async function autoAdvance(ticketId: number, userId: number): Promise<string[]> {
    const visited = new Set<string>();
    const openedTabs: string[] = [];

    for (let hop = 0; hop < MAX_AUTO_HOPS; hop++) {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: ticketSelect });
        if (!ticket?.workerId) return openedTabs;

        const worker = await prisma.ticketWorker.findUnique({
            where: { id: ticket.workerId },
            select: {
                id: true, label: true, successWorkerId: true, failWorkerId: true,
                spawnPipelineId: true, actions: true,
                work: { select: { kind: true, toolType: true, toolConfig: true } },
            },
        });
        // Not an Action (human Work, or auto without a tool) → chain pauses here.
        if (!worker || worker.work?.kind !== "auto" || !worker.work.toolType) return openedTabs;

        // Loop guard: a cycle (A ✓→B, B ✓→A) must not run forever.
        if (visited.has(worker.id)) {
            await log(ticketId, ticket.status, worker.id, `⚠️ Auto-run loop detected at "${worker.label}" — stopped`, userId);
            return openedTabs;
        }
        visited.add(worker.id);

        // Resolve the tool's input bindings (fixed value, or a context source).
        const cfg = (worker.work.toolConfig ?? {}) as ToolConfig;
        const ticketLike: TicketLike = {
            id: ticket.id, status: ticket.status, ticketStatus: ticket.ticketStatus,
            context: ticket.context as Record<string, unknown> | null, device: ticket.device,
        };
        const inputs: Record<string, string> = {};
        for (const [key, b] of Object.entries(cfg.bindings ?? {})) {
            if (!b) continue;
            inputs[key] = b.mode === "fixed" ? (b.value ?? "") : (resolveTicketSource(b.value ?? "", ticketLike) ?? "");
        }

        // Run the tool (headless). Unknown tool → stop (can't decide an outcome).
        const result = await runServerTool(worker.work.toolType, inputs).catch(() => null);
        if (!result) {
            await log(ticketId, ticket.status, worker.id, `⚠️ Auto-run: tool "${worker.work.toolType}" not runnable — stopped`, userId);
            return openedTabs;
        }
        const outcome: "success" | "unsuccess" = result.success ? "success" : "unsuccess";
        const target = result.success ? worker.successWorkerId : worker.failWorkerId;

        // open_tab succeeded (URL reachable) → ask the caller's browser to pop the tab.
        if (worker.work.toolType === "open_tab" && result.success && inputs.url) openedTabs.push(inputs.url);

        // Map tool outputs → context keys (cfg.outputs: toolOutputKey → contextKey).
        const merged: Record<string, unknown> = { ...((ticket.context as Record<string, unknown> | null) ?? {}) };
        for (const [toolKey, ctxKey] of Object.entries(cfg.outputs ?? {})) {
            if (result.outputs[toolKey] != null && ctxKey) merged[ctxKey] = result.outputs[toolKey];
        }

        // No route for this outcome → record the result + save outputs, then stop (stuck,
        // but the outcome IS recorded so it's not silent).
        if (!target) {
            await prisma.$transaction(async (tx) => {
                await tx.ticket.update({ where: { id: ticketId }, data: { context: merged as Prisma.InputJsonValue, updatedAt: new Date() } });
                await tx.ticketLog.create({ data: { ticketId, status: ticket.status, workerId: worker.id, note: `Work done · ${result.success ? "Success" : "Unsuccess"} — ${worker.label} (auto, no route)`, userId } });
            });
            return openedTabs;
        }

        // Landing: the target's triggerMap may auto-advance to a new status (→ its entry worker).
        const targetWorker = await prisma.ticketWorker.findUnique({ where: { id: target }, select: { label: true, triggerMap: true } });
        const triggerStatusId = ((targetWorker?.triggerMap ?? {}) as Record<string, string>)[ticket.status] ?? null;
        const newStatus = triggerStatusId ?? ticket.status;
        const entrySub = triggerStatusId ? await findEntryWorker(triggerStatusId) : null;
        const newWorkerId = triggerStatusId ? (entrySub?.id ?? null) : target;

        await prisma.$transaction(async (tx) => {
            await tx.ticket.update({
                where: { id: ticketId },
                data: { workerId: newWorkerId, status: newStatus, context: merged as Prisma.InputJsonValue, updatedAt: new Date() },
            });
            // Completion stamp for the Action we just ran (feeds the Finished list + history).
            await tx.ticketLog.create({ data: { ticketId, status: ticket.status, workerId: worker.id, note: `Work done · ${result.success ? "Success" : "Unsuccess"} — ${worker.label} (auto)`, userId } });
            if (triggerStatusId) {
                await tx.ticketLog.create({ data: { ticketId, status: triggerStatusId, note: `Auto-advanced by: ${worker.label}`, userId } });
                if (entrySub) await tx.ticketLog.create({ data: { ticketId, status: triggerStatusId, workerId: entrySub.id, note: `Entered: ${entrySub.label}`, userId } });
            } else if (newWorkerId) {
                await tx.ticketLog.create({ data: { ticketId, status: newStatus, workerId: newWorkerId, note: `Entered: ${targetWorker?.label ?? ""}`, userId } });
            }
        });

        // 5th power: landing worker may spawn a child pipeline (best-effort).
        if (newWorkerId) {
            const landing = await prisma.ticketWorker.findUnique({ where: { id: newWorkerId }, select: { spawnPipelineId: true } });
            if (landing?.spawnPipelineId) {
                await spawnChild({ parentId: ticketId, parentStatus: newStatus, parentWorkerId: newWorkerId, spawnPipelineId: landing.spawnPipelineId, deviceId: ticket.deviceId, userId }).catch(() => { /* never blocks */ });
            }
        }
        // 6th power: the completed Action's own action chain, filtered by outcome (best-effort).
        await runWorkerActions({ ticketId, status: newStatus, workerId: worker.id, deviceId: ticket.deviceId, userId, outcome }, worker.actions).catch(() => { /* never blocks */ });

        // Loop continues — if the new landing worker is ALSO an Action, it runs next.
    }

    // Bound exceeded — stop and log (prevents runaway chains).
    const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true, workerId: true } });
    await log(ticketId, t?.status ?? "", t?.workerId ?? null, `⚠️ Auto-run chain exceeded ${MAX_AUTO_HOPS} hops — stopped`, userId);
    return openedTabs;
}

async function log(ticketId: number, status: string, workerId: string | null, note: string, userId: number) {
    await prisma.ticketLog.create({ data: { ticketId, status, workerId: workerId ?? undefined, note, userId } }).catch(() => { /* swallow */ });
}
