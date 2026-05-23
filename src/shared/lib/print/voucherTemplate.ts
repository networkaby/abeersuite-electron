import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    buildVoucherTemplateDefaults,
    isVoucherTemplateKind,
    isPaperFormat,
    type PaperFormat,
    type VoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";

/**
 * Server-side helper used by the receipt routes. Reads the per-kind row;
 * falls back to the canonical defaults if either the row is missing (DB
 * not yet seeded for this kind) or the caller passed a kind that isn't in
 * our enum (defensive — keeps the receipt rendering instead of 500-ing).
 */
export async function getVoucherTemplate(kind: string): Promise<VoucherTemplateDefaults> {
    if (!isVoucherTemplateKind(kind)) {
        // Render *something* — pick SALE as a safe generic.
        return buildVoucherTemplateDefaults("SALE");
    }
    const row = await prisma.voucherPrintTemplate.findUnique({ where: { kind } });
    if (!row) return buildVoucherTemplateDefaults(kind);
    const fallback = buildVoucherTemplateDefaults(kind);
    return {
        kind,
        headerLine1:    row.headerLine1,
        headerLine2:    row.headerLine2,
        addressBlock:   row.addressBlock,
        gstinLine:      row.gstinLine,
        phoneLine:      row.phoneLine,
        logoUrl:        row.logoUrl,
        showLogo:       row.showLogo,
        showAddress:    row.showAddress,
        showGstin:      row.showGstin,
        showPhone:      row.showPhone,
        showTaxSummary: row.showTaxSummary,
        showSignature:  row.showSignature,
        showQrCode:     row.showQrCode,
        termsText:      row.termsText,
        footerLine:     row.footerLine,
        signatureLabel: row.signatureLabel,
        defaultPaper:   isPaperFormat(row.defaultPaper) ? row.defaultPaper : fallback.defaultPaper,
        paperWidthMm:   row.paperWidthMm,
        fontFamily:     row.fontFamily,
        fontSizePx:     row.fontSizePx,
    };
}

/**
 * Decide which paper format to render. URL override wins (so the print
 * button can force one); otherwise use the kind's stored default.
 */
export function resolvePaperFormat(template: VoucherTemplateDefaults, override?: string): PaperFormat {
    if (override && isPaperFormat(override)) return override;
    return template.defaultPaper;
}
