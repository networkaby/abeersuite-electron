// GL auto-posting for InvVoucher (SALE, PURCHASE).
// Builds a balanced JournalEntry from the voucher and runs Account.balance updates.
// NB: COGS / closing-stock is not posted per voucher — closing stock is computed
// live at report time via getClosingStockValue (matches Tally).
//
// Posting rules:
//   SALE   →  Dr <Party | Cash>    total
//             Cr Sales A/c         subtotal − taxAmount   (gross goods)
//             Cr Shipping Income   shippingAmt − shippingTaxAmt (net; folds into body when unseeded)
//             Cr <Tax ledgers>     taxAmount + charge GST + shippingTaxAmt (split CGST+SGST or IGST)
//             Dr/Cr Round Off      |roundOff|             (if non-zero)
//   PURCH  →  Dr Purchase A/c      subtotal − taxAmount
//             Dr Freight Charges   shippingAmt − shippingTaxAmt
//             Dr <Tax ledgers>     taxAmount + charge GST + shippingTaxAmt (split CGST+SGST or IGST)
//             Cr <Party | Cash>    total
//             Dr/Cr Round Off      |roundOff|             (if non-zero)
//
// GST routing (added 2026-05-23):
//   • Caller passes resolved `sellerStateCode` + `buyerStateCode` (place of
//     supply) on PostVoucherInput. We compute the split via computeGstSplit:
//       seller == buyer  → CGST + SGST (each = taxAmount / 2)
//       seller != buyer  → IGST (full taxAmount)
//   • Caller may also pass `placeOfSupply` directly (already-resolved 2-char
//     code); it short-circuits the resolution chain.
//   • Missing buyer state (legacy callers) falls back to seller state →
//     intra-state, matching pre-refactor behaviour.

import type { Prisma, PrismaClient, VoucherGlRole, PaymentMethod } from "@/generated/prisma/client";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { toNumber } from "./balance";
import { computeGstSplit } from "@/shared/lib/gst/computeGstSplit";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

type Tx = Prisma.TransactionClient | PrismaClient;

type LedgerLite = {
    id: number;
    name: string;
    normalBalance: "DEBIT" | "CREDIT" | null;
    groupType: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null;
};

type JeLine = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      number;
    description?: string;
    /// Phase 4 G4 — form-section tag (BODY/TAX/TENDER/…). `seq` is stamped by
    /// emission order just before return so the spine reconstructs the form.
    role?:       VoucherGlRole;
    seq?:        number;
    /// Phase 4 G4b — tender channel + ref (only on role=TENDER lines).
    method?:     PaymentMethod | null;
    reference?:  string | null;
};

const NAMES = {
    SALES:            ["Sales A/c", "Sales", "Sales Account"],
    PURCHASE:         ["Purchase A/c", "Purchase", "Purchase Account"],
    SALES_RETURNS:    ["Sales Return A/c", "Sales Returns", "Returns Inward", "Sales Return"],
    PURCHASE_RETURNS: ["Purchase Return A/c", "Purchase Returns", "Returns Outward", "Purchase Return"],
    CASH:             ["Cash", "Cash-in-Hand", "Cash A/c"],
    // Per-direction tax ledger name lookups for the CGST/SGST/IGST split.
    // The final IGST fallbacks keep the legacy single-ledger behaviour for
    // installs whose CoA only seeded one combined "GST Output / IGST" row.
    GST_OUTPUT_CGST:  ["CGST Output", "Output CGST", "CGST"],
    GST_OUTPUT_SGST:  ["SGST Output", "Output SGST", "SGST"],
    GST_OUTPUT_IGST:  ["IGST Output", "Output IGST", "IGST", "GST Output", "Output GST", "Output Tax"],
    GST_INPUT_CGST:   ["CGST Input", "Input CGST", "CGST"],
    GST_INPUT_SGST:   ["SGST Input", "Input SGST", "SGST"],
    GST_INPUT_IGST:   ["IGST Input", "Input IGST", "IGST", "GST Input", "Input GST", "Input Tax"],
    ROUND_OFF:        ["Round Off", "Rounded Off", "Round-Off"],
    // Outward freight on a sale invoice → Cr Shipping Income.
    // Inward freight on a purchase invoice → Dr Freight Charges.
    SHIPPING_INCOME:  ["Shipping Income", "Freight Income", "Carriage Outward", "Delivery Charges Income"],
    SHIPPING_EXPENSE: ["Freight Charges", "Carriage Inward", "Inward Freight"],
    // Voucher-level (overall) discount given on a sale → Dr Discount Allowed.
    // Voucher-level discount received on a purchase → Cr Discount Received.
    DISCOUNT_ALLOWED:  ["Discount Allowed", "Discount Given", "Trade Discount Allowed"],
    DISCOUNT_RECEIVED: ["Discount Received", "Trade Discount Received"],
    SUNDRY_DEB:       [ACCOUNT_GROUPS.SUNDRY_DEBTORS],   // ledger fallback (rare)
    SUNDRY_CRED:      [ACCOUNT_GROUPS.SUNDRY_CREDITORS], // ledger fallback (rare)
} as const;

