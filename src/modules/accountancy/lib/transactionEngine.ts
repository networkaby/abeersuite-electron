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
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "./groupNature";
import { recordStockMovementsBatch, type RecordStockMovementArgs } from "@/modules/inventory/lib/stockMovement";

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
    stockMoves:  EngineStockMove[];
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
 * The single GL writer. Creates the mirror `JournalEntry` (GL_POSTING series) +
 * `JournalLine`s (branch-stamped), and applies per-line `Account.balance` deltas
 * with the null-normalBalance group-nature fallback. Returns the JE id.
 *
 * Ledger nature comes from each line's pre-loaded `account` when present; the
 * engine batch-loads any missing ledgers. Does NOT touch a `Voucher` row — that
 * is the caller's concern (`enginePostVoucher` flips the voucher; `enginePost`
 * leaves it to the route).
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
        friendlyRef?:    string | null;
        narration?:      string | null;
        partyAccountId?: number | null;
    },
): Promise<{ journalEntryId: number; universalVoucherId: number }> {
    const { date, description, lines, userId, branchId, postedAt } = args;

    const jeRef = await nextRefFromSeries(tx, "GL_POSTING", userId);

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
    for (const l of lines) {
        const side = natureById.get(l.accountId) ?? null;
        if (!side) continue;
        const delta = balanceDelta(side, l.type, toNumber(l.amount));
        await tx.account.update({
            where: { id: l.accountId },
            data:  { balance: { increment: delta } },
        });
    }

    // ── The single GL writer (Phase 4 G5 — legacy JournalEntry/JournalLine dropped) ─
    // The universal-voucher spine + VoucherGlLine children ARE the GL now.
    const uv = await tx.universalVoucher.create({
        select: { id: true },
        data: {
            type:                 args.type ?? "JOURNAL",
            reference:            jeRef,
            friendlyRef:          args.friendlyRef ?? null,
            date,
            description,
            narration:            args.narration ?? null,
            status:               "POSTED",
            postedAt,
            sourceCreatedAt:      postedAt,   // faithful txn wall-clock for windowed readers
            partyAccountId:       args.partyAccountId ?? null,
            createdById:          userId,
            lines: {
                create: lines.map((l, idx) => ({
                    accountId:           l.accountId,
                    type:                l.type,
                    amount:              l.amount,
                    description:         l.description ?? null,
                    branchId,
                    role:                l.role ?? null,        // form-section tag
                    seq:                 l.seq ?? idx,          // ordinal (form order)
                    method:              l.method ?? null,      // tender channel
                    reference:           l.reference ?? null,   // tender ref
                })),
            },
        },
    });
    // Self-reference: `sourceJournalEntryId`/voucher `journalEntryId` now carry the
    // SPINE id (the JE is gone), so the lifecycle helpers that key by it still
    // resolve. Vestigial — dropped in a follow-up rename.
    await tx.universalVoucher.update({ where: { id: uv.id }, data: { sourceJournalEntryId: uv.id } });

    return { journalEntryId: uv.id, universalVoucherId: uv.id };
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
    opts: { branchId?: string | null; postedAt?: Date } = {},
): Promise<{ journalEntryId: number | null; universalVoucherId: number | null }> {
    const branchId = opts.branchId ?? null;
    const postedAt = opts.postedAt ?? new Date();

    let journalEntryId: number | null = null;
    let universalVoucherId: number | null = null;
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
            friendlyRef: spec.reference ?? null,
            narration:   spec.narration ?? null,
        });
        journalEntryId = gl.journalEntryId;
        universalVoucherId = gl.universalVoucherId;   // G4d direct spine link
    }
    if (spec.stockMoves.length > 0) {
        await engineStockArm(tx, spec.stockMoves);
    }
    return { journalEntryId, universalVoucherId };
}

// ── Legacy GL-voucher helpers (being subsumed by enginePost) ──────────────────

/**
 * Post a DRAFT financial voucher: write its GL via `engineGlArm`, then flip the
 * `Voucher` to POSTED with its `journalEntryId`. Caller loads + guards the
 * voucher (DRAFT, not deleted) and owns the tx. Returns the JE id.
 */
export async function enginePostVoucher(
    tx: Prisma.TransactionClient,
    voucher: PostableVoucher,
    /** Stamped on the mirror-JE lines for branch-scoped GL reports. Office GL
     * vouchers pass null (org-level); POS callers pass the shift/active branch. */
    userId: number,
    branchId: string | null = null,
    /** Posting timestamp. Defaults to now; auto-settled receipts pass the voucher
     * date to preserve their prior `postedAt` semantics. */
    postedAt: Date = new Date(),
): Promise<number> {
    const { journalEntryId: jeId, universalVoucherId } = await engineGlArm(tx, {
        date:        voucher.date,
        description: `${voucher.type} ${voucher.reference}: ${voucher.narration ?? ""}`.trim(),
        lines:       voucher.lines,
        userId,
        branchId,
        postedAt,
        type:        voucher.type,
        friendlyRef: voucher.reference,
        narration:   voucher.narration,
    });
    await tx.voucher.update({
        where: { id: voucher.id },
        data:  { status: "POSTED", postedAt, journalEntryId: jeId, universalVoucherId },  // G4d direct spine link
    });
    return jeId;
}

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
}

/**
 * Create a financial transaction (the `Voucher` row + lines), optionally posting
 * it. `totalAmount` is the sum of debit lines. Returns the created voucher with
 * its lines (DRAFT snapshot; re-fetch if you need the posted state).
 */
export async function engineCreateVoucher(
    tx: Prisma.TransactionClient,
    spec: CreateGlVoucherSpec,
) {
    const totalAmount = spec.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0);

    const reference = await nextRefFromSeries(tx, spec.referenceSeries ?? spec.type, spec.userId);

    const voucher = await tx.voucher.create({
        data: {
            type:           spec.type,
            reference,
            date:           spec.date,
            narration:      spec.narration ?? null,
            partyAccountId: spec.partyAccountId ?? null,
            totalAmount,
            createdById:    spec.userId,
            lines: {
                create: spec.lines.map((l) => ({
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                })),
            },
        },
        include: { lines: true },
    });

    if (spec.post) {
        const loaded = await tx.voucher.findUnique({
            where:   { id: voucher.id },
            include: { lines: { include: { account: { select: { normalBalance: true, group: { select: { type: true } } } } } } },
        });
        if (loaded) {
            const jeId = await enginePostVoucher(tx, loaded as unknown as PostableVoucher, spec.userId, spec.branchId ?? null, spec.postedAt ?? new Date());
            // Reflect the posted state on the returned snapshot so callers that
            // need the mirror-JE id (postContra et al.) can read it without a re-fetch.
            voucher.journalEntryId = jeId;
            voucher.status = "POSTED";
        }
    }

    return voucher;
}
