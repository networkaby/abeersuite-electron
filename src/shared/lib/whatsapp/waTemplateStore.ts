import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { WhatsAppTemplate, WhatsAppTemplateApproval } from "@/generated/prisma/client";
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
import { billWabaId, fetchTemplateStatus, isTemplateApiConfigured, submitTemplate } from "./metaTemplates";

/**
 * WhatsAppTemplate rows: read, edit, send to Meta, follow the approval.
 *
 * The wording (draft, on/off, auto send) is one per template. Meta's approval
 * is per WhatsApp account (WhatsAppTemplateApproval), so a new account can be
 * approved while bills keep going from the old one. Every view below is "this
 * template at account X"; X defaults to the bills account, which is also the
 * one bills are sent with.
 *
 * The sender reads the approved copy on every bill, so it is cached in memory
 * for a minute (and dropped on any change here) — one row read per minute per
 * server instead of one per bill.
 */

export type WaTemplateView = {
    kind: WaAnyKind;
    /** The WhatsApp account the status / approval below is for. */
    wabaId: string;
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

export class WaTemplateError extends Error {}

function toView(kind: WaAnyKind, wabaId: string, r: WhatsAppTemplate | undefined, a: WhatsAppTemplateApproval | undefined): WaTemplateView {
    const draft = r
        ? { body: r.body, viewButton: r.viewButton, appButton: r.appButton }
        : isCustomKind(kind) ? CUSTOM_TEMPLATE_DEFAULT : WA_TEMPLATE_DEFAULTS[kind];
    return {
        kind,
        wabaId,
        name: r?.name ?? null,
        enabled: r?.enabled ?? false,
        autoSend: r?.autoSend ?? autoSendDefault(kind),
        draft,
        status: a?.status ?? "DRAFT",
        rejectReason: a?.rejectReason ?? null,
        metaName: a?.metaName ?? null,
        submittedAt: a?.submittedAt?.toISOString() ?? null,
        approved: a?.approvedName && a.approvedBody != null
            ? { name: a.approvedName, body: a.approvedBody, viewButton: a.approvedView, appButton: a.approvedApp, at: a.approvedAt?.toISOString() ?? null }
            : null,
    };
}

/**
 * Before 2026-11-15 the one approval lived on WhatsAppTemplate, for the bills
 * account. Copy it once into WhatsAppTemplateApproval for that account — in
 * code, not the migration, because the account id may live only in .env. A
 * kind that already has any approval row is left alone, so this is one-time.
 */
let adopted: Promise<void> | null = null;
function adoptLegacyApprovals(): Promise<void> {
    adopted ??= (async () => {
        const waba = await billWabaId();
        if (!waba) return;
        const [rows, have] = await Promise.all([
            prisma.whatsAppTemplate.findMany({ where: { OR: [{ metaName: { not: null } }, { approvedName: { not: null } }] } }),
            prisma.whatsAppTemplateApproval.findMany({ select: { kind: true } }),
        ]);
        const done = new Set(have.map((h) => h.kind));
        const todo = rows.filter((r) => !done.has(r.kind));
        if (!todo.length) return;
        await prisma.whatsAppTemplateApproval.createMany({
            data: todo.map((r) => ({
                kind: r.kind,
                wabaId: waba,
                status: r.status,
                metaName: r.metaName,
                metaId: r.metaId,
                rejectReason: r.rejectReason,
                version: r.version,
                submittedAt: r.submittedAt,
                approvedName: r.approvedName,
                approvedBody: r.approvedBody,
                approvedView: r.approvedView,
                approvedApp: r.approvedApp,
                approvedAt: r.approvedAt,
            })),
            skipDuplicates: true,
        });
    })().catch((e) => {
        adopted = null; // try again on the next read
        throw e;
    });
    return adopted;
}

/** The account a call is about: the one asked for, else the bills account. */
async function resolveWaba(waba?: string | null): Promise<string> {
    const id = waba || (await billWabaId());
    if (!id) throw new WaTemplateError("No WhatsApp account is set — App Settings → WhatsApp.");
    return id;
}

export async function listWaTemplates(waba?: string | null): Promise<WaTemplateView[]> {
    const id = await resolveWaba(waba);
    await adoptLegacyApprovals();
    const [rows, approvals] = await Promise.all([
        prisma.whatsAppTemplate.findMany(),
        prisma.whatsAppTemplateApproval.findMany({ where: { wabaId: id } }),
    ]);
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    const appr = new Map(approvals.map((a) => [a.kind, a]));
    const custom = rows.filter((r) => isCustomKind(r.kind)).sort((a, b) => a.kind.localeCompare(b.kind));
    return [
        ...WA_TEMPLATE_KINDS.map((k) => toView(k, id, byKind.get(k), appr.get(k))),
        ...custom.map((r) => toView(r.kind as WaAnyKind, id, r, appr.get(r.kind))),
    ];
}

/** Every kind, after asking Meta about any still waiting for approval — so
 *  opening the page (or its list API) is how staff see an approval land, with
 *  no polling job. Only PENDING rows call Meta; the rest is one read. */
export async function listWaTemplatesFresh(waba?: string | null): Promise<WaTemplateView[]> {
    const templates = await listWaTemplates(waba);
    const pending = templates.filter((t) => t.status === "PENDING");
    if (!pending.length) return templates;
    await Promise.all(pending.map((t) => refreshWaTemplate(t.kind, t.wabaId).catch(() => null)));
    return listWaTemplates(waba);
}

async function getOne(kind: WaAnyKind, waba?: string | null): Promise<WaTemplateView> {
    const id = await resolveWaba(waba);
    await adoptLegacyApprovals();
    const [r, a] = await Promise.all([
        prisma.whatsAppTemplate.findUnique({ where: { kind } }),
        prisma.whatsAppTemplateApproval.findUnique({ where: { kind_wabaId: { kind, wabaId: id } } }),
    ]);
    return toView(kind, id, r ?? undefined, a ?? undefined);
}

// ── Sender cache ────────────────────────────────────────────────────────────
// Bills go out from the bills account, so its approval is the one that counts.
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

/** Drop every cached approval — the bills account just changed. */
export function clearWaTemplateCache() {
    cache.clear();
}

// ── Edits ───────────────────────────────────────────────────────────────────

/** Save the wording (one for every account). A changed wording goes back to
 *  DRAFT at every account; each keeps sending its last approved copy until the
 *  new one is approved there. */
export async function saveWaTemplate(
    kind: WaAnyKind,
    input: { enabled: boolean; autoSend: boolean; draft: WaTemplateDraft },
    waba?: string | null,
): Promise<WaTemplateView> {
    const cur = await getOne(kind, waba);
    if (isCustomKind(kind) && cur.name == null) throw new WaTemplateError("This template has been deleted.");
    const d = input.draft;
    const changed = d.body !== cur.draft.body || d.viewButton !== cur.draft.viewButton || d.appButton !== cur.draft.appButton;
    // The approval that comes back is for the copy Meta holds — an edit now
    // would be recorded as approved without Meta ever seeing it. One wording for
    // every account, so a check pending at ANY account blocks the edit.
    if (changed && (await prisma.whatsAppTemplateApproval.count({ where: { kind, status: "PENDING" } }))) {
        throw new WaTemplateError("Meta is still checking the last version — wait for its answer before changing the wording.");
    }
    await prisma.whatsAppTemplate.upsert({
        where: { kind },
        create: { kind, enabled: input.enabled, autoSend: input.autoSend, body: d.body, viewButton: d.viewButton, appButton: d.appButton },
        update: { enabled: input.enabled, autoSend: input.autoSend, body: d.body, viewButton: d.viewButton, appButton: d.appButton },
    });
    if (changed) await prisma.whatsAppTemplateApproval.updateMany({ where: { kind }, data: { status: "DRAFT", rejectReason: null } });
    cache.delete(kind);
    return getOne(kind, waba);
}

// ── Custom templates ────────────────────────────────────────────────────────

/** Add a custom template with the starting wording; staff edit it from there. */
export async function createCustomWaTemplate(name: string, waba?: string | null): Promise<WaTemplateView> {
    const kind = newCustomKind();
    const d = CUSTOM_TEMPLATE_DEFAULT;
    await prisma.whatsAppTemplate.create({
        data: { kind, name: name.trim(), enabled: false, autoSend: false, body: d.body, viewButton: d.viewButton, appButton: d.appButton },
    });
    return getOne(kind, waba);
}

export async function renameCustomWaTemplate(kind: WaAnyKind, name: string, waba?: string | null): Promise<WaTemplateView> {
    if (!isCustomKind(kind)) throw new WaTemplateError("A built-in template cannot be renamed.");
    await prisma.whatsAppTemplate.update({ where: { kind }, data: { name: name.trim() } });
    return getOne(kind, waba);
}

/** Send the saved draft to Meta, at one account, under a fresh versioned name. */
export async function submitWaTemplate(kind: WaAnyKind, waba?: string | null): Promise<WaTemplateView> {
    if (!(await isTemplateApiConfigured())) {
        throw new WaTemplateError("WhatsApp template sending is not set up — META_WA_BUSINESS_ACCOUNT_ID or META_WA_ACCESS_TOKEN is missing.");
    }
    const cur = await getOne(kind, waba);
    if (isCustomKind(kind) && cur.name == null) throw new WaTemplateError("This template has been deleted.");
    const errs = checkBody(cur.draft, kind);
    if (errs.length) throw new WaTemplateError(errs.join(" "));
    const wabaId = cur.wabaId;

    // A built-in never edited has no wording row yet.
    await prisma.whatsAppTemplate.upsert({
        where: { kind },
        create: { kind, autoSend: cur.autoSend, body: cur.draft.body, viewButton: cur.draft.viewButton, appButton: cur.draft.appButton },
        update: {},
    });
    const row = await prisma.whatsAppTemplateApproval.upsert({
        where: { kind_wabaId: { kind, wabaId } },
        create: { kind, wabaId, version: 1 },
        update: { version: { increment: 1 } },
        select: { version: true },
    });
    // Meta keeps a deleted/rejected name reserved (per account), so every submission gets its own.
    const name = `${kind.toLowerCase()}_v${row.version}`;
    try {
        const r = await submitTemplate(kind, name, cur.draft, wabaId);
        await prisma.whatsAppTemplateApproval.update({
            where: { kind_wabaId: { kind, wabaId } },
            data: { status: r.status, metaName: name, metaId: r.id, rejectReason: null, submittedAt: new Date() },
        });
        if (r.status === "APPROVED") await markApproved(kind, wabaId, name, cur.draft);
    } catch (e) {
        throw new WaTemplateError(`Meta refused it: ${e instanceof Error ? e.message : String(e)}`);
    }
    return getOne(kind, wabaId);
}

/** Ask Meta where the copy submitted at this account stands; on APPROVED it
 *  becomes the one that account's bills use. */
export async function refreshWaTemplate(kind: WaAnyKind, waba?: string | null): Promise<WaTemplateView> {
    const cur = await getOne(kind, waba);
    if (!cur.metaName || cur.status !== "PENDING" || !(await isTemplateApiConfigured())) return cur;
    const s = await fetchTemplateStatus(cur.metaName, cur.wabaId);
    if (!s) return cur;
    if (s.status === "APPROVED") {
        await markApproved(kind, cur.wabaId, cur.metaName, cur.draft);
    } else if (s.status !== cur.status) {
        await prisma.whatsAppTemplateApproval.update({
            where: { kind_wabaId: { kind, wabaId: cur.wabaId } },
            data: { status: s.status, rejectReason: s.rejectReason },
        });
    }
    return getOne(kind, cur.wabaId);
}

async function markApproved(kind: WaAnyKind, wabaId: string, name: string, d: WaTemplateDraft) {
    await prisma.whatsAppTemplateApproval.update({
        where: { kind_wabaId: { kind, wabaId } },
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
