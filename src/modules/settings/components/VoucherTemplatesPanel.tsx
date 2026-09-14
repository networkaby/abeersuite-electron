"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { parseDigitsInput } from "@/shared/lib/format";
import { Loader2, Maximize2, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { RepairTicketBody } from "@/shared/components/print/RepairTicketBody";
import { ShippingSlipBody } from "@/shared/components/print/ShippingSlipBody";
import ShippingLabel from "@/shared/components/print/ShippingLabel";
import OrderParcelLabel from "@/shared/components/print/OrderParcelLabel";
import CouponCard from "@/shared/components/print/CouponCard";
import GiftCardCard from "@/shared/components/print/GiftCardCard";
import { ShiftCloseBody } from "@/shared/components/print/ShiftCloseBody";
import {
    VOUCHER_TEMPLATE_KIND_GROUPS,
    resolveTemplateForFormat,
    REPAIR_DOCUMENT_KINDS,
    POS_DOCUMENT_KINDS,
    type VoucherTemplateDefaults,
    type VoucherTemplateKind,
    type PaperFormat,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { mergeTemplateWithOrg, labelSender, labelFooter } from "@/shared/lib/print/mergeTemplateWithOrg";
import type { OrganisationView } from "@/shared/lib/org/organisationView";
import {
    buildSampleForKind,
    VOUCHER_KIND_LABEL as KIND_LABEL,
    SAMPLE_REPAIR_TICKET,
    SAMPLE_SHIPPING_SLIP,
    SAMPLE_SHIPPING_LABEL,
    SAMPLE_PARCEL_LABEL,
    SAMPLE_COUPON_CARD,
    SAMPLE_GIFT_CARD,
    SAMPLE_SHIFT_CLOSE,
} from "@/modules/settings/lib/voucherTemplateSamples";

interface Props {
    initialTemplates: VoucherTemplateDefaults[];
    organisation:     OrganisationView;
}

// Buffered numeric input: lets the user type freely (including intermediate
// values below the min, e.g. "8" on the way to "80") and clamps to [min,max]
// only on blur — so editing 120 → 80 works. Clamping on every keystroke would
// snap "8" up to the min and trap the value.
function NumberField({
    value, min, max, onCommit,
}: { value: number; min: number; max: number; onCommit: (n: number) => void }) {
    const [text, setText] = useState(String(value));
    // Resync when the row's value changes externally (kind switch / reset / save).
    useEffect(() => { setText(String(value)); }, [value]);
    return (
        <Input
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(parseDigitsInput(e.target.value))}
            onBlur={() => {
                const n = parseInt(text, 10);
                const next = Number.isNaN(n) ? value : Math.min(max, Math.max(min, n));
                setText(String(next));
                if (next !== value) onCommit(next);
            }}
        />
    );
}

// Boolean-valued keys of the template — the show/hide switches operate on these.
// `-?` strips the optional modifier so optional props (emailLine, bankDetails, …)
// resolve to `never` and are dropped, instead of leaking `undefined` into the union.
type BoolTemplateKey = {
    [K in keyof VoucherTemplateDefaults]-?: VoucherTemplateDefaults[K] extends boolean ? K : never;
}[keyof VoucherTemplateDefaults];

// One row per print element; each has an independent A4 + thermal flag so a
// format can show something the other hides. `a4Only` rows describe an element
// the thermal slip simply doesn't have, so its switch is shown as "—".
const SHOW_HIDE_ELEMENTS: { label: string; a4: BoolTemplateKey; thermal: BoolTemplateKey; a4Only?: boolean }[] = [
    { label: "Logo",           a4: "showLogo",          thermal: "showLogoThermal" },
    { label: "Header text",    a4: "showHeaderText",    thermal: "showHeaderTextThermal" },
    { label: "HO address",     a4: "showAddress",       thermal: "showAddressThermal" },
    { label: "Branch address", a4: "showBranchAddress", thermal: "showBranchAddressThermal" },
    { label: "Phone",          a4: "showPhone",         thermal: "showPhoneThermal" },
    { label: "GSTIN",          a4: "showGstin",         thermal: "showGstinThermal" },
    // Only the separate HSN/SAC rate-wise table — the tax figures inside the
    // total block always print. The thermal slip carries no such table.
    { label: "HSN tax analysis table", a4: "showTaxSummary", thermal: "showTaxSummaryThermal", a4Only: true },
    { label: "MRP (struck)",   a4: "showMrp",           thermal: "showMrpThermal" },
    { label: "Signature",      a4: "showSignature",     thermal: "showSignatureThermal" },
    { label: "Barcode",        a4: "showBarcode",       thermal: "showBarcodeThermal" },
    { label: "Bank details",   a4: "showBank",          thermal: "showBankThermal" },
    { label: "Party balance",  a4: "showPartyBalance",  thermal: "showPartyBalanceThermal" },
];

// Service Shipping Label meta fields — its own row set with a switch per format:
// Sheet (A4/A5/A6) · Thermal (80mm) · TL (Thermal Label 100×50).
const LABEL_FIELD_ELEMENTS: { label: string; a4: BoolTemplateKey; thermal: BoolTemplateKey; tl: BoolTemplateKey }[] = [
    { label: "Ticket",            a4: "showTicket", thermal: "showTicketThermal", tl: "showTicketTl" },
    { label: "Date",              a4: "showDate",   thermal: "showDateThermal",   tl: "showDateTl" },
    { label: "Ref",               a4: "showRef",    thermal: "showRefThermal",    tl: "showRefTl" },
    { label: "Device (theft risk)", a4: "showDevice", thermal: "showDeviceThermal", tl: "showDeviceTl" },
    { label: "Footer (handle-with-care)", a4: "showFooter", thermal: "showFooterThermal", tl: "showFooterTl" },
];

// Service Slip sign-off rows — a switch per format (A4 · Thermal) like the
// Show/hide table above.
const SLIP_SIGNOFF_ELEMENTS: { label: string; a4: BoolTemplateKey; thermal: BoolTemplateKey }[] = [
    { label: "Received by (Service Centre)",   a4: "showReceivedBy", thermal: "showReceivedByThermal" },
    { label: "Sent by (Shop)",                 a4: "showSentBy",     thermal: "showSentByThermal" },
    { label: "Prepared by (name line)",        a4: "showPreparedBy", thermal: "showPreparedByThermal" },
    { label: "Findings & note (Service Centre use)", a4: "showFindings", thermal: "showFindingsThermal" },
];

// The bespoke documents (repair ticket / shipping slip) have no line-items
// table, tax, barcode or issuing branch — hide those toggles for them.
const BESPOKE_HIDDEN_ELEMENTS = new Set<BoolTemplateKey>([
    "showTaxSummary", "showMrp", "showBarcode", "showBranchAddress",
]);
const BESPOKE_KINDS = new Set<VoucherTemplateKind>(["REPAIR_TICKET", "SHIPPING_SLIP", "SERVICE_SHIPPING_LABEL", "DELIVERY_SHIPPING_LABEL", "COUPON", "GIFT_CARD", "SHIFT_CLOSE"]);
// The cards read only logo / brand / phone (foot) — the rest of the chrome has no place on them.
const CARD_KINDS = new Set<VoucherTemplateKind>(["COUPON", "GIFT_CARD"]);
const CARD_HIDDEN_ELEMENTS = new Set<BoolTemplateKey>([
    "showAddress", "showGstin", "showSignature", "showBank", "showPartyBalance",
]);

export function VoucherTemplatesPanel({ initialTemplates, organisation }: Props) {
    const byKind = useMemo(() => {
        const m = new Map<VoucherTemplateKind, VoucherTemplateDefaults>();
        for (const t of initialTemplates) m.set(t.kind as VoucherTemplateKind, t);
        return m;
    }, [initialTemplates]);

    // Local working copies (mutated by the form) and the last-saved baselines
    // (used to compute "modified" badges).
    const [working, setWorking] = useState<Map<VoucherTemplateKind, VoucherTemplateDefaults>>(
        () => new Map(byKind),
    );
    const [saved, setSaved] = useState<Map<VoucherTemplateKind, VoucherTemplateDefaults>>(
        () => new Map(byKind),
    );

    const [selectedKind, setSelectedKind] = useState<VoucherTemplateKind>("SALE");
    // null → follow the kind's `defaultPaper`; otherwise force-preview the chosen format.
    const [previewOverride, setPreviewOverride] = useState<PaperFormat | null>(null);
    const [labelPreviewFormat, setLabelPreviewFormat] = useState<"sheet" | "thermal" | "tl">("sheet");
    const [expanded, setExpanded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);

    const current = working.get(selectedKind);
    const baseline = saved.get(selectedKind);
    const isDirty = !!current && !!baseline && JSON.stringify(current) !== JSON.stringify(baseline);

    // Computed before any early return so React Hook ordering stays stable.
    const sample = useMemo(() => buildSampleForKind(selectedKind), [selectedKind]);

    if (!current || !baseline) {
        // Should never happen — the page hands us all rows.
        return <div className="text-sm text-muted-foreground">No templates loaded.</div>;
    }

    // "Default paper" only means something for documents with no Print / Thermal
    // ticks on their voucher forms (repair ticket, shipping slip, shift close).
    const hasDefaultPaper = (REPAIR_DOCUMENT_KINDS as readonly string[]).includes(selectedKind)
        || (POS_DOCUMENT_KINDS as readonly string[]).includes(selectedKind);
    const kindDefaultPaper: PaperFormat = hasDefaultPaper ? current.defaultPaper : "A4";

    // Which paper the preview shows, and the org-merged template both the inline
    // preview and the full-size popup render.
    const previewFormat = previewOverride ?? kindDefaultPaper;
    const mergedPreview = mergeTemplateWithOrg(current, organisation);

    // Bespoke documents carry their OWN body (not the invoice line-items layout),
    // so preview the real body and drop the phantom line-items sample. Their
    // Show/Hide table also hides the toggles that don't apply.
    const isSlip = selectedKind === "SHIPPING_SLIP";
    // Sign-off flags follow the previewed format (A4 vs 80mm) so toggling either
    // column updates the live preview.
    const slipFlags = resolveTemplateForFormat(current, previewFormat);
    const bespokeBody =
        selectedKind === "REPAIR_TICKET" ? <RepairTicketBody data={SAMPLE_REPAIR_TICKET} thermal={previewFormat === "THERMAL_80MM"} /> :
        isSlip ? (
            <ShippingSlipBody
                thermal={previewFormat === "THERMAL_80MM"}
                data={{
                    ...SAMPLE_SHIPPING_SLIP,
                    showSentBy:     slipFlags.showSentBy,
                    showReceivedBy: slipFlags.showReceivedBy,
                    showPreparedBy: slipFlags.showPreparedBy,
                    showFindings:   slipFlags.showFindings,
                    sentByLabel:    current.signatureLabel,
                }}
            />
        ) :
        selectedKind === "SHIFT_CLOSE" ? (
            <ShiftCloseBody
                data={{
                    ...SAMPLE_SHIFT_CLOSE,
                    cashierSignatureLabel: current.signatureLabel || "Cashier Signature",
                }}
                thermal={previewFormat === "THERMAL_80MM"}
                showSignature={slipFlags.showSignature}
            />
        ) :
        null;

    // The shipping label is its OWN postcard document (not the letterhead chrome),
    // so it previews standalone. Feed the live-edited shop identity as the From.
    const isLabel = selectedKind === "SERVICE_SHIPPING_LABEL";
    // The parcel label (order shipped by our own courier) — also standalone.
    const isParcelLabel = selectedKind === "DELIVERY_SHIPPING_LABEL";
    // Coupon / gift card — a fixed card face, previewed standalone too.
    const isCard = CARD_KINDS.has(selectedKind);
    // Same sender / footer derivation the label pages use, so the preview IS
    // the print. The Fields toggles come straight off the merged template.
    const parcelLabelData = { ...SAMPLE_PARCEL_LABEL,   from: labelSender(mergedPreview), footer: labelFooter(mergedPreview) };
    const labelData       = { ...SAMPLE_SHIPPING_LABEL, from: labelSender(mergedPreview), footer: labelFooter(mergedPreview) };
    const labelFields     = mergedPreview;
    const previewSample = bespokeBody
        ? { ...sample, lines: [], subtotal: null, taxAmount: null, total: null, discounts: null, hsnSummary: null }
        : sample;
    const visibleElements = (() => {
        if (!BESPOKE_KINDS.has(selectedKind)) return SHOW_HIDE_ELEMENTS;
        // The parcel label reads no show/hide flag at all (sender, receiver,
        // order, courier and payment always print) — no inert rows.
        if (isParcelLabel) return [];
        const hidden = new Set(BESPOKE_HIDDEN_ELEMENTS);
        if (isCard) for (const k of CARD_HIDDEN_ELEMENTS) hidden.add(k);
        if (selectedKind === "SHIFT_CLOSE") {
            hidden.add("showBank");
            hidden.add("showPartyBalance");
        }
        // The slip has its own Sent/Received/Prepared toggles, so drop the
        // generic Signature row for it (it never drove the slip anyway).
        if (isSlip) hidden.add("showSignature");
        return SHOW_HIDE_ELEMENTS.filter((e) => !hidden.has(e.a4));
    })();

    function setField<K extends keyof VoucherTemplateDefaults>(
        field: K,
        value: VoucherTemplateDefaults[K],
    ) {
        setWorking((prev) => {
            const next = new Map(prev);
            const row = next.get(selectedKind);
            if (!row) return prev;
            next.set(selectedKind, { ...row, [field]: value });
            return next;
        });
    }

    async function handleSave() {
        if (!current || !isDirty) return;
        setSaving(true);
        try {
            const { kind, ...payload } = current;
            const { data } = await axios.put<VoucherTemplateDefaults>(
                `/api/settings/voucher-templates/${kind}`,
                payload,
            );
            const next = new Map(saved);
            next.set(selectedKind, data);
            setSaved(next);
            const w = new Map(working);
            w.set(selectedKind, data);
            setWorking(w);
            toast.success(`Saved ${KIND_LABEL[selectedKind]} template`);
        } catch (err) {
            toast.error(extractApiError(err, "Save failed"));
        } finally {
            setSaving(false);
        }
    }

    async function handleReset() {
        if (!window.confirm(
            `Reset the ${KIND_LABEL[selectedKind]} template to defaults? Your customisations for this kind will be lost.`,
        )) return;
        setResetting(true);
        try {
            const { data } = await axios.post<VoucherTemplateDefaults>(
                `/api/settings/voucher-templates/${selectedKind}/reset`,
            );
            const s = new Map(saved);    s.set(selectedKind, data); setSaved(s);
            const w = new Map(working);  w.set(selectedKind, data); setWorking(w);
            toast.success(`${KIND_LABEL[selectedKind]} template reset to defaults`);
        } catch (err) {
            toast.error(extractApiError(err, "Reset failed"));
        } finally {
            setResetting(false);
        }
    }

    function handleDiscard() {
        const w = new Map(working);
        w.set(selectedKind, baseline!);
        setWorking(w);
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-4">
            {/* Left: kind list — stays pinned while the form/preview scroll. */}
            <aside className="rounded-lg border bg-card p-2 self-start max-h-[calc(100vh-90px)] overflow-y-auto lg:sticky lg:top-2">
                <KindGroup
                    title="Accounting"
                    kinds={VOUCHER_TEMPLATE_KIND_GROUPS.accounting}
                    selected={selectedKind}
                    onSelect={setSelectedKind}
                    workingMap={working}
                    savedMap={saved}
                />
                <div className="my-2 border-t" />
                <KindGroup
                    title="Inventory"
                    kinds={VOUCHER_TEMPLATE_KIND_GROUPS.inventory}
                    selected={selectedKind}
                    onSelect={setSelectedKind}
                    workingMap={working}
                    savedMap={saved}
                />
                <div className="my-2 border-t" />
                <KindGroup
                    title="POS & Register"
                    kinds={VOUCHER_TEMPLATE_KIND_GROUPS.pos}
                    selected={selectedKind}
                    onSelect={setSelectedKind}
                    workingMap={working}
                    savedMap={saved}
                />
                <div className="my-2 border-t" />
                <KindGroup
                    title="Repair"
                    kinds={VOUCHER_TEMPLATE_KIND_GROUPS.repair}
                    selected={selectedKind}
                    onSelect={setSelectedKind}
                    workingMap={working}
                    savedMap={saved}
                />
                <div className="my-2 border-t" />
                <KindGroup
                    title="Marketing"
                    kinds={VOUCHER_TEMPLATE_KIND_GROUPS.marketing}
                    selected={selectedKind}
                    onSelect={setSelectedKind}
                    workingMap={working}
                    savedMap={saved}
                />
            </aside>

            {/* Right: editor + preview. Preview column is fixed-width so it
                 doesn't push the form into a sliver when A4 is selected
                 (A4 native = 210mm ≈ 793px). Preview itself fits inside via
                 CSS zoom. ─────────────────────────────────────────────── */}
            <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-4">
                {/* Form */}
                <div className="rounded-lg border bg-card p-4 space-y-3 min-w-0">
                    <header className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                            <h2 className="text-sm font-semibold">
                                {KIND_LABEL[selectedKind]} template
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                {isDirty ? "Unsaved changes" : "All changes saved"}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm" variant="ghost"
                                onClick={handleDiscard} disabled={!isDirty || saving}
                            >
                                <X className="mr-1 size-3.5" /> Discard
                            </Button>
                            <Button
                                size="sm" variant="outline"
                                onClick={handleReset} disabled={resetting || saving}
                            >
                                {resetting
                                    ? <Loader2 className="mr-1 size-3.5 animate-spin" />
                                    : <RotateCcw className="mr-1 size-3.5" />}
                                Reset defaults
                            </Button>
                            <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                                {saving
                                    ? <Loader2 className="mr-1 size-3.5 animate-spin" />
                                    : <Save className="mr-1 size-3.5" />}
                                Save
                            </Button>
                        </div>
                    </header>

                    {/* Header fields. The shipping label is a bare address card —
                        it only reads the From identity (name/address/phone) and the
                        footer line, so every other voucher-chrome field is hidden
                        for it rather than shown dead. */}
                    <fieldset className="space-y-2.5">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            {isLabel ? "From (sender)" : "Header"}
                        </legend>
                        <Field label={isLabel ? "Shop name" : "Header line 1 (brand name)"} hint="Blank → uses Organisation > Brand name.">
                            <Input
                                value={current.headerLine1}
                                onChange={(e) => setField("headerLine1", e.target.value)}
                                placeholder={organisation.brandName}
                            />
                        </Field>
                        {!isLabel && (
                            <Field label="Header line 2 (sub-title)">
                                <Input
                                    value={current.headerLine2}
                                    onChange={(e) => setField("headerLine2", e.target.value)}
                                />
                            </Field>
                        )}
                        <Field label={isLabel ? "Shop address" : "Address block"} hint="One address line per row. Blank → uses Organisation > Address.">
                            <Textarea
                                rows={2}
                                value={current.addressBlock}
                                onChange={(e) => setField("addressBlock", e.target.value)}
                                placeholder={organisation.addressLine1 ? `${organisation.addressLine1}\n${[organisation.city, organisation.state, organisation.pinCode].filter(Boolean).join(", ")}` : ""}
                            />
                        </Field>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label={isLabel ? "Shop phone" : "Phone line"} hint="Blank → uses Organisation > Phone.">
                                <Input
                                    value={current.phoneLine}
                                    onChange={(e) => setField("phoneLine", e.target.value)}
                                    placeholder={organisation.phone ? `Ph: ${organisation.phone}` : ""}
                                />
                            </Field>
                            {!isLabel && (
                                <Field label="GSTIN line" hint="Blank → uses Organisation > GSTIN.">
                                    <Input
                                        value={current.gstinLine}
                                        onChange={(e) => setField("gstinLine", e.target.value)}
                                        placeholder={organisation.gstin ? `GSTIN: ${organisation.gstin}` : ""}
                                    />
                                </Field>
                            )}
                        </div>
                        {!isLabel && (
                            <Field label="Logo URL (optional)" hint="Shown above the header if 'Show logo' is on. Blank → Organisation > Logo URL → bundled /logo.svg.">
                                <Input
                                    value={current.logoUrl}
                                    onChange={(e) => setField("logoUrl", e.target.value)}
                                    placeholder={organisation.logoUrl || "/logo.svg"}
                                />
                            </Field>
                        )}
                    </fieldset>

                    {/* Toggles — one row per element, an independent switch per format.
                        The label has THREE (Sheet · Thermal · TL 100×50) since it prints
                        to all three; vouchers have two (A4 · Thermal). Same switch table,
                        different rows + column count. */}
                    <fieldset className="space-y-2">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            {isLabel ? "Fields" : "Show / hide"}
                        </legend>
                        {(() => {
                        const cols = isLabel ? "grid-cols-[1fr_3.25rem_3.25rem_3.25rem]" : "grid-cols-[1fr_3.5rem_3.5rem]";
                        return (
                        <div className="rounded-md border overflow-hidden">
                            <div className={`grid ${cols} items-center gap-x-2 border-b bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wide font-medium text-muted-foreground`}>
                                <span>{isLabel ? "Field" : "Element"}</span>
                                <span className="text-center">{isLabel ? "Sheet" : "A4"}</span>
                                <span className="text-center">Thermal</span>
                                {isLabel && <span className="text-center">TL 100×50</span>}
                            </div>
                            {!isLabel && visibleElements.length === 0 && (
                                <div className="px-3 py-2 text-[10px] text-muted-foreground">
                                    This label has no toggleable elements — sender, receiver, order, courier and payment always print.
                                </div>
                            )}
                            {/* One typed row shape (tl optional) so the ternary is a single
                                array type — mapping a union of arrays would degrade el.tl to unknown. */}
                            {((isLabel ? LABEL_FIELD_ELEMENTS : visibleElements) as {
                                label: string; a4: BoolTemplateKey; thermal: BoolTemplateKey; tl?: BoolTemplateKey; a4Only?: boolean;
                            }[]).map((el) => (
                                <div
                                    key={el.label}
                                    className={`grid ${cols} items-center gap-x-2 border-b px-3 py-1.5 text-sm last:border-0`}
                                >
                                    <span className="truncate">{el.label}</span>
                                    <Switch
                                        className="justify-self-center"
                                        checked={current[el.a4]}
                                        onCheckedChange={(v) => setField(el.a4, v)}
                                    />
                                    {el.a4Only ? (
                                        <span className="justify-self-center text-muted-foreground">&mdash;</span>
                                    ) : (
                                        <Switch
                                            className="justify-self-center"
                                            checked={current[el.thermal]}
                                            onCheckedChange={(v) => setField(el.thermal, v)}
                                        />
                                    )}
                                    {isLabel && el.tl && (
                                        <Switch
                                            className="justify-self-center"
                                            checked={current[el.tl]}
                                            onCheckedChange={(v) => setField(el.tl!, v)}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                        );
                        })()}
                    </fieldset>

                    {/* Service Slip sign-off rows — each toggles independently. */}
                    {isSlip && (
                        <fieldset className="space-y-2">
                            <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                                Sign-off
                            </legend>
                            <div className="rounded-md border overflow-hidden">
                                <div className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-x-2 border-b bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                                    <span>Element</span>
                                    <span className="text-center">A4</span>
                                    <span className="text-center">Thermal</span>
                                </div>
                                {SLIP_SIGNOFF_ELEMENTS.map((el) => (
                                    <div
                                        key={el.a4}
                                        className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-x-2 border-b px-3 py-1.5 text-sm last:border-0"
                                    >
                                        <span className="truncate">{el.label}</span>
                                        <Switch
                                            className="justify-self-center"
                                            checked={current[el.a4]}
                                            onCheckedChange={(v) => setField(el.a4, v)}
                                        />
                                        <Switch
                                            className="justify-self-center"
                                            checked={current[el.thermal]}
                                            onCheckedChange={(v) => setField(el.thermal, v)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </fieldset>
                    )}

                    {/* Footer — the label prints only the footer line (its bottom
                        strip); terms / signature / disclaimer are voucher-only. */}
                    <fieldset className="space-y-2.5">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Footer
                        </legend>
                        <Field label="Footer line" hint={isLabel ? "Printed on the label's bottom strip, e.g. handling instructions." : undefined}>
                            <Input
                                value={current.footerLine}
                                onChange={(e) => setField("footerLine", e.target.value)}
                            />
                        </Field>
                        {!isLabel && (
                            <>
                                <Field label="Terms text" hint="Free-form; line breaks preserved.">
                                    <Textarea
                                        rows={2}
                                        value={current.termsText}
                                        onChange={(e) => setField("termsText", e.target.value)}
                                    />
                                </Field>
                                <Field label="Signature label" hint={isSlip ? "The shop's signature line on the slip (e.g. \"Sent by (Shop)\")." : undefined}>
                                    <Input
                                        value={current.signatureLabel}
                                        onChange={(e) => setField("signatureLabel", e.target.value)}
                                    />
                                </Field>
                                <Field label="Disclaimer line" hint="Printed at the very bottom, below the footer line. Blank hides it.">
                                    <Input
                                        value={current.disclaimerLine}
                                        onChange={(e) => setField("disclaimerLine", e.target.value)}
                                    />
                                </Field>
                            </>
                        )}
                    </fieldset>

                    {/* Paper — irrelevant for the label (it picks its own A4/A5/A6
                        and qty on the print page) and for the cards (fixed face). */}
                    {!isLabel && !isCard && (
                    <fieldset className="space-y-2.5">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Paper
                        </legend>
                        {hasDefaultPaper && (
                        <Field label="Default paper format" hint="Format this document opens on (its form has no Print / Thermal ticks).">
                            <div className="flex gap-2">
                                <PaperRadio
                                    label="A4"
                                    value="A4"
                                    selected={current.defaultPaper}
                                    onChange={(v) => setField("defaultPaper", v)}
                                />
                                <PaperRadio
                                    label="Thermal 80mm"
                                    value="THERMAL_80MM"
                                    selected={current.defaultPaper}
                                    onChange={(v) => setField("defaultPaper", v)}
                                />
                            </div>
                        </Field>
                        )}
                        {!hasDefaultPaper && (
                            <p className="text-[10px] text-muted-foreground">
                                No default paper here: the voucher form&apos;s Print / Thermal ticks decide per save — Thermal prints silently on the counter printer, otherwise the format-selection page opens.
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label="Thermal width (mm)" hint="Used only for thermal printing.">
                                <NumberField
                                    value={current.paperWidthMm}
                                    min={50}
                                    max={120}
                                    onCommit={(n) => setField("paperWidthMm", n)}
                                />
                            </Field>
                            <Field label="Thermal font family" hint="Browser print only — the thermal printer uses its built-in font.">
                                <Input
                                    value={current.fontFamily}
                                    onChange={(e) => setField("fontFamily", e.target.value)}
                                />
                            </Field>
                            <Field label="Thermal font size (px)" hint="Browser print only — the thermal printer uses its built-in font.">
                                <NumberField
                                    value={current.fontSizePx}
                                    min={8}
                                    max={20}
                                    onCommit={(n) => setField("fontSizePx", n)}
                                />
                            </Field>
                        </div>
                    </fieldset>
                    )}
                </div>

                {/* Preview — sticks in view while the config form scrolls (xl+);
                    A4 native is 210mm so we scale it down with CSS zoom to fit.
                    Thermal (~320px) renders at native size. Use "Full size" for a
                    native-scale popup. ─────────────────────────────────── */}
                <div className="space-y-2 min-w-0 xl:sticky xl:top-2 xl:self-start">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Live preview
                        </p>
                        <div className="flex items-center gap-1.5">
                            {/* The label previews each of its formats — Sheet (A6 card),
                                Thermal (80mm strip), 100×50 (DT die-cut); vouchers
                                pick A4/Thermal/default. */}
                            {isLabel && (
                                <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-xs">
                                    <PreviewToggle label="Sheet" active={labelPreviewFormat === "sheet"} onClick={() => setLabelPreviewFormat("sheet")} />
                                    <PreviewToggle label="Thermal" active={labelPreviewFormat === "thermal"} onClick={() => setLabelPreviewFormat("thermal")} />
                                    <PreviewToggle label="TL 100×50" active={labelPreviewFormat === "tl"} onClick={() => setLabelPreviewFormat("tl")} />
                                </div>
                            )}
                            {/* The parcel label previews its 4×6 face only (its A4/roll
                                variants share the same face). */}
                            {!isLabel && !isParcelLabel && !isCard && (
                                <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-xs">
                                    <PreviewToggle
                                        label="As default"
                                        hint={`Showing ${kindDefaultPaper === "A4" ? "A4" : "Thermal"} (default)`}
                                        active={previewOverride === null}
                                        onClick={() => setPreviewOverride(null)}
                                    />
                                    <PreviewToggle
                                        label="A4"
                                        active={previewOverride === "A4"}
                                        onClick={() => setPreviewOverride("A4")}
                                    />
                                    <PreviewToggle
                                        label="Thermal"
                                        active={previewOverride === "THERMAL_80MM"}
                                        onClick={() => setPreviewOverride("THERMAL_80MM")}
                                    />
                                </div>
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => setExpanded(true)}
                                title="Open a full-size preview"
                            >
                                <Maximize2 size={13} /> Full size
                            </Button>
                        </div>
                    </div>
                    {isCard ? (
                        <div className="flex justify-center rounded-md bg-muted/20 p-4">
                            {selectedKind === "COUPON"
                                ? <CouponCard template={mergedPreview} data={SAMPLE_COUPON_CARD} />
                                : <GiftCardCard template={mergedPreview} data={SAMPLE_GIFT_CARD} />}
                        </div>
                    ) : isParcelLabel ? (
                        <div className="flex justify-center rounded-md bg-muted/20 p-4">
                            <OrderParcelLabel data={parcelLabelData} previewMode />
                        </div>
                    ) : isLabel ? (
                        <div className="flex justify-center rounded-md bg-muted/20 p-4">
                            <ShippingLabel data={labelData} previewMode previewFormat={labelPreviewFormat} fields={labelFields} />
                        </div>
                    ) : (
                        <ScaledPreviewBox format={previewFormat}>
                            <ReceiptPreview
                                format={previewFormat}
                                // Merge with Organisation so blank template fields
                                // (no headerLine1, no GSTIN, etc.) fall back to the
                                // org-wide values exactly like the real print route.
                                template={mergedPreview}
                                sample={previewSample}
                                body={bespokeBody}
                                previewMode
                                previewFill
                            />
                        </ScaledPreviewBox>
                    )}
                </div>
            </section>

            {/* Full-size preview popup — renders the same slip at native scale
                (A4 ≈ 793px) inside a scrollable dialog. */}
            <Dialog open={expanded} onOpenChange={setExpanded}>
                {/* sm:max-w override beats shadcn's default sm:max-w-lg (512px),
                    which otherwise clips the A4 (≈793px). */}
                <DialogContent className="w-[95vw] max-w-[900px] sm:max-w-[900px] p-0 gap-0">
                    <DialogHeader className="px-5 pt-5 pb-3">
                        <DialogTitle>
                            {KIND_LABEL[selectedKind]} — {previewFormat === "A4" ? "A4" : "Thermal 80mm"} preview
                        </DialogTitle>
                    </DialogHeader>
                    <div className="overflow-auto bg-muted/20 px-5 pb-5" style={{ maxHeight: "82vh" }}>
                        <div className="flex justify-center py-2">
                            {isParcelLabel ? (
                                <OrderParcelLabel data={parcelLabelData} previewMode />
                            ) : isLabel ? (
                                <ShippingLabel data={labelData} previewMode previewFormat={labelPreviewFormat} fields={labelFields} />
                            ) : (
                                <ReceiptPreview
                                    format={previewFormat}
                                    template={mergedPreview}
                                    sample={previewSample}
                                    body={bespokeBody}
                                    previewMode
                                    previewFill
                                />
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function PaperRadio({
    label, value, selected, onChange,
}: { label: string; value: PaperFormat; selected: PaperFormat; onChange: (v: PaperFormat) => void }) {
    const on = selected === value;
    return (
        <button
            type="button"
            onClick={() => onChange(value)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                on ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted/60"
            }`}
        >
            {label}
        </button>
    );
}

function PreviewToggle({
    label, hint, active, onClick,
}: { label: string; hint?: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={hint}
            className={`rounded px-2 py-1 transition-colors ${
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted/60"
            }`}
        >
            {label}
        </button>
    );
}

function KindGroup({
    title, kinds, selected, onSelect, workingMap, savedMap,
}: {
    title: string;
    kinds: readonly VoucherTemplateKind[];
    selected: VoucherTemplateKind;
    onSelect: (k: VoucherTemplateKind) => void;
    workingMap: Map<VoucherTemplateKind, VoucherTemplateDefaults>;
    savedMap:   Map<VoucherTemplateKind, VoucherTemplateDefaults>;
}) {
    return (
        <div>
            <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                {title}
            </p>
            <ul className="space-y-0.5">
                {kinds.map((k) => {
                    const isSelected = selected === k;
                    const w = workingMap.get(k);
                    const s = savedMap.get(k);
                    const dirty = w && s && JSON.stringify(w) !== JSON.stringify(s);
                    return (
                        <li key={k}>
                            <button
                                type="button"
                                onClick={() => onSelect(k)}
                                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors ${
                                    isSelected
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "hover:bg-muted/60"
                                }`}
                            >
                                <span>{KIND_LABEL[k]}</span>
                                {dirty && (
                                    <span className="size-1.5 rounded-full bg-amber-500" title="Unsaved changes" />
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Field({
    label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs font-medium">{label}</Label>
            {children}
            {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
        </div>
    );
}

/**
 * Wraps the live preview so A4 (793px native) fits inside the editor's
 * fixed-width column without horizontal scroll. CSS `zoom` is a real layout
 * shrink (unlike `transform: scale`) so the parent's height adapts too.
 * Thermal slips render at native ~320px and don't need scaling.
 */
function ScaledPreviewBox({
    format, children,
}: { format: PaperFormat; children: React.ReactNode }) {
    const panelClass = "flex justify-center rounded-md border bg-muted/20 w-full overflow-x-hidden overflow-y-auto min-h-0 max-h-[calc(100vh-180px)]";

    if (format === "A4") {
        return (
            <div className={panelClass}>
                {/* Fill the preview panel instead of forcing a narrow 440px band.
                    The full-size dialog already provides native-scale inspection,
                    so the inline live preview should consume the available box width
                    while allowing vertical scroll for longer documents. */}
                <div className="w-full max-w-full" style={{ zoom: 0.62 }}>
                    {children}
                </div>
            </div>
        );
    }
    return (
        <div className={`${panelClass} p-2`}>
            <div className="w-full max-w-full">{children}</div>
        </div>
    );
}

