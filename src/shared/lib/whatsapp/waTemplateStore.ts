import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { WhatsAppTemplate } from "@/generated/prisma/client";
import {
    CUSTOM_TEMPLATE_DEFAULT,
    WA_TEMPLATE_DEFAULTS,
    WA_TEMPLATE_KINDS,
    autoSendDefault,
    checkBody,
    isCustomKind,
    newCustomKind,
    type WaAnyKind,
    type WaSendState,
    type WaTemplateDraft,
    type WaTemplateKind,
} from "./billTemplates";
import { fetchTemplateStatus, isTemplateApiConfigured, submitTemplate } from "./metaTemplates";

/**
 * WhatsAppTemplate rows: read, edit, send to Meta, follow the approval.
 *
 * The sender reads the approved copy on every bill, so it is cached in memory
 * for a minute (and dropped on any change here) — one row read per minute per
 * server instead of one per bill.
 */

export type WaTemplateView = {
    kind: WaAnyKind;
    /** Staff's name for a custom template; null on a built-in one. */
    name: string | null;
    enabled: boolean;
    autoSend: boolean;
    draft: WaTemplateDraft;
    status: string;
    rejectReason: string | null;
    metaName: string | null;
    submittedAt: string | null;
    approved: (WaTemplateDraft & { name: string; at: string | null }) | null;
};

function toView(kind: WaAnyKind, r: WhatsAppTemplate | undefined): WaTemplateView {
    if (!r) {
        const draft = isCustomKind(kind) ? CUSTOM_TEMPLATE_DEFAULT : WA_TEMPLATE_DEFAULTS[kind];
        return { kind, name: null, enabled: false, autoSend: autoSendDefault(kind), draft, status: "DRAFT", rejectReason: null, metaName: null, submittedAt: null, approved: null };
    }
    return {
        kind,
        name: r.name,
        enabled: r.enabled,
        autoSend: r.autoSend,
        draft: { body: r.body, viewButton: r.viewButton, appButton: r.appButton },
        status: r.status,
        rejectReason: r.rejectReason,
        metaName: r.metaName,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        approved: r.approvedName && r.approvedBody != null
            ? { name: r.approvedName, body: r.approvedBody, viewButton: r.approvedView, appButton: r.approvedApp, at: r.approvedAt?.toISOString() ?? null }
            : null,
    };
}

export async function listWaTemplates(): Promise<WaTemplateView[]> {
    const rows = await prisma.whatsAppTemplate.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    const custom = rows.filter((r) => isCustomKind(r.kind)).sort((a, b) => a.kind.localeCompare(b.kind));
    return [...WA_TEMPLATE_KINDS.map((k) => toView(k, byKind.get(k))), ...custom.map((r) => toView(r.kind as WaAnyKind, r))];
}

/** Every kind, after asking Meta about any still waiting for approval — so
 *  opening the page (or its list API) is how staff see an approval land, with
 *  no polling job. Only PENDING rows call Meta; the rest is one read. */
export async function listWaTemplatesFresh(): Promise<WaTemplateView[]> {
    const templates = await listWaTemplates();
    const pending = templates.filter((t) => t.status === "PENDING");
    if (!pending.length) return templates;
    await Promise.all(pending.map((t) => refreshWaTemplate(t.kind).catch(() => null)));
    return listWaTemplates();
}

async function getOne(kind: WaAnyKind): Promise<WaTemplateView> {
    const r = await prisma.whatsAppTemplate.findUnique({ where: { kind } });
    return toView(kind, r ?? undefined);
}

// ── Sender cache ────────────────────────────────────────────────────────────
const TTL_MS = 60_000;
type Cached = { autoSend: boolean; state: WaSendState; approved: { name: string; draft: WaTemplateDraft } | null };
const cache = new Map<WaAnyKind, { at: number; value: Cached }>();

async function cached(kind: WaAnyKind): Promise<Cached> {
    const hit = cache.get(kind);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const v = await getOne(kind);
    const value: Cached = {
        autoSend: v.autoSend,
        approved: v.enabled && v.approved ? { name: v.approved.name, draft: v.approved } : null,
        state: !v.approved ? "not-approved" : v.enabled ? "ready" : "off",
    };
    cache.set(kind, { at: Date.now(), value });
    return value;
}

/** The approved copy bills are sent with; null when switched off or never approved. */
export async function getApprovedWaTemplate(kind: WaAnyKind) {
    return (await cached(kind)).approved;
}

/** Whether a save sends this kind by itself. */
export async function isAutoSend(kind: WaTemplateKind): Promise<boolean> {
    return (await cached(kind)).autoSend;
}

/** The saved draft wording for this kind (whether approved yet or not). */
export async function getWaTemplateDraft(kind: WaTemplateKind): Promise<WaTemplateDraft> {
    return (await getOne(kind)).draft;
}

/** Per kind: can staff send it by hand now, and if not, why. Feeds the 3-dot
 *  menus and the repair ticket, which grey the item out with the reason. */
export async function waSendStates(): Promise<Record<WaTemplateKind, WaSendState>> {
    const pairs = await Promise.all(WA_TEMPLATE_KINDS.map(async (k) => [k, (await cached(k)).state] as const));
    return Object.fromEntries(pairs) as Record<WaTemplateKind, WaSendState>;
}

