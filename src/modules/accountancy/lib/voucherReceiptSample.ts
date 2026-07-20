import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import type { Prisma, InvVoucherType } from "@/generated/prisma/client";
import type {
    ThermalReceiptSample,
} from "@/shared/components/print/ThermalReceiptPreview";
import {
    isVoucherTemplateKind,
    type VoucherTemplateKind,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadEstimateDiscountVisibility } from "@/shared/lib/pos/estimateDiscountVisibility";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { parseBankJson } from "@/shared/lib/org/organisationView";
import { parseDenomJson } from "@/shared/lib/accountancy/denomJson";

// ── Cross-source receipt sample builder ─────────────────────────────────────
//
// Turns ANY Day-Book voucher (inventory · GL · journal-entry) into the single
// `ThermalReceiptSample` shape that the template-driven renderer
// (`ReceiptPreview` → A4 / Thermal) consumes. This is what lets the Day Book
// 3-dot menu print every voucher kind — not just POS sales — through one path.
//
// The POS counter flow keeps its own rich pages (/receipt/invoice?kind=POS with
// the price ladder, /receipt/payment with the relay). This builder powers the
// generic /receipt/voucher/[source]/[id] route used by the register menus.

export type VoucherReceiptSource = "inv" | "gl" | "je";

export interface VoucherReceiptData {
    kind:     VoucherTemplateKind;
    sample:   ThermalReceiptSample;
    docTitle: string;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Org's configured note/coin list (high → low) for the deposit-slip pen-fill
 *  rows, with a sane India fallback. */
function resolveDenoms(raw: unknown): number[] {
    return Array.isArray(raw) && raw.every((d) => typeof d === "number") && raw.length
        ? (raw as number[])
        : [500, 200, 100, 50, 20, 10, 5, 2, 1];
}

/** Resolve a party display name from an Account's linked Person/Company. */
function partyFromAccount(account: {
    name:    string;
    person?:  { name: string; gstin: string | null; phones: { phone: string }[] } | null;
    company?: { name: string; gstin: string | null; phones: { phone: string }[] } | null;
} | null): { name: string | null; phone: string | null; gstin: string | null } {
    if (!account) return { name: null, phone: null, gstin: null };
    const owner = account.person ?? account.company ?? null;
    return {
        name:  owner?.name ?? account.name ?? null,
        phone: owner?.phones[0]?.phone ?? null,
        gstin: owner?.gstin ?? null,
    };
}

// Shared party-account select shape (Account → linked Person/Company).
const partyAccountSelect = {
    name:    true,
    person:  { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
    company: { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
} satisfies Prisma.AccountSelect;

// ── Inventory voucher (SALE / PURCHASE / returns / GRN / CHALLAN / …) ────────
async function buildInvSample(id: number): Promise<VoucherReceiptData> {
    const vRow = await prisma.voucherDetail.findUnique({
        where: { id },
        include: { universalVoucher: { select: { partyAccountId: true, description: true, voucherNo: true, date: true, type: true } } },   // 5D-4 party + 5D-5 desc + 5D-6 ref + 5D-10 date + 5D-11 type
    });
    if (!vRow) return notFoundData();
    // Phase 5 5C: goods lines hang off the spine.
    const invLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: vRow.universalVoucherId ?? -1 },
        include: { product: { select: { sku: true, name: true } } },
    });
    // 5D-4: resolve the party ledger from the spine's partyAccountId.
    const account = vRow.universalVoucher?.partyAccountId != null
        ? await prisma.account.findUnique({ where: { id: vRow.universalVoucher.partyAccountId }, select: partyAccountSelect })
        : null;
    const v = { ...vRow, lines: invLines, account };

    const party = partyFromAccount(v.account);
    // Strip the POS "<sku> — <name>" prefix so the printed line reads cleanly.
    const lineName = (l: (typeof v.lines)[number]): string => {
        const desc = (l.description ?? "").trim();
        const sku  = l.product?.sku;
        if (sku && desc.startsWith(`${sku} — `)) return desc.slice(sku.length + 3);
        return desc || l.product?.name || "";
    };

    let subtotal  = toNumber(v.subtotal);
    let taxAmount = toNumber(v.taxAmount);
    let total     = toNumber(v.totalAmount);
    let lines = v.lines.map((l) => ({
        description: lineName(l),
        quantity:    toNumber(l.quantity),
        amount:      toNumber(l.amount),
    }));

