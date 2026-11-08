import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { spawnChild } from "./spawnChild";
import { isKnownActionType } from "./actionTypes";
import { after } from "next/server";
import { notifyRepair, notifyTicketTemplate, type NotifyResult } from "@/shared/lib/whatsapp/notifyBill";
import { notifyTicketEmail } from "@/shared/lib/email/notifyEmail";
import { isWaKind, waKindLabel } from "@/shared/lib/whatsapp/billTemplates";
import { emailKindLabel, isEmailAnyKind } from "@/shared/lib/email/emailTemplates";

// ── Worker action runtime (6th power) ─────────────────────────────────────────
// Actions are read-only CODE hooks (catalog in actionTypes.ts). A worker carries an
// ordered chain of [{ type, on, config }] where `type` selects the hook, `config`
// is its arguments (filled in on the worker), and `on` filters by outcome. When the
// worker is COMPLETED the chain runs in order via the RUN_HANDLERS below.
//
// Best-effort: one action failing never blocks the move or the rest of the chain.
// Money/CRM hooks STAGE or open a flow — they never silently post a GL entry.

export type ActionOn = "success" | "fail" | "always";

export type ActionRunContext = {
    ticketId: number;
    status: string;          // the ticket's status at completion (for logs / spawn link)
    workerId: string;        // the worker being completed (the chain owner)
    deviceId: number | null; // for a spawn child that inherits the device (null = device-free)
    userId: number;
    outcome: "success" | "unsuccess" | null;  // what the human/action reported
    // Actor snapshot for logs — resolved once by runWorkerActions (no User FK).
    author?: Prisma.InputJsonValue;
};

const str = (c: Record<string, unknown> | undefined, k: string): string | null => {
    const v = c?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
};

// "2d" / "6h" / "30m" / "1w" → ms (default minutes if bare number, 0 if unparseable).
function parseAfter(s: string | null): number {
    if (!s) return 0;
    const m = /^(\d+)\s*([mhdw]?)$/i.exec(s.trim());
    if (!m) return 0;
    const n = Number(m[1]);
    const unit = (m[2] || "m").toLowerCase();
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit] ?? 60_000;
    return n * ms;
}

type RunHandler = (ctx: ActionRunContext, config: Record<string, unknown> | undefined) => Promise<void>;

const RUN_HANDLERS: Record<string, RunHandler> = {
    // Create a child entity (ticket/task/deal) on another pipeline. args: { pipelineId }.
    async spawn(ctx, config) {
        const pipelineId = str(config, "pipelineId");
        if (!pipelineId) return;
        await spawnChild({
            parentId: ctx.ticketId, parentStatus: ctx.status, parentWorkerId: ctx.workerId,
            spawnPipelineId: pipelineId, deviceId: ctx.deviceId, userId: ctx.userId,
        });
    },

    // Move the ticket to a status — pipeline-agnostic. args: { statusId }.
    async move_status(ctx, config) {
        const statusId = str(config, "statusId");
        if (!statusId || statusId === ctx.status) return;
        const target = await prisma.ticketStatus.findUnique({ where: { id: statusId }, select: { label: true } });
        if (!target) return;
        await prisma.ticket.update({ where: { id: ctx.ticketId }, data: { status: statusId, updatedAt: new Date() } });
        await prisma.ticketLog.create({
            data: { ticketId: ctx.ticketId, status: statusId, note: `Action: moved to ${target.label}`, author: ctx.author },
        });
        await messageOnStatusEntry(ctx.ticketId, statusId, ctx.userId);
    },

    // One of staff's own templates to the ticket's customer, after the
    // response; once per (template, ticket). args: { template } = CUSTOM_<id>.
    async send_whatsapp_template(ctx, config) {
        const kind = str(config, "template");
        if (!kind || !isWaKind(kind)) return;
        const label = await templateName("wa", kind);
        after(async () => logTemplate(ctx, "WhatsApp", label, await notifyTicketTemplate(kind, ctx.ticketId)));
    },
    async send_email_template(ctx, config) {
        const kind = str(config, "template");
        if (!kind || !isEmailAnyKind(kind)) return;
        const label = await templateName("email", kind);
        after(async () => logTemplate(ctx, "Email", label, await notifyTicketEmail(kind, ctx.ticketId)));
    },

    // Snooze the ticket and re-surface it in the Work Inbox after the interval — a
    // simple follow-up timer. args: { after } ("2d"|"6h"|"30m"|"1w").
    async retry(ctx, config) {
        const delta = parseAfter(str(config, "after"));
        if (!delta) return;
        const wakeAt = new Date(Date.now() + delta);
        await prisma.ticket.update({
            where: { id: ctx.ticketId },
            data: { wakeAt, retryKeyId: ctx.workerId, updatedAt: new Date() },
        });
        await prisma.ticketLog.create({
            data: { ticketId: ctx.ticketId, status: ctx.status, note: `Action: snoozed — re-surfaces ${str(config, "after")}`, author: ctx.author },
        });
    },

    // Tell the customer (app + WhatsApp) after the response — the stage move
    // never waits on Meta or Google. Once per ticket per kind: a stage completed
    // twice does not message twice. No args.
    async notify_repair_received(ctx) {
        after(async () => logNotify(ctx, "Repair received", await notifyRepair("REPAIR_RECEIVED", ctx.ticketId)));
    },
    async notify_repair_ready(ctx) {
        after(async () => logNotify(ctx, "Repair ready", await notifyRepair("REPAIR_READY", ctx.ticketId)));
    },
};

