/**
 * Paper-format-aware dispatcher. Picks <A4InvoicePreview> or
 * <ThermalReceiptPreview> based on the `format` prop, and is the SINGLE place
 * that collapses the template's A4/thermal flag pairs to the set that applies
 * to this format (via resolveTemplateForFormat) — so both renderers stay
 * format-agnostic and just read the base `showX` names.
 *
 * Used by:
 *   • /receipt/... print routes — production print path
 *   • /office/settings/print-templates — editor live preview
 *   • bespoke documents (repair ticket / shipping slip / payment slip) — via
 *     the optional `body` slot, which supplies a custom middle while reusing
 *     the template-driven header + footer chrome.
 *
 * Keeping a thin dispatcher (rather than a single mega-component) means
 * each layout can evolve independently while sharing the template + sample
 * data shape.
 */

import {
    resolveTemplateForFormat,
    type VoucherTemplateDefaults,
    type PaperFormat,
} from "@/shared/lib/print/voucherTemplateDefaults";
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
    /** Custom middle for bespoke documents. When set, replaces the invoice
     *  meta/lines/totals block; the header + footer chrome stay shared. */
    body?:        React.ReactNode;
}

export default function ReceiptPreview({
    format,
    template,
    sample,
    previewMode,
    toolbar,
    docTitle,
    body,
}: ReceiptPreviewProps) {
    // Single resolution point: pick the A4 or thermal flag from each pair.
    const t = resolveTemplateForFormat(template, format);

    if (format === "A4") {
        return (
            <A4InvoicePreview
                template={t}
                sample={sample}
                previewMode={previewMode}
                toolbar={toolbar}
                docTitle={docTitle}
                body={body}
            />
        );
    }
    return (
        <ThermalReceiptPreview
            template={t}
            sample={sample}
            previewMode={previewMode}
            toolbar={toolbar}
            docTitle={docTitle}
            body={body}
        />
    );
}
