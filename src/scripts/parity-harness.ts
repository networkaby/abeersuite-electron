// Regression + characterization harness.
//
// Part 1 — inventory→engine reroute (Phases 1-3): the engine path
// (saleToSpec → enginePost) that all inventory/POS posting now uses:
//   • stock arm — buildTradingStockMoves direction + free-qty + MRP (pure)
//   • e2e       — a real DRAFT sale → engine → correct JE + InvStockLedger,
//                 rolled back (DB left pristine)
//
// Part 2 — Phase 4 GOLDEN BASELINE (Stage B): captures the exact GL output of
// every FINANCIAL voucher kind (CONTRA / PAYMENT / RECEIPT / JOURNAL /
// CREDIT_NOTE / DEBIT_NOTE) on the CURRENT schema, via engineCreateVoucher
// (create+post, rolled back). These are the kinds whose GL path changes when
// the Voucher↔JournalEntry mirror collapses into the universal voucher — this
// snapshot is the diff target the Stage C–E cutover must reproduce byte-for-byte.
// Lines are captured by ACCOUNT NAME (reseed-stable, unlike ids).
//
// Run: pnpm tsx src/scripts/parity-harness.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, type Prisma, type VoucherType } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { PostVoucherInput } from "@/modules/accountancy/lib/postInvVoucher";
import { saleToSpec, buildTradingStockMoves } from "@/modules/accountancy/lib/voucherMappers";
import { enginePost, engineCreateVoucher, mirrorJeToSpine, syncSpineLifecycle, resyncSpineFromJe } from "@/modules/accountancy/lib/transactionEngine";
import { recomputeProductStock, recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputeAccountBalances } from "@/modules/accountancy/lib/aggregateLedger";

// Self-built client (the app singleton reads env at import-time; tsx doesn't load
// .env.local for us). Mirror prismaClient.ts's local-vs-remote SSL detection.
const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ROLLBACK = "ROLLBACK_OK";
type GlLine = { accountId: number; account: string; type: string; amount: number };

async function captureJe(tx: Prisma.TransactionClient, jeId: number): Promise<GlLine[]> {
    const lines = await tx.journalLine.findMany({
        where: { journalEntryId: jeId },
        select: { accountId: true, type: true, amount: true, account: { select: { name: true } } },
    });
    return lines
        .map((l) => ({ accountId: l.accountId, account: l.account.name, type: String(l.type), amount: Number(l.amount) }))
        .sort((a, b) => a.account.localeCompare(b.account) || a.type.localeCompare(b.type));
}

// Phase 4 Stage C: read the universal-voucher spine mirror for a given legacy JE.
type ArmLine = { accountId: number; type: string; amount: number };
async function captureSpine(tx: Prisma.TransactionClient, jeId: number): Promise<ArmLine[]> {
    const uv = await tx.universalVoucher.findUnique({
        where: { sourceJournalEntryId: jeId },
        select: { id: true },
    });
    if (!uv) return [];
    const lines = await tx.voucherGlLine.findMany({
        where: { universalVoucherId: uv.id },
        select: { accountId: true, type: true, amount: true },
    });
    return lines.map((l) => ({ accountId: l.accountId, type: String(l.type), amount: Number(l.amount) }));
}

/** Dual-write parity: spine GL-arm lines must equal the legacy JE lines (by
 *  accountId/type/amount, order-independent). */
function sameLines(je: GlLine[], spine: ArmLine[]): boolean {
    if (je.length !== spine.length || spine.length === 0) return false;
    const key = (l: ArmLine) => `${l.accountId}:${l.type}:${l.amount}`;
    const a = je.map(key).sort();
    const b = spine.map(key).sort();
    return a.every((v, i) => v === b[i]);
}