async function logNotify(ctx: ActionRunContext, what: string, r: { status: string; reason?: string }) {
    const note =
        r.status === "sent" ? `📲 Customer told: ${what} (app + WhatsApp)`
            : r.status === "already" ? `📲 ${what} message was already sent`
                : `📲 ${what} message not sent — ${r.reason ?? "skipped"}`;
    await prisma.ticketLog.create({ data: { ticketId: ctx.ticketId, status: ctx.status, note, author: ctx.author } });
}

async function templateName(channel: "wa" | "email", kind: string): Promise<string> {
    const row = channel === "wa"
        ? await prisma.whatsAppTemplate.findUnique({ where: { kind }, select: { name: true } })
        : await prisma.emailTemplate.findUnique({ where: { kind }, select: { name: true } });
    if (channel === "wa") return isWaKind(kind) ? waKindLabel(kind, row?.name) : "template";
    return isEmailAnyKind(kind) ? emailKindLabel(kind, row?.name) : "template";
}

async function logTemplate(ctx: ActionRunContext, channel: string, name: string, r: NotifyResult) {
    const icon = channel === "Email" ? "📧" : "📲";
    const note =
        r.status === "sent" ? `${icon} ${channel} sent: "${name}"`
            : r.status === "already" ? `${icon} ${channel} "${name}" was already sent`
                : `${icon} ${channel} "${name}" not sent — ${r.reason ?? "skipped"}`;
    await prisma.ticketLog.create({ data: { ticketId: ctx.ticketId, status: ctx.status, note, author: ctx.author } });
}

// ── Status entry: the status' own WhatsApp / email template ──────────────────

const REPAIR_KINDS = { REPAIR_RECEIVED: "Repair received", REPAIR_READY: "Repair ready" } as const;
type RepairKind = keyof typeof REPAIR_KINDS;
const isRepairTemplate = (k: string): k is RepairKind => k in REPAIR_KINDS;

/** A ticket just ENTERED `statusId`: send that status' chosen WhatsApp and
 *  email templates (Workflow → Statuses), after the response. Once per
 *  (template, ticket) — moving in twice never messages twice. Every move path
 *  calls this; it never throws and never slows the move. */
export async function messageOnStatusEntry(ticketId: number, statusId: string, userId: number, author?: Prisma.InputJsonValue): Promise<void> {
    try {
        const st = await prisma.ticketStatus.findUnique({ where: { id: statusId }, select: { waTemplate: true, emailTemplate: true } });
        const wa = st?.waTemplate ?? null;
        const em = st?.emailTemplate ?? null;
        if (!wa && !em) return;
        const ctx: ActionRunContext = { ticketId, status: statusId, workerId: "", deviceId: null, userId, outcome: null, author: author ?? await buildActorSnapshot(userId) };
        after(async () => {
            if (wa && isRepairTemplate(wa)) {
                // manual: send on the template's approval alone, and leave the email to the email dropdown.
                await logTemplate(ctx, "WhatsApp", REPAIR_KINDS[wa], await notifyRepair(wa, ticketId, { manual: true }));
            } else if (wa && isWaKind(wa)) {
                await logTemplate(ctx, "WhatsApp", await templateName("wa", wa), await notifyTicketTemplate(wa, ticketId));
            }
            if (em && isEmailAnyKind(em)) {
                await logTemplate(ctx, "Email", await templateName("email", em), await notifyTicketEmail(em, ticketId));
            }
        });
    } catch (e) {
        console.error(`[status-message] ticket ${ticketId} → ${statusId} failed`, e);
    }
}

type ChainEntry = { type: string; on: ActionOn; config: Record<string, unknown> };

function parseChain(raw: unknown): ChainEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((a): a is ChainEntry => !!a && typeof a === "object" && typeof (a as ChainEntry).type === "string" && isKnownActionType((a as ChainEntry).type))
        .map((a) => ({
            type: a.type,
            on: (a.on === "success" || a.on === "fail") ? a.on : "always",
            config: (a.config && typeof a.config === "object") ? a.config : {},
        }));
}

// Run a completed worker's action chain, in order, filtered by the recorded outcome.
// Best-effort: an action that throws is logged and skipped; the chain continues.
export async function runWorkerActions(ctx: ActionRunContext, rawActions: unknown): Promise<void> {
    const chain = parseChain(rawActions);
    if (!chain.length) return;
    // Resolve the actor snapshot ONCE for every log this chain writes (no User FK).
    if (ctx.author === undefined) ctx.author = await buildActorSnapshot(ctx.userId);
    const matches = (on: ActionOn) =>
        on === "always"
        || (on === "success" && ctx.outcome === "success")
        || (on === "fail" && ctx.outcome === "unsuccess");
    for (const a of chain) {
        if (!matches(a.on)) continue;
        try {
            await RUN_HANDLERS[a.type](ctx, a.config);
        } catch {
            await prisma.ticketLog.create({
                data: { ticketId: ctx.ticketId, status: ctx.status, note: `⚠️ Action "${a.type}" failed`, author: ctx.author },
            }).catch(() => { /* swallow */ });
        }
    }
}
