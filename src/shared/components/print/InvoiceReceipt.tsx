import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample, ThermalTaxBreakdown } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { isVoucherTemplateKind, resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { formatStructuredAddressBlock } from "@/shared/lib/org/organisationView";
import { computeGstSplit } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode, isValidStateCode } from "@/shared/lib/gst/indianStates";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { round2 } from "@/shared/lib/format";

// Shared invoice-print body for InvVoucher-shaped sales. Extracted so both
// the staff print surface (`/receipt/invoice/[id]`, any voucher, full paper/
// autoprint controls) and the customer bill view (`/portal/orders/[id]/bill`,
// ownership-checked, always A4/ONLINE_INVOICE) render from one place — the
// two callers differ only in WHO may reach this component and WHICH params
// they're allowed to pass, not in how the receipt itself is built.
export default async function InvoiceReceipt({
    id,
    kindParam = "SALE",
    placeOfSupplyParam = "",
    paper,
    autoprint,
}: {
    id: string;
    kindParam?: string;
    placeOfSupplyParam?: string;
    paper?: string;
    autoprint?: string;
}) {
    // ?kind=POS for counter sales, everything else defaults to SALE.
    const kind = isVoucherTemplateKind(kindParam) ? kindParam : "SALE";

    // ?placeOfSupply=NN — buyer's 2-char state code. The caller computes this
    // from the voucher's `placeOfSupply` column when launching the receipt;
    // POS sales pass the branch state. Anything else falls back to org state
    // → intra-state → single "Tax" row (legacy behaviour).
    const placeOfSupplyClean = placeOfSupplyParam.trim();

    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: Number(id) },
        include: { universalVoucher: { select: {
            partyAccountId: true, voucherNo: true, date: true,   // 5D-4 party + 5D-6 ref + 5D-10 date
            // Issuing branch — its address is printed when the template's
            // `showBranchAddress` flag is on (branch invoices in another GST state).
            branch: { select: { addressLine1: true, addressLine2: true, city: true, state: true, pinCode: true } },
        } } },
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
    const format = resolvePaperFormat(template, paper);

    // Compute CGST/SGST/IGST split for the totals box. Only when a valid
    // place-of-supply was passed; otherwise we render the legacy single
    // "Tax" row (caller didn't compute it — could be a non-GST voucher
    // or a stale call).
    const sellerStateCode = (org.gstStateCode || "").trim();
    let taxBreakdown: ThermalTaxBreakdown | null = null;
    // Printed GST = line tax + GST on tax-bearing charge rows (POS services)
    // + GST embedded in the (inclusive) shipping charge — the same pool the
    // GL splits onto the CGST/SGST/IGST legs, so the printed tax box always
    // matches the books.
    const chargesTax = settlement.charges.reduce((s, c) => s + Math.max(0, Number(c.taxAmount ?? 0)), 0);
    const taxAmt = Number(voucher.taxAmount) + chargesTax + Number(voucher.shippingTaxAmt ?? 0);
    if (taxAmt > 0 && placeOfSupplyClean && isValidStateCode(placeOfSupplyClean) && sellerStateCode) {
        const split = computeGstSplit({
            taxAmount:       taxAmt,
            sellerStateCode,
            buyerStateCode:  placeOfSupplyClean,
        });
        const placeOfSupplyName = stateNameForCode(placeOfSupplyClean);
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
    // POS + ONLINE_INVOICE ONLY: the price-hiding ladder is a customer-receipt
    // device (counter slip / parcel insert — the online invoice prints the same
    // ladder as the POS sale). A formal SALE invoice (often B2B, with the
    // buyer's GSTIN) must show the REAL per-line price + tax for the buyer's
    // ITC — so SALE renders the normal invoice, not the ladder.
    const isSaleKind = kind === "POS" || kind === "ONLINE_INVOICE";
    // The spend-tier discount now lives on the goods lines (line.amount is NET). To
    // show it as its own "Level discount" row the ladder needs the GROSS (pre-tier)
    // line amounts + the tier as a bill-level figure — the exact inputs it took when
    // the discount was voucher-level, so its reconciliation is unchanged. Reconstruct
    // the gross incl amount (qty × rate × (1 + gst)) and derive the tier = gross − net.
    // A free-grant line stores quantity 0 + freeQty — the receipt prints the
    // granted count ("1 × Fanta" at ₹0.00), and the gross is ₹0 either way.
    const lineQty = (l: (typeof voucher.lines)[number]): number => {
        const qty = Number(l.quantity);
        const freeQty = Number(l.freeQty ?? 0);
        return qty === 0 && freeQty > 0 ? freeQty : qty;
    };
    const lineGrossIncl = (l: (typeof voucher.lines)[number]): number =>
        lineQty(l) * Number(l.rate) * (1 + Number(l.taxRate) / 100);
    const grossGoodsIncl = voucher.lines.reduce((s, l) => s + lineGrossIncl(l), 0);
    const tierDiscount = voucher.lines.reduce((s, l) => s + Math.max(0, lineGrossIncl(l) - Number(l.amount)), 0);
    let loyaltyDiscount = 0, couponDiscount = 0;
    let loyaltyLabel: string | undefined, couponLabel: string | undefined;
    // Bill-level adjustments (everything that isn't a goods discount): shipping,
    // round-off and any manual charge. Signed: + adds, − reduces.
    const extraCharges: { label: string; amount: number; taxAmount?: number }[] = [];
    for (const c of charges) {
        const amt = Number(c.amount);
        if (amt < 0 && loyaltyConfig?.redeemExpenseAccountId && c.accountId === loyaltyConfig.redeemExpenseAccountId) {
            loyaltyDiscount += Math.abs(amt);
            loyaltyLabel = c.description?.trim() || "Loyalty";
        } else if (amt < 0 && couponConfig?.couponExpenseAccountId && c.accountId === couponConfig.couponExpenseAccountId) {
            couponDiscount += Math.abs(amt);
            couponLabel = c.description?.trim() || "Coupon";
        } else if (Math.abs(amt) > 0.005) {
            // Manual charge / discount — keep its sign and label. A tax-bearing
            // charge (POS service) carries its own GST, same as shipping below.
            extraCharges.push({
                label: c.description?.trim() || c.account?.name || "Charge",
                amount: amt,
                taxAmount: c.taxAmount != null ? Math.max(0, Number(c.taxAmount)) : undefined,
            });
        }
    }
    const shippingAmt = Number(voucher.shippingAmt ?? 0);
    const roundOff    = Number(voucher.roundOff ?? 0);
    if (shippingAmt > 0.005) extraCharges.push({ label: "Shipping", amount: shippingAmt, taxAmount: Number(voucher.shippingTaxAmt ?? 0) });
    if (Math.abs(roundOff) > 0.005) extraCharges.push({ label: "Round-off", amount: roundOff });

    // Resolve the spend-tier NAME from the voucher's configured discount % (the record
    // key), but SHOW the synthetic % — the discount as a share of the tag the customer
    // sees. The configured "% of cost" never appears on the customer receipt.
    const vDiscPct  = Number(voucher.discountPct ?? 0);
    const tierName  = vDiscPct > 0 ? spendTiers.find((t) => Number(t.discountPct) === vDiscPct)?.name : undefined;
    const synthTierPct = grossGoodsIncl > 0.005 ? round2((tierDiscount / grossGoodsIncl) * 100) : 0;
    const tierLabel = tierDiscount > 0.005
        ? `Level Discount${(() => {
            const parts = [tierName, synthTierPct > 0 ? `${synthTierPct}%` : ""].filter(Boolean);
            return parts.length ? ` (${parts.join(" · ")})` : "";
        })()}`
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
                    qty:         lineQty(l),
                    mrpPaise:    l.mrpPaise,
                    barcodePaise: l.savedSalePricePaise,
                    taxRatePct:  Number(l.taxRate),
                    taxAmount:   Number(l.taxAmount),
                    // GROSS (pre-tier) inclusive amount so the ladder breaks the tier
                    // out as its own row (goodsPaid = gross − tier − loyalty − coupon
                    // reconciles to the net the line already stores). Free lines are
                    // ₹0 by design — the ladder shows them as the given-away gift.
                    amount:      lineGrossIncl(l),
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
            const freeQty = Number(l.freeQty ?? 0);
            const isFreeLine = Number(l.quantity) === 0 && freeQty > 0;
            return {
                description: lineName(l),
                quantity:    isFreeLine ? freeQty : Number(l.quantity),
                // Ladder mode shows the gross-at-tag (barcode) amount; falls back
                // to the charged amount when no barcode was snapshotted. Free
                // lines print the granted count at ₹0.00.
                amount:      isFreeLine ? 0 : (lad?.barcode ?? eff),
                mrp:         isFreeLine ? null : (lad?.mrp ?? null),
                barcode:     isFreeLine ? null : (lad?.barcode ?? null),
            };
        }),
        subtotal:  Number(voucher.subtotal),
        taxAmount: taxAmt,
        total:     Number(voucher.totalAmount),
        notes:     null,
        taxBreakdown,
        branchAddress: voucher.universalVoucher?.branch
            ? formatStructuredAddressBlock(voucher.universalVoucher.branch) || null
            : null,
        discounts: ladder
            ? {
                grossAtTag:   ladder.barcodeTotal,
                rows:         ladder.discounts.map((d) => ({ label: d.label, amount: d.amount })),
                charges:      ladder.charges.map((c) => ({ label: c.label, amount: c.amount })),
                total:        ladder.todaysDiscountTotal,
                savingsTotal: ladder.savingsTotal,
                savingsPct:   ladder.savingsPct,
                taxTotal:     ladder.taxTotal,
              }
            : null,
        hsnSummary: ladder?.hsn ?? null,
        charges: extraCharges.length > 0
            ? extraCharges.map((c) => {
                const amt = Number(c.amount);
                const tax = Math.max(0, Number(c.taxAmount ?? 0));
                const taxable = amt - tax;
                const rate = taxable > 0.005 ? round2((tax / taxable) * 100) : 0;
                return { label: c.label, amount: amt, taxAmount: tax, taxRate: rate };
              })
            : null,
    };

    // Relay payload for the thermal bridge (/print/pos) — same shape PosScreen
    // sends at sale time, so a reprint matches the original slip. Only built for
    // POS (the ladder surface); SALE invoices print in the browser.
    const posRelayPayload = isSaleKind ? {
        invoiceNumber:  voucher.universalVoucher?.voucherNo ?? "",
        date:           voucher.universalVoucher!.date.toISOString(),   // 5D-10: date on spine
        customerName:   partyName,
        customerGstin:  partyGstin,
        // Thermal-resolved template rides along so the bridge has the shop's
        // current config (logo/header/GSTIN toggles) on every job.
        template:       resolveTemplateForFormat(template, "THERMAL_80MM"),
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
        // Tier discount is per-line now; expose the reconstructed inclusive total for
        // relays that read this flat field (the ladder `discounts` array is canonical).
        discountAmount: round2(tierDiscount),
        tax:            taxAmt,
        total:          Number(voucher.totalAmount),
        grossAtTag:     ladder?.barcodeTotal ?? null,
        discounts:      ladder ? ladder.discounts.map((d) => ({ label: d.label, amount: d.amount })) : [],
        charges:        ladder ? ladder.charges.map((c) => ({ label: c.label, amount: c.amount })) : [],
        savings:        ladder && ladder.savingsTotal > 0 ? { amount: ladder.savingsTotal, pct: ladder.savingsPct } : null,
        hsnSummary:     ladder?.hsn ?? null,
    } : null;

    // Print rule: POS counter slips fire the combined bridge first (browser
    // fallback), everything else prints in the browser; both offer the A4 /
    // thermal picker so each format renders its own template. `?autoprint=0`
    // (set by a format switch) suppresses the auto-fire.
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = autoprint !== "0";

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            toolbar={
                <PrintToolbar
                    bridge={posRelayPayload && isThermal && autoPrint
                        ? { endpoint: "/print/pos", payload: posRelayPayload }
                        : undefined}
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`Invoice ${voucher.universalVoucher?.voucherNo ?? ""}`}
        />
    );
}
