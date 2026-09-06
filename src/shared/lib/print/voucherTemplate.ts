import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    buildVoucherTemplateDefaults,
    isVoucherTemplateKind,
    isPaperFormat,
    resolveTemplateForFormat,
    rowToVoucherTemplateDefaults,
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
    return rowToVoucherTemplateDefaults(row);
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
 * Template for a silent thermal print — org-merged AND resolved to the 80mm
 * roll's toggles. Every bridge payload must be built from this (or from
 * resolveTemplateForFormat(..., "THERMAL_80MM") on a page that already holds
 * the merged template) so the paper obeys the *Thermal* column of the editor,
 * never the A4 one.
 */
export async function getThermalTemplate(kind: string): Promise<VoucherTemplateDefaults> {
    return resolveTemplateForFormat(await getVoucherTemplate(kind), "THERMAL_80MM");
}

/**
 * Decide which paper format to render. URL override wins (so the print
 * button can force one); otherwise use the kind's stored default.
 */
export function resolvePaperFormat(template: VoucherTemplateDefaults, override?: string): PaperFormat {
    if (override && isPaperFormat(override)) return override;
    return template.defaultPaper;
}
