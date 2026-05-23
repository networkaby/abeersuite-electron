import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
    isPaperFormat,
    type VoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { VoucherTemplatesPanel } from "@/modules/settings/components/VoucherTemplatesPanel";

export const metadata = { title: "Voucher Templates" };

export default async function VoucherTemplatesPage() {
    const rows = await prisma.voucherPrintTemplate.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    // Hand a fully-populated array to the client so it doesn't have to wait
    // on a second fetch (and rows missing from the seed get default-shaped
    // entries to render).
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
        <div className="space-y-4 p-6">
            <div>
                <h1 className="text-xl font-semibold">Voucher Templates</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Customise the print template per voucher kind — header, GSTIN, terms, signature, footer.
                    Each kind has a <b>default paper format</b> (A4 or 80mm thermal); use the &ldquo;Preview as&rdquo; toggle
                    on the right to inspect the other format without changing the default. Open{" "}
                    <a className="underline hover:text-foreground" href="/office/settings/voucher-templates/preview">
                        Voucher Preview
                    </a>{" "}for a side-by-side demo gallery.
                </p>
            </div>
            <VoucherTemplatesPanel initialTemplates={templates} />
        </div>
    );
}