/** Every ledger name above, flattened and de-duplicated — the one list the loader asks for. */
const ALL_LEDGER_NAMES: readonly string[] = [
    ...new Set(Object.values(NAMES).flatMap((v) => [...v] as string[]).map((n) => n.toLowerCase())),
];

/**
 * Every named ledger the GL builder can possibly want, in ONE query.
 *
 * This used to be a query PER CANDIDATE NAME, run in a loop: resolving the body
 * ledger alone asked for "Sales A/c", then "Sales", then "Sales Account", one
 * round trip each, and a sale with shipping, a bill discount and round-off could
 * spend eight trips inside the transaction before a single line was written.
 * The whole set is at most ~30 rows, so fetching it outright is cheaper than
 * asking even twice.
 *
 * Raw SQL because the match has to stay case-insensitive (a chart of accounts
 * spelled "SALES A/C" must keep resolving, as it did under `mode: "insensitive"`),
 * and Prisma cannot express a case-insensitive `in`.
 *
 * Deliberately NOT cached across requests. It is one statement, and a cache would
 * mean that for its whole lifetime a freshly-created "Shipping Income" ledger is
 * not found — which does not fail loudly, it quietly folds shipping into the body
 * ledger and leaves a posting that has to be spotted by eye later.
 */
async function loadLedgerMap(tx: Tx): Promise<Map<string, LedgerLite>> {
    const rows = await tx.$queryRaw<Array<{
        id: number; name: string; normalBalance: string | null; groupType: string | null;
    }>>`
        SELECT a."id", a."name",
               a."normalBalance"::text AS "normalBalance",
               g."type"::text          AS "groupType"
          FROM "Account" a
          LEFT JOIN "AccountGroup" g ON g."id" = a."groupId"
         WHERE a."personId" IS NULL
           AND a."companyId" IS NULL
           AND a."isActive" = true
           AND LOWER(a."name") = ANY(${[...ALL_LEDGER_NAMES]}::text[])
         ORDER BY a."id" ASC
    `;
    const map = new Map<string, LedgerLite>();
    for (const r of rows) {
        const key = r.name.toLowerCase();
        // Lowest id wins, so two ledgers sharing a name resolve the same way every
        // time. The per-name `findFirst` this replaces had no ordering at all.
        if (map.has(key)) continue;
        map.set(key, {
            id:            r.id,
            name:          r.name,
            normalBalance: r.normalBalance as LedgerLite["normalBalance"],
            groupType:     r.groupType as LedgerLite["groupType"],
        });
    }
    return map;
}

/** First name in `names` that the chart of accounts actually has. Pure — no I/O. */
function pickLedger(ledgers: Map<string, LedgerLite>, names: readonly string[]): LedgerLite | null {
    for (const n of names) {
        const hit = ledgers.get(n.toLowerCase());
        if (hit) return hit;
    }
    return null;
}

