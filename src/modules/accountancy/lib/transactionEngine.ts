// ── Transaction Engine ────────────────────────────────────────────────────────
//
// The single internal writer for ledger postings. Every posting voucher funnels
// through `enginePost`, which drives two internal arms in the caller's tx:
//   • engineGlArm    — mirror JournalEntry + JournalLines + Account.balance deltas
//   • engineStockArm — InvStockLedger + InvProduct/InvProductBranch stock caches
//
// INVARIANT: one voucher → one `enginePost` call carrying both arms; both run in
// the SAME `tx` (atomic); the engine never opens or commits its own transaction
// (callers own that + the P2028 timeout tuning).
//
// Naming: every engine function carries the `engine` prefix.
//   enginePost          — the funnel (spec in, GL + stock out)
//   engineGlArm         — the GL writer (shared by enginePost + enginePostVoucher)
//   engineStockArm      — the stock writer (wraps recordStockMovementsBatch)
//   enginePostVoucher   — legacy: post a `Voucher` row (engineGlArm + status flip)
//   engineCreateVoucher — legacy: create a `Voucher` row, optionally posting it
//
// `enginePostVoucher` / `engineCreateVoucher` still target the GL `Voucher` table
// and are being subsumed by `enginePost` as callers migrate (see plan Phase 3).

import type { Prisma, VoucherType, VoucherGlRole, PaymentMethod } from "@/generated/prisma/client";
import { balanceDelta, nextRefFromSeries, toNumber } from "./balance";
import { round2 } from "@/shared/lib/format";
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "./groupNature";
import { recordStockMovementsBatch, type RecordStockMovementArgs } from "@/modules/inventory/lib/stockMovement";
import { bindingForType } from "@/shared/lib/accountancy/voucherBinding";
import { retreatReconciliation } from "./reconciliation";

type Drcr = "DEBIT" | "CREDIT";

/** A single GL (Dr/Cr) line for the engine. `account` is optional: when the
 * caller already loaded the ledger's nature (normalBalance/group) the engine
 * uses it; otherwise the engine batch-loads it before applying balance deltas. */
export interface EngineGlLine {
    accountId:    number;
    type:         Drcr;
    amount:       Prisma.Decimal | number | string;
    description?: string | null;
    account?:     { normalBalance: Drcr | null; group: { type: GroupTypeStr } | null } | null;
    /** Phase 4 G4 — self-describing spine line. `role` = form section (set by the
     *  trading GL builder; null on generic legs); `seq` = ordinal (defaults to the
     *  line's position when omitted). Mirrored onto `VoucherGlLine`, not JournalLine. */
    role?:        VoucherGlRole | null;
    seq?:         number | null;
    /** Phase 4 G4b — tender metadata, only meaningful on role=TENDER lines. */
    method?:      PaymentMethod | null;
    reference?:   string | null;
}

/** A stock movement for the engine's stock arm (re-export of the stock helper's shape). */
export type EngineStockMove = RecordStockMovementArgs;
/** Phase 5 5C: a stock move as the MAPPER builds it — without `universalVoucherId`.
 *  The mapper runs before the spine id is known (create-posted), so `enginePost`
 *  injects it after the GL arm yields the spine id. */
export type EngineStockMoveSpec = Omit<EngineStockMove, "universalVoucherId">;

/** The canonical thing the engine writes. Either arm may be empty:
 *  empty `glLines` → skip the GL arm; empty `stockMoves` → skip the stock arm. */
export interface TransactionSpec {
    type:        string;
    date:        Date;
    /** JE description. When omitted it's built from `type`/`reference`/`narration`. */
    description?: string;
    reference?:  string;
    narration?:  string | null;
    glLines:     EngineGlLine[];
    stockMoves:  EngineStockMoveSpec[];
}

/** A voucher loaded with the fields the GL post routine needs.
 * `account.group.type` feeds the null-normalBalance fallback (subsidiary party
 * ledgers carry a null `normalBalance`; their natural side derives from the
 * group). */
export interface PostableVoucher {
    id:        number;
    type:      string;
    reference: string;
    narration: string | null;
    date:      Date;
    lines: {
        accountId:   number;
        type:        Drcr;
        amount:      Prisma.Decimal | number | string;
        description: string | null;
        account:     { normalBalance: Drcr | null; group: { type: GroupTypeStr } | null };
    }[];
}

// ── GL arm ──────────────────────────────────────────────────────────────────

