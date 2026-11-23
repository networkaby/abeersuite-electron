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
import { enginePost, engineCreateVoucher, engineCreateSpine, engineGlArm } from "@/modules/accountancy/lib/transactionEngine";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { reapplyTradingVoucherInPlace } from "@/modules/accountancy/lib/reapplyTradingVoucher";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { loadTenderLines } from "@/modules/accountancy/lib/outstandings";
import { sumLinked, assertLinkable, createLink } from "@/modules/accountancy/lib/billLink";
import { tillBalancePaise, sumShiftTendersByAccount } from "@/modules/pos/lib/shiftMath";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { syncVoucherLink, syncVoucherLinks } from "@/modules/accountancy/lib/voucherLinks";
import { HEAD_OFFICE_BRANCH_ID } from "@/shared/lib/org/systemBranch";
import { scriptDbUrl } from "@/shared/lib/db/dbTargets";

// Self-built client (the app singleton reads env at import-time; tsx doesn't load
// .env.local for us). Mirror prismaClient.ts's local-vs-remote SSL detection.
const rawUrl = scriptDbUrl()
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ROLLBACK = "ROLLBACK_OK";
type GlLine = { accountId: number; account: string; type: string; amount: number };

// Since G5 the spine IS the GL — `id` is the UniversalVoucher id that enginePost
// returns as `journalEntryId` (self-ref). Read the GL lines straight off the spine
// and enrich account names in one lookup (spine lines are scalar/id-only).
async function captureJe(tx: Prisma.TransactionClient, id: number): Promise<GlLine[]> {
    const lines = await tx.voucherGlLine.findMany({
        where:  { universalVoucherId: id },
        select: { accountId: true, type: true, amount: true },
    });
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accts = await tx.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameById = new Map(accts.map((a) => [a.id, a.name]));
    return lines
        .map((l) => ({ accountId: l.accountId, account: nameById.get(l.accountId) ?? "—", type: String(l.type), amount: Number(l.amount) }))
        .sort((a, b) => a.account.localeCompare(b.account) || a.type.localeCompare(b.type));
}