    // POS_ESTIMATE price-privacy: the customer copy prints the TAG/list price and
    // hides discounts by default (cashier negotiates from the discounted price on
    // screen). When the org turns ANY discount on (Settings → Org Defaults), the
    // real discounted price is revealed instead. POS_ORDER always prints the real
    // (discounted) price. (Per-line discount itemisation needs the rich POS ladder
    // — the generic slip only toggles tag-vs-net.)
    if (v.universalVoucher?.type === "POS_ESTIMATE") {
        const vis = await loadEstimateDiscountVisibility();
        const revealDiscounts = vis.tier || vis.loyalty || vis.coupon || vis.manual;
        if (!revealDiscounts) {
            lines = v.lines.map((l) => {
                const qty = toNumber(l.quantity);
                const tagUnit = l.savedSalePricePaise != null ? l.savedSalePricePaise / 100 : toNumber(l.rate);
                return { description: lineName(l), quantity: qty, amount: tagUnit * qty };
            });
            total = lines.reduce((s, l) => s + l.amount, 0);
            subtotal = total;
            taxAmount = 0; // tag price is shown all-in; no separate tax line
        }
    }

    const sample: ThermalReceiptSample = {
        reference:  v.universalVoucher?.voucherNo ?? "",
        date:       isoDate(v.universalVoucher!.date),   // 5D-10: date on spine
        partyName:  party.name ?? readPartyName(v.partyJson) ?? "Walk-in",
        partyPhone: party.phone,
        partyGstin: party.gstin,
        lines,
        subtotal:  subtotal || null,
        taxAmount: taxAmount || null,
        total,
        notes:     v.universalVoucher?.description?.trim() || null,
    };

    const vType = (v.universalVoucher?.type ?? "") as InvVoucherType;   // 5D-11
    const kind = isVoucherTemplateKind(vType) ? vType : "SALE";
    return { kind, sample, docTitle: `${vType} ${v.universalVoucher?.voucherNo ?? ""}` };
}

// ── GL voucher (PAYMENT / RECEIPT / CONTRA / CREDIT_NOTE / DEBIT_NOTE / JOURNAL) ──
async function buildGlSample(id: number): Promise<VoucherReceiptData> {
    // Phase 5 5E: the spine IS the GL voucher. Lines (VoucherGlLine) and the party
    // are scalar/id-only, so account names + the party are enriched via lookups.
    const spine = await prisma.universalVoucher.findUnique({
        where: { id },
        include: { lines: { orderBy: [{ type: "asc" }, { id: "asc" }] } },
    });
    if (!spine) return notFoundData();

    const lineAcctIds = [...new Set(spine.lines.map((l) => l.accountId))];
    const [partyAcct, lineAccts] = await Promise.all([
        spine.partyAccountId != null ? prisma.account.findUnique({ where: { id: spine.partyAccountId }, select: partyAccountSelect }) : Promise.resolve(null),
        lineAcctIds.length ? prisma.account.findMany({ where: { id: { in: lineAcctIds } }, select: { id: true, name: true, bankJson: true, group: { select: { name: true } } } }) : Promise.resolve([]),
    ]);
    const nameById  = new Map(lineAccts.map((a) => [a.id, a.name]));
    const acctById  = new Map(lineAccts.map((a) => [a.id, a]));
    const v = {
        ...spine,
        partyAccount: partyAcct,
        lines: spine.lines.map((l) => ({ ...l, account: { name: nameById.get(l.accountId) ?? "—" } })),
    };

    const party = partyFromAccount(v.partyAccount);
    const total = v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + toNumber(l.amount), 0);

    // GL vouchers have no qty×rate goods — render each ledger line as
    // "<Account> (Dr|Cr)" with its amount so the slip reads as a journal.
    const sample: ThermalReceiptSample = {
        reference:  (v.voucherNo ?? formatUvNo(v.id)),
        date:       isoDate(v.date),
        partyName:  party.name,
        partyPhone: party.phone,
        partyGstin: party.gstin,
        // Journal-style lines carry the GL side; the renderer shows a
        // Particulars · Debit · Credit table (Contra / Journal) rather than
        // "Account (Dr)" text in a qty/rate row.
        lines: v.lines.map((l) => ({
            description: l.account.name,
            quantity:    1,
            amount:      toNumber(l.amount),
            entryType:   l.type,
        })),
        subtotal:  null,
        taxAmount: null,
        total,
        notes:     v.narration?.trim() || null,
    };

    // CONTRA slips — swap the journal table for a bespoke denomination slip:
    //   • cash → bank  → Bank Deposit Slip (bank block + depositor counterfoil).
    //     Always shown (blank pen-fill when no capture) since a deposit needs a slip.
    //   • cash → cash  → Cash Handover Slip (from/to + handed-by/received-by sigs).
    //     Shown ONLY when denominations were captured; a plain internal transfer
    //     with no count keeps the journal table.
    if (v.type === "CONTRA") {
        const isBankAcct = (a?: { group?: { name: string | null } | null }) =>
            (a?.group?.name ?? "").toLowerCase().includes("bank");
        const bankAcct = v.lines
            .filter((l) => l.type === "DEBIT")
            .map((l) => acctById.get(l.accountId))
            .find(isBankAcct);
        // Captured breakdown (final combined, saved on the spine) → filled slip.
        const denom = parseDenomJson(v.denomJson);
        const countedFromDenom = denom ? {
            notes: Object.entries(denom.notes)
                .map(([d, count]) => ({ denom: Number(d), count }))
                .sort((a, b) => b.denom - a.denom),
            cheques: denom.cheques,
        } : null;
        const fromLedger = v.lines.filter((l) => l.type === "CREDIT")
            .map((l) => nameById.get(l.accountId) ?? "—").join(", ") || null;
        const toLedger = v.lines.filter((l) => l.type === "DEBIT")
            .map((l) => nameById.get(l.accountId) ?? "—").join(", ") || null;

        if (bankAcct) {
            const [org, od] = await Promise.all([
                getOrganisation(),
                prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { cashDenominationsJson: true } }),
            ]);
            const denominations = resolveDenoms(od?.cashDenominationsJson);
            // Bank particulars: the destination ledger's own bankJson wins;
            // any blank field falls back to the org's primary bank details.
            const acctBank = parseBankJson(bankAcct.bankJson);
            sample.depositSlip = {
                mode:        "deposit",
                bankName:    acctBank.bankName      || org.bankName          || null,
                branch:      acctBank.branch        || org.bankBranch        || null,
                accountName: acctBank.beneficiary   || org.bankBeneficiary   || org.brandName || null,
                accountNo:   acctBank.accountNumber || org.bankAccountNumber || null,
                ifsc:        acctBank.ifsc          || org.bankIfsc          || null,
                pan:         org.pan                || null,
                fromLedger,
                denominations,
                counted:     countedFromDenom,
            };
        } else if (denom) {
            // cash → cash with a captured count → internal handover slip.
            const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { cashDenominationsJson: true } });
            sample.depositSlip = {
                mode:        "handover",
                bankName: null, branch: null, accountName: null, accountNo: null, ifsc: null, pan: null,
                fromLedger,
                toLedger,
                denominations: resolveDenoms(od?.cashDenominationsJson),
                counted:     countedFromDenom,
            };
        }
    }

    // A cash→bank deposit and a cash→cash handover are both CONTRA rows in the
    // DB, but each prints on its own print-only template (BANK_DEPOSIT /
    // CASH_HANDOVER) so it gets the right chrome, title, and layout. A plain
    // contra keeps the neutral CONTRA template. Everything else keeps its type.
    const slipMode = sample.depositSlip?.mode;
    const kind: VoucherTemplateKind =
        slipMode === "deposit"        ? "BANK_DEPOSIT"
      : slipMode === "handover"       ? "CASH_HANDOVER"
      : isVoucherTemplateKind(v.type) ? v.type
      : "JOURNAL";
    const docLabel = slipMode === "deposit" ? "Bank Deposit"
        : slipMode === "handover" ? "Cash Handover"
        : v.type;
    const docTitle = `${docLabel} ${(v.voucherNo ?? formatUvNo(v.id))}`;
    return { kind, sample, docTitle };
}

