import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo, voucherDisplayNo } from "@/shared/lib/accountancy/uvNo";
import type { Prisma, InvVoucherType } from "@/generated/prisma/client";
import type {
    ThermalReceiptSample,
} from "@/shared/components/print/ThermalReceiptPreview";
import {
    isVoucherTemplateKind,
    type VoucherTemplateDefaults,
    type VoucherTemplateKind,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadEstimateDiscountVisibility } from "@/shared/lib/pos/estimateDiscountVisibility";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { formatStructuredAddressBlock, parseBankJson } from "@/shared/lib/org/organisationView";
import { parseDenomJson } from "@/shared/lib/accountancy/denomJson";
import { buildPartyDepositSlip, loadSlipDenominations } from "@/modules/accountancy/lib/partyDepositSlip";
import { paymentInstrumentText } from "@/shared/lib/constants/accounting";
import { partyBalanceAroundVoucher } from "@/shared/lib/accountancy/partyLedgerBalance";
import { getThermalTemplate, getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { buildWarrantyGroups } from "@/shared/lib/warranty/warrantyTerms";
import { carriesWarranty, WARRANTY_PRINT_SELECT } from "@/modules/inventory/lib/warrantyStamp";
import { readLineText } from "@/shared/lib/print/lineDescription";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { computeGstSplit, gstinDerivedStateCode } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode } from "@/shared/lib/gst/indianStates";
import { round2 } from "@/shared/lib/format";
import { loadBillSettlementPrint } from "@/modules/accountancy/lib/billSettlementPrint";

// ── Cross-source receipt sample builder ─────────────────────────────────────
//
// Turns ANY Day-Book voucher (inventory · GL · journal-entry) into the single
// `ThermalReceiptSample` shape that the template-driven renderer
// (`ReceiptPreview` → A4 / Thermal) consumes. This is what lets the Day Book
// 3-dot menu print every voucher kind — not just POS sales — through one path.
//
// The POS sale keeps its own rich page (/receipt/invoice?kind=POS, the price
// ladder). This builder powers the generic /receipt/voucher/[source]/[id] route
// and every silent thermal print (buildVoucherBridgePayload) — so a Receipt or
// Payment, from any button, is one slip on its print template.

export type VoucherReceiptSource = "inv" | "gl" | "je";