// Read the spine GL lines for a given spine id (== journalEntryId via self-ref).
type ArmLine = { accountId: number; type: string; amount: number };
async function captureSpine(tx: Prisma.TransactionClient, id: number): Promise<ArmLine[]> {
    const lines = await tx.voucherGlLine.findMany({
        where:  { universalVoucherId: id },
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

/** Every voucher carries a branch, so the harness posts everything at Head
 *  Office — the same id the stock checks below already used inline. */
const PARITY_BRANCH = HEAD_OFFICE_BRANCH_ID;

/** Pure check of the stock arm: direction + free-qty + MRP stamp. */
function stockCheck(): boolean {
    const date = new Date();
    const sale = buildTradingStockMoves({
        type: "SALE", branchId: PARITY_BRANCH, date,
        lines: [{ productId: 7, quantity: 2, freeQty: 1, rate: 100, amount: 236, product: { stock: 50 } }],
    });
    const purchase = buildTradingStockMoves({
        type: "PURCHASE", branchId: PARITY_BRANCH, date,
        lines: [{ productId: 7, quantity: 3, rate: 80, amount: 240, mrpPaise: 12000, product: { stock: 50 } }],
    });
    // ONLINE_INVOICE shares the SALE direction (stock OUT) — explicit coverage so
    // the new online-channel type can't silently drift off the sale path.
    const online = buildTradingStockMoves({
        type: "ONLINE_INVOICE", branchId: PARITY_BRANCH, date,
        lines: [{ productId: 7, quantity: 2, freeQty: 1, rate: 100, amount: 236, product: { stock: 50 } }],
    });
    const saleOk  = sale.length === 1 && sale[0].outQty === 3 && sale[0].inQty === 0;             // 2 + 1 free
    const purchOk = purchase.length === 1 && purchase[0].inQty === 3 && purchase[0].outQty === 0
        && purchase[0].newMrpPaise === 12000;
    const onlineOk = online.length === 1 && online[0].outQty === 3 && online[0].inQty === 0;      // same as SALE
    console.log("=== stock arm (buildTradingStockMoves) ===");
    console.log("SALE           →", JSON.stringify(sale[0]),     saleOk   ? "✓" : "✗");
    console.log("PURCHASE       →", JSON.stringify(purchase[0]), purchOk  ? "✓" : "✗");
    console.log("ONLINE_INVOICE →", JSON.stringify(online[0]),   onlineOk ? "✓" : "✗");
    return saleOk && purchOk && onlineOk;
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

    const box: { cap: { jeLines: GlLine[]; spineOk: boolean; stock: { productId: number; inQty: number; outQty: number }[]; rolesOk: boolean } | null } = { cap: null };
    try {
        await prisma.$transaction(async (tx) => {
            const spineId = await engineCreateSpine(tx, { type: "SALE", date: new Date(), description: "e2e parity sale", voucherNo: `PARITY-E2E-${Date.now()}`, branchId: PARITY_BRANCH, userId: user.id });
            const v = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch on the spine
                    universalVoucherId: spineId,
                    // 5D-8/5D-10: status + date live on the spine
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19",
                    settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118, method: "CASH", reference: "E2E-TENDER-REF" }], []),
                },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const spec = await saleToSpec(
                tx,
                { ...v, type: "SALE", date: new Date(), tenders: [{ accountId: cash.id, amount: 118, method: "CASH", reference: "E2E-TENDER-REF" }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"],
                { branchId: branch.id, lines: vLines },
            );
            const { journalEntryId } = await enginePost(tx, spec, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });
            const jeLines = journalEntryId ? await captureJe(tx, journalEntryId) : [];
            const spine   = journalEntryId ? await captureSpine(tx, journalEntryId) : [];
            const stock = await tx.invStockLedger.findMany({ where: { universalVoucherId: spineId }, select: { productId: true, inQty: true, outQty: true } });
            // G4: every spine GL line of a trading sale must carry a role tag
            // (TENDER + BODY + TAX here) and a contiguous seq 0..n-1.
            const uv = journalEntryId ? await tx.universalVoucher.findUnique({ where: { id: journalEntryId }, select: { id: true } }) : null;   // 5D-16: spine id directly
            const roleLines = uv ? await tx.voucherGlLine.findMany({ where: { universalVoucherId: uv.id }, select: { role: true, seq: true, method: true, reference: true }, orderBy: { seq: "asc" } }) : [];
            const roles = new Set(roleLines.map((l) => l.role));
            // G4b: the TENDER line carries its channel + ref; non-tender legs don't.
            const tenderLine = roleLines.find((l) => l.role === "TENDER");
            const tenderMetaOk = tenderLine?.method === "CASH" && tenderLine?.reference === "E2E-TENDER-REF"
                && roleLines.filter((l) => l.role !== "TENDER").every((l) => l.method == null && l.reference == null);
            // G4b-2: the receivables reader helper returns the cash tender for this spine.
            const tenderMap = uv ? await loadTenderLines(tx, [uv.id]) : new Map();
            const readerTenders = uv ? (tenderMap.get(uv.id) ?? []) : [];
            const readerOk = readerTenders.length === 1 && readerTenders[0].accountId === cash.id && Math.abs(readerTenders[0].amount - 118) < 0.005;
            const rolesOk = roleLines.length === 4
                && roleLines.every((l) => l.role != null)
                && roles.has("TENDER") && roles.has("BODY") && roles.has("TAX")
                && roleLines.every((l, i) => l.seq === i)
                && tenderMetaOk && readerOk;
            box.cap = { jeLines, spineOk: sameLines(jeLines, spine), stock: stock.map((s) => ({ productId: s.productId, inQty: Number(s.inQty), outQty: Number(s.outQty) })), rolesOk };
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
    console.log("GL 4 lines:", glOk ? "✓" : "✗", "· stock OUT 1:", stockOk ? "✓" : "✗", "· spine parity:", box.cap.spineOk ? "✓" : "✗", "· G4 role/seq + tender meta + reader:", box.cap.rolesOk ? "✓" : "✗");
    return glOk && stockOk && box.cap.spineOk && box.cap.rolesOk;
}

/** End-to-end PURCHASE: real DRAFT purchase → saleToSpec → enginePost, capture GL +
 *  stock IN, roll back. Asserts the NEW CONCEPT explicitly — type/status/branch all
 *  resolve from the spine (UniversalVoucher), not the VoucherDetail sidecar. */
async function runPurchaseE2E(): Promise<boolean> {
    const [branch, product, cash, user] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true, stock: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
    ]);
    if (!branch || !product || !cash || !user) { console.log("\npurchase-e2e skipped — missing seed data"); return false; }

    const box: { cap: { glLen: number; dr: number; cr: number; stockIn: number; spineOk: boolean; spineType: string | null; spineStatus: string | null; spineBranch: string | null } | null } = { cap: null };
    try {
        await prisma.$transaction(async (tx) => {
            const spineId = await engineCreateSpine(tx, { type: "PURCHASE", date: new Date(), description: "e2e parity purchase", voucherNo: `PARITY-PUR-${Date.now()}`, branchId: branch.id, userId: user.id });
            const v = await tx.voucherDetail.create({
                data: { universalVoucherId: spineId, subtotal: 118, taxAmount: 18, totalAmount: 118, deliveryMode: "COUNTER", placeOfSupply: "19", settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118, method: "CASH" }], []) },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const spec = await saleToSpec(tx, { ...v, type: "PURCHASE", date: new Date(), tenders: [{ accountId: cash.id, amount: 118, method: "CASH" }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { branchId: branch.id, lines: vLines });
            const { journalEntryId } = await enginePost(tx, spec, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });
            const jeLines = journalEntryId ? await captureJe(tx, journalEntryId) : [];
            const spine   = journalEntryId ? await captureSpine(tx, journalEntryId) : [];
            const stock   = await tx.invStockLedger.findMany({ where: { universalVoucherId: spineId }, select: { inQty: true, outQty: true } });
            const sp      = await tx.universalVoucher.findUnique({ where: { id: spineId }, select: { type: true, status: true, branchId: true } });
            box.cap = {
                glLen: jeLines.length,
                dr: jeLines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + l.amount, 0),
                cr: jeLines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + l.amount, 0),
                stockIn: stock.reduce((s, e) => s + Number(e.inQty) - Number(e.outQty), 0),
                spineOk: sameLines(jeLines, spine),
                spineType: sp?.type ?? null, spineStatus: sp?.status ?? null, spineBranch: sp?.branchId ?? null,
            };
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) { if ((e as Error)?.message !== ROLLBACK) throw e; }

    console.log("\n=== e2e PURCHASE (real DRAFT purchase → enginePost, rolled back) ===");
    console.log(JSON.stringify(box.cap));
    if (!box.cap) return false;
    const balanced  = Math.abs(box.cap.dr - box.cap.cr) < 0.005 && box.cap.dr > 0;
    const stockOk   = Math.abs(box.cap.stockIn - 1) < 0.005;
    const conceptOk = box.cap.spineType === "PURCHASE" && box.cap.spineStatus === "POSTED" && box.cap.spineBranch === branch.id;
    console.log("GL balanced:", balanced ? "✓" : "✗", "· stock IN 1:", stockOk ? "✓" : "✗", "· spine parity:", box.cap.spineOk ? "✓" : "✗", "· new-concept type/status/branch on spine:", conceptOk ? "✓" : "✗");
    return balanced && stockOk && box.cap.spineOk && conceptOk;
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
                type, date: new Date(), userId: acc.userId, lines, branchId: PARITY_BRANCH,
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

/** Phase 5 5.0: draft-on-spine. engineCreateSpine writes a DRAFT spine HEADER
 *  (no GL lines, invisible to the status gate); engineGlArm({existingSpineId})
 *  attaches the lines + flips it to POSTED (now gate-visible). Rolled back. */
async function runDraftPost(): Promise<boolean> {
    const acc = await loadAccounts();
    if (!acc || acc.cash == null || acc.expense == null) { console.log("\ndraft-post skipped — no accounts"); return true; }
    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            // 1. DRAFT spine header — no lines, no balance impact.
            const spineId = await engineCreateSpine(tx, {
                type: "JOURNAL", date: new Date(), description: "parity draft-post", userId: acc.userId, branchId: PARITY_BRANCH,
            });
            const draft = await tx.universalVoucher.findUnique({
                where: { id: spineId }, select: { status: true, _count: { select: { lines: true } } },
            });
            // Gate: a DRAFT spine is excluded by ledgerStatusFilterUv (reports won't see it).
            const hiddenWhileDraft = await tx.universalVoucher.findFirst({
                where: { id: spineId, ...ledgerStatusFilterUv() }, select: { id: true },
            });
            // 2. POST: attach GL lines + flip DRAFT→POSTED on the SAME spine id.
            const gl = await engineGlArm(tx, {
                date: new Date(), description: "parity draft-post", userId: acc.userId, branchId: PARITY_BRANCH, postedAt: new Date(),
                type: "JOURNAL", existingSpineId: spineId,
                lines: [
                    { accountId: acc.expense!, type: "DEBIT",  amount: 300 },
                    { accountId: acc.cash!,    type: "CREDIT", amount: 300 },
                ],
            });
            const posted = await tx.universalVoucher.findUnique({ where: { id: spineId }, select: { status: true } });
            const visibleAfterPost = await tx.universalVoucher.findFirst({
                where: { id: spineId, ...ledgerStatusFilterUv() }, select: { id: true },
            });
            const linesNow = await captureJe(tx, spineId);
            ok = draft?.status === "DRAFT" && draft._count.lines === 0
                && hiddenWhileDraft == null                 // gated out while DRAFT
                && gl.universalVoucherId === spineId         // attached to the same spine
                && posted?.status === "POSTED"
                && visibleAfterPost != null                  // gate-visible after POST
                && linesNow.length === 2;
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== 5.0 draft→post (DRAFT spine hidden by gate → POST attaches lines + flips visible, rolled back) ===");
    console.log("draft hidden then posted-visible with 2 lines:", ok ? "✓" : "✗");
    return ok;
}

/** Phase 5 5.0: the INVENTORY route pattern — a DRAFT InvVoucher gets a draft
 *  spine at create (engineCreateSpine + universalVoucherId); POST runs the mapper
 *  + enginePost({existingSpineId}) which ATTACHES to that same spine (no orphan
 *  second spine) + flips it. Asserts the attach (out.uv === spineId), POSTED, 4
 *  GL lines, stock OUT 1. Rolled back. */
async function runDraftSale(): Promise<boolean> {
    const [branch, product, cash, user] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true, stock: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
    ]);
    if (!branch || !product || !cash || !user) { console.log("\ndraft-sale skipped — missing seed data"); return true; }
    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            // 1. DRAFT InvVoucher + draft spine at create (the route's create path).
            const spineId = await engineCreateSpine(tx, { type: "SALE", date: new Date(), description: "parity draft-sale", voucherNo: `PARITY-DRAFTSALE-${Date.now()}`, branchId: PARITY_BRANCH, userId: user.id });
            const v = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch on the spine
                    universalVoucherId: spineId,
                    // 5D-8/5D-10: status + date live on the spine
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19",
                    settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118, method: "CASH" }], []),
                },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const draftStatus = (await tx.universalVoucher.findUnique({ where: { id: spineId }, select: { status: true } }))?.status;
            // 2. POST (the route's post path): mapper + enginePost ATTACH to the draft spine.
            const spec = await saleToSpec(tx, { ...v, type: "SALE", date: new Date(), tenders: [{ accountId: cash.id, amount: 118, method: "CASH" }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { branchId: branch.id, lines: vLines });
            const out = await enginePost(tx, spec, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });
            const linesNow = await captureJe(tx, spineId);
            const postedStatus = (await tx.universalVoucher.findUnique({ where: { id: spineId }, select: { status: true } }))?.status;
            const stock = await tx.invStockLedger.findMany({ where: { universalVoucherId: spineId }, select: { outQty: true, universalVoucherId: true } });
            // 5C: goods line + stock row now carry the spine id.
            const goods = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, select: { universalVoucherId: true } });
            ok = draftStatus === "DRAFT"
                && out.universalVoucherId === spineId    // ATTACHED, not a new spine
                && postedStatus === "POSTED"
                && linesNow.length === 4
                && stock.length === 1 && Number(stock[0].outQty) === 1
                && stock[0].universalVoucherId === spineId         // 5C stock linked
                && goods.length === 1 && goods[0].universalVoucherId === spineId;   // 5C goods linked
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== 5.0 draft-sale (InvVoucher DRAFT + draft spine → POST attaches to SAME spine, rolled back) ===");
    console.log("draft→posted on same spine, 4 GL lines + stock OUT 1:", ok ? "✓" : "✗");
    return ok;
}