/**
 * The single GL writer (Phase 4 G5: legacy JournalEntry/JournalLine dropped — the
 * UniversalVoucher spine + VoucherGlLine children ARE the GL). Writes the spine's
 * GL lines (branch-stamped) and applies per-line `Account.balance` deltas with the
 * null-normalBalance group-nature fallback. Returns `{journalEntryId, universalVoucherId}`
 * (both the spine id since G5's self-ref).
 *
 * Ledger nature comes from each line's pre-loaded `account` when present; the
 * engine batch-loads any missing ledgers.
 */
export async function engineGlArm(
    tx: Prisma.TransactionClient,
    args: {
        date:        Date;
        description: string;
        lines:       EngineGlLine[];
        userId:      number;
        branchId:    string | null;
        postedAt:    Date;
        // Phase 4 dual-write metadata (Stage C). Optional so the engine compiles
        // for any caller; threaded onto the universal-voucher spine mirror.
        type?:           string;
        voucherNo?:    string | null;
        narration?:      string | null;
        partyAccountId?: number | null;
        // Phase 5 5.0 — when set, ATTACH the GL lines to this pre-created DRAFT
        // spine and flip it to POSTED (instead of minting a fresh spine). Lets a
        // draft carry a spine id from create time; POST fills its lines + balances.
        existingSpineId?: number | null;
    },
): Promise<{ journalEntryId: number; universalVoucherId: number }> {
    const { date, description, lines, userId, branchId, postedAt } = args;

    // Resolve each ledger's normal side for the balance delta. Use the caller's
    // pre-loaded `account` when present; batch-load the rest. Null-normalBalance
    // subsidiary (AR/AP) ledgers fall back to their group's natural side; a line
    // with neither is skipped rather than mis-posted.
    const natureById = new Map<number, Drcr | null>();
    for (const l of lines) {
        if (l.account) {
            natureById.set(
                l.accountId,
                l.account.normalBalance
                    ?? (l.account.group?.type ? defaultNormalBalanceForGroupType(l.account.group.type) : null),
            );
        }
    }
    const missing = [...new Set(lines.filter((l) => !natureById.has(l.accountId)).map((l) => l.accountId))];
    if (missing.length > 0) {
        const rows = await tx.account.findMany({
            where:  { id: { in: missing } },
            select: { id: true, normalBalance: true, group: { select: { type: true } } },
        });
        for (const r of rows) {
            natureById.set(
                r.id,
                (r.normalBalance as Drcr | null)
                    ?? (r.group?.type ? defaultNormalBalanceForGroupType(r.group.type as GroupTypeStr) : null),
            );
        }
    }
    // Money boundary: callers may hand us float sums (GST splits, discounts).
    // Round once to 2dp here so the stored line and the balance delta are the
    // SAME number — the Decimal(14,2) column would round on write anyway, and an
    // unrounded delta would drift the cached Account.balance away from its lines.
    for (const l of lines) {
        const side = natureById.get(l.accountId) ?? null;
        if (!side) continue;
        const delta = balanceDelta(side, l.type, round2(toNumber(l.amount)));
        await tx.account.update({
            where: { id: l.accountId },
            data:  { balance: { increment: delta } },
        });
    }

    // A posting dated inside an already-reconciled window invalidates that
    // reconciliation — pull each affected ledger's watermark back to the day
    // before this voucher. Placed before the ATTACH/CREATE split so BOTH paths
    // are covered, and inside the caller's tx so it rolls back with the posting.
    await retreatReconciliation(tx, lines.map((l) => l.accountId), date);

    // ── The single GL writer (Phase 4 G5 — legacy JournalEntry/JournalLine dropped) ─
    // The universal-voucher spine + VoucherGlLine children ARE the GL now.
    const glLineBase = lines.map((l, idx) => ({
        accountId:   l.accountId,
        type:        l.type,
        amount:      round2(toNumber(l.amount)),
        description: l.description ?? null,
        branchId,
        role:        l.role ?? null,        // form-section tag
        seq:         l.seq ?? idx,          // ordinal (form order)
        method:      l.method ?? null,      // tender channel
        reference:   l.reference ?? null,   // tender ref
    }));

    // Phase 5 5.0 — ATTACH mode: the draft spine already exists (created at
    // voucher-save by engineCreateSpine). Fill its GL lines + flip DRAFT→POSTED.
    if (args.existingSpineId != null) {
        const id = args.existingSpineId;
        await tx.voucherGlLine.createMany({ data: glLineBase.map((d) => ({ universalVoucherId: id, ...d })) });
        await tx.universalVoucher.update({
            where: { id },
            data: {
                status:          "POSTED",
                postedAt,
                sourceCreatedAt: postedAt,
                description,
                ...(args.type        != null ? { type:           args.type }        : {}),
                ...(args.voucherNo != null ? { voucherNo:    args.voucherNo } : {}),
                ...(args.narration   != null ? { narration:      args.narration }   : {}),
                ...(args.partyAccountId != null ? { partyAccountId: args.partyAccountId } : {}),
                ...(branchId != null ? { branchId } : {}),   // 5D-12: branch primary on the spine
            },
        });
        return { journalEntryId: id, universalVoucherId: id };
    }

    // CREATE-POSTED-directly: no pre-created draft spine — mint a fresh POSTED one.
    // 5D-7: the spine's `id` IS the Universal Voucher No (no `reference` string).
    const uv = await tx.universalVoucher.create({
        select: { id: true },
        data: {
            type:                 args.type ?? "JOURNAL",
            binding:              bindingForType(args.type ?? "JOURNAL"),   // 5D-9
            voucherNo:          args.voucherNo ?? null,
            date,
            description,
            narration:            args.narration ?? null,
            status:               "POSTED",
            postedAt,
            sourceCreatedAt:      postedAt,   // faithful txn wall-clock for windowed readers
            partyAccountId:       args.partyAccountId ?? null,
            branchId:             branchId ?? null,   // 5D-12: branch primary on the spine
            createdById:          userId,
            lines: { create: glLineBase },
        },
    });
    // 5D-16: the vestigial self-ref `sourceJournalEntryId` is dropped — callers key
    // by the spine `id` directly. The engine's `journalEntryId` RETURN value (= the
    // spine id) is kept for caller compatibility.
    return { journalEntryId: uv.id, universalVoucherId: uv.id };
}

