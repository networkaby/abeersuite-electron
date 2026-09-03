/**
 * Which Prisma write the offline policies actually restrain.
 *
 * The policy page offers three families of toggle. Vouchers were already enforced
 * (by `UniversalVoucher.type`); the other two had no enforcement anywhere — the
 * master-data toggles' only helper, `isMasterOperationAllowedOffline`, had zero
 * callers. This module is the missing half: model + operation -> the toggle that
 * decides it.
 *
 * It lives beside the policy definitions rather than inside `prismaClient.ts` because
 * that file's job is choosing a DATABASE, not knowing that `InvBrand` is taxonomy.
 *
 * ── Create vs edit ───────────────────────────────────────────────────────────
 * Master families carry a separate toggle for each, so both are checked. Ticket
 * intake carries only one toggle per kind, and its wording is about intake ("Service
 * & Repair Ticket Intake", "Help Desk Front-Desk Enquiries"), so it gates CREATE
 * only: a repair already on the board must still be able to move down its pipeline
 * while the shop is offline, or the toggle would freeze work it never meant to touch.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { REPAIR_PIPELINE_NAME } from "@/modules/repairing/lib/repairPipeline";
import { DEALS_PIPELINE_NAME } from "@/modules/deals/lib/dealsPipeline";
import { HELP_PIPELINE_NAME } from "@/modules/help/lib/helpPipeline";
import { ADMIN_TASKS_PIPELINE_ID } from "@/modules/administration/lib/adminPipeline";
import {
    isMasterOperationAllowedOffline,
    getOfflineMasterBlockedReason,
    type MasterEntity,
    type OfflinePolicies,
} from "./offlineVoucherSafety";

/** Prisma operations that bring a NEW row into existence. */
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
/** Prisma operations that change rows that already exist. */
const EDIT_OPS = new Set(["update", "updateMany"]);
// `upsert` is deliberately in neither: it may do either, so it is checked against both.

/**
 * Master-data models, grouped into the four families the settings page names.
 *
 * Only the records a counter can actually author are listed. Rows written as a
 * side-effect of a sale — `InvStockLedger`, `InvProductBranch` — are NOT master data
 * and must never be gated by a master toggle, or switching off "edit products" would
 * stop billing.
 */
const MASTER_MODELS: Record<string, MasterEntity> = {
    InvProduct:      "product",
    InvProductCode:  "product",   // barcodes, per the toggle's own wording
    Account:         "account",
    AccountAlias:    "account",
    AccountGroup:    "account",
    InvBrand:        "taxonomy",
    InvCategory:     "taxonomy",
    InvUnit:         "taxonomy",
    InvProductGroup: "taxonomy",
    Person:          "customer",
    Company:         "customer",
};

/** Ticket flavours that carry their own intake toggle. */
type TicketKind = "repair" | "help" | "deal" | "task";

const TICKET_KIND_POLICY: Record<TicketKind, keyof OfflinePolicies> = {
    repair: "allowRepairTicket",
    help:   "allowHelpTicket",
    deal:   "allowCrmDeal",
    task:   "allowTask",
};

const TICKET_KIND_LABEL: Record<TicketKind, string> = {
    repair: "Repair ticket intake",
    help:   "Help-desk enquiries",
    deal:   "CRM deals",
    task:   "Internal staff tasks",
};

/** Pipelines resolve by NAME (ids are seed-dependent), so the map is looked up once. */
const PIPELINE_NAME_KIND: Record<string, TicketKind> = {
    [REPAIR_PIPELINE_NAME]: "repair",
    [DEALS_PIPELINE_NAME]:  "deal",
    [HELP_PIPELINE_NAME]:   "help",
};

const PIPELINE_CACHE_TTL_MS = 300_000; // pipelines are configuration, not traffic

type PipelineCache = { byId: Record<string, TicketKind>; loadedAt: number };
const globalForPipelines = globalThis as unknown as { __offlinePipelineKinds?: PipelineCache };

/**
 * pipelineId -> ticket kind, cached for five minutes.
 *
 * Fails open to the admin-tasks pipeline alone: if the lookup cannot run, an unknown
 * pipeline is simply not gated, which is the same answer a brand-new custom pipeline
 * gets. Refusing intake because a lookup failed would be worse than the risk.
 */
async function pipelineKinds(db: PrismaClient): Promise<Record<string, TicketKind>> {
    const cached = globalForPipelines.__offlinePipelineKinds;
    if (cached && Date.now() - cached.loadedAt < PIPELINE_CACHE_TTL_MS) return cached.byId;

    const byId: Record<string, TicketKind> = { [ADMIN_TASKS_PIPELINE_ID]: "task" };
    try {
        const rows = await db.pipeline.findMany({
            where:  { name: { in: Object.keys(PIPELINE_NAME_KIND) } },
            select: { id: true, name: true },
        });
        for (const row of rows) {
            const kind = PIPELINE_NAME_KIND[row.name];
            if (kind) byId[row.id] = kind;
        }
    } catch {
        // Left with admin tasks only — see the fail-open note above.
    }

    globalForPipelines.__offlinePipelineKinds = { byId, loadedAt: Date.now() };
    return byId;
}

/** Drops the cached pipeline map — used by tests and after a pipeline rename. */
export function invalidatePipelineKindCache(): void {
    globalForPipelines.__offlinePipelineKinds = undefined;
}

/**
 * Decides whether one non-voucher write is allowed under the current policies.
 *
 * Returns `null` when the model is not policy-gated at all (the overwhelming majority
 * of writes), or a refusal message when it is gated and switched off.
 */
export async function checkOfflinePolicyForWrite(
    db: PrismaClient,
    model: string,
    operation: string,
    args: unknown,
    policies: OfflinePolicies,
): Promise<string | null> {
    // ── Master data ──────────────────────────────────────────────────────────
    const entity = MASTER_MODELS[model];
    if (entity) {
        const ops: ("create" | "edit")[] = operation === "upsert"
            ? ["create", "edit"]                        // may do either, so both must be allowed
            : CREATE_OPS.has(operation) ? ["create"]
            : EDIT_OPS.has(operation)   ? ["edit"]
            : [];
        for (const op of ops) {
            if (!isMasterOperationAllowedOffline(entity, op, policies)) {
                return getOfflineMasterBlockedReason(entity, op);
            }
        }
        return null;
    }

    // ── Ticket intake ────────────────────────────────────────────────────────
    if (model === "Ticket" && CREATE_OPS.has(operation)) {
        const pipelineId = (args as { data?: { pipelineId?: unknown } })?.data?.pipelineId;
        if (typeof pipelineId === "string") {
            const kind = (await pipelineKinds(db))[pipelineId];
            if (kind && !policies[TICKET_KIND_POLICY[kind]]) {
                return `${TICKET_KIND_LABEL[kind]} is switched off while this counter is offline `
                    + "(Settings → Offline Policies). Take the details on paper, or ask an admin to allow it.";
            }
        }
        return null;
    }

    // ── Timeline notes / call logs ───────────────────────────────────────────
    if (model === "TicketLog" && CREATE_OPS.has(operation) && !policies.allowTimelineLog) {
        return "Timeline notes and call logs are switched off while this counter is offline "
            + "(Settings → Offline Policies).";
    }

    return null;
}