// ── Journal entry (GL spine row) ────────────────────────────────────────────
async function buildJeSample(id: number): Promise<VoucherReceiptData> {
    const v = await prisma.universalVoucher.findUnique({
        where: { id },
        include: { lines: true },
    });
    if (!v) return notFoundData();

    // Spine lines are scalar — resolve account names in one lookup.
    const acctIds = [...new Set(v.lines.map((l) => l.accountId))];
    const accounts = await prisma.account.findMany({
        where:  { id: { in: acctIds } },
        select: { id: true, name: true },
    });
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    // Total = Σ debits (== Σ credits for a balanced entry).
    const total = v.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + toNumber(l.amount), 0);

    const sample: ThermalReceiptSample = {
        reference:  (v.voucherNo ?? formatUvNo(v.id)),
        date:       isoDate(v.date),
        partyName:  null,
        partyPhone: null,
        lines: v.lines.map((l) => ({
            description: nameById.get(l.accountId) ?? "—",
            quantity:    1,
            amount:      toNumber(l.amount),
            entryType:   l.type,
        })),
        subtotal:  null,
        taxAmount: null,
        total,
        notes:     v.description?.trim() || null,
    };

    return { kind: "JOURNAL", sample, docTitle: `JOURNAL ${(v.voucherNo ?? formatUvNo(v.id))}` };
}

/** Sentinel returned when a voucher id doesn't resolve — the route maps it to notFound(). */
function notFoundData(): VoucherReceiptData {
    return { kind: "SALE", sample: null as unknown as ThermalReceiptSample, docTitle: "" };
}

/**
 * Build the print-ready sample for any Day-Book voucher. Returns `null` for the
 * sample when the id doesn't resolve so the caller can `notFound()`.
 */
export async function buildVoucherReceiptSample(
    source: VoucherReceiptSource,
    id: number,
): Promise<VoucherReceiptData | null> {
    if (!Number.isFinite(id)) return null;
    const data =
        source === "inv" ? await buildInvSample(id)
      : source === "gl"  ? await buildGlSample(id)
      : await buildJeSample(id);
    if (data.sample == null) return null;
    return data;
}