// ── Draft spine (Phase 5 5.0) ─────────────────────────────────────────────────

/**
 * Create a DRAFT universal-voucher spine HEADER (no GL lines, no balance impact)
 * at voucher-save time, so the document carries a `universalVoucherId` from the
 * start. The central status gate (ledgerStatusFilter) excludes non-POSTED rows,
 * so a draft spine is invisible to balances/reports until POST attaches its GL
 * lines + flips it to POSTED via `engineGlArm({ existingSpineId })`.
 *
 * The spine carries the user-facing Voucher No (`voucherNo`, e.g. SV-/PV-/PMT-);
 * its `id` IS the Universal Voucher No (Phase 5 5D-7). The old internal GL_POSTING
 * series was retired (5D-14).
 */
export async function engineCreateSpine(
    tx: Prisma.TransactionClient,
    args: {
        type:            string;
        date:            Date;
        description:     string;
        narration?:      string | null;
        voucherNo?:    string | null;
        partyAccountId?: number | null;
        branchId?:       string | null;
        userId:          number;
    },
): Promise<number> {
    // 5D-7: the spine's `id` IS the Universal Voucher No (no `reference` string).
    const uv = await tx.universalVoucher.create({
        select: { id: true },
        data: {
            type:           args.type,
            binding:        bindingForType(args.type),   // 5D-9
            voucherNo:    args.voucherNo ?? null,
            date:           args.date,
            description:    args.description,
            narration:      args.narration ?? null,
            status:         "DRAFT",
            partyAccountId: args.partyAccountId ?? null,
            branchId:       args.branchId ?? null,   // 5D-12: branch primary on the spine
            createdById:    args.userId,
        },
    });
    return uv.id;   // 5D-16: vestigial sourceJournalEntryId self-ref dropped
}

// ── Spine lifecycle helper (Phase 4 G5 — the JE mirror is gone) ───────────────

/** Lifecycle fields the cancel/delete/restore routes set on the spine directly
 *  (the spine IS the GL now; `id` is the same value the routes hold as the
 *  voucher's `journalEntryId`/`universalVoucherId`). */
export type SpineLifecycle = Partial<{
    status: "DRAFT" | "POSTED" | "CANCELLED";
    postedAt: Date | null;
    cancelledAt: Date | null; cancelledById: number | null; cancelReason: string | null;
    deletedAt: Date | null; deletedById: number | null; deleteReason: string | null;
}>;

/** Apply a lifecycle change to the spine row by id (no-op when it doesn't exist). */
export async function setSpineLifecycle(
    tx: Prisma.TransactionClient,
    universalVoucherId: number,
    data: SpineLifecycle,
): Promise<void> {
    await tx.universalVoucher.updateMany({ where: { id: universalVoucherId }, data });
}

// ── Stock arm ───────────────────────────────────────────────────────────────

