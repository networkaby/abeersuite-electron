import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { getPortalAccountOptions } from "@/shared/lib/auth/portalAccountContext";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample, ThermalTaxBreakdown } from "@/shared/components/print/ThermalReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { formatStructuredAddressBlock } from "@/shared/lib/org/organisationView";
import { computeGstSplit } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode, isValidStateCode } from "@/shared/lib/gst/indianStates";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { round2 } from "@/shared/lib/format";

// ── Customer bill view for online orders ─────────────────────────────────────
// Portal-session-scoped invoice view that verifies customer ownership of the
// order before rendering the printable invoice using the shared template print
// components (ReceiptPreview + PrintToolbar).

export default async function PortalOrderBillPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    const { id } = await params;
    const sp = (await searchParams) ?? {};

    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect(`/login?callbackUrl=/portal/orders/${id}/bill`);
    }

    const accountOptions = await getPortalAccountOptions(customerId);
    const allowedAccountIds = new Set(accountOptions.map((o) => o.accountId));

    const ticket = await prisma.ticket.findUnique({
        where: { id: Number(id) },
        include: { order: true },
    });
    if (!ticket || !ticket.order) notFound();

    const isOwner =
        ticket.order.personId === customerId ||
        (ticket.accountId != null && allowedAccountIds.has(ticket.accountId));
    if (!isOwner) notFound();

    // Locate linked posted invoice for this shop order
    const invLink = await prisma.voucherLink.findFirst({
        where: { kind: "SHOP_ORDER", targetId: String(ticket.id) },
        select: { universalVoucherId: true },
    });
    if (!invLink) notFound();

    const spine = await prisma.universalVoucher.findUnique({
        where: {
            id: invLink.universalVoucherId,
            status: "POSTED",
            deletedAt: null,
        },
        include: {
            voucherDetail: true,
            branch: { select: { addressLine1: true, addressLine2: true, city: true, state: true, pinCode: true } },
        },
    });
    if (!spine?.voucherDetail) notFound();

    const voucherRow = { ...spine.voucherDetail, universalVoucher: spine };

    const invLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: spine.id },
        include: { product: { select: { sku: true, name: true } } },
    });

    const account = spine.partyAccountId != null
        ? await prisma.account.findUnique({
            where:  { id: spine.partyAccountId },
            select: {
                id: true, name: true,
                person:  { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
                company: { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" as const }] } } },
            },
        })
        : null;

    const voucher = { ...voucherRow, lines: invLines, account };

    const settlement = readSettlement(voucher.settlementJson);
    const chargeAcctById = new Map(
        (settlement.charges.length === 0
            ? []
            : await prisma.account.findMany({
                  where: { id: { in: [...new Set(settlement.charges.map((c) => c.accountId))] } },
                  select: { id: true, name: true },
              })
        ).map((a) => [a.id, a]),
    );
    const charges = settlement.charges.map((c) => ({
        ...c,
        account: chargeAcctById.get(c.accountId) ?? null,
    }));

    const owner = voucher.account?.person ?? voucher.account?.company ?? null;
    const partyName  = owner?.name ?? voucher.account?.name ?? readPartyName(voucher.partyJson) ?? "Customer";
    const partyPhone = owner?.phones[0]?.phone ?? null;
    const partyGstin = owner?.gstin ?? null;

    const lineName = (l: (typeof voucher.lines)[number]): string => {
        const desc = (l.description ?? "").trim();
        const sku  = l.product?.sku;
        if (sku && desc.startsWith(`${sku} — `)) return desc.slice(sku.length + 3);
        return desc || l.product?.name || "";
    };

    const [template, org, loyaltyConfig, couponConfig, taxByProduct, spendTiers] = await Promise.all([
        getVoucherTemplate("ONLINE_INVOICE"),
        getOrganisation(),
        prisma.loyaltyConfig.findUnique({ where: { id: 1 }, select: { redeemExpenseAccountId: true } }),
        prisma.couponConfig.findUnique({ where: { id: 1 }, select: { couponExpenseAccountId: true } }),
        resolveProductTaxBatch({ productIds: voucher.lines.map((l) => l.productId) }).then((r) => r.products),
        prisma.customerTier.findMany({ where: { enabled: true }, select: { name: true, discountPct: true } }),
    ]);

    const format = resolvePaperFormat(template, sp.paper);
    const placeOfSupplyParam = (voucher.placeOfSupply ?? "").trim();

    const sellerStateCode = (org.gstStateCode || "").trim();
    let taxBreakdown: ThermalTaxBreakdown | null = null;
    const chargesTax = settlement.charges.reduce((s, c) => s + Math.max(0, Number(c.taxAmount ?? 0)), 0);
    const taxAmt = Number(voucher.taxAmount) + chargesTax + Number(voucher.shippingTaxAmt ?? 0);
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

    const vDiscPct  = Number(voucher.discountPct ?? 0);
    const tierName  = vDiscPct > 0 ? spendTiers.find((t) => Number(t.discountPct) === vDiscPct)?.name : undefined;
    const synthTierPct = grossGoodsIncl > 0.005 ? round2((tierDiscount / grossGoodsIncl) * 100) : 0;
    const tierLabel = tierDiscount > 0.005
        ? `Level Discount${(() => {
            const parts = [tierName, synthTierPct > 0 ? `${synthTierPct}%` : ""].filter(Boolean);
            return parts.length ? ` (${parts.join(" · ")})` : "";
        })()}`
        : undefined;

    const hasLadderData = (
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

    const sample: ThermalReceiptSample = {
        reference:  voucher.universalVoucher?.voucherNo ?? "",
        date:       voucher.universalVoucher!.date.toISOString().slice(0, 10),
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

    const autoPrint = sp.autoprint !== "0";

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            toolbar={
                <PrintToolbar
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`Invoice ${voucher.universalVoucher?.voucherNo ?? ""}`}
        />
    );
}
