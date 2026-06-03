import { notFound } from "next/navigation";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import {
    buildVoucherReceiptSample,
    type VoucherReceiptSource,
} from "@/modules/accountancy/lib/voucherReceiptSample";

// ── Generic voucher print page ──────────────────────────────────────────────
//
// Prints ANY Day-Book voucher (inventory · GL · journal-entry) through the
// template-driven renderer. Reached from the 3-dot menu's Print / PDF actions:
//
//   /receipt/voucher/<source>/<id>?paper=A4           → A4 PDF / print
//   /receipt/voucher/<source>/<id>?paper=THERMAL_80MM → 80mm thermal
//   /receipt/voucher/<source>/<id>?paper=THERMAL_80MM&width=72 → 72mm PDF
//
// The POS counter flow keeps its dedicated relay pages (/receipt/invoice?kind=POS
// and /receipt/payment) — this route is the catch-all for every other kind and
// for browser "Save as PDF" at any paper width.

const SOURCES = new Set<VoucherReceiptSource>(["inv", "gl", "je"]);

export default async function VoucherReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ source: string; id: string }>;
    searchParams?: Promise<{ paper?: string; width?: string }>;
}) {
    const { source, id } = await params;
    const sp = (await searchParams) ?? {};

    if (!SOURCES.has(source as VoucherReceiptSource)) notFound();

    const data = await buildVoucherReceiptSample(source as VoucherReceiptSource, Number(id));
    if (!data) notFound();

    const template = await getVoucherTemplate(data.kind);

    // `?width=` overrides the thermal paper width (e.g. 72mm) without needing a
    // new persisted PaperFormat — the thermal renderer keys off paperWidthMm.
    const widthOverride = Number(sp.width);
    const renderTemplate = Number.isFinite(widthOverride) && widthOverride > 0
        ? { ...template, paperWidthMm: widthOverride }
        : template;

    const format = resolvePaperFormat(template, sp.paper);

    return (
        <ReceiptPreview
            format={format}
            template={renderTemplate}
            sample={data.sample}
            toolbar={<ReceiptButtons />}
            docTitle={data.docTitle}
        />
    );
}