export interface VoucherReceiptData {
    kind:     VoucherTemplateKind;
    sample:   ThermalReceiptSample;
    docTitle: string;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

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

// Issuing branch (UniversalVoucher.branch) — every builder prints it in the
// letterhead when the template's Branch address switch is on. Selected inside
// each builder's own voucher query, so it costs no extra round trip.
const branchAddressSelect = {
    addressLine1: true, addressLine2: true, city: true, state: true, pinCode: true,
} satisfies Prisma.BranchSelect;

/** The branch's address block, or null when none is on file. */
const branchAddressText = (branch: Parameters<typeof formatStructuredAddressBlock>[0] | null | undefined): string | null =>
    branch ? formatStructuredAddressBlock(branch) || null : null;

/**
 * Settlement JSON written by the trading voucher form — the tender + charge
 * INPUT re-rendered for edit. Money/reporting read the posted spine; the print
 * only needs the labels and amounts, so a loose read is enough.
 */
function readSettlement(raw: unknown): {
    tenders: { accountId: number; amount: number }[];
    charges: { accountId: number; amount: number; description?: string; taxAmount?: number; taxRate?: number; isService?: boolean }[];
} {
    const j = (raw ?? {}) as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
    return {
        tenders: arr(j.tenders).map((t) => ({ accountId: num(t.accountId), amount: num(t.amount) })),
        charges: arr(j.charges).map((c) => ({
            accountId:   num(c.accountId),
            amount:      num(c.amount),
            description: typeof c.description === "string" ? c.description : undefined,
            // A service row carries its own GST. Without these two the A4
            // rate-wise (HSN/SAC) table showed the tax but no taxable value to
            // put it against, so the summary never added up to the bill.
            taxAmount:   c.taxAmount != null ? num(c.taxAmount) : undefined,
            taxRate:     c.taxRate   != null ? num(c.taxRate)   : undefined,
            isService:   c.serviceId != null,
        })),
    };
}

/** Add `days` to an ISO date string, keeping the ISO shape. */
function addDaysIso(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// ── Inventory voucher (SALE / PURCHASE / returns / GRN / CHALLAN / …) ────────
async function buildInvSample(id: number): Promise<VoucherReceiptData> {
    const vRow = await prisma.voucherDetail.findUnique({
        where: { id },
        include: {
            universalVoucher: { select: {
                partyAccountId: true, description: true, voucherNo: true, date: true, type: true,   // 5D-4 party + 5D-5 desc + 5D-6 ref + 5D-10 date + 5D-11 type
                branch: { select: branchAddressSelect },
            } },
            // A return against a POS bill prints on the counter's POS_RETURN slip.
            refVoucher: { select: { universalVoucher: { select: { type: true } } } },
        },
    });
    if (!vRow) return notFoundData();
    // Phase 5 5C: goods lines hang off the spine.
    const invLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: vRow.universalVoucherId ?? -1 },
        include: {
            product: { select: { id: true, sku: true, name: true, unit: { select: { label: true } } } },
            // The warranty frozen at sale time → the bill's Warranty section.
            warrantyTerm: { select: WARRANTY_PRINT_SELECT },
        },
    });
    // 5D-4: resolve the party ledger from the spine's partyAccountId.
    const account = vRow.universalVoucher?.partyAccountId != null
        ? await prisma.account.findUnique({ where: { id: vRow.universalVoucher.partyAccountId }, select: partyAccountSelect })
        : null;
    const v = { ...vRow, lines: invLines, account };

    const party = partyFromAccount(v.account);
    // The item prints as the item and the note (the line's note column, or on an
    // older line the text after POS's "<sku> — <name> · ") prints under it.
    // Using the note as the name (the old behaviour) silently renamed the item.
    const itemName = (l: (typeof v.lines)[number]): string => readLineText(l, l.product).name;
    const itemNote = (l: (typeof v.lines)[number]): string | null => readLineText(l, l.product).note;

    let subtotal  = toNumber(v.subtotal);
    let taxAmount = toNumber(v.taxAmount);
    let total     = toNumber(v.totalAmount);
    let lines = v.lines.map((l) => {
        // FREE-grant lines (independent FREE_ITEM / BOGO coupons) store quantity
        // 0 + freeQty — print the granted count so the receipt says "1 × Fanta"
        // at ₹0, never a blank "0 ×". The note already carries the "FREE · …"
        // line the sale route baked in.
        const qty = toNumber(l.quantity);
        const freeQty = toNumber(l.freeQty ?? 0);
        return {
            description: itemName(l),
            note:        itemNote(l),
            quantity:    qty === 0 && freeQty > 0 ? freeQty : qty,
            amount:      toNumber(l.amount),
        };
    });

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
                return { description: itemName(l), note: itemNote(l), quantity: qty, amount: tagUnit * qty };
            });
            total = lines.reduce((s, l) => s + l.amount, 0);
            subtotal = total;
            taxAmount = 0; // tag price is shown all-in; no separate tax line
        }
    }

    // ── Tally tax-invoice extras ────────────────────────────────────────────
    // Per-line HSN/unit/GST plus the bill-level ledger rows (discount, charges,
    // shipping, round-off) and the settlement, so the A4 goods table can print
    // one continuous column of figures that ends at the grand total. Everything
    // is optional — a voucher with no tax and no charges just prints fewer rows.
    const productIds = [...new Set(v.lines.map((l) => l.productId))];
    const [resolvedTax, org] = await Promise.all([
        productIds.length ? resolveProductTaxBatch({ productIds }) : Promise.resolve(null),
        getOrganisation(),
    ]);

    const goodsTax      = v.lines.reduce((s, l) => s + toNumber(l.taxAmount), 0);
    const shippingGross = toNumber(v.shippingAmt);
    const shippingTax   = toNumber(v.shippingTaxAmt);
    const shippingNet   = shippingGross - shippingTax;
    const billDiscount  = toNumber(v.discountAmt ?? 0);
    const roundOff      = toNumber(v.roundOff);
    const settlement    = readSettlement(v.settlementJson);

    // Ledger-row and tender labels come from the account names.
    const settleAcctIds = [...new Set(
        [...settlement.charges, ...settlement.tenders].map((r) => r.accountId),
    )].filter((id) => id > 0);
    const settleNames = settleAcctIds.length
        ? new Map((await prisma.account.findMany({
            where:  { id: { in: settleAcctIds } },
            select: { id: true, name: true },
        })).map((a) => [a.id, a.name]))
        : new Map<number, string>();

    // Buyer state drives the CGST+SGST vs IGST split. The buyer's GSTIN carries
    // its own state code and IS the registration, so it wins; then the voucher's
    // place of supply; then the seller's state (a walk-in is intra-state).
    const buyerStateCode = gstinDerivedStateCode(party.gstin)
        || (v.placeOfSupply ?? "")
        || org.gstStateCode;
    const split = computeGstSplit({
        taxAmount:       goodsTax + shippingTax,
        sellerStateCode: org.gstStateCode,
        buyerStateCode,
    });
    const stateLabel = (code: string): string | null => {
        const name = stateNameForCode(code);
        return name ? `${name}, Code : ${code}` : null;
    };

    // Pre-tax basis for the goods table. Skipped for the price-privacy estimate
    // above, whose amounts were rewritten to tag prices with no tax to strip.
    const taxInvoice = v.universalVoucher?.type !== "POS_ESTIMATE" || taxAmount > 0;
    if (taxInvoice) {
        lines = lines.map((ln, i) => {
            const src     = v.lines[i];
            const lineTax = toNumber(src.taxAmount);
            return {
                ...ln,
                hsn:       resolvedTax?.products.get(src.productId)?.hsnCode ?? null,
                unit:      src.product?.unit?.label ?? null,
                taxable:   ln.amount - lineTax,
                discount:  toNumber(src.discountAmt) || null,
                taxRate:   toNumber(src.taxRate) || null,
                taxAmount: lineTax || null,
                mrp:       src.mrpPaise != null ? src.mrpPaise / 100 : null,
            };
        });
    }

    // Rate-wise HSN/SAC summary — one row per (code × rate) pair, which is the
    // grouping GSTR-1 asks for. A line with NO code still belongs here: the tax
    // breakup is the point, and dropping those lines made the whole table
    // disappear on bills whose products have no HSN in the master. Its code
    // cell prints blank, which is the honest signal that master data is missing.
    const hsnAcc = new Map<string, { hsn: string; ratePct: number; taxable: number; tax: number }>();
    for (const src of v.lines) {
        const hsn     = resolvedTax?.products.get(src.productId)?.hsnCode ?? "";
        const lineTax = toNumber(src.taxAmount);
        if (lineTax <= 0.005) continue;
        const ratePct = toNumber(src.taxRate);
        const key     = `${hsn}|${ratePct}`;
        const row     = hsnAcc.get(key) ?? { hsn, ratePct, taxable: 0, tax: 0 };
        row.taxable  += toNumber(src.amount) - lineTax;
        row.tax      += lineTax;
        hsnAcc.set(key, row);
    }
    const hsnSummary = [...hsnAcc.values()]
        .sort((a, b) => a.hsn.localeCompare(b.hsn))
        .map((r) => {
            // Split in paise with the odd one going to CGST — the same
            // convention computeGstSplit uses for the ledger rows, so the
            // summary and the Output CGST/SGST lines never disagree.
            const paise = Math.round(r.tax * 100);
            const sgstP = Math.floor(paise / 2);
            return {
                hsn:     r.hsn,
                ratePct: r.ratePct,
                taxable: round2(r.taxable),
                cgst:    (paise - sgstP) / 100,
                sgst:    sgstP / 100,
                total:   round2(r.tax),
            };
        });

    // Ledger rows, in the order Tally stacks them: bill discount, then income
    // charges, then freight. GST and round-off are appended by the renderer.
    const charges: { label: string; amount: number; taxAmount?: number; taxRate?: number }[] = [];
    if (billDiscount > 0.005) charges.push({ label: "Less : Discount on bill", amount: -billDiscount });
    for (const c of settlement.charges) {
        if (Math.abs(c.amount) < 0.005) continue;
        const name = settleNames.get(c.accountId) ?? "Charges";
        // A service's description already names the service ("Service: Fitting
        // × 2"), so prefixing the ledger would print the same words twice.
        // A plain charge keeps the ledger name as its label.
        // `amount` is the NET; a tax-bearing row's GST rides alongside it so the
        // renderer can show the row and still reconcile the tax summary.
        charges.push({
            label: c.isService && c.description
                ? c.description
                : c.description ? `${name} — ${c.description}` : name,
            amount: c.amount,
            ...(c.taxAmount ? { taxAmount: c.taxAmount } : {}),
            ...(c.taxRate   ? { taxRate:   c.taxRate   } : {}),
        });
    }
    if (shippingNet > 0.005) charges.push({ label: "Shipping", amount: shippingNet });

    // Received in · Balance due · the party's running account — one reader
    // shared with the POS counter print (billSettlementPrint.ts).
    const paid = await loadBillSettlementPrint({
        uvId:           v.universalVoucherId,
        partyAccountId: v.universalVoucher?.partyAccountId ?? null,
        total,
        partyBalance:   true,
    });

    const creditDays = v.creditPeriodDays ?? 0;
    const voucherDate = isoDate(v.universalVoucher!.date);

    // Carried for the money-receipt / journal middles, which print the
    // narration as the document's own content. The goods tax invoice never
    // prints it — voucher narration is internal bookkeeping text.
    const notes = v.universalVoucher?.description?.trim() || null;

    const sample: ThermalReceiptSample = {
        reference:  voucherDisplayNo(v.universalVoucher?.voucherNo, v.universalVoucherId),
        date:       voucherDate,   // 5D-10: date on spine
        partyName:  party.name ?? readPartyName(v.partyJson) ?? "Walk-in",
        partyPhone: party.phone,
        partyGstin: party.gstin,
        partyState: stateLabel(buyerStateCode),
        lines,
        subtotal:  subtotal || null,
        taxAmount: taxAmount || null,
        total,
        notes,
        taxBreakdown: goodsTax + shippingTax > 0.005
            ? (split.kind === "INTRA"
                ? { kind: "INTRA", cgst: split.cgst, sgst: split.sgst, placeOfSupplyName: stateNameForCode(buyerStateCode) }
                : { kind: "INTER", igst: split.igst, placeOfSupplyName: stateNameForCode(buyerStateCode) })
            : null,
        hsnSummary: hsnSummary.length ? hsnSummary : null,
        charges:    charges.length ? charges : null,
        roundOff:   roundOff || null,
        receipts:   paid.receipts,
        balanceDue: paid.balanceDue,
        paymentTerms: creditDays > 0 ? `Credit — ${creditDays} days` : null,
        dueDate:      creditDays > 0 ? addDaysIso(voucherDate, creditDays) : null,
        balanceBefore: paid.balanceBefore,
        balanceAfter:  paid.balanceAfter,
        branchAddress: branchAddressText(v.universalVoucher?.branch),
    };

    const vType = (v.universalVoucher?.type ?? "") as InvVoucherType;   // 5D-11
    // Challan "Show prices" off (the form's print toggle): goods + qty only,
    // every money figure dropped so no total, tax or balance can leak onto it.
    if (vType === "CHALLAN" && v.showPrices === false) {
        Object.assign(sample, {
            hidePrices: true,
            subtotal: null, taxAmount: null, total: null,
            taxBreakdown: null, hsnSummary: null, charges: null, roundOff: null,
            receipts: null, balanceDue: null, balanceBefore: null, balanceAfter: null,
            paymentTerms: null, dueDate: null,
        } satisfies Partial<ThermalReceiptSample>);
    }
    const posReturn = vType === "SALE_RETURN" && v.refVoucher?.universalVoucher?.type === "POS";
    const kind: VoucherTemplateKind = posReturn ? "POS_RETURN" : isVoucherTemplateKind(vType) ? vType : "SALE";
    // Sale bills group their items by the warranty frozen on each line, with
    // the kind's condition text per type. Older bills carry no term → no section.
    if (carriesWarranty(vType) && v.lines.some((l) => l.warrantyTerm)) {
        sample.warranty = buildWarrantyGroups(v.lines.map((l) => l.warrantyTerm), await getVoucherTemplate(kind));
    }
    return { kind, sample, docTitle: `${vType} ${voucherDisplayNo(v.universalVoucher?.voucherNo, v.universalVoucherId)}` };
}