/** Pure check of the stock arm: direction + free-qty + MRP stamp. */
function stockCheck(): boolean {
    const date = new Date();
    const sale = buildTradingStockMoves({
        type: "SALE", voucherId: 1, branchId: "BR-HQ", date,
        lines: [{ productId: 7, quantity: 2, freeQty: 1, rate: 100, amount: 236, product: { stock: 50 } }],
    });
    const purchase = buildTradingStockMoves({
        type: "PURCHASE", voucherId: 1, branchId: "BR-HQ", date,
        lines: [{ productId: 7, quantity: 3, rate: 80, amount: 240, mrpPaise: 12000, product: { stock: 50 } }],
    });
    const saleOk  = sale.length === 1 && sale[0].outQty === 3 && sale[0].inQty === 0;             // 2 + 1 free
    const purchOk = purchase.length === 1 && purchase[0].inQty === 3 && purchase[0].outQty === 0
        && purchase[0].newMrpPaise === 12000;
    console.log("=== stock arm (buildTradingStockMoves) ===");
    console.log("SALE     →", JSON.stringify(sale[0]),     saleOk  ? "✓" : "✗");
    console.log("PURCHASE →", JSON.stringify(purchase[0]), purchOk ? "✓" : "✗");
    return saleOk && purchOk;
}

