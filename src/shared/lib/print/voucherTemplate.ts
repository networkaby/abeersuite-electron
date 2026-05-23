import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    buildVoucherTemplateDefaults,
    isVoucherTemplateKind,
    isPaperFormat,
    type PaperFormat,
    type VoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { mergeTemplateWithOrg } from "@/shared/lib/print/mergeTemplateWithOrg";

// Re-export so callers can pull both server + pure helpers from one spot.
export { mergeTemplateWithOrg };

/**
 * Read the raw VoucherPrintTemplate row for the given kind (no org merge).
 * Used by the settings editor, which renders the row exactly as stored so
 * the admin can see which fields are blank → falling back to the org.
 */
async function readVoucherTemplateRaw(kind: string): Promise<VoucherTemplateDefaults> {
    if (!isVoucherTemplateKind(kind)) {
        // Defensive — render *something* even if the caller passed garbage.
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
 * Server-side helper used by the receipt routes — loads the per-kind row
 * AND merges in the Organisation singleton, so the returned template is
 * always ready to render without any further fallback logic in the print
 * components.
 */
export async function getVoucherTemplate(kind: string): Promise<VoucherTemplateDefaults> {
    const [raw, org] = await Promise.all([
        readVoucherTemplateRaw(kind),
        getOrganisation(),
    ]);
    return mergeTemplateWithOrg(raw, org);
}

/**
 * Decide which paper format to render. URL override wins (so the print
 * button can force one); otherwise use the kind's stored default.
 */
export function resolvePaperFormat(template: VoucherTemplateDefaults, override?: string): PaperFormat {
    if (override && isPaperFormat(override)) return override;
    return template.defaultPaper;
}
