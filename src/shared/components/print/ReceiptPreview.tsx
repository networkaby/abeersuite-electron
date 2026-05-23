/**
 * Paper-format-aware dispatcher. Picks <A4InvoicePreview> or
 * <ThermalReceiptPreview> based on the `format` prop. Used by:
 *   • /receipt/invoice/[id] — production print path
 *   • /office/settings/voucher-templates       — editor live preview
 *   • /office/settings/voucher-templates/preview — demo gallery
 *
 * Keeping a thin dispatcher (rather than a single mega-component) means
 * each layout can evolve independently while sharing the template + sample
 * data shape.
 */

import type { VoucherTemplateDefaults, PaperFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import ThermalReceiptPreview, {
    type ThermalReceiptSample,
} from "@/shared/components/print/ThermalReceiptPreview";
import A4InvoicePreview from "@/shared/components/print/A4InvoicePreview";

export interface ReceiptPreviewProps {
    format:       PaperFormat;
    template:     VoucherTemplateDefaults;
    sample:       ThermalReceiptSample;
    previewMode?: boolean;
    toolbar?:     React.ReactNode;
    docTitle?:    string;
}

export default function ReceiptPreview({
    format,
    template,
    sample,
    previewMode,
    toolbar,
    docTitle,
}: ReceiptPreviewProps) {
    if (format === "A4") {
        return (
            <A4InvoicePreview
                template={template}
                sample={sample}
                previewMode={previewMode}
                toolbar={toolbar}
                docTitle={docTitle}
            />
        );
    }
    return (
        <ThermalReceiptPreview
            template={template}
            sample={sample}
            previewMode={previewMode}
            toolbar={toolbar}
            docTitle={docTitle}
        />
    );
}
