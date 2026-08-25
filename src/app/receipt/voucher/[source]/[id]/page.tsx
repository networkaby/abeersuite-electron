import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import {
    buildVoucherReceiptSample,
    type VoucherReceiptSource,
} from "@/modules/accountancy/lib/voucherReceiptSample";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

// ── Generic voucher print page ──────────────────────────────────────────────
//
// Prints ANY Day-Book voucher (inventory · GL · journal-entry) through the
// template-driven renderer, following the house print rule: thermal always
// tries the combined bridge first and falls back to the browser, where a format
// picker lets the user switch A4 / thermal — each format rendering its own
// template. Reached from the 3-dot menu's Print / PDF actions and the voucher
// forms' "Print after save" toggle:
//
//   /receipt/voucher/<source>/<id>?paper=A4           → A4 print
//   /receipt/voucher/<source>/<id>?paper=THERMAL_80MM → 80mm thermal
//   /receipt/voucher/<source>/<id>?width=72           → 72mm thermal width
//   /receipt/voucher/<source>/<id>?mode=thermal       → force thermal + auto-fire
//        the combined bridge (browser fallback if the relay is offline)
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
    await requireStaffPage();

    const { source, id } = await params;
    const sp = (await searchParams) ?? {};

    if (!SOURCES.has(source as VoucherReceiptSource)) notFound();

    const data = await buildVoucherReceiptSample(source as VoucherReceiptSource, Number(id));
    if (!data) notFound();

    const template = await getVoucherTemplate(data.kind);

    // Format resolution: `?mode=thermal` (the form's Thermal toggle) forces the
    // 80mm slip; otherwise `?paper=` wins, then the kind's stored default.
    const format = sp.mode === "thermal" ? "THERMAL_80MM" : resolvePaperFormat(template, sp.paper);
    const isThermal = format === "THERMAL_80MM";

    // `?width=` overrides the thermal width (e.g. 72mm) without a new PaperFormat.
    const widthOverride = Number(sp.width);
    const hasWidth = Number.isFinite(widthOverride) && widthOverride > 0;
    const renderTemplate = hasWidth ? { ...template, paperWidthMm: widthOverride } : template;

    // `?autoprint=0` (set by the form "Print after save" flow and by a format
    // switch) opens the page without firing the dialog / bridge so the user can
    // pick a format first. Everything else auto-prints as before.
    const autoPrint = sp.autoprint !== "0";
    const selectorWidth = hasWidth ? String(widthOverride) : "";

    return (
        <ReceiptPreview
            format={format}
            template={renderTemplate}
            sample={data.sample}
            toolbar={
                <PrintToolbar
                    // Thermal → try the combined bridge first; on failure the
                    // toolbar falls back to browser print and reveals the picker.
                    bridge={isThermal && autoPrint
                        ? {
                            endpoint: "/print/voucher",
                            payload:  {
                                kind:     data.kind,
                                title:    data.docTitle,
                                sample:   data.sample,
                                template: resolveTemplateForFormat(renderTemplate, "THERMAL_80MM"),
                            },
                        }
                        : undefined}
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