/** End-to-end: real DRAFT sale → saleToSpec → enginePost, capture JE + stock, roll back. */
async function runE2E(): Promise<boolean> {
    const [branch, product, cash, user] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true, stock: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
    ]);
    if (!branch || !product || !cash || !user) {
        console.log("\ne2e skipped — missing seed data", { branch, product, cash, user });
        return false;
    }

    const box: { cap: { jeLines: GlLine[]; spineOk: boolean; stock: { productId: number; inQty: number; outQty: number }[] } | null } = { cap: null };
    try {
        await prisma.$transaction(async (tx) => {
            const v = await tx.invVoucher.create({
                data: {
                    type: "SALE", reference: `PARITY-E2E-${Date.now()}`, branchId: branch.id,
                    date: new Date(), description: "e2e parity sale", status: "DRAFT",
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19", createdById: user.id,
                    lines:   { create: [{ productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] },
                    tenders: { create: [{ accountId: cash.id, amount: 118 }] },
                },
                include: { lines: { include: { product: { select: { id: true, stock: true, mrpPaise: true } } } }, tenders: true },
            });
            const spec = await saleToSpec(
                tx,
                { ...v, sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"],
                { voucherId: v.id, branchId: v.branchId, lines: v.lines },
            );
            const { journalEntryId } = await enginePost(tx, spec, user.id);
            const jeLines = journalEntryId ? await captureJe(tx, journalEntryId) : [];
            const spine   = journalEntryId ? await captureSpine(tx, journalEntryId) : [];
            const stock = await tx.invStockLedger.findMany({ where: { voucherId: v.id }, select: { productId: true, inQty: true, outQty: true } });
            box.cap = { jeLines, spineOk: sameLines(jeLines, spine), stock: stock.map((s) => ({ productId: s.productId, inQty: Number(s.inQty), outQty: Number(s.outQty) })) };
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }

    console.log("\n=== e2e (real DRAFT sale → saleToSpec → enginePost, rolled back) ===");
    console.log(JSON.stringify(box.cap));
    if (!box.cap) return false;
    const glOk    = box.cap.jeLines.length === 4;                                  // Dr Cash + Cr Sales + CGST + SGST
    const stockOk = box.cap.stock.length === 1 && box.cap.stock[0].outQty === 1 && box.cap.stock[0].inQty === 0;
    console.log("GL 4 lines:", glOk ? "✓" : "✗", "· stock OUT 1:", stockOk ? "✓" : "✗", "· spine parity:", box.cap.spineOk ? "✓" : "✗");
    return glOk && stockOk && box.cap.spineOk;
}

// ── Phase 4 golden baseline — financial voucher kinds ────────────────────────

type EngineLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string | null };
type Accounts = {
    userId: number;
    cash?: number; bank?: number; debtor?: number; creditor?: number; expense?: number; income?: number;
};

async function loadAccounts(): Promise<Accounts | null> {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) return null;
    const byName = (n: string) => prisma.account.findFirst({
        where: { name: { equals: n, mode: "insensitive" }, personId: null, companyId: null, isActive: true },
        select: { id: true },
    });
    const byGroupName = (g: string) => prisma.account.findFirst({
        where: { isActive: true, group: { name: { equals: g, mode: "insensitive" } } },
        select: { id: true },
    });
    const byGroupType = (t: "INCOME" | "EXPENSE") => prisma.account.findFirst({
        where: { isActive: true, group: { type: t } },
        select: { id: true },
    });
    const [cash, bank, debtor, creditor, expense, income] = await Promise.all([
        byName("Cash"),
        byGroupName("Bank Accounts"),
        byGroupName("Sundry Debtors"),
        byGroupName("Sundry Creditors"),
        byGroupType("EXPENSE"),
        byGroupType("INCOME"),
    ]);
    return {
        userId: user.id,
        cash: cash?.id, bank: bank?.id, debtor: debtor?.id,
        creditor: creditor?.id, expense: expense?.id, income: income?.id,
    };
}

/** Create+post a financial voucher through the engine, capture its JE, roll back. */
async function golden(
    acc: Accounts,
    label: string,
    type: VoucherType,
    lines: EngineLine[] | null,
    partyAccountId?: number | null,
): Promise<boolean> {
    if (!lines) { console.log(`\n=== golden: ${label} (${type}) === skipped — missing seed account`); return true; }
    let cap: GlLine[] = [];
    let spineOk = false;
    try {
        await prisma.$transaction(async (tx) => {
            const v = await engineCreateVoucher(tx, {
                type, date: new Date(), userId: acc.userId, lines,
                narration: `parity ${label}`, partyAccountId: partyAccountId ?? null,
                post: true, referenceSeries: type === "JOURNAL" ? "JOURNAL" : undefined,
            });
            cap = v.journalEntryId ? await captureJe(tx, v.journalEntryId) : [];
            const spine = v.journalEntryId ? await captureSpine(tx, v.journalEntryId) : [];
            spineOk = sameLines(cap, spine);
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    const dr = cap.filter((l) => l.type === "DEBIT").reduce((s, l) => s + l.amount, 0);
    const cr = cap.filter((l) => l.type === "CREDIT").reduce((s, l) => s + l.amount, 0);
    const ok = cap.length >= 2 && Math.abs(dr - cr) < 0.01 && spineOk;
    console.log(`\n=== golden: ${label} (${type}) ===`);
    console.log(JSON.stringify(cap));
    console.log(`balanced ${dr.toFixed(2)} = ${cr.toFixed(2)}:`, (cap.length >= 2 && Math.abs(dr - cr) < 0.01) ? "✓" : "✗", "· spine parity:", spineOk ? "✓" : "✗");
    return ok;
}

/** Golden GL baseline for every financial voucher kind (Phase-4 diff target). */
async function runGolden(): Promise<boolean> {
    const acc = await loadAccounts();
    if (!acc) { console.log("\ngolden skipped — no user"); return false; }
    console.log("\n--- Phase 4 golden baseline (financial kinds) ---");
    console.log("resolved accounts:", JSON.stringify(acc));
    const A = 1000;
    const L = (id: number | undefined, type: "DEBIT" | "CREDIT", amount = A): EngineLine | null =>
        id == null ? null : { accountId: id, type, amount };
    const pair = (a: EngineLine | null, b: EngineLine | null): EngineLine[] | null =>
        a && b ? [a, b] : null;

    const results = await Promise.all([
        // CONTRA — Cash → Bank deposit (Dr Bank / Cr Cash)
        golden(acc, "Contra (Cash→Bank)", "CONTRA", pair(L(acc.bank, "DEBIT"), L(acc.cash, "CREDIT"))),
        // PAYMENT — pay an expense in cash (Dr Expense / Cr Cash)
        golden(acc, "Payment (expense)", "PAYMENT", pair(L(acc.expense, "DEBIT"), L(acc.cash, "CREDIT"))),
        // RECEIPT — collect from a debtor (Dr Cash / Cr Debtor) — null-normalBalance party leg
        golden(acc, "Receipt (from debtor)", "RECEIPT", pair(L(acc.cash, "DEBIT"), L(acc.debtor, "CREDIT")), acc.debtor),
        // JOURNAL — generic adjustment (Dr Expense / Cr Cash)
        golden(acc, "Journal", "JOURNAL", pair(L(acc.expense, "DEBIT"), L(acc.cash, "CREDIT"))),
        // CREDIT_NOTE — reduce a debtor (Dr Income / Cr Debtor)
        golden(acc, "Credit Note", "CREDIT_NOTE", pair(L(acc.income, "DEBIT"), L(acc.debtor, "CREDIT")), acc.debtor),
        // DEBIT_NOTE — reduce a creditor (Dr Creditor / Cr Expense)
        golden(acc, "Debit Note", "DEBIT_NOTE", pair(L(acc.creditor, "DEBIT"), L(acc.expense, "CREDIT")), acc.creditor),
    ]);
    return results.every(Boolean);
}

/** Stage D.5: a bypass writer's raw JE → mirrorJeToSpine must produce a parity
 *  spine, and a second call must be idempotent (no duplicate). Rolled back. */
async function runMirror(): Promise<boolean> {
    const acc = await loadAccounts();
    if (!acc || acc.cash == null || acc.expense == null) { console.log("\nmirror skipped — no accounts"); return true; }
    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            const jeRef = `PARITY-MIRROR-${Date.now()}`;
            const je = await tx.journalEntry.create({
                data: {
                    date: new Date(), reference: jeRef, description: "parity mirror reversal",
                    status: "POSTED", postedAt: new Date(), createdById: acc.userId,
                    lines: { create: [
                        { accountId: acc.expense!, type: "DEBIT",  amount: 500 },
                        { accountId: acc.cash!,    type: "CREDIT", amount: 500 },
                    ] },
                },
                select: { id: true },
            });
            await mirrorJeToSpine(tx, je.id, { type: "JOURNAL", friendlyRef: jeRef });
            const jeLines = await captureJe(tx, je.id);
            const spine   = await captureSpine(tx, je.id);
            await mirrorJeToSpine(tx, je.id, { type: "JOURNAL" });   // idempotency
            const spine2  = await captureSpine(tx, je.id);
            ok = sameLines(jeLines, spine) && spine.length === spine2.length && spine.length === 2;
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== mirror (raw JE → mirrorJeToSpine, idempotent, rolled back) ===");
    console.log("spine parity + idempotent:", ok ? "✓" : "✗");
    return ok;
}

/** Stage F: a JE's delete/restore must propagate to its spine mirror so reports
 *  (which read the spine) hide/show it in step with legacy. Rolled back. */
async function runLifecycle(): Promise<boolean> {
    const acc = await loadAccounts();
    if (!acc || acc.cash == null || acc.expense == null) { console.log("\nlifecycle skipped — no accounts"); return true; }
    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            const je = await tx.journalEntry.create({
                data: {
                    date: new Date(), reference: `PARITY-LIFE-${Date.now()}`, description: "parity lifecycle",
                    status: "POSTED", postedAt: new Date(), createdById: acc.userId,
                    lines: { create: [
                        { accountId: acc.expense!, type: "DEBIT",  amount: 700 },
                        { accountId: acc.cash!,    type: "CREDIT", amount: 700 },
                    ] },
                },
                select: { id: true },
            });
            await mirrorJeToSpine(tx, je.id, { type: "JOURNAL" });
            await tx.journalEntry.update({ where: { id: je.id }, data: { deletedAt: new Date(), deleteReason: "t" } });
            await syncSpineLifecycle(tx, je.id);
            const afterDelete = await tx.universalVoucher.findUnique({ where: { sourceJournalEntryId: je.id }, select: { deletedAt: true } });
            await tx.journalEntry.update({ where: { id: je.id }, data: { deletedAt: null, deleteReason: null } });
            await syncSpineLifecycle(tx, je.id);
            const afterRestore = await tx.universalVoucher.findUnique({ where: { sourceJournalEntryId: je.id }, select: { deletedAt: true } });
            ok = afterDelete?.deletedAt != null && afterRestore?.deletedAt == null;
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== lifecycle (delete → spine.deletedAt set; restore → cleared, rolled back) ===");
    console.log("lifecycle propagation:", ok ? "✓" : "✗");
    return ok;
}

/** ②-foundation: recomputeProductStock (rebuild cache from openingStock + ledger)
 *  must agree with the incremental stock arm. Post a sale, recompute, assert the
 *  cache is unchanged (zero drift). Rolled back. */
async function runStockRecompute(): Promise<boolean> {
    const [branch, product, cash, user] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true, stock: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
    ]);
    if (!branch || !product || !cash || !user) { console.log("\nstock-recompute skipped — missing seed data"); return true; }

    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            const v = await tx.invVoucher.create({
                data: {
                    type: "SALE", reference: `PARITY-RECOMP-${Date.now()}`, branchId: branch.id,
                    date: new Date(), description: "recompute check sale", status: "DRAFT",
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19", createdById: user.id,
                    lines:   { create: [{ productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] },
                    tenders: { create: [{ accountId: cash.id, amount: 118 }] },
                },
                include: { lines: { include: { product: { select: { id: true, stock: true, mrpPaise: true } } } }, tenders: true },
            });
            const spec = await saleToSpec(
                tx,
                { ...v, sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"],
                { voucherId: v.id, branchId: v.branchId, lines: v.lines },
            );
            await enginePost(tx, spec, user.id);   // incremental: stock arm + Account.balance deltas
            const stockAfterPost = await tx.invProduct.findUnique({ where: { id: product.id }, select: { stock: true } });
            const cashAfterPost  = await tx.account.findUnique({ where: { id: cash.id }, select: { balance: true } });
            await recomputeProductStock(tx, [product.id]);       // rebuild stock from openingStock + ledger
            await recomputeAccountBalances(tx, [cash.id]);       // rebuild Account.balance from posted lines
            const stockAfterRecompute = await tx.invProduct.findUnique({ where: { id: product.id }, select: { stock: true } });
            const cashAfterRecompute  = await tx.account.findUnique({ where: { id: cash.id }, select: { balance: true } });
            // Stock cache was clean (validated), so recompute must match incremental.
            const stockOk = Number(stockAfterPost?.stock) === Number(stockAfterRecompute?.stock);
            // Account.balance can carry pre-existing drift, so verify the helper
            // against an INDEPENDENT line-sum (Cash is DEBIT-normal) instead.
            const cashLines = await tx.voucherGlLine.groupBy({
                by: ["type"], where: { accountId: cash.id, universalVoucher: { status: "POSTED", deletedAt: null } }, _sum: { amount: true },
            });
            let expectedCash = 0;
            for (const l of cashLines) expectedCash += (String(l.type) === "DEBIT" ? 1 : -1) * Number(l._sum.amount ?? 0);
            const acctOk = Math.abs(Number(cashAfterRecompute?.balance) - expectedCash) < 0.01;
            const drift  = Number(cashAfterPost?.balance) - Number(cashAfterRecompute?.balance);
            console.log(`\n=== recompute (post sale → recompute helpers, rolled back) ===`);
            console.log(`stock recompute == incremental: ${stockOk ? "✓" : "✗"}`);
            console.log(`account recompute == independent line-sum: ${acctOk ? "✓" : "✗"}  (pre-existing Account.balance drift on Cash = ${drift.toFixed(2)})`);
            ok = stockOk && acctOk;
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    return ok;
}

/** ②-gate: post a SALE qty 1, then EDIT it to qty 2 IN PLACE (same JE id) using
 *  the decided ② operations — rewrite JE lines on the same JE, rewrite stock,
 *  recompute caches, resync spine. Asserts: JE id preserved (allocation-safe),
 *  JE rebalanced to the new total, stock reflects the new qty, spine == JE.
 *  Rolled back. This proves the ② edit operations before wiring them into the route. */
async function runEditCycle(): Promise<boolean> {
    const [branch, product, cash, user] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
    ]);
    if (!branch || !product || !cash || !user) { console.log("\nedit-cycle skipped — missing seed data"); return true; }

    let ok = false;
    const log: string[] = [];
    const reload = (tx: Prisma.TransactionClient, id: number) => tx.invVoucher.findUnique({
        where: { id },
        include: { lines: { include: { product: { select: { id: true, stock: true, mrpPaise: true } } } }, tenders: true },
    });
    try {
        await prisma.$transaction(async (tx) => {
            // 1. Post a SALE qty 1.
            const v = await tx.invVoucher.create({
                data: {
                    type: "SALE", reference: `PARITY-EDIT-${Date.now()}`, branchId: branch.id,
                    date: new Date(), description: "edit-cycle sale", status: "POSTED",
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19", createdById: user.id,
                    lines:   { create: [{ productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] },
                    tenders: { create: [{ accountId: cash.id, amount: 118 }] },
                },
                include: { lines: { include: { product: { select: { id: true, stock: true, mrpPaise: true } } } }, tenders: true },
            });
            const spec1 = await saleToSpec(tx, { ...v, sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { voucherId: v.id, branchId: v.branchId, lines: v.lines });
            const { journalEntryId: saleJe } = await enginePost(tx, spec1, user.id);
            if (saleJe == null) throw new Error("no saleJe");
            await tx.invVoucher.update({ where: { id: v.id }, data: { journalEntryId: saleJe } });

            // 2. EDIT in place: qty 1 → 2 (line 236 = taxable 200 + 18% tax 36).
            await tx.invVoucherLine.updateMany({ where: { voucherId: v.id }, data: { quantity: 2, amount: 236, taxAmount: 36 } });
            await tx.invVoucherTender.updateMany({ where: { voucherId: v.id }, data: { amount: 236 } });
            await tx.invVoucher.update({ where: { id: v.id }, data: { subtotal: 236, taxAmount: 36, totalAmount: 236 } });
            const edited = await reload(tx, v.id);
            const spec2 = await saleToSpec(tx, { ...edited!, sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { voucherId: v.id, branchId: v.branchId, lines: edited!.lines });

            const oldAccts = (await tx.journalLine.findMany({ where: { journalEntryId: saleJe }, select: { accountId: true } })).map((l) => l.accountId);
            const affected = [...new Set([...oldAccts, ...spec2.glLines.map((l) => l.accountId)])];

            // GL: rewrite the lines on the SAME JE id (in place → allocations safe).
            await tx.journalLine.deleteMany({ where: { journalEntryId: saleJe } });
            await tx.journalLine.createMany({ data: spec2.glLines.map((l) => ({ journalEntryId: saleJe, accountId: l.accountId, type: l.type, amount: l.amount, description: l.description ?? null })) });
            await resyncSpineFromJe(tx, saleJe, { type: "SALE", friendlyRef: v.reference });   // spine = new JE lines
            await recomputeAccountBalances(tx, affected);                                       // cache from new spine

            // Stock: delete old rows + re-post new + recompute.
            await tx.invStockLedger.deleteMany({ where: { voucherId: v.id } });
            for (const m of spec2.stockMoves) await recordStockMovement(tx, m);
            await recomputeProductStock(tx, [product.id]);

            // 3. Assertions.
            const vAfter = await tx.invVoucher.findUnique({ where: { id: v.id }, select: { journalEntryId: true } });
            const jeCap  = await captureJe(tx, saleJe);
            const spine  = await captureSpine(tx, saleJe);
            const dr = jeCap.filter((l) => l.type === "DEBIT").reduce((s, l) => s + l.amount, 0);
            const cr = jeCap.filter((l) => l.type === "CREDIT").reduce((s, l) => s + l.amount, 0);
            const outQty = (await tx.invStockLedger.findMany({ where: { voucherId: v.id }, select: { outQty: true } })).reduce((s, r) => s + Number(r.outQty), 0);

            const jeSameId = vAfter?.journalEntryId === saleJe;
            const balanced = Math.abs(dr - cr) < 0.01 && Math.abs(dr - 236) < 0.01;
            const stockOk2 = Math.abs(outQty - 2) < 0.001;
            const spineOk  = sameLines(jeCap, spine);
            ok = jeSameId && balanced && stockOk2 && spineOk;
            log.push(`JE id preserved (allocation-safe): ${jeSameId ? "✓" : "✗"}`);
            log.push(`JE rebalanced to 236: ${balanced ? "✓" : "✗"} (Dr ${dr} / Cr ${cr})`);
            log.push(`stock OUT 2: ${stockOk2 ? "✓" : "✗"} (${outQty})`);
            log.push(`spine == JE: ${spineOk ? "✓" : "✗"}`);
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== edit-cycle (post sale qty1 → edit qty2 IN PLACE → recompute, rolled back) ===");
    for (const l of log) console.log("  " + l);
    console.log("edit cycle:", ok ? "✓" : "✗");
    return ok;
}

async function main() {
    const stockOk    = stockCheck();
    const e2eOk      = await runE2E();
    const recompOk   = await runStockRecompute();
    const editOk     = await runEditCycle();
    const goldenOk   = await runGolden();
    const mirrorOk   = await runMirror();
    const lifecycleOk = await runLifecycle();
    const green      = stockOk && e2eOk && recompOk && editOk && goldenOk && mirrorOk && lifecycleOk;
    console.log(green ? "\nHARNESS GREEN ✓" : "\nHARNESS FAILED ✗");
    if (!green) process.exitCode = 1;
}

main()
    .then(() => prisma.$disconnect().then(() => process.exit(process.exitCode ?? 0)))
    .catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