/** Phase 5 5A: VoucherLink dual-write — workflow links upsert onto the spine,
 *  move in place, and clear (loose targetId, no FK). Rolled back. */
async function runVoucherLink(): Promise<boolean> {
    const acc = await loadAccounts();
    if (!acc) { console.log("\nvoucher-link skipped — no accounts"); return true; }
    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            const spineId = await engineCreateSpine(tx, { type: "POS_ORDER", date: new Date(), description: "parity voucher-link", branchId: PARITY_BRANCH, userId: acc.userId });
            await syncVoucherLinks(tx, spineId, { dealId: 4242, orderStatusId: "P7-S1" });
            const after = await tx.voucherLink.findMany({ where: { universalVoucherId: spineId }, select: { kind: true, targetId: true } });
            await syncVoucherLink(tx, spineId, "ORDER_STATUS", "P7-S2");   // move in place
            await syncVoucherLink(tx, spineId, "DEAL", null);             // clear
            const after2 = await tx.voucherLink.findMany({ where: { universalVoucherId: spineId }, select: { kind: true, targetId: true } });
            ok = after.length === 2
                && after.some((l) => l.kind === "DEAL" && l.targetId === "4242")
                && after.some((l) => l.kind === "ORDER_STATUS" && l.targetId === "P7-S1")
                && after2.length === 1
                && after2.some((l) => l.kind === "ORDER_STATUS" && l.targetId === "P7-S2")
                && !after2.some((l) => l.kind === "DEAL");
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== 5A voucher-link (dual-write upsert/move/clear on the spine, rolled back) ===");
    console.log("links written (2), moved in place, cleared:", ok ? "✓" : "✗");
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
            const spineId = await engineCreateSpine(tx, { type: "SALE", date: new Date(), description: "recompute check sale", voucherNo: `PARITY-RECOMP-${Date.now()}`, branchId: PARITY_BRANCH, userId: user.id });
            const v = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch on the spine
                    universalVoucherId: spineId,
                    // 5D-8/5D-10: status + date live on the spine
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19",
                    settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118 }], []),
                },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const spec = await saleToSpec(
                tx,
                { ...v, type: "SALE", date: new Date(), tenders: [{ accountId: cash.id, amount: 118 }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"],
                { branchId: branch.id, lines: vLines },
            );
            await enginePost(tx, spec, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });   // incremental: stock arm
            const stockAfterPost = await tx.invProduct.findUnique({ where: { id: product.id }, select: { stock: true } });
            await recomputeProductStock(tx, [product.id]);       // rebuild stock from openingStock + ledger
            const stockAfterRecompute = await tx.invProduct.findUnique({ where: { id: product.id }, select: { stock: true } });
            // Stock cache was clean (validated), so recompute must match incremental.
            const stockOk = Number(stockAfterPost?.stock) === Number(stockAfterRecompute?.stock);
            console.log(`\n=== recompute (post sale → recompute helpers, rolled back) ===`);
            console.log(`stock recompute == incremental: ${stockOk ? "✓" : "✗"}`);
            ok = stockOk;
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
    const reload = async (tx: Prisma.TransactionClient, id: number) => {
        const row = await tx.voucherDetail.findUnique({ where: { id } });
        if (!row) return null;
        // Phase 5 5C: goods lines hang off the spine.
        const lines = await tx.voucherInventoryLine.findMany({
            where:   { universalVoucherId: row.universalVoucherId ?? -1 },
            include: { product: { select: { id: true, stock: true, mrpPaise: true } } },
        });
        return { ...row, lines };
    };
    try {
        await prisma.$transaction(async (tx) => {
            // 1. Post a SALE qty 1.
            const spineId = await engineCreateSpine(tx, { type: "SALE", date: new Date(), description: "edit-cycle sale", voucherNo: `PARITY-EDIT-${Date.now()}`, branchId: PARITY_BRANCH, userId: user.id });
            const v = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch on the spine
                    universalVoucherId: spineId,
                    // 5D-8/5D-10: status + date live on the spine (set by enginePost)
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19",
                    settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118 }], []),
                },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const spec1 = await saleToSpec(tx, { ...v, type: "SALE", date: new Date(), tenders: [{ accountId: cash.id, amount: 118 }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { branchId: branch.id, lines: vLines });
            const { journalEntryId: saleJe } = await enginePost(tx, spec1, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });
            if (saleJe == null) throw new Error("no saleJe");
            // 5D-1: InvVoucher.journalEntryId dropped — the spine link is universalVoucherId
            // (already = spineId, set at create; saleJe == spineId via existingSpineId).

            // 2. EDIT in place: qty 1 → 2 (line 236 = taxable 200 + 18% tax 36).
            await tx.voucherInventoryLine.updateMany({ where: { universalVoucherId: spineId }, data: { quantity: 2, amount: 236, taxAmount: 36 } });
            await tx.voucherDetail.update({ where: { id: v.id }, data: { subtotal: 236, taxAmount: 36, totalAmount: 236, settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 236 }], []) } });
            const edited = await reload(tx, v.id);
            // Reapply through the SHARED helper the PATCH route uses — so a green
            // harness verifies the route's actual edit logic, not a parallel copy.
            await reapplyTradingVoucherInPlace(tx, {
                voucher:        { ...edited!, type: "SALE", date: new Date(), tenders: [{ accountId: cash.id, amount: 236 }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"],
                branchId:       branch.id,
                lines:          edited!.lines,
                journalEntryId: saleJe,
                previousDate:   new Date(),
            });

            // 3. Assertions.
            const vAfter = await tx.voucherDetail.findUnique({ where: { id: v.id }, select: { universalVoucherId: true } });
            const jeCap  = await captureJe(tx, saleJe);
            const spine  = await captureSpine(tx, saleJe);
            const dr = jeCap.filter((l) => l.type === "DEBIT").reduce((s, l) => s + l.amount, 0);
            const cr = jeCap.filter((l) => l.type === "CREDIT").reduce((s, l) => s + l.amount, 0);
            const outQty = (await tx.invStockLedger.findMany({ where: { universalVoucherId: spineId }, select: { outQty: true } })).reduce((s, r) => s + Number(r.outQty), 0);

            const jeSameId = vAfter?.universalVoucherId === saleJe;
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

/** Stage G1: a receipt allocated against a sale's JE must ALSO get a spine-targeted
 *  (UNIVERSAL_VOUCHER) allocation — the dual-target step. Rolled back. */
async function runAllocationDualTarget(): Promise<boolean> {
    const [branch, product, cash, debtor, user] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true, stock: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.account.findFirst({ where: { group: { name: { equals: "Sundry Debtors", mode: "insensitive" } } }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
    ]);
    if (!branch || !product || !cash || !debtor || !user) { console.log("\nG1 alloc skipped — missing seed data"); return true; }

    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            const spineId = await engineCreateSpine(tx, { type: "SALE", date: new Date(), description: "G1 alloc sale", voucherNo: `PARITY-G1-${Date.now()}`, branchId: PARITY_BRANCH, userId: user.id });
            const v = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch on the spine
                    universalVoucherId: spineId,
                    // 5D-8/5D-10: status + date live on the spine (set by enginePost)
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19",
                    settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118 }], []),
                },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const spec = await saleToSpec(tx, { ...v, type: "SALE", date: new Date(), tenders: [{ accountId: cash.id, amount: 118 }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { branchId: branch.id, lines: vLines });
            const { universalVoucherId: saleSpine } = await enginePost(tx, spec, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });

            const r = await postReceiptVoucher(tx, {
                customerAccountId: debtor.id,
                tenders:           [{ accountId: cash.id, amount: 118 }],
                date:              new Date(),
                userId:            user.id,
                branchId:          PARITY_BRANCH,
                allocateToUniversalVoucherId: saleSpine!,
            });

            const allocs = await tx.voucherAllocation.findMany({ where: { sourceType: "VOUCHER", sourceId: r.voucherId }, select: { targetType: true, targetId: true } });
            // Spine-only: one UNIVERSAL_VOUCHER allocation against the sale's spine.
            const uvAlloc   = allocs.find((a) => a.targetType === "UNIVERSAL_VOUCHER" && a.targetId === saleSpine);
            const noJeAlloc = !allocs.some((a) => a.targetType === "JOURNAL_ENTRY");
            // The spine-based reader helper returns the settled amount keyed by spine id.
            const paidViaSpine = await sumLinked(tx, [saleSpine!]);
            const helperOk = Math.abs((paidViaSpine[saleSpine!] ?? 0) - 118) < 0.01;
            ok = !!uvAlloc && noJeAlloc && allocs.length === 1 && helperOk;
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== G1 spine-only alloc (receipt → UNIVERSAL_VOUCHER only, rolled back) ===");
    console.log("spine-only allocation (UNIVERSAL_VOUCHER, no JE) + reader helper:", ok ? "✓" : "✗");
    return ok;
}