// ── GL voucher (PAYMENT / RECEIPT / CONTRA / CREDIT_NOTE / DEBIT_NOTE / JOURNAL) ──
async function buildGlSample(id: number): Promise<VoucherReceiptData> {
    // Phase 5 5E: the spine IS the GL voucher. Lines (VoucherGlLine) and the party
    // are scalar/id-only, so account names + the party are enriched via lookups.
    const spine = await prisma.universalVoucher.findUnique({
        where: { id },
        include: {
            lines:  { orderBy: [{ type: "asc" }, { id: "asc" }] },
            branch: { select: branchAddressSelect },
        },
    });
    if (!spine) return notFoundData();

    // A Receipt / Payment prints the receipt-book slip (buildMoneySample) — except
    // cash paid to a party, which goes into their bank and prints the Bank
    // Deposit Slip with THEIR bank details (see partyDepositSlip.ts) below.
    const partyDeposit = spine.type === "PAYMENT" ? await buildPartyDepositSlip(spine) : null;
    if ((spine.type === "RECEIPT" || spine.type === "PAYMENT") && !partyDeposit) {
        return buildMoneySample(spine);
    }

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
    const printLines = v.lines.map((l) => ({ ...l, description: l.account.name }));
    const sample: ThermalReceiptSample = {
        reference:  (v.voucherNo ?? formatUvNo(v.id)),
        date:       isoDate(v.date),
        partyName:  party.name,
        partyPhone: party.phone,
        partyGstin: party.gstin,
        // Journal-style lines carry the GL side; the renderer shows a
        // Particulars · Debit · Credit table (Contra / Journal) rather than
        // "Account (Dr)" text in a qty/rate row.
        lines: printLines.map((l) => ({
            description: l.description,
            quantity:    1,
            amount:      toNumber(l.amount),
            entryType:   l.type,
        })),
        subtotal:  null,
        taxAmount: null,
        total,
        notes:     v.narration?.trim() || null,
        branchAddress: branchAddressText(v.branch),
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
            const org = getOrganisation();
            const denominations = await loadSlipDenominations();
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
            sample.depositSlip = {
                mode:        "handover",
                bankName: null, branch: null, accountName: null, accountNo: null, ifsc: null, pan: null,
                fromLedger,
                toLedger,
                denominations: await loadSlipDenominations(),
                counted:     countedFromDenom,
            };
        }
    }

    // PAYMENT in cash to a party with an A/C No on file — the cash goes into the
    // party's own bank, so it prints the same Bank Deposit Slip with THEIR bank
    // details (see partyDepositSlip.ts). The slip total is the cash side.
    if (partyDeposit) {
        sample.depositSlip = partyDeposit.slip;
        sample.total = partyDeposit.amount;
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

// ── Money voucher (RECEIPT / PAYMENT) — the receipt-book slip ────────────────
//
// Every way a receipt or payment prints comes here: the form's "Print after
// save", the Day Book / ledger menus, POS Rcv (a RECEIPT) and Exp (a PAYMENT),
// the overpayment RV-… a POS sale books, and every silent thermal print. It
// used to be two builders — one had the party balance, the other the UPI /
// cheque details — so the same receipt printed differently by button. The
// look is the Receipt / Payment print template's: this only fills its blanks,
// and each one prints only where the template switches it on.
async function buildMoneySample(
    spine: Prisma.UniversalVoucherGetPayload<{ include: { lines: true; branch: { select: typeof branchAddressSelect } } }>,
): Promise<VoucherReceiptData> {
    const isReceipt = spine.type === "RECEIPT";
    const acctIds = [...new Set([...(spine.partyAccountId != null ? [spine.partyAccountId] : []), ...spine.lines.map((l) => l.accountId)])];
    const [accounts, ledgerBalance] = await Promise.all([
        prisma.account.findMany({
            where:  { id: { in: acctIds } },
            select: {
                id: true, name: true,
                person:  { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
                company: { select: { name: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
            },
        }),
        // Party's running account before / after — the same reader the Sale and
        // POS bills print from. Null for a walk-in (no ledger).
        partyBalanceAroundVoucher(spine.partyAccountId, spine.id),
    ]);
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    const nameOf   = (accountId: number) => acctById.get(accountId)?.name ?? "—";

    // The money side. RECEIPT: the debit ledgers (till / UPI / card the cash
    // landed in). PAYMENT: the credit ledgers it left from. A POS
    // "collect-on-the-go" surplus posts ONE receipt with several tenders, so list
    // them all — this voucher is where the tender breakdown lives.
    const moneySide   = isReceipt ? "DEBIT" : "CREDIT";
    const tenderLines = spine.lines.filter((l) => l.type === moneySide);
    // The instrument (UPI ref, cheque no.) is entered on each particulars row —
    // one party by UPI, the next by cheque — and printed on the "By:" line:
    // "HDFC Bank · UPI (4532…), Cheque (IN955468)". Only onto a single money
    // ledger: with several (a POS split tender) there is no telling which
    // tender a row's instrument went through, and those rows carry none.
    const instruments = spine.lines
        .filter((l) => l.type !== moneySide)
        .map((l) => paymentInstrumentText(l.method, l.reference))
        .filter(Boolean)
        .join(", ");
    const tenderText = (name: string) =>
        instruments && tenderLines.length === 1 ? `${name} · ${instruments}` : name;

    // RECEIPT: FROM the party (else the first credit ledger). PAYMENT: TO the
    // party — a supplier's name beats the expense-ledger name — else the first
    // debit ledger (a counter Exp names only its expense head).
    const partyAccount = spine.partyAccountId != null ? acctById.get(spine.partyAccountId) ?? null : null;
    const owner        = partyAccount?.person ?? partyAccount?.company ?? null;
    const partyName    = owner?.name ?? partyAccount?.name ?? null;
    const otherSide    = spine.lines.find((l) => l.type !== moneySide);
    const reference    = spine.voucherNo ?? formatUvNo(spine.id);

    // Both formats render their built-in money middles from this sample (A4:
    // MoneyReceiptMiddle; thermal: MoneyThermalMiddle; the bridge: printMoneyMiddle).
    const sample: ThermalReceiptSample = {
        reference,
        // `date` is a DATE column — there is no time of day to print (formatting
        // it with one printed a made-up 05:30).
        date:       isoDate(spine.date),
        partyName:  partyName ?? (otherSide ? nameOf(otherSide.accountId) : "—"),
        partyPhone: isReceipt ? owner?.phones[0]?.phone ?? null : null,
        lines:      tenderLines.map((l) => ({ description: tenderText(nameOf(l.accountId)), quantity: 1, amount: toNumber(l.amount) })),
        subtotal:   null,
        taxAmount:  null,
        total:      spine.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + toNumber(l.amount), 0),
        notes:      spine.narration?.trim() || null,
        balanceBefore: ledgerBalance ? ledgerBalance.format(ledgerBalance.before) : null,
        balanceAfter:  ledgerBalance ? ledgerBalance.format(ledgerBalance.after)  : null,
        branchAddress: branchAddressText(spine.branch),
    };

    return { kind: isReceipt ? "RECEIPT" : "PAYMENT", sample, docTitle: `${isReceipt ? "Receipt" : "Payment"} ${reference}` };
}

// ── Journal entry (GL spine row) ────────────────────────────────────────────
async function buildJeSample(id: number): Promise<VoucherReceiptData> {
    const v = await prisma.universalVoucher.findUnique({
        where: { id },
        include: { lines: true, branch: { select: branchAddressSelect } },
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
        branchAddress: branchAddressText(v.branch),
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

/** The bridge `print/voucher` payload — `{ kind, title, sample, template }`. */
export interface VoucherBridgePayload {
    kind:     VoucherTemplateKind;
    title:    string;
    sample:   ThermalReceiptSample;
    /** Thermal-resolved, so the slip obeys the template's Thermal column. */
    template: VoucherTemplateDefaults;
}

/**
 * The silent-thermal print of any Day-Book voucher — the same sample the print
 * page renders, with the kind's template resolved for the 80mm roll. Shared by
 * `/api/print/thermal/[source]/[id]` and the POS sale response (its overpayment
 * RV-…), so a slip printed silently and one printed from the page are one slip.
 */
export async function buildVoucherBridgePayload(
    source: VoucherReceiptSource,
    id: number,
): Promise<VoucherBridgePayload | null> {
    const data = await buildVoucherReceiptSample(source, id);
    if (!data) return null;
    return { kind: data.kind, title: data.docTitle, sample: data.sample, template: await getThermalTemplate(data.kind) };
}