export type PostVoucherInput = {
    voucherId: number;
    voucher: {
        id: number;
        type: string;
        /// The voucher's user-facing number. Null on a voucher that has not been
        /// numbered yet — the spine takes its number when it POSTS, so a draft
        /// being posted right now still has none at spec-build time.
        reference: string | null;
        date: Date;
        description: string;
        /// Frozen party snapshot — name used for JE descriptions (read via readPartyName).
        partyJson: Prisma.JsonValue | null;
        subtotal:    Prisma.Decimal | number;
        taxAmount:   Prisma.Decimal | number;
        shippingAmt: Prisma.Decimal | number;
        /// GST embedded in `shippingAmt` (which stays GROSS). When set, the
        /// shipping leg posts NET (shippingAmt − shippingTaxAmt) and this tax
        /// joins the CGST/SGST/IGST pool below — mirroring tax-bearing charge
        /// rows. Absent/0 = pre-existing behaviour (full gross to Shipping
        /// Income). POS sale is the only writer today.
        shippingTaxAmt?: Prisma.Decimal | number | null;
        roundOff:    Prisma.Decimal | number;
        totalAmount: Prisma.Decimal | number;
        /// Voucher-level overall discount (₹). Posts to "Discount Allowed"
        /// on sale-side (Dr) or "Discount Received" on purchase-side (Cr).
        /// Folds into the body ledger if the dedicated ledger isn't seeded.
        /// Per-line discount is already netted into line.amount and never
        /// reaches this helper as a separate field.
        discountAmt?: Prisma.Decimal | number | null;
        /// Seller's state code (place of business — branch.gstStateCode,
        /// falling back to org.gstStateCode). Drives the CGST/SGST vs IGST
        /// split. Optional for back-compat: when blank we treat the sale as
        /// intra-state (pre-refactor behaviour).
        sellerStateCode?: string | null;
        /// Buyer's state code (place of supply). Already resolved by the
        /// caller via resolveBuyerStateCode(party, sellerState, deliveryMode).
        /// Defaults to sellerStateCode → intra-state when blank.
        buyerStateCode?:  string | null;
        /// Multi-tender rows — when present, one JE leg per row replaces the
        /// legacy single `paymentAccount` + `amountReceived` shape. Direction
        /// is the voucher type's counter side (Dr on sale, Cr on purchase).
        /// The customer-AR portion is just another tender row whose
        /// `accountId` points at the party's ledger account; no implicit
        /// "remainder" math here — the caller computes it.
        tenders?: Array<{
            accountId: number;
            amount:    Prisma.Decimal | number;
            /// G4b — channel label + txn ref carried onto the role=TENDER GL line.
            method?:    PaymentMethod | null;
            reference?: string | null;
            account?: {
                normalBalance: "DEBIT" | "CREDIT" | null;
                group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
            } | null;
        }>;
        /// Additional GL legs (the "+ Add Account" rows below the items
        /// table). One JE leg per row. Direction = body's direction
        /// (Cr on sale, Dr on purchase) when amount > 0; opposite when
        /// amount < 0. Line amount is always |amount|. Contributes to
        /// totalAmount via calcVoucherTotals(chargesNet = Σ amount).
        charges?: Array<{
            accountId:   number;
            amount:      Prisma.Decimal | number;
            description?: string | null;
            /// Optional GST carried by this charge (a POS-service row): `amount`
            /// is the NET income and this tax joins the voucher's tax legs
            /// (CGST/SGST/IGST split). The charge's gross (net + tax) must be
            /// included in totalAmount by the caller for the JE to balance.
            /// Absent/0 = a plain untaxed charge — behaviour unchanged.
            taxAmount?:  Prisma.Decimal | number | null;
            account?: {
                normalBalance: "DEBIT" | "CREDIT" | null;
                group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
            } | null;
        }>;
    };
    userId: number;
};

