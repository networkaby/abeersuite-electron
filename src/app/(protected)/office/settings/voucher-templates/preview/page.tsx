import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
    isPaperFormat,
    type VoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { VoucherTemplatesPreviewGallery } from "@/modules/settings/components/VoucherTemplatesPreviewGallery";

export const metadata = { title: "Voucher Template Preview" };

export default async function VoucherTemplatesPreviewPage() {
    const [rows, organisation] = await Promise.all([
        prisma.voucherPrintTemplate.findMany(),
        getOrganisation(),
    ]);
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    const templates: VoucherTemplateDefaults[] = VOUCHER_TEMPLATE_KINDS.map((kind) => {
        const r = byKind.get(kind);
        if (!r) return buildVoucherTemplateDefaults(kind);
        const fallback = buildVoucherTemplateDefaults(kind);
        return {
            kind,
            headerLine1:    r.headerLine1,
            headerLine2:    r.headerLine2,
            addressBlock:   r.addressBlock,
            gstinLine:      r.gstinLine,
            phoneLine:      r.phoneLine,
            logoUrl:        r.logoUrl,
            showLogo:       r.showLogo,
            showAddress:    r.showAddress,
            showGstin:      r.showGstin,
            showPhone:      r.showPhone,
            showTaxSummary: r.showTaxSummary,
            showMrp:        r.showMrp,
            showSignature:  r.showSignature,
            showQrCode:     r.showQrCode,
            termsText:      r.termsText,
            footerLine:     r.footerLine,
            signatureLabel: r.signatureLabel,
            defaultPaper:   isPaperFormat(r.defaultPaper) ? r.defaultPaper : fallback.defaultPaper,
            paperWidthMm:   r.paperWidthMm,
            fontFamily:     r.fontFamily,
            fontSizePx:     r.fontSizePx,
        };
    });

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-4 px-6 pt-3 pb-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-xl font-semibold">Voucher Template Preview</h1>
                    <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                        Side-by-side A4 and 80mm thermal preview for the selected voucher kind. Use this on a
                        client demo to show exactly what each print will look like before going live. Edit the
                        template at <span className="font-mono text-xs">/office/settings/voucher-templates</span>.
                    </p>
                </div>
            </div>
            <VoucherTemplatesPreviewGallery templates={templates} organisation={organisation} />
        </div>
        </ScrollArea>
    );
}