/** Shift cash reconciliation reads the till's BOOK BALANCE (the same
 *  GL-summed figure shift open/close use), so every posting on the till
 *  moves "expected in drawer" with no per-type math. Post a POS sale with a ₹118
 *  cash tender + a ₹50 cash RECEIPT linked to a temporary shift, assert the till
 *  balance moved by 16800 paise and that sumShiftTendersByAccount (the
 *  informational "collected" tally: POS tenders + receipts, both by shift)
 *  reports the same. Rolled back. */
async function runShiftCashMath(): Promise<boolean> {
    const [branch, product, cash, user, debtor, counter] = await Promise.all([
        prisma.branch.findFirst({ select: { id: true } }),
        prisma.invProduct.findFirst({ select: { id: true, stock: true } }),
        prisma.account.findFirst({ where: { name: { equals: "Cash", mode: "insensitive" }, personId: null, companyId: null }, select: { id: true } }),
        prisma.user.findFirst({ select: { id: true } }),
        prisma.account.findFirst({ where: { isActive: true, group: { name: { equals: "Sundry Debtors", mode: "insensitive" } } }, select: { id: true } }),
        prisma.posCounter.findFirst({ select: { id: true, branchId: true } }),
    ]);
    if (!branch || !product || !cash || !user) { console.log("\nshift-cash skipped — missing seed data"); return true; }
    let ok = false;
    try {
        await prisma.$transaction(async (tx) => {
            const openedAt = new Date(Date.now() - 60_000);
            const tillBefore = await tillBalancePaise(tx, cash.id);
            // A temporary shift so the sale and the receipt can carry it (the
            // "collected" tally reads `sourceShiftId`, never a time window).
            const shift = counter
                ? await tx.posShift.create({ data: { userId: user.id, counterId: counter.id, branchId: counter.branchId, openedById: user.id, openingFloatPaise: tillBefore, carryOverFloatPaise: tillBefore, openedAt }, select: { id: true } })
                : null;
            const spineId = await engineCreateSpine(tx, { type: "POS", date: new Date(), description: "parity POS shift", voucherNo: `PARITY-SHIFT-${Date.now()}`, branchId: PARITY_BRANCH, userId: user.id, shiftId: shift?.id ?? null });
            const v = await tx.voucherDetail.create({
                data: {
                    // 5D-11/5D-12: type + branch on the spine
                    universalVoucherId: spineId,
                    // 5D-8/5D-10: status + date live on the spine
                    subtotal: 118, taxAmount: 18, totalAmount: 118,
                    deliveryMode: "COUNTER", placeOfSupply: "19",
                    settlementJson: buildSettlementJson([{ accountId: cash.id, amount: 118, method: "CASH" }], []),
                },
            });
            await tx.voucherInventoryLine.createMany({ data: [{ universalVoucherId: spineId, productId: product.id, quantity: 1, rate: 100, taxRate: 18, taxAmount: 18, amount: 118 }] });
            const vLines = await tx.voucherInventoryLine.findMany({ where: { universalVoucherId: spineId }, include: { product: { select: { id: true, stock: true, mrpPaise: true } } } });
            const spec = await saleToSpec(tx, { ...v, type: "POS", date: new Date(), tenders: [{ accountId: cash.id, amount: 118, method: "CASH" }], charges: [], sellerStateCode: "19", buyerStateCode: "19" } as unknown as PostVoucherInput["voucher"], { branchId: branch.id, lines: vLines });
            const { universalVoucherId } = await enginePost(tx, spec, user.id, { branchId: PARITY_BRANCH, existingSpineId: spineId });
            // POS route links the spine to the voucher — replicate so the window→spine resolution finds it.
            await tx.voucherDetail.update({ where: { id: v.id }, data: { universalVoucherId } });   // 5D-8: status POSTED set on the spine by enginePost
            // A counter RECEIPT at the till (Dr Till 50 / Cr Debtor) moves the book
            // balance like any other posting; the shift it carries is what the
            // "collected" tally reads.
            const expectReceipt = debtor != null && shift != null;
            if (debtor && shift) {
                await postReceiptVoucher(tx, { customerAccountId: debtor.id, tenders: [{ accountId: cash.id, amount: 50 }], date: new Date(), branchId: PARITY_BRANCH, userId: user.id, shiftId: shift.id });
            }
            const tillAfter = await tillBalancePaise(tx, cash.id);
            const expected = BigInt(expectReceipt ? 16800 : 11800);   // POS 11800 + receipt 5000
            const bookMoved = tillAfter - tillBefore === expected;
            const collected = shift
                ? (await sumShiftTendersByAccount(tx, { shiftId: shift.id, accountIds: [cash.id] })).get(cash.id) ?? BigInt(0)
                : expected;   // no counter seeded → skip the tally half
            ok = bookMoved && collected === expected;
            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== shift cash math (POS sale + RECEIPT → till book balance, rolled back) ===");
    console.log("till book balance moved by sale + receipt; collected tally agrees:", ok ? "✓" : "✗");
    return ok;
}

/** Bill-wise link: a credit note settles a receivable for the SAME party — the
 *  purchase-against-sale case in miniature — read back by `sumLinked` from BOTH
 *  ends, plus proof that a self-link nets nothing. Rolled back. */
async function runVoucherAllocation(): Promise<boolean> {
    const acc = await loadAccounts();
    if (!acc || acc.income == null || acc.debtor == null) { console.log("\nvoucher-alloc skipped — no accounts"); return true; }
    let pairOk = false;
    let selfOk = false;
    try {
        await prisma.$transaction(async (tx) => {
            // Receivable side — Dr Debtor / Cr Income: the party owes us 300.
            const bill = await engineCreateVoucher(tx, {
                type: "DEBIT_NOTE", date: new Date(), userId: acc.userId, branchId: PARITY_BRANCH,
                lines: [{ accountId: acc.debtor!, type: "DEBIT", amount: 300 }, { accountId: acc.income!, type: "CREDIT", amount: 300 }],
                partyAccountId: acc.debtor, post: true,
            });
            // Payable side — Dr Income / Cr Debtor: a credit note back to them.
            const note = await engineCreateVoucher(tx, {
                type: "CREDIT_NOTE", date: new Date(), userId: acc.userId, branchId: PARITY_BRANCH,
                lines: [{ accountId: acc.income!, type: "DEBIT", amount: 300 }, { accountId: acc.debtor!, type: "CREDIT", amount: 300 }],
                partyAccountId: acc.debtor, post: true,
            });
            if (bill.id == null || note.id == null) throw new Error("voucher has no spine");

            const { targetId, sourceId } = await assertLinkable(tx, { accountId: acc.debtor!, aId: note.id, bId: bill.id, amount: 120 });
            await createLink(tx, { targetId, sourceId, amount: 120, userId: acc.userId });

            // Both ends must come down — that is what lets a purchase settle a sale.
            // The receivable side is always stored as the target, whichever order
            // the caller passed the two vouchers in.
            const paid = await sumLinked(tx, [bill.id, note.id]);
            pairOk = Math.abs((paid[bill.id] ?? 0) - 120) < 0.005
                  && Math.abs((paid[note.id] ?? 0) - 120) < 0.005
                  && targetId === bill.id;

            // A self-link must stay invisible, or a symmetric sum counts it twice.
            await tx.voucherAllocation.create({ data: { targetType: "UNIVERSAL_VOUCHER", targetId: note.id, sourceType: "VOUCHER", sourceId: note.id, amount: 50, method: "AGAINST_REF", createdById: acc.userId } });
            const afterSelf = await sumLinked(tx, [note.id]);
            selfOk = Math.abs((afterSelf[note.id] ?? 0) - 120) < 0.005;

            throw new Error(ROLLBACK);
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (e) {
        if ((e as Error)?.message !== ROLLBACK) throw e;
    }
    console.log("\n=== bill-wise link (credit note settles a receivable, rolled back) ===");
    console.log("sumLinked nets both ends of the link:", pairOk ? "✓" : "✗");
    console.log("a self-link nets nothing:", selfOk ? "✓" : "✗");
    return pairOk && selfOk;
}

async function main() {
    const stockOk    = stockCheck();
    const e2eOk      = await runE2E();
    const purchaseOk = await runPurchaseE2E();
    const recompOk   = await runStockRecompute();
    const editOk     = await runEditCycle();
    const allocOk    = await runAllocationDualTarget();
    const vchAllocOk = await runVoucherAllocation();
    const shiftOk    = await runShiftCashMath();
    const goldenOk   = await runGolden();
    const draftOk    = await runDraftPost();
    const draftSaleOk = await runDraftSale();
    const linkOk     = await runVoucherLink();
    const green      = stockOk && e2eOk && purchaseOk && recompOk && editOk && allocOk && vchAllocOk && shiftOk && goldenOk && draftOk && draftSaleOk && linkOk;
    console.log(green ? "\nHARNESS GREEN ✓" : "\nHARNESS FAILED ✗");
    if (!green) process.exitCode = 1;
}

main()
    .then(() => prisma.$disconnect().then(() => process.exit(process.exitCode ?? 0)))
    .catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
