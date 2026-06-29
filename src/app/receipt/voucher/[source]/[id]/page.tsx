import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import ThermalAutoPrint from "@/modules/pos/components/ThermalAutoPrint";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import {
    buildVoucherReceiptSample,
    type VoucherReceiptSource,
} from "@/modules/accountancy/lib/voucherReceiptSample";

// ── Generic voucher print page ──────────────────────────────────────────────
//
// Prints ANY Day-Book voucher (inventory · GL · journal-entry) through the
// template-driven renderer. Reached from the 3-dot menu's Print / PDF actions
// and from the voucher forms' "Print after save" toggle:
//
//   /receipt/voucher/<source>/<id>?paper=A4           → A4 PDF / print
//   /receipt/voucher/<source>/<id>?paper=THERMAL_80MM → 80mm thermal
//   /receipt/voucher/<source>/<id>?paper=THERMAL_80MM&width=72 → 72mm PDF
//   /receipt/voucher/<source>/<id>?mode=thermal       → auto-fire to the thermal
//        printer like POS (tries the local relay, falls back to browser print)
//
// The POS counter flow keeps its dedicated relay pages (/receipt/invoice?kind=POS
// and /receipt/payment) — this route is the catch-all for every other kind.

const SOURCES = new Set<VoucherReceiptSource>(["inv", "gl", "je"]);

export default async function VoucherReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ source: string; id: string }>;
    searchParams?: Promise<{ paper?: string; width?: string; autoprint?: string; mode?: string }>;
}) {
    const { source, id } = await params;
    const sp = (await searchParams) ?? {};

    if (!SOURCES.has(source as VoucherReceiptSource)) notFound();

    const data = await buildVoucherReceiptSample(source as VoucherReceiptSource, Number(id));
    if (!data) notFound();

    const template = await getVoucherTemplate(data.kind);

    // Thermal mode (Thermal toggle ON): render the 80mm slip and auto-fire to the
    // thermal printer like POS. ThermalAutoPrint tries the local relay first and
    // falls back to a browser print of the slip if the bridge is offline or has
    // no endpoint for this kind yet.
    const isThermalMode = sp.mode === "thermal";
    if (isThermalMode) {
        return (
            <ReceiptPreview
                format="THERMAL_80MM"
                template={template}
                sample={data.sample}
                toolbar={
                    <ThermalAutoPrint
                        endpoint="/print/voucher"
                        payload={{ kind: data.kind, title: data.docTitle, sample: data.sample, template }}
                    />
                }
                docTitle={data.docTitle}
            />
        );
    }

    // Browser mode: traditional, format-selectable print page. Paper defaults to
    // the kind's template setting (configured on the voucher-templates page).
    // `?width=` overrides the thermal width (e.g. 72mm) without a new PaperFormat.
    const widthOverride = Number(sp.width);
    const renderTemplate = Number.isFinite(widthOverride) && widthOverride > 0
        ? { ...template, paperWidthMm: widthOverride }
        : template;

    const format = resolvePaperFormat(template, sp.paper);

    // `?autoprint=0` (set by the form "Print after save" flow) opens the page
    // without firing the dialog so the user can pick a format first. The 3-dot
    // register Print/PDF actions omit it → auto-print as before.
    const autoPrint = sp.autoprint !== "0";
    const selectorWidth = Number.isFinite(widthOverride) && widthOverride > 0 ? String(widthOverride) : "";

    return (
        <ReceiptPreview
            format={format}
            template={renderTemplate}
            sample={data.sample}
            toolbar={
                <ReceiptButtons
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                    currentWidth={selectorWidth}
                />
            }
            docTitle={data.docTitle}
        />
    );
}