/**
 * The invariant that keeps a trading voucher's money side equal to its goods
 * side: the payment rows must add up to the voucher total. The party's own
 * unpaid part is a payment row too (the AR / AP tender), so a credit sale is
 * covered by this as much as a cash one.
 *
 * Returns the complaint to show the user, or null when the voucher is sound.
 *
 * This lived inline in POST /api/inventory/vouchers and NOWHERE ELSE, which is
 * how POS-26-27-0039 came to exist: an edit changed the lines and the total,
 * kept the old payment rows, and no one checked. The GL builder noticed and its
 * objection was thrown away (see `GlSkipReason`). One copy, called by every
 * route that writes a voucher, is the reason that cannot happen twice.
 *
 * A voucher with no payment rows at all is left to the GL builder to judge —
 * some types legitimately have none, and it knows which.
 */
export function tenderCoverageComplaint(
    tenders: { amount: number | string }[],
    totalAmount: number,
): string | null {
    if (tenders.length === 0) return null;
    const sum = tenders.reduce((s, t) => s + Number(t.amount), 0);
    // A rupee's worth of rounding is the operator's, not an error.
    if (Math.abs(sum - totalAmount) <= 0.01) return null;
    return `The payment rows come to ₹${sum.toFixed(2)} but the voucher total is ₹${totalAmount.toFixed(2)}. `
        + "Adjust them so they add up — the unpaid part goes on the party's own account.";
}

/** A refusal the caller should show to the user as-is — not a server fault.
 *  Raised when a voucher that must carry a ledger entry cannot be given one. */
export class GlBuildError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GlBuildError";
    }
}

/** Why a build produced no GL lines. "none" — this voucher has no ledger entry
 *  to make and never had one (a type that does not post, a zero-value voucher);
 *  carrying on is correct. "refused" — it SHOULD have posted and could not, so
 *  carrying on would leave a voucher whose invoice and ledger disagree. */
export type GlSkipReason = "none" | "refused";

type BuiltGl =
    | { skip: true;  reason: GlSkipReason; notes: string[] }
    | { skip: false; lines: JeLine[]; notes: string[]; ledgers: LedgerLite[] };

/**
 * Build the balanced GL lines for an inventory trading voucher (SALE / PURCHASE
 * / SALE_RETURN / PURCHASE_RETURN). No JE / balance writes — returns `lines`,
 * diagnostic `notes`, and the resolved `ledgers` (so the caller can apply the
 * balance deltas). `skip:true` means no GL post (wrong type / zero total / no
 * body ledger / no tenders / unbalanced). Shared by `postInvVoucherToGl` (which
 * writes the JE itself) and the engine mapper `saleToSpec` (feeds `enginePost`)
 * so both produce byte-identical lines.
 */