// ── Edits ───────────────────────────────────────────────────────────────────

/** Save the wording. A changed wording goes back to DRAFT; bills keep using
 *  the last approved copy until the new one is approved. */
export async function saveWaTemplate(kind: WaAnyKind, input: { enabled: boolean; autoSend: boolean; draft: WaTemplateDraft }): Promise<WaTemplateView> {
    const cur = await getOne(kind);
    if (isCustomKind(kind) && cur.name == null) throw new WaTemplateError("This template has been deleted.");
    const d = input.draft;
    const changed = d.body !== cur.draft.body || d.viewButton !== cur.draft.viewButton || d.appButton !== cur.draft.appButton;
    // The approval that comes back is for the copy Meta holds — an edit now
    // would be recorded as approved without Meta ever seeing it.
    if (changed && cur.status === "PENDING") {
        throw new WaTemplateError("Meta is still checking the last version — wait for its answer before changing the wording.");
    }
    await prisma.whatsAppTemplate.upsert({
        where: { kind },
        create: { kind, enabled: input.enabled, autoSend: input.autoSend, body: d.body, viewButton: d.viewButton, appButton: d.appButton },
        update: {
            enabled: input.enabled,
            autoSend: input.autoSend,
            body: d.body,
            viewButton: d.viewButton,
            appButton: d.appButton,
            ...(changed ? { status: "DRAFT", rejectReason: null } : {}),
        },
    });
    cache.delete(kind);
    return getOne(kind);
}

export class WaTemplateError extends Error {}

// ── Custom templates ────────────────────────────────────────────────────────

/** Add a custom template with the starting wording; staff edit it from there. */
export async function createCustomWaTemplate(name: string): Promise<WaTemplateView> {
    const kind = newCustomKind();
    const d = CUSTOM_TEMPLATE_DEFAULT;
    await prisma.whatsAppTemplate.create({
        data: { kind, name: name.trim(), enabled: false, autoSend: false, body: d.body, viewButton: d.viewButton, appButton: d.appButton },
    });
    return getOne(kind);
}

export async function renameCustomWaTemplate(kind: WaAnyKind, name: string): Promise<WaTemplateView> {
    if (!isCustomKind(kind)) throw new WaTemplateError("A built-in template cannot be renamed.");
    await prisma.whatsAppTemplate.update({ where: { kind }, data: { name: name.trim() } });
    return getOne(kind);
}

/** Send the saved draft to Meta under a fresh versioned name. */
export async function submitWaTemplate(kind: WaAnyKind): Promise<WaTemplateView> {
    if (!(await isTemplateApiConfigured())) {
        throw new WaTemplateError("WhatsApp template sending is not set up — META_WA_BUSINESS_ACCOUNT_ID or META_WA_ACCESS_TOKEN is missing.");
    }
    const cur = await getOne(kind);
    if (isCustomKind(kind) && cur.name == null) throw new WaTemplateError("This template has been deleted.");
    const errs = checkBody(cur.draft, kind);
    if (errs.length) throw new WaTemplateError(errs.join(" "));

    const row = await prisma.whatsAppTemplate.upsert({
        where: { kind },
        create: { kind, autoSend: cur.autoSend, body: cur.draft.body, viewButton: cur.draft.viewButton, appButton: cur.draft.appButton, version: 1 },
        update: { version: { increment: 1 } },
        select: { version: true },
    });
    // Meta keeps a deleted/rejected name reserved, so every submission gets its own.
    const name = `${kind.toLowerCase()}_v${row.version}`;
    try {
        const r = await submitTemplate(kind, name, cur.draft);
        await prisma.whatsAppTemplate.update({
            where: { kind },
            data: { status: r.status, metaName: name, metaId: r.id, rejectReason: null, submittedAt: new Date() },
        });
        if (r.status === "APPROVED") await markApproved(kind, name, cur.draft);
    } catch (e) {
        throw new WaTemplateError(`Meta refused it: ${e instanceof Error ? e.message : String(e)}`);
    }
    return getOne(kind);
}

/** Ask Meta where the submitted copy stands; on APPROVED it becomes the one bills use. */
export async function refreshWaTemplate(kind: WaAnyKind): Promise<WaTemplateView> {
    const cur = await getOne(kind);
    if (!cur.metaName || cur.status !== "PENDING" || !(await isTemplateApiConfigured())) return cur;
    const s = await fetchTemplateStatus(cur.metaName);
    if (!s) return cur;
    if (s.status === "APPROVED") {
        await markApproved(kind, cur.metaName, cur.draft);
    } else if (s.status !== cur.status) {
        await prisma.whatsAppTemplate.update({ where: { kind }, data: { status: s.status, rejectReason: s.rejectReason } });
    }
    return getOne(kind);
}

async function markApproved(kind: WaAnyKind, name: string, d: WaTemplateDraft) {
    await prisma.whatsAppTemplate.update({
        where: { kind },
        data: {
            status: "APPROVED",
            rejectReason: null,
            approvedName: name,
            approvedBody: d.body,
            approvedView: d.viewButton,
            approvedApp: d.appButton,
            approvedAt: new Date(),
        },
    });
    cache.delete(kind);
}
