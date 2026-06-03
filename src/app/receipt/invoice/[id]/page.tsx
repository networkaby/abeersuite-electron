import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
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

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { product: { select: { sku: true, name: true } } } },
            charges: { include: { account: { select: { id: true, name: true } } } },
            account: {
                select: {
                    id: true,
                    name: true,
                    person:  { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
                    company: { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
                },
            },
        },
    });
    if (!voucher) notFound();

    const owner = voucher.account?.person ?? voucher.account?.company ?? null;
    const partyName  = owner?.name ?? voucher.account?.name ?? voucher.partyName ?? "Walk-in";
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
    for (const c of voucher.charges) {
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
        reference:  voucher.reference,
        date:       voucher.date.toISOString().slice(0, 10),
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

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            toolbar={<ReceiptButtons />}
            docTitle={`Invoice ${voucher.reference}`}
        />
    );
}
