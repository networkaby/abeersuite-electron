"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import {
    VOUCHER_TEMPLATE_KIND_GROUPS,
    type VoucherTemplateDefaults,
    type VoucherTemplateKind,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { mergeTemplateWithOrg } from "@/shared/lib/print/mergeTemplateWithOrg";
import type { OrganisationView } from "@/shared/lib/org/organisationView";
import { buildSampleForKind, VOUCHER_KIND_LABEL, SAMPLE_COUPON_CARD, SAMPLE_GIFT_CARD, SAMPLE_SHIFT_CLOSE } from "@/modules/settings/lib/voucherTemplateSamples";
import CouponCard from "@/shared/components/print/CouponCard";
import GiftCardCard from "@/shared/components/print/GiftCardCard";
import { ShiftCloseBody } from "@/shared/components/print/ShiftCloseBody";

interface Props {
    templates:    VoucherTemplateDefaults[];
    organisation: OrganisationView;
}

export function VoucherTemplatesPreviewGallery({ templates, organisation }: Props) {
    const byKind = useMemo(() => {
        const m = new Map<VoucherTemplateKind, VoucherTemplateDefaults>();
        for (const t of templates) m.set(t.kind as VoucherTemplateKind, t);
        return m;
    }, [templates]);

    const [selectedKind, setSelectedKind] = useState<VoucherTemplateKind>("SALE");

    const rawTemplate = byKind.get(selectedKind);
    // Merge with org so the gallery shows the same output the real print
    // route would produce. Done client-side here so kind switches don't
    // need a server round-trip.
    const template = useMemo(
        () => (rawTemplate ? mergeTemplateWithOrg(rawTemplate, organisation) : null),
        [rawTemplate, organisation],
    );
    const sample = useMemo(() => buildSampleForKind(selectedKind), [selectedKind]);

    if (!template) return null;

    return (
        <div className="space-y-4">
            {/* Kind picker */}
            <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-card p-3">
                <label htmlFor="kind-picker" className="text-sm font-medium">Voucher kind:</label>
                <select
                    id="kind-picker"
                    value={selectedKind}
                    onChange={(e) => setSelectedKind(e.target.value as VoucherTemplateKind)}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
                >
                    <optgroup label="Accounting">
                        {VOUCHER_TEMPLATE_KIND_GROUPS.accounting.map((k) => (
                            <option key={k} value={k}>{VOUCHER_KIND_LABEL[k]}</option>
                        ))}
                    </optgroup>
                    <optgroup label="Inventory">
                        {VOUCHER_TEMPLATE_KIND_GROUPS.inventory.map((k) => (
                            <option key={k} value={k}>{VOUCHER_KIND_LABEL[k]}</option>
                        ))}
                    </optgroup>
                    <optgroup label="POS & Register">
                        {VOUCHER_TEMPLATE_KIND_GROUPS.pos.map((k) => (
                            <option key={k} value={k}>{VOUCHER_KIND_LABEL[k]}</option>
                        ))}
                    </optgroup>
                    <optgroup label="Repair">
                        {VOUCHER_TEMPLATE_KIND_GROUPS.repair.map((k) => (
                            <option key={k} value={k}>{VOUCHER_KIND_LABEL[k]}</option>
                        ))}
                    </optgroup>
                    <optgroup label="Marketing">
                        {VOUCHER_TEMPLATE_KIND_GROUPS.marketing.map((k) => (
                            <option key={k} value={k}>{VOUCHER_KIND_LABEL[k]}</option>
                        ))}
                    </optgroup>
                </select>

                <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                        Default paper for <span className="font-medium text-foreground">{VOUCHER_KIND_LABEL[selectedKind]}</span>:{" "}
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] ${
                            template.defaultPaper === "A4"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-amber-100 text-amber-700"
                        }`}>
                            {template.defaultPaper === "A4" ? "A4" : "Thermal 80mm"}
                        </span>
                    </span>
                    <Link
                        href={`/office/settings/voucher-templates`}
                        className="inline-flex items-center gap-1 underline hover:text-foreground"
                    >
                        Edit template
                        <ExternalLink className="size-3" />
                    </Link>
                </div>
            </div>

            {/* Cards have one fixed face — no A4 / thermal pair. */}
            {(selectedKind === "COUPON" || selectedKind === "GIFT_CARD") ? (
                <PreviewPane title={VOUCHER_KIND_LABEL[selectedKind]} isDefault={false} description="Fixed 360px card face, printed from the browser.">
                    <div className="flex justify-center">
                        {selectedKind === "COUPON"
                            ? <CouponCard template={template} data={SAMPLE_COUPON_CARD} />
                            : <GiftCardCard template={template} data={SAMPLE_GIFT_CARD} />}
                    </div>
                </PreviewPane>
            ) : (
            /* Side-by-side previews */
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <PreviewPane
                    title="A4 — Tax invoice"
                    isDefault={template.defaultPaper === "A4"}
                    description="Full-page formal invoice. Standard for sale invoices, purchase invoices, and printed bills."
                >
                    {/* CSS `zoom` actually shrinks the layout box (unlike
                        `transform: scale`) so the parent's height follows
                        the scaled content — no overlap with the next pane,
                        no horizontal scroll. 0.6 keeps A4 readable while
                        fitting in a typical 600-700px pane on a laptop. */}
                    <div style={{ zoom: 0.6 }}>
                        <ReceiptPreview
                            format="A4"
                            template={template}
                            sample={sample}
                            previewMode
                            body={selectedKind === "SHIFT_CLOSE" ? (
                                <ShiftCloseBody
                                    data={{
                                        ...SAMPLE_SHIFT_CLOSE,
                                        cashierSignatureLabel: template.signatureLabel || "Cashier Signature",
                                    }}
                                    thermal={false}
                                    showSignature={template.showSignature}
                                />
                            ) : undefined}
                        />
                    </div>
                </PreviewPane>

                <PreviewPane
                    title="Thermal 80mm — Counter receipt"
                    isDefault={template.defaultPaper === "THERMAL_80MM"}
                    description="80mm-wide thermal slip. Used at POS counters and for compact receipts."
                >
                    <div className="flex justify-center">
                        <ReceiptPreview
                            format="THERMAL_80MM"
                            template={template}
                            sample={sample}
                            previewMode
                            body={selectedKind === "SHIFT_CLOSE" ? (
                                <ShiftCloseBody
                                    data={{
                                        ...SAMPLE_SHIFT_CLOSE,
                                        cashierSignatureLabel: template.signatureLabel || "Cashier Signature",
                                    }}
                                    thermal={true}
                                    showSignature={template.showSignatureThermal}
                                />
                            ) : undefined}
                        />
                    </div>
                </PreviewPane>
            </div>
            )}
        </div>
    );
}

function PreviewPane({
    title, isDefault, description, children,
}: {
    title: string; isDefault: boolean; description: string; children: React.ReactNode;
}) {
    return (
        <section className={`rounded-lg border bg-card overflow-hidden ${isDefault ? "border-primary/60 ring-1 ring-primary/20" : ""}`}>
            <header className="flex items-start justify-between gap-3 p-3 border-b">
                <div>
                    <h2 className="text-sm font-semibold">{title}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{description}</p>
                </div>
                {isDefault && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-primary shrink-0">
                        Default · prints today
                    </span>
                )}
            </header>
            <div className="p-3 bg-muted/30 overflow-auto" style={{ maxHeight: 760 }}>
                {children}
            </div>
        </section>
    );
}
