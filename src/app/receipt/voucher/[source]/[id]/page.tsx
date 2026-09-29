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
// template-driven renderer, following the house print rule (two ways only):
// silent thermal = the bridge; otherwise this format-selection page, where the
// user picks A4 / thermal and the printer in the browser dialog — each format
// rendering its own template. Reached from the 3-dot menu's Print (thermal) /
// Print / PDF actions and the voucher forms' "Print after save" toggle:
//
//   /receipt/voucher/<source>/<id>?paper=A4           → A4 print
//   /receipt/voucher/<source>/<id>?paper=THERMAL_80MM → 80mm thermal
//   /receipt/voucher/<source>/<id>?width=72           → 72mm thermal width
//   /receipt/voucher/<source>/<id>?mode=thermal       → the thermal way: fire the
//        bridge once on mount; no printer / bridge down → this same page stays
//        open as the format-selection page (nothing auto-prints)
//
// The POS sale keeps its dedicated relay page (/receipt/invoice?kind=POS, the
// price ladder) — this route prints every other kind, the POS Rcv / Exp and
// office Receipt / Payment slips included (/receipt/payment only forwards here).

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

    // Format resolution: `?paper=` wins, then `?mode=thermal` (the thermal way
    // in), otherwise A4 — see resolvePaperFormat.
    const format = resolvePaperFormat(template, sp.paper, sp.mode);
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