/** The stock writer — InvStockLedger rows + InvProduct/InvProductBranch caches. */
export async function engineStockArm(
    tx: Prisma.TransactionClient,
    moves: EngineStockMove[],
): Promise<void> {
    if (moves.length === 0) return;
    await recordStockMovementsBatch(tx, moves);
}

// ── Funnel ──────────────────────────────────────────────────────────────────

/**
 * The engine funnel — every posting voucher's single entry. Writes the GL arm
 * (when `glLines` present) and the stock arm (when `stockMoves` present) in the
 * caller's `tx`, atomically. Returns the mirror JE id (null when GL-less).
 *
 * Does not touch a voucher row — the caller flips voucher status / links the JE.
 */
export async function enginePost(
    tx: Prisma.TransactionClient,
    spec: TransactionSpec,
    userId: number,
    opts: { branchId?: string | null; postedAt?: Date; existingSpineId?: number | null } = {},
): Promise<{ journalEntryId: number | null; universalVoucherId: number | null }> {
    const branchId = opts.branchId ?? null;
    const postedAt = opts.postedAt ?? new Date();

    let journalEntryId: number | null = null;
    // Stock-only vouchers (GRN/Challan/…) have no GL arm but DO have a spine
    // (created at voucher-save, passed as existingSpineId) — seed from it.
    let universalVoucherId: number | null = opts.existingSpineId ?? null;
    if (spec.glLines.length > 0) {
        const description = spec.description
            ?? `${spec.type} ${spec.reference ?? ""}: ${spec.narration ?? ""}`.trim();
        const gl = await engineGlArm(tx, {
            date:        spec.date,
            description,
            lines:       spec.glLines,
            userId,
            branchId,
            postedAt,
            type:        spec.type,
            voucherNo: spec.reference ?? null,
            narration:   spec.narration ?? null,
            existingSpineId: opts.existingSpineId ?? null,   // Phase 5 5.0: attach to draft spine
        });
        journalEntryId = gl.journalEntryId;
        universalVoucherId = gl.universalVoucherId;   // G4d direct spine link
    }
    if (spec.stockMoves.length > 0) {
        // Phase 5 5C: stamp the spine id onto each stock row (the mapper builds
        // them spine-less since it runs before the spine exists for create-posted).
        if (universalVoucherId == null) {
            throw new Error("enginePost: stock moves need a spine — pass existingSpineId or GL lines.");
        }
        const uv = universalVoucherId;
        await engineStockArm(tx, spec.stockMoves.map((m) => ({ ...m, universalVoucherId: uv })));
    }
    return { journalEntryId, universalVoucherId };
}

// ── Financial-voucher helpers (spine-only since Phase 5 5E) ───────────────────

export interface CreateGlVoucherSpec {
    type:            VoucherType;
    date:            Date;
    userId:          number;
    lines:           { accountId: number; type: Drcr; amount: number; description?: string | null }[];
    narration?:      string | null;
    partyAccountId?: number | null;
    /** When true, create then immediately post (DRAFT → POSTED) in the same tx. */
    post?:           boolean;
    /** VoucherSeries key for the reference. Defaults to the voucher `type`.
     * The Journal-Voucher dialog passes "JOURNAL" to keep its `JV-…` numbering. */
    referenceSeries?: string;
    /** Branch stamped on the mirror-JE lines when posted (POS callers). */
    branchId?:        string | null;
    /** Posting timestamp when `post` is true. Defaults to now. */
    postedAt?:        Date;
    /**
     * POS counter the voucher was raised at — becomes the counter part of the
     * reference (`assembleReference`). Omit for office / back-office vouchers
     * that belong to no counter; the series then defaults to counter 1.
     *
     * Until 2026-09-04 this slot was fed `spec.userId` — a leftover from when
     * the reference carried a USER number (the `"user"` token in `partOrder` is
     * still an alias for `"counter"`). That stamped the creator's row id into
     * every GL voucher reference, so the same series read `30012` or `70013`
     * depending on who happened to save it.
     */
    counterNumber?:   number | null;
}

/** The shape engineCreateVoucher returns — Voucher table dropped (Phase 5 5E), so
 *  this is a spine-shaped snapshot. `id` / `journalEntryId` / `universalVoucherId`
 *  are all the spine id (self-ref). */
export interface CreatedVoucher {
    id:                 number;
    reference:          string;
    universalVoucherId: number;
    journalEntryId:     number | null;
    status:             "DRAFT" | "POSTED";
    totalAmount:        number;
}

/**
 * Phase 5 5E: flip a DRAFT spine (its VoucherGlLine already written at create) to
 * POSTED and apply the Account.balance deltas. The spine IS the financial voucher
 * now (Voucher table dropped), so there is no second row to flip.
 */
