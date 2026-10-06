import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { WhatsAppTemplate } from "@/generated/prisma/client";
import {
    WA_TEMPLATE_DEFAULTS,
    WA_TEMPLATE_KINDS,
    checkBody,
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
    kind: WaTemplateKind;
    enabled: boolean;
    draft: WaTemplateDraft;
    status: string;
    rejectReason: string | null;
    metaName: string | null;
    submittedAt: string | null;
    approved: (WaTemplateDraft & { name: string; at: string | null }) | null;
};

function toView(kind: WaTemplateKind, r: WhatsAppTemplate | undefined): WaTemplateView {
    if (!r) {
        return { kind, enabled: false, draft: WA_TEMPLATE_DEFAULTS[kind], status: "DRAFT", rejectReason: null, metaName: null, submittedAt: null, approved: null };
    }
    return {
        kind,
        enabled: r.enabled,
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
    return WA_TEMPLATE_KINDS.map((k) => toView(k, byKind.get(k)));
}

async function getOne(kind: WaTemplateKind): Promise<WaTemplateView> {
    const r = await prisma.whatsAppTemplate.findUnique({ where: { kind } });
    return toView(kind, r ?? undefined);
}

// ── Sender cache ────────────────────────────────────────────────────────────
const TTL_MS = 60_000;
const cache = new Map<WaTemplateKind, { at: number; value: { name: string; draft: WaTemplateDraft } | null }>();

/** The approved copy bills are sent with; null when switched off or never approved. */
export async function getApprovedWaTemplate(kind: WaTemplateKind) {
    const hit = cache.get(kind);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const v = await getOne(kind);
    const value = v.enabled && v.approved ? { name: v.approved.name, draft: v.approved } : null;
    cache.set(kind, { at: Date.now(), value });
    return value;
}

// ── Edits ───────────────────────────────────────────────────────────────────

/** Save the wording. A changed wording goes back to DRAFT; bills keep using
 *  the last approved copy until the new one is approved. */
export async function saveWaTemplate(kind: WaTemplateKind, input: { enabled: boolean; draft: WaTemplateDraft }): Promise<WaTemplateView> {
    const cur = await getOne(kind);
    const d = input.draft;
    const changed = d.body !== cur.draft.body || d.viewButton !== cur.draft.viewButton || d.appButton !== cur.draft.appButton;
    // The approval that comes back is for the copy Meta holds — an edit now
    // would be recorded as approved without Meta ever seeing it.
    if (changed && cur.status === "PENDING") {
        throw new WaTemplateError("Meta is still checking the last version — wait for its answer before changing the wording.");
    }
    await prisma.whatsAppTemplate.upsert({
        where: { kind },
        create: { kind, enabled: input.enabled, body: d.body, viewButton: d.viewButton, appButton: d.appButton },
        update: {
            enabled: input.enabled,
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

/** Send the saved draft to Meta under a fresh versioned name. */
export async function submitWaTemplate(kind: WaTemplateKind): Promise<WaTemplateView> {
    if (!isTemplateApiConfigured()) {
        throw new WaTemplateError("WhatsApp template sending is not set up — META_WA_BUSINESS_ACCOUNT_ID or META_WA_ACCESS_TOKEN is missing.");
    }
    const cur = await getOne(kind);
    const errs = checkBody(cur.draft);
    if (errs.length) throw new WaTemplateError(errs.join(" "));

    const row = await prisma.whatsAppTemplate.upsert({
        where: { kind },
        create: { kind, body: cur.draft.body, viewButton: cur.draft.viewButton, appButton: cur.draft.appButton, version: 1 },
        update: { version: { increment: 1 } },
        select: { version: true },
    });
    // Meta keeps a deleted/rejected name reserved, so every submission gets its own.
    const name = `${kind.toLowerCase()}_bill_v${row.version}`;
    try {
        const r = await submitTemplate(name, cur.draft);
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
export async function refreshWaTemplate(kind: WaTemplateKind): Promise<WaTemplateView> {
    const cur = await getOne(kind);
    if (!cur.metaName || cur.status !== "PENDING" || !isTemplateApiConfigured()) return cur;
    const s = await fetchTemplateStatus(cur.metaName);
    if (!s) return cur;
    if (s.status === "APPROVED") {
        await markApproved(kind, cur.metaName, cur.draft);
    } else if (s.status !== cur.status) {
        await prisma.whatsAppTemplate.update({ where: { kind }, data: { status: s.status, rejectReason: s.rejectReason } });
    }
    return getOne(kind);
}

async function markApproved(kind: WaTemplateKind, name: string, d: WaTemplateDraft) {
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
