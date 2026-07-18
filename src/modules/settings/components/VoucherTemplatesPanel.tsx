"use client";

import { useMemo, useState } from "react";
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
import {
    VOUCHER_TEMPLATE_KIND_GROUPS,
    type VoucherTemplateDefaults,
    type VoucherTemplateKind,
    type PaperFormat,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { mergeTemplateWithOrg } from "@/shared/lib/print/mergeTemplateWithOrg";
import type { OrganisationView } from "@/shared/lib/org/organisationView";
import { buildSampleForKind, VOUCHER_KIND_LABEL as KIND_LABEL } from "@/modules/settings/lib/voucherTemplateSamples";

interface Props {
    initialTemplates: VoucherTemplateDefaults[];
    organisation:     OrganisationView;
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
    const n = parseInt(parseDigitsInput(raw), 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

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

    // Which paper the preview shows, and the org-merged template both the inline
    // preview and the full-size popup render.
    const previewFormat = previewOverride ?? current.defaultPaper;
    const mergedPreview = mergeTemplateWithOrg(current, organisation);

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
            {/* Left: kind list ─────────────────────────────────────────── */}
            <aside className="rounded-lg border bg-card p-2 h-fit max-h-[80vh] overflow-y-auto">
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
                    title="Repair"
                    kinds={VOUCHER_TEMPLATE_KIND_GROUPS.repair}
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
            <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_740px] gap-4">
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

                    {/* Header fields */}
                    <fieldset className="space-y-2.5">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Header
                        </legend>
                        <Field label="Header line 1 (brand name)" hint="Blank → uses Organisation > Brand name.">
                            <Input
                                value={current.headerLine1}
                                onChange={(e) => setField("headerLine1", e.target.value)}
                                placeholder={organisation.brandName}
                            />
                        </Field>
                        <Field label="Header line 2 (sub-title)">
                            <Input
                                value={current.headerLine2}
                                onChange={(e) => setField("headerLine2", e.target.value)}
                            />
                        </Field>
                        <Field label="Address block" hint="One address line per row. Blank → uses Organisation > Address.">
                            <Textarea
                                rows={2}
                                value={current.addressBlock}
                                onChange={(e) => setField("addressBlock", e.target.value)}
                                placeholder={organisation.addressLine1 ? `${organisation.addressLine1}\n${[organisation.city, organisation.state, organisation.pinCode].filter(Boolean).join(", ")}` : ""}
                            />
                        </Field>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="Phone line" hint="Blank → uses Organisation > Phone.">
                                <Input
                                    value={current.phoneLine}
                                    onChange={(e) => setField("phoneLine", e.target.value)}
                                    placeholder={organisation.phone ? `Ph: ${organisation.phone}` : ""}
                                />
                            </Field>
                            <Field label="GSTIN line" hint="Blank → uses Organisation > GSTIN.">
                                <Input
                                    value={current.gstinLine}
                                    onChange={(e) => setField("gstinLine", e.target.value)}
                                    placeholder={organisation.gstin ? `GSTIN: ${organisation.gstin}` : ""}
                                />
                            </Field>
                        </div>
                        <Field label="Logo URL (optional)" hint="Shown above the header if 'Show logo' is on. Blank → Organisation > Logo URL → bundled /logo.svg.">
                            <Input
                                value={current.logoUrl}
                                onChange={(e) => setField("logoUrl", e.target.value)}
                                placeholder={organisation.logoUrl || "/logo.svg"}
                            />
                        </Field>
                    </fieldset>

                    {/* Toggles */}
                    <fieldset className="space-y-2">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Show / hide
                        </legend>
                        {/* Every element has an independent A4 (left) + Thermal
                            (right) toggle — each print format respects its own
                            template. */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                            <ToggleRow label="Logo · A4"      on={current.showLogo}        onChange={(v) => setField("showLogo", v)} />
                            <ToggleRow label="Logo · Thermal" on={current.showLogoThermal} onChange={(v) => setField("showLogoThermal", v)} />
                            <ToggleRow label="Header text · A4"      on={current.showHeaderText}        onChange={(v) => setField("showHeaderText", v)} />
                            <ToggleRow label="Header text · Thermal" on={current.showHeaderTextThermal} onChange={(v) => setField("showHeaderTextThermal", v)} />
                            <ToggleRow label="HO address · A4"      on={current.showAddress}        onChange={(v) => setField("showAddress", v)} />
                            <ToggleRow label="HO address · Thermal" on={current.showAddressThermal} onChange={(v) => setField("showAddressThermal", v)} />
                            <ToggleRow label="Branch address · A4"      on={current.showBranchAddress}        onChange={(v) => setField("showBranchAddress", v)} />
                            <ToggleRow label="Branch address · Thermal" on={current.showBranchAddressThermal} onChange={(v) => setField("showBranchAddressThermal", v)} />
                            <ToggleRow label="Phone · A4"      on={current.showPhone}        onChange={(v) => setField("showPhone", v)} />
                            <ToggleRow label="Phone · Thermal" on={current.showPhoneThermal} onChange={(v) => setField("showPhoneThermal", v)} />
                            <ToggleRow label="GSTIN · A4"      on={current.showGstin}        onChange={(v) => setField("showGstin", v)} />
                            <ToggleRow label="GSTIN · Thermal" on={current.showGstinThermal} onChange={(v) => setField("showGstinThermal", v)} />
                            <ToggleRow label="Tax summary · A4"      on={current.showTaxSummary}        onChange={(v) => setField("showTaxSummary", v)} />
                            <ToggleRow label="Tax summary · Thermal" on={current.showTaxSummaryThermal} onChange={(v) => setField("showTaxSummaryThermal", v)} />
                            <ToggleRow label="MRP (struck) · A4"      on={current.showMrp}        onChange={(v) => setField("showMrp", v)} />
                            <ToggleRow label="MRP (struck) · Thermal" on={current.showMrpThermal} onChange={(v) => setField("showMrpThermal", v)} />
                            <ToggleRow label="Signature · A4"      on={current.showSignature}        onChange={(v) => setField("showSignature", v)} />
                            <ToggleRow label="Signature · Thermal" on={current.showSignatureThermal} onChange={(v) => setField("showSignatureThermal", v)} />
                            <ToggleRow label="Barcode · A4"      on={current.showBarcode}        onChange={(v) => setField("showBarcode", v)} />
                            <ToggleRow label="Barcode · Thermal" on={current.showBarcodeThermal} onChange={(v) => setField("showBarcodeThermal", v)} />
                        </div>
                    </fieldset>

                    {/* Footer */}
                    <fieldset className="space-y-2.5">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Footer
                        </legend>
                        <Field label="Footer line">
                            <Input
                                value={current.footerLine}
                                onChange={(e) => setField("footerLine", e.target.value)}
                            />
                        </Field>
                        <Field label="Terms text" hint="Free-form; line breaks preserved.">
                            <Textarea
                                rows={2}
                                value={current.termsText}
                                onChange={(e) => setField("termsText", e.target.value)}
                            />
                        </Field>
                        <Field label="Signature label">
                            <Input
                                value={current.signatureLabel}
                                onChange={(e) => setField("signatureLabel", e.target.value)}
                            />
                        </Field>
                    </fieldset>

                    {/* Paper */}
                    <fieldset className="space-y-2.5">
                        <legend className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Paper
                        </legend>
                        <Field label="Default paper format" hint="Used when the print button doesn't pass a paper override.">
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label="Thermal width (mm)" hint="Used only for thermal printing.">
                                <Input
                                    inputMode="numeric"
                                    value={String(current.paperWidthMm)}
                                    onChange={(e) => setField("paperWidthMm", clampInt(e.target.value, 50, 120, current.paperWidthMm))}
                                />
                            </Field>
                            <Field label="Thermal font family">
                                <Input
                                    value={current.fontFamily}
                                    onChange={(e) => setField("fontFamily", e.target.value)}
                                />
                            </Field>
                            <Field label="Thermal font size (px)">
                                <Input
                                    inputMode="numeric"
                                    value={String(current.fontSizePx)}
                                    onChange={(e) => setField("fontSizePx", clampInt(e.target.value, 8, 20, current.fontSizePx))}
                                />
                            </Field>
                        </div>
                    </fieldset>
                </div>

                {/* Preview — pinned to its column (xl: 480px); A4 native is
                    210mm so we scale it down with CSS zoom to fit. Thermal
                    (~320px) renders at native size. Use "Full size" for a
                    native-scale popup. ─────────────────────────────────── */}
                <div className="space-y-2 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                            Live preview
                        </p>
                        <div className="flex items-center gap-1.5">
                            <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-xs">
                                <PreviewToggle
                                    label="As default"
                                    hint={`Showing ${current.defaultPaper === "A4" ? "A4" : "Thermal"} (default)`}
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
                    <ScaledPreviewBox format={previewFormat}>
                        <ReceiptPreview
                            format={previewFormat}
                            // Merge with Organisation so blank template fields
                            // (no headerLine1, no GSTIN, etc.) fall back to the
                            // org-wide values exactly like the real print route.
                            template={mergedPreview}
                            sample={sample}
                            previewMode
                        />
                    </ScaledPreviewBox>
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
                            <ReceiptPreview
                                format={previewFormat}
                                template={mergedPreview}
                                sample={sample}
                                previewMode
                            />
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
    if (format === "A4") {
        return (
            <div className="rounded-md border bg-muted/20 overflow-auto" style={{ maxHeight: 720 }}>
                {/*  zoom shrinks layout box; widely supported in modern Chromium+Webkit
                     and is now also implemented in Firefox 126+. A4 native ≈ 793px →
                     0.90 fits the ~740px preview column. */}
                <div style={{ zoom: 0.90 }}>
                    {children}
                </div>
            </div>
        );
    }
    return (
        <div className="rounded-md border bg-muted/20 overflow-auto" style={{ maxHeight: 720 }}>
            <div className="flex justify-center p-2">{children}</div>
        </div>
    );
}

function ToggleRow({
    label, on, onChange,
}: { label: string; on: boolean; onChange: (v: boolean) => void }) {
    return (
        // Switch sits immediately before its label so the pairing is unambiguous
        // (justify-between pushed them to opposite cell edges — read as unrelated).
        <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0">
            <Switch checked={on} onCheckedChange={onChange} className="shrink-0" />
            <span className="truncate">{label}</span>
        </label>
    );
}