export async function enginePostSpine(
    tx: Prisma.TransactionClient,
    spineId: number,
    opts: { postedAt?: Date } = {},
): Promise<void> {
    const postedAt = opts.postedAt ?? new Date();
    const lines = await tx.voucherGlLine.findMany({
        where:  { universalVoucherId: spineId },
        select: { accountId: true, type: true, amount: true },
    });
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const rows = ids.length === 0 ? [] : await tx.account.findMany({
        where:  { id: { in: ids } },
        select: { id: true, normalBalance: true, group: { select: { type: true } } },
    });
    const natureById = new Map<number, Drcr | null>();
    for (const r of rows) {
        natureById.set(r.id, (r.normalBalance as Drcr | null)
            ?? (r.group?.type ? defaultNormalBalanceForGroupType(r.group.type as GroupTypeStr) : null));
    }
    for (const l of lines) {
        const side = natureById.get(l.accountId) ?? null;
        if (!side) continue;
        await tx.account.update({ where: { id: l.accountId }, data: { balance: { increment: balanceDelta(side, l.type, toNumber(l.amount)) } } });
    }
    // Same reconciliation retreat as engineGlArm — this is the OTHER path a spine
    // can reach POSTED by (engineCreateVoucher → enginePostSpine), and a DRAFT
    // moves no balances, so posting is the moment the window turns dirty.
    const spine = await tx.universalVoucher.findUnique({ where: { id: spineId }, select: { date: true } });
    if (spine) await retreatReconciliation(tx, ids, spine.date);

    await tx.universalVoucher.updateMany({ where: { id: spineId }, data: { status: "POSTED", postedAt, sourceCreatedAt: postedAt } });
}

/**
 * Read a financial voucher's total back from the DB — the sum of its DEBIT legs,
 * the same rule `engineCreateVoucher` applies when it stamps `totalAmount` at
 * creation (below).
 *
 * Financial vouchers are spine-only: Phase 5 5E dropped Voucher/VoucherLine, and a
 * RECEIPT/PAYMENT/CONTRA has NO `VoucherDetail` sidecar — that table is the
 * inventory document (renamed InvVoucher). Summing the GL lines is therefore the
 * only way to read a receipt's total, and any code reaching into `voucherDetail`
 * with a spine id is looking in the wrong table.
 */
export async function voucherDebitTotal(tx: Prisma.TransactionClient, spineId: number): Promise<number> {
    const agg = await tx.voucherGlLine.aggregate({
        where: { universalVoucherId: spineId, type: "DEBIT" },
        _sum: { amount: true },
    });
    return round2(toNumber(agg._sum.amount ?? 0));
}

/**
 * Create a financial voucher — the UniversalVoucher spine IS the voucher (Phase 5
 * 5E dropped the Voucher table). Writes a DRAFT spine + its VoucherGlLine lines
 * (gated out of balances until POSTED); when `spec.post`, flips it POSTED + applies
 * the balance deltas. Returns a spine-shaped snapshot.
 */
export async function engineCreateVoucher(
    tx: Prisma.TransactionClient,
    spec: CreateGlVoucherSpec,
): Promise<CreatedVoucher> {
    const totalAmount = round2(spec.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0));

    const reference = await nextRefFromSeries(tx, spec.referenceSeries ?? spec.type, {
        counterNumber: spec.counterNumber ?? null,
    });

    const spineId = await engineCreateSpine(tx, {
        type:           spec.type,
        date:           spec.date,
        description:    `${spec.type} ${reference}: ${spec.narration ?? ""}`.trim(),
        narration:      spec.narration ?? null,
        voucherNo:    reference,
        partyAccountId: spec.partyAccountId ?? null,
        branchId:       spec.branchId ?? null,   // 5D-12: branch primary on the spine
        userId:         spec.userId,
    });
    await tx.voucherGlLine.createMany({
        data: spec.lines.map((l, idx) => ({
            universalVoucherId: spineId,
            accountId:   l.accountId,
            type:        l.type,
            amount:      round2(l.amount),
            description: l.description ?? null,
            seq:         idx,
        })),
    });

    let status: "DRAFT" | "POSTED" = "DRAFT";
    let journalEntryId: number | null = null;
    if (spec.post) {
        await enginePostSpine(tx, spineId, { postedAt: spec.postedAt ?? new Date() });
        status = "POSTED";
        journalEntryId = spineId;
    }

    return { id: spineId, reference, universalVoucherId: spineId, journalEntryId, status, totalAmount };
}