export async function buildInvVoucherGlLines(
    tx: Tx,
    voucher: PostVoucherInput["voucher"],
): Promise<BuiltGl> {
    const notes: string[] = [];
    // Party name for JE descriptions comes from the frozen snapshot (partyJson).
    const partyName = readPartyName(voucher.partyJson);

    // Four GL-posting kinds, in two direction-shapes:
    //   "sale shape"     — counter (party/cash) Dr, body Cr, tax Cr
    //                      → SALE (body=Sales, tax=Output GST)
    //                      → PURCHASE_RETURN (body=Purchase Returns, tax=Input GST reversal)
    //   "purchase shape" — counter (party/cash) Cr, body Dr, tax Dr
    //                      → PURCHASE (body=Purchase, tax=Input GST)
    //                      → SALE_RETURN (body=Sales Returns, tax=Output GST reversal)
    // POS shares the sale shape (counter Dr / body Cr) — same GST split,
    // same body/tax resolution, and (since Layer 7g) the same tender
    // shape — every Dr leg is an explicit tender row on the InvVoucher.
    // ONLINE_INVOICE is the online-channel fulfilment sale — identical sale shape.
    const isPositiveSale     = voucher.type === "SALE" || voucher.type === "POS" || voucher.type === "ONLINE_INVOICE";
    const isPositivePurchase = voucher.type === "PURCHASE";
    const isSaleReturn       = voucher.type === "SALE_RETURN";
    const isPurchaseReturn   = voucher.type === "PURCHASE_RETURN";
    if (!isPositiveSale && !isPositivePurchase && !isSaleReturn && !isPurchaseReturn) {
        return { skip: true, reason: "none", notes: ["voucher type does not post to GL"] };
    }
    // `isSale` (legacy name) reused below as a shorthand for the "sale shape"
    // direction — counter Dr, body Cr. SALE and PURCHASE_RETURN both share it.
    const isSale     = isPositiveSale || isPurchaseReturn;
    // `isDebtorParty` drives the no-party-linked fallback chain: SALE +
    // SALE_RETURN go against Sundry Debtors; PURCHASE + PURCHASE_RETURN
    // against Sundry Creditors.
    const isDebtorParty = isPositiveSale || isSaleReturn;

    const subtotal     = toNumber(voucher.subtotal);
    const taxAmount    = toNumber(voucher.taxAmount);
    const shippingAmt  = toNumber(voucher.shippingAmt);
    // GST inside the (gross) shipping amount — clamped so a bad caller can
    // never push the shipping net negative. 0 for every non-POS caller.
    const shippingTax  = Math.min(Math.max(0, toNumber(voucher.shippingTaxAmt ?? 0)), shippingAmt);
    // What Shipping Income actually earns (the tax was never income).
    const shippingNet  = shippingAmt - shippingTax;
    const discountAmt  = Math.max(0, toNumber(voucher.discountAmt ?? 0));
    const roundOff     = toNumber(voucher.roundOff);
    const totalAmount  = toNumber(voucher.totalAmount);
    // `voucher.subtotal` from calcVoucherTotals is tax-INCLUSIVE (sum of
    // line.amount, where line.amount = taxable + line tax). Pure goods =
    // subtotal − taxAmount. Shipping and voucher-level discount used to
    // be folded into the body (Sales/Purchase) credit/debit; since
    // 2026-05-24 they're posted as their own GL legs — see Shipping Income
    // / Discount Allowed / Discount Received resolution below.
    const goodsAmount  = subtotal - taxAmount;

    if (totalAmount <= 0) {
        return { skip: true, reason: "none", notes: ["voucher total is zero — skipping GL post"] };
    }

    // ── Resolve ledgers ────────────────────────────────────────────────
    // Every named ledger this voucher could need, in one statement — see
    // loadLedgerMap. All the picks below are then pure map lookups.
    const ledgers = await loadLedgerMap(tx);
    // Body ledger — Sales / Purchase / Sales Returns / Purchase Returns per kind.
    // Returns fall back to the parent ledger (Sales / Purchase) when the
    // dedicated returns ledger isn't seeded, so old installs keep working.
    let bodyNames: readonly string[];
    let bodyFallbackNames: readonly string[] | null = null;
    let bodyKindLabel: string;
    if (isPositiveSale)            { bodyNames = NAMES.SALES;            bodyKindLabel = "Sales"; }
    else if (isPositivePurchase)   { bodyNames = NAMES.PURCHASE;         bodyKindLabel = "Purchase"; }
    else if (isSaleReturn)         { bodyNames = NAMES.SALES_RETURNS;    bodyFallbackNames = NAMES.SALES;    bodyKindLabel = "Sales Returns"; }
    else /* isPurchaseReturn */    { bodyNames = NAMES.PURCHASE_RETURNS; bodyFallbackNames = NAMES.PURCHASE; bodyKindLabel = "Purchase Returns"; }

    let bodyLedger = pickLedger(ledgers, bodyNames);
    if (!bodyLedger && bodyFallbackNames) {
        bodyLedger = pickLedger(ledgers, bodyFallbackNames);
        if (bodyLedger) notes.push(`no dedicated ${bodyKindLabel} ledger — folded into ${bodyLedger.name}`);
    }
    if (!bodyLedger) {
        return { skip: true, reason: "refused", notes: [
            `no ledger found for ${bodyKindLabel} — skipping GL post`,
        ] };
    }

    // Counter side comes entirely from `voucher.tenders[]` — one Dr leg
    // per tender on a sale-shape voucher, one Cr leg on a purchase shape.
    // The customer-AR portion is just another tender row whose accountId
    // points at the party's ledger. Every Dr/Cr counter line is backed
    // by an explicit InvVoucherTender row — no implicit math, no
    // partyType+partyId resolution fallback.
    const tenderRows = (voucher.tenders ?? []).filter((t) => toNumber(t.amount) > 0.005);
    if (tenderRows.length === 0) {
        return { skip: true, reason: "refused", notes: [
            ...notes,
            `no tender rows on voucher ${voucher.reference ?? formatUvNo(voucher.id)} — caller must supply at least one`,
        ] };
    }

    // Tax leg — split into CGST + SGST (intra-state) or IGST (inter-state)
    // based on the caller-supplied state codes. Output ledgers for sale-side
    // (SALE + SALE_RETURN), Input ledgers for purchase-side. Returns reverse
    // the direction via bodyType below.
    const isOutputTax = isPositiveSale || isSaleReturn;
    const sellerStateCode = (voucher.sellerStateCode ?? "").trim();
    // Default buyer = seller → intra-state (matches pre-refactor behaviour
    // for old callers that don't pass a buyer state yet).
    const buyerStateCode  = (voucher.buyerStateCode  ?? sellerStateCode).trim();

    type TaxLeg = { ledger: LedgerLite; amount: number; label: string };
    const taxLegs: TaxLeg[] = [];
    let unledgered = 0; // tax amount that couldn't find a ledger — folds into body

    // GST carried by tax-bearing charge rows (POS services: Cr income NET +
    // this tax on the voucher's tax legs). 0 for every pre-existing caller —
    // the split below then runs on voucher.taxAmount exactly as before.
    const chargesTax = (voucher.charges ?? []).reduce(
        (s, ch) => s + Math.max(0, toNumber(ch.taxAmount ?? 0)), 0,
    );
    // Shipping GST rides the same pool (shipping leg posts NET, like a
    // tax-bearing charge). 0 whenever shippingTaxAmt isn't set.
    const totalTax = taxAmount + chargesTax + shippingTax;

    if (totalTax > 0) {
        const split = computeGstSplit({
            taxAmount: totalTax,
            sellerStateCode,
            buyerStateCode,
        });

        if (split.kind === "INTRA") {
            const cgst = split.cgst;
            const sgst = split.sgst;
            const cgstLedger = pickLedger(
                ledgers, isOutputTax ? NAMES.GST_OUTPUT_CGST : NAMES.GST_INPUT_CGST,
            );
            const sgstLedger = pickLedger(
                ledgers, isOutputTax ? NAMES.GST_OUTPUT_SGST : NAMES.GST_INPUT_SGST,
            );
            if (cgstLedger && cgst > 0) {
                taxLegs.push({ ledger: cgstLedger, amount: cgst, label: `${isOutputTax ? "Output" : "Input"} CGST` });
            } else if (cgst > 0) {
                unledgered += cgst;
                notes.push(`no CGST ledger — ${cgst.toFixed(2)} folded into ${bodyLedger.name}`);
            }
            if (sgstLedger && sgst > 0) {
                taxLegs.push({ ledger: sgstLedger, amount: sgst, label: `${isOutputTax ? "Output" : "Input"} SGST` });
            } else if (sgst > 0) {
                unledgered += sgst;
                notes.push(`no SGST ledger — ${sgst.toFixed(2)} folded into ${bodyLedger.name}`);
            }
        } else {
            const igstLedger = pickLedger(
                ledgers, isOutputTax ? NAMES.GST_OUTPUT_IGST : NAMES.GST_INPUT_IGST,
            );
            if (igstLedger) {
                taxLegs.push({ ledger: igstLedger, amount: split.igst, label: `${isOutputTax ? "Output" : "Input"} IGST` });
            } else {
                unledgered += split.igst;
                notes.push(`no IGST ledger — ${split.igst.toFixed(2)} folded into ${bodyLedger.name}`);
            }
        }
    }

    // Round-off ledger (optional)
    let roundOffLedger: LedgerLite | null = null;
    if (Math.abs(roundOff) >= 0.005) {
        roundOffLedger = pickLedger(ledgers, NAMES.ROUND_OFF);
        if (!roundOffLedger) {
            notes.push(`no Round Off ledger — rounding of ${roundOff.toFixed(2)} folded into ${bodyLedger.name}`);
        }
    }

    // Shipping leg ledger (optional). Outward shipping on a sale-side
    // voucher → Shipping Income. Inward freight on a purchase-side voucher
    // → Freight Charges. Falls back to folding into body when missing so
    // legacy installs that haven't seeded the ledger still post correctly.
    let shippingLedger: LedgerLite | null = null;
    if (shippingAmt > 0.005) {
        shippingLedger = pickLedger(
            ledgers, isDebtorParty ? NAMES.SHIPPING_INCOME : NAMES.SHIPPING_EXPENSE,
        );
        if (!shippingLedger) {
            notes.push(`no ${isDebtorParty ? "Shipping Income" : "Freight Charges"} ledger — shipping of ${shippingNet.toFixed(2)} folded into ${bodyLedger.name}`);
        }
    }

    // Voucher-level discount leg (optional). Discount given on a sale →
    // Discount Allowed (Dr — expense). Discount received on a purchase →
    // Discount Received (Cr — income). Falls back to reducing the body
    // line so the JE still balances on legacy installs.
    let discountLedger: LedgerLite | null = null;
    if (discountAmt > 0.005) {
        discountLedger = pickLedger(
            ledgers, isDebtorParty ? NAMES.DISCOUNT_ALLOWED : NAMES.DISCOUNT_RECEIVED,
        );
        if (!discountLedger) {
            notes.push(`no ${isDebtorParty ? "Discount Allowed" : "Discount Received"} ledger — discount of ${discountAmt.toFixed(2)} folded into ${bodyLedger.name}`);
        }
    }

    // ── Build balanced JE lines ──────────────────────────────────────────
    // For a SALE: counter side debits the party; body side credits sales/tax/round-off.
    // For a PURCHASE: counter side credits the party; body side debits purchase/tax/round-off.
    const counterType: "DEBIT" | "CREDIT" = isSale ? "DEBIT" : "CREDIT";
    const bodyType:    "DEBIT" | "CREDIT" = isSale ? "CREDIT" : "DEBIT";

    // Body-side amounts (split where possible). Tax / shipping / discount
    // each fall back to folding into body when their dedicated ledger
    // isn't seeded. Shipping is same direction as body (+); discount is
    // opposite direction (so it gets subtracted from body when folded).
    let bodyAmount = goodsAmount;
    let rndLineAmt = roundOff;
    if (unledgered > 0)     { bodyAmount += unledgered; }
    // NET only — shipping's GST is already in the tax pool above.
    if (!shippingLedger)    { bodyAmount += shippingNet; }
    if (!discountLedger)    { bodyAmount -= discountAmt; }
    if (!roundOffLedger)    { bodyAmount += rndLineAmt; rndLineAmt = 0; }

    // ── Counter side: one JE leg per tender row ─────────────────────────
    // Required since Layer 7g — every Dr (sale) / Cr (purchase) leg is
    // backed by an explicit InvVoucherTender row. The empty-tender guard
    // at the top of the function already rejected the no-tender case.
    const lines: JeLine[] = [];
    const extraLedgers: LedgerLite[] = [];

    for (const t of tenderRows) {
        const amt = toNumber(t.amount);
        lines.push({
            accountId:   t.accountId,
            type:        counterType,
            amount:      amt,
            description: partyName ?? voucher.description,
            role:        "TENDER",
            method:      t.method ?? null,
            reference:   t.reference ?? null,
        });
        if (t.account) {
            extraLedgers.push({
                id:            t.accountId,
                name:          "", // resolved below if needed for balance delta
                normalBalance: t.account.normalBalance,
                groupType:     t.account.group?.type ?? null,
            });
        }
    }
    if (bodyAmount !== 0) {
        lines.push({
            accountId:   bodyLedger.id,
            type:        bodyType,
            amount:      bodyAmount,
            description: voucher.description,
            role:        "BODY",
        });
    }
    for (const leg of taxLegs) {
        lines.push({
            accountId:   leg.ledger.id,
            type:        bodyType, // for SALE: credit GST; for PURCHASE: debit GST
            amount:      leg.amount,
            description: leg.label,
            role:        "TAX",
        });
    }
    if (shippingLedger && shippingNet > 0) {
        // Same direction as body — credits Shipping Income on sale,
        // debits Freight Charges on purchase. Returns flip via bodyType.
        // NET of shippingTax — the GST share posts on the tax legs above.
        lines.push({
            accountId:   shippingLedger.id,
            type:        bodyType,
            amount:      shippingNet,
            description: shippingLedger.name,
            role:        "SHIPPING",
        });
    }
    if (discountLedger && discountAmt > 0) {
        // Opposite direction to body — debits Discount Allowed on sale
        // (it's an expense that offsets revenue), credits Discount
        // Received on purchase. Returns flip via counterType.
        lines.push({
            accountId:   discountLedger.id,
            type:        counterType,
            amount:      discountAmt,
            description: discountLedger.name,
            role:        "DISCOUNT",
        });
    }
    if (roundOffLedger && rndLineAmt !== 0) {
        // Positive roundOff → income (Cr) on sale, expense (Dr) on purchase. Negative → mirror.
        const positiveSide = isSale ? "CREDIT" : "DEBIT";
        const negativeSide = isSale ? "DEBIT"  : "CREDIT";
        lines.push({
            accountId:   roundOffLedger.id,
            type:        rndLineAmt > 0 ? positiveSide : negativeSide,
            amount:      Math.abs(rndLineAmt),
            description: "Round Off",
            role:        "ROUNDOFF",
        });
    }

    // ── Additional charge legs (the "+ Add Account" rows below items) ──
    // Each charge row posts one JE leg. Direction = body's direction
    // (Cr on sale, Dr on purchase) when amount > 0; opposite direction
    // when amount < 0. Line amount is always |amount|. These are
    // independent of shipping/discount/round-off — they extend the JE
    // with whatever the operator chose (Packing Income, Service Charges,
    // Insurance, …).
    for (const ch of voucher.charges ?? []) {
        const raw = toNumber(ch.amount);
        if (Math.abs(raw) < 0.005) continue;
        const dir: "DEBIT" | "CREDIT" = raw > 0 ? bodyType : counterType;
        lines.push({
            accountId:   ch.accountId,
            type:        dir,
            amount:      Math.abs(raw),
            description: ch.description ?? undefined,
            role:        "CHARGE",
        });
        if (ch.account) {
            extraLedgers.push({
                id:            ch.accountId,
                name:          "",
                normalBalance: ch.account.normalBalance,
                groupType:     ch.account.group?.type ?? null,
            });
        }
    }

    // G4: stamp each leg's ordinal position so the spine reconstructs the form
    // (role = section, seq = order within the document).
    lines.forEach((l, i) => { l.seq = i; });

    // Sanity: check balance
    const debSum = lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + l.amount, 0);
    const credSum = lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + l.amount, 0);
    if (Math.abs(debSum - credSum) > 0.01) {
        return { skip: true, reason: "refused", notes: [
            ...notes,
            `the payment rows come to ₹${debSum.toFixed(2)} but the voucher comes to ₹${credSum.toFixed(2)}`,
        ] };
    }

    return { skip: false, lines, notes, ledgers: [
        bodyLedger, roundOffLedger, shippingLedger, discountLedger,
        ...extraLedgers, ...taxLegs.map((leg) => leg.ledger),
    ].filter((x): x is LedgerLite => x != null) };
}

// `postInvVoucherToGl` (the legacy GL bridge) was deleted 2026-06-26 — all
// callers now build the spec via `saleToSpec` (which reuses `buildInvVoucherGlLines`
// above) and write through the engine's `enginePost`. The line-building lives on
// here; the JE-write + balance-delta half moved to `engineGlArm`.
