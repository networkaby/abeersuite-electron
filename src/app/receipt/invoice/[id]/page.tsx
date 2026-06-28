import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import ThermalAutoPrint from "@/modules/pos/components/ThermalAutoPrint";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample, ThermalTaxBreakdown } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { isVoucherTemplateKind } from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { computeGstSplit } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode, isValidStateCode } from "@/shared/lib/gst/indianStates";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";

// Resolves the id as an InvVoucher (the new shape, used by POS sales since
// the Invoice→InvVoucher consolidation on 2026-05-24). The URL path keeps
// `/receipt/invoice/...` for back-compat with bookmarked links and the
// thermal-print fallback in PosScreen.
export default async function PosReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ kind?: string; paper?: string; placeOfSupply?: string }>;
}) {
    const { id } = await params;
    const sp = (await searchParams) ?? {};

    // ?kind=POS for counter sales, everything else defaults to SALE.
    const kindParam = sp.kind ?? "SALE";
    const kind = isVoucherTemplateKind(kindParam) ? kindParam : "SALE";

    // ?placeOfSupply=NN — buyer's 2-char state code. The caller computes this
    // from the voucher's `placeOfSupply` column when launching the receipt;
    // POS sales pass the branch state. Anything else falls back to org state
    // → intra-state → single "Tax" row (legacy behaviour).
    const placeOfSupplyParam = (sp.placeOfSupply ?? "").trim();

    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: Number(id) },
        include: { universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true } } },   // 5D-4 party + 5D-6 ref + 5D-10 date
    });
    if (!voucherRow) notFound();
    // Phase 5 5C: goods lines hang off the spine.
    const invLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
        include: { product: { select: { sku: true, name: true } } },
    });
    // 5D-4: resolve the party ledger from the spine's partyAccountId.
    const account = voucherRow.universalVoucher?.partyAccountId != null
        ? await prisma.account.findUnique({
            where:  { id: voucherRow.universalVoucher.partyAccountId },
            select: {
                id: true, name: true,
                person:  { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
                company: { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
            },
        })
        : null;
    const voucher = { ...voucherRow, lines: invLines, account };

    // G4b: additional-charge rows come from settlementJson (with account names).
    const settlement = readSettlement(voucher.settlementJson);
    const chargeAcctById = new Map(
        (settlement.charges.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: [...new Set(settlement.charges.map((c) => c.accountId))] } }, select: { id: true, name: true } }))
            .map((a) => [a.id, a]),
    );
    const charges = settlement.charges.map((c) => ({ ...c, account: chargeAcctById.get(c.accountId) ?? null }));

    const owner = voucher.account?.person ?? voucher.account?.company ?? null;
    const partyName  = owner?.name ?? voucher.account?.name ?? readPartyName(voucher.partyJson) ?? "Walk-in";
    const partyPhone = owner?.phones[0]?.phone ?? null;
    const partyGstin = owner?.gstin ?? null;   // B2B tax invoice prints the buyer GSTIN

    // Customer receipt shows the clean product name. POS bakes an internal
    // "<sku> — <name>" prefix into the stored line description; strip the SKU so
    // the customer sees just the product (keeping any "· note" the cashier added).
    const lineName = (l: (typeof voucher.lines)[number]): string => {
        const desc = (l.description ?? "").trim();
        const sku  = l.product?.sku;
        if (sku && desc.startsWith(`${sku} — `)) return desc.slice(sku.length + 3);
        return desc || l.product?.name || "";
    };

    const [template, org, loyaltyConfig, couponConfig, taxByProduct, spendTiers] = await Promise.all([
        getVoucherTemplate(kind),
        getOrganisation(),
        prisma.loyaltyConfig.findUnique({ where: { id: 1 }, select: { redeemExpenseAccountId: true } }),
        prisma.couponConfig.findUnique({ where: { id: 1 }, select: { couponExpenseAccountId: true } }),
        // HSN per line product → feeds the HSN/rate-wise tax summary.
        resolveProductTaxBatch({ productIds: voucher.lines.map((l) => l.productId) })
            .then((r) => r.products),
        // Spend tiers → resolve the level NAME from the voucher's discount % for
        // the "Level Discount (Name)" row.
        prisma.customerTier.findMany({ where: { enabled: true }, select: { name: true, discountPct: true } }),
    ]);
    // ?paper= override wins; otherwise the kind's stored default.
    const format = resolvePaperFormat(template, sp.paper);

    // Compute CGST/SGST/IGST split for the totals box. Only when a valid
    // place-of-supply was passed; otherwise we render the legacy single
    // "Tax" row (caller didn't compute it — could be a non-GST voucher
    // or a stale call).
    const sellerStateCode = (org.gstStateCode || "").trim();
    let taxBreakdown: ThermalTaxBreakdown | null = null;
    const taxAmt = Number(voucher.taxAmount);
    if (taxAmt > 0 && placeOfSupplyParam && isValidStateCode(placeOfSupplyParam) && sellerStateCode) {
        const split = computeGstSplit({
            taxAmount:       taxAmt,
            sellerStateCode,
            buyerStateCode:  placeOfSupplyParam,
        });
        const placeOfSupplyName = stateNameForCode(placeOfSupplyParam);
        taxBreakdown = split.kind === "INTRA"
            ? { kind: "INTRA", cgst: split.cgst, sgst: split.sgst, placeOfSupplyName }
            : { kind: "INTER", igst: split.igst, placeOfSupplyName };
    }

    // ── Customer-facing "Today's discount" price ladder (POS / SALE only) ─────
    // Display-only — derived from the real voucher (per-line mrp/barcode snapshot
    // + the tier discount + the loyalty/coupon charges). The per-item real price
    // stays internal; the bill pools every reduction so a multi-item receipt
    // doesn't reveal it. Built only when there's actual ladder data, so plain
    // invoices and non-sale vouchers render exactly as before.
    //
    // POS ONLY: the price-hiding ladder is a counter-receipt device. A formal
    // SALE invoice (often B2B, with the buyer's GSTIN) must show the REAL
    // per-line price + tax for the buyer's ITC — so SALE renders the normal
    // invoice, not the ladder.
    const isSaleKind = kind === "POS";
    const tierDiscount = Number(voucher.discountAmt ?? 0);
    let loyaltyDiscount = 0, couponDiscount = 0;
    let loyaltyLabel: string | undefined, couponLabel: string | undefined;
    // Bill-level adjustments (everything that isn't a goods discount): shipping,
    // round-off and any manual charge. Signed: + adds, − reduces.
    const extraCharges: { label: string; amount: number }[] = [];
    for (const c of charges) {
        const amt = Number(c.amount);
        if (amt < 0 && loyaltyConfig?.redeemExpenseAccountId && c.accountId === loyaltyConfig.redeemExpenseAccountId) {
            loyaltyDiscount += Math.abs(amt);
            loyaltyLabel = c.description?.trim() || "Loyalty";
        } else if (amt < 0 && couponConfig?.couponExpenseAccountId && c.accountId === couponConfig.couponExpenseAccountId) {
            couponDiscount += Math.abs(amt);
            couponLabel = c.description?.trim() || "Coupon";
        } else if (Math.abs(amt) > 0.005) {
            // Manual charge / discount — keep its sign and label.
            extraCharges.push({ label: c.description?.trim() || c.account?.name || "Charge", amount: amt });
        }
    }
    const shippingAmt = Number(voucher.shippingAmt ?? 0);
    const roundOff    = Number(voucher.roundOff ?? 0);
    if (shippingAmt > 0.005) extraCharges.push({ label: "Shipping", amount: shippingAmt });
    if (Math.abs(roundOff) > 0.005) extraCharges.push({ label: "Round-off", amount: roundOff });

    // Resolve the spend-tier NAME from the voucher's discount % → "Level Discount (Silver)".
    const vDiscPct  = Number(voucher.discountPct ?? 0);
    const tierName  = vDiscPct > 0 ? spendTiers.find((t) => Number(t.discountPct) === vDiscPct)?.name : undefined;
    const tierLabel = tierDiscount > 0.005
        ? `Level Discount${tierName ? ` (${tierName})` : vDiscPct > 0 ? ` (${vDiscPct}%)` : ""}`
        : undefined;

    const hasLadderData = isSaleKind && (
        voucher.lines.some((l) => l.mrpPaise != null || l.savedSalePricePaise != null) ||
        tierDiscount > 0.005 || loyaltyDiscount > 0.005 || couponDiscount > 0.005 || extraCharges.length > 0
    );

    const ladder = hasLadderData
        ? computePriceLadder(
            {
                lines: voucher.lines.map((l) => ({
                    description: lineName(l),
                    qty:         Number(l.quantity),
                    mrpPaise:    l.mrpPaise,
                    barcodePaise: l.savedSalePricePaise,
                    taxRatePct:  Number(l.taxRate),
                    taxAmount:   Number(l.taxAmount),
                    amount:      Number(l.amount),
                    hsnCode:     taxByProduct.get(l.productId)?.hsnCode ?? null,
                })),
                tierDiscount,
                loyaltyDiscount,
                couponDiscount,
                extraCharges,
                total: Number(voucher.totalAmount),
            },
            {
                tier:    tierLabel,
                loyalty: loyaltyLabel,
                coupon:  couponLabel,
            },
        )
        : null;

    // NOTE: when this POS sale was overpaid, the money (tenders) + how it was
    // applied (old dues / advance) live on the separate Receipt voucher (RV-…,
    // printed via /receipt/payment/[id]) — NOT on this invoice. The invoice stays
    // a clean record of the sale at the bill amount.
    const sample: ThermalReceiptSample = {
        reference:  voucher.universalVoucher?.voucherNo ?? "",
        date:       voucher.universalVoucher!.date.toISOString().slice(0, 10),   // 5D-10: date on spine
        partyName,
        partyPhone,
        partyGstin,
        lines: voucher.lines.map((l, i) => {
            const lad = ladder?.lines[i];
            const eff = Number(l.amount);
            return {
                description: lineName(l),
                quantity:    Number(l.quantity),
                // Ladder mode shows the gross-at-tag (barcode) amount; falls back
                // to the charged amount when no barcode was snapshotted.
                amount:      lad?.barcode ?? eff,
                mrp:         lad?.mrp ?? null,
                barcode:     lad?.barcode ?? null,
            };
        }),
        subtotal:  Number(voucher.subtotal),
        taxAmount: taxAmt,
        total:     Number(voucher.totalAmount),
        notes:     null,
        taxBreakdown,
        discounts: ladder
            ? {
                grossAtTag:   ladder.barcodeTotal,
                rows:         ladder.discounts.map((d) => ({ label: d.label, amount: d.amount })),
                charges:      ladder.charges.map((c) => ({ label: c.label, amount: c.amount })),
                total:        ladder.todaysDiscountTotal,
                savingsTotal: ladder.savingsTotal,
                savingsPct:   ladder.savingsPct,
            }
            : null,
        hsnSummary: ladder?.hsn ?? null,
    };

    // Relay payload for the thermal bridge (/print/pos) — same shape PosScreen
    // sends at sale time, so a reprint matches the original slip. Only built for
    // POS (the ladder surface); SALE invoices print in the browser.
    const posRelayPayload = isSaleKind ? {
        invoiceNumber:  voucher.universalVoucher?.voucherNo ?? "",
        date:           voucher.universalVoucher!.date.toISOString(),   // 5D-10: date on spine
        customerName:   partyName,
        customerGstin:  partyGstin,
        template,
        lines: voucher.lines.map((l, i) => {
            const lad = ladder?.lines[i];
            const qty = Number(l.quantity);
            const rate = Number(l.rate);
            return {
                name:      lineName(l),
                qty,
                unitPrice: rate,
                amount:    qty * rate,
                mrp:       lad?.mrp != null && qty ? lad.mrp / qty : null,
                barcode:   lad?.barcode != null && qty ? lad.barcode / qty : null,
            };
        }),
        subtotal:       Number(voucher.subtotal),
        discountPct:    Number(voucher.discountPct ?? 0),
        discountAmount: Number(voucher.discountAmt ?? 0),
        tax:            taxAmt,
        total:          Number(voucher.totalAmount),
        grossAtTag:     ladder?.barcodeTotal ?? null,
        discounts:      ladder ? ladder.discounts.map((d) => ({ label: d.label, amount: d.amount })) : [],
        charges:        ladder ? ladder.charges.map((c) => ({ label: c.label, amount: c.amount })) : [],
        savings:        ladder && ladder.savingsTotal > 0 ? { amount: ladder.savingsTotal, pct: ladder.savingsPct } : null,
        hsnSummary:     ladder?.hsn ?? null,
    } : null;

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            toolbar={posRelayPayload
                ? <ThermalAutoPrint endpoint="/print/pos" payload={posRelayPayload} />
                : <ReceiptButtons />}
            docTitle={`Invoice ${voucher.universalVoucher?.voucherNo ?? ""}`}
        />
    );
}
