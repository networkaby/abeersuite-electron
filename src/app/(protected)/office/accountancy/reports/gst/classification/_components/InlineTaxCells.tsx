"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Inline editable cells for tax classification rows (products + groups).
//
// Three primitives:
//   • <RateCell>       — Select of active GstRate; empty = inherit
//   • <HsnCell>         — Text input (numeric IME); empty = inherit
//   • <TaxabilityCell>  — Select of Taxability enum; empty = inherit
//
// Each saves via PATCH on commit. The caller passes the target URL (so the
// same cells work for /api/inventory/products/:id and /api/inventory/product-groups/:id).
// Compact `source` chip is rendered to the right of the value when the cell is
// not in edit mode, indicating where the resolved value comes from.
//
// Per project rule: NO `input type="number"` — HSN uses plain text + inputMode.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type GstRateOpt = {
    id: number;
    rate: number;
    label: string;
    isActive: boolean;
};

export type CascadeSource =
    | "product"
    | "org-default"
    | { kind: "group"; groupId: number; groupName: string }
    | null;

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE", label: "Taxable" },
    { value: "EXEMPT", label: "Exempt" },
    { value: "NIL_RATED", label: "Nil rated" },
    { value: "NON_GST", label: "Non-GST" },
] as const;

const TAXABILITY_LABEL: Record<string, string> = Object.fromEntries(
    TAXABILITY_OPTIONS.map((o) => [o.value, o.label]),
);

const NONE = "__none__";

function SourceChip({ source }: { source: CascadeSource }) {
    if (!source) {
        return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">unset</span>;
    }
    if (source === "product") {
        return <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">own</span>;
    }
    if (source === "org-default") {
        return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">org</span>;
    }
    return (
        <span
            className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
            title={`Inherited from group: ${source.groupName}`}
        >
            grp
        </span>
    );
}

export function CascadeSourceChip({ source }: { source: CascadeSource }) {
    return <SourceChip source={source} />;
}

interface BaseCellProps {
    /** URL the PATCH hits — `/api/inventory/products/123` or `/api/inventory/product-groups/9`. */
    patchUrl: string;
    /** Called after a successful PATCH so the parent can refresh data. */
    onSaved: () => void;
    /** When false, renders read-only (no edit affordance). */
    canEdit: boolean;
}

// ── GST Rate cell ──────────────────────────────────────────────────────────

interface RateCellProps extends BaseCellProps {
    ownRateId: number | null;
    resolvedRate: number | null;
    resolvedSource: CascadeSource;
    rates: GstRateOpt[];
}

export function RateCell({
    ownRateId,
    resolvedRate,
    resolvedSource,
    rates,
    patchUrl,
    onSaved,
    canEdit,
}: RateCellProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(ownRateId != null ? String(ownRateId) : NONE);
    const [saving, setSaving] = useState(false);

    async function commit(next: string) {
        const nextId = next === NONE ? null : parseInt(next, 10);
        setSaving(true);
        try {
            await axios.patch(patchUrl, { gstRateId: nextId });
            toast.success("GST rate updated");
            setEditing(false);
            onSaved();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Save failed" : "Save failed");
        } finally {
            setSaving(false);
        }
    }

    if (editing && canEdit) {
        return (
            <Select
                value={draft}
                onValueChange={(v) => { setDraft(v); commit(v); }}
                disabled={saving}
                open
                onOpenChange={(open) => { if (!open) setEditing(false); }}
            >
                <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={NONE}>— inherit —</SelectItem>
                    {rates.filter((r) => r.isActive).map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <span className={ownRateId != null ? "font-medium" : "italic text-muted-foreground"}>
                {resolvedRate != null ? `${resolvedRate.toFixed(resolvedRate % 1 === 0 ? 0 : 2)}%` : "—"}
            </span>
            <SourceChip source={resolvedSource} />
            {canEdit && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => setEditing(true)}
                    title="Edit GST rate"
                >
                    <Pencil className="size-3" />
                </Button>
            )}
        </div>
    );
}

// ── HSN / SAC cell ─────────────────────────────────────────────────────────

interface HsnCellProps extends BaseCellProps {
    ownHsn: string | null;
    resolvedHsn: string | null;
    resolvedSource: CascadeSource;
}

export function HsnCell({
    ownHsn,
    resolvedHsn,
    resolvedSource,
    patchUrl,
    onSaved,
    canEdit,
}: HsnCellProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(ownHsn ?? "");
    const [saving, setSaving] = useState(false);

    async function commit() {
        const trimmed = draft.trim();
        const nextValue = trimmed === "" ? null : trimmed;
        if ((nextValue ?? "") === (ownHsn ?? "")) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            await axios.patch(patchUrl, { hsnCode: nextValue });
            toast.success("HSN updated");
            setEditing(false);
            onSaved();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Save failed" : "Save failed");
        } finally {
            setSaving(false);
        }
    }

    if (editing && canEdit) {
        return (
            <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    if (e.key === "Escape") { setDraft(ownHsn ?? ""); setEditing(false); }
                }}
                disabled={saving}
                inputMode="numeric"
                maxLength={32}
                placeholder="— inherit —"
                className="h-7 w-28 font-mono text-xs"
            />
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <span className={ownHsn ? "font-mono font-medium" : "italic text-muted-foreground"}>
                {resolvedHsn ?? "—"}
            </span>
            <SourceChip source={resolvedSource} />
            {canEdit && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => { setDraft(ownHsn ?? ""); setEditing(true); }}
                    title="Edit HSN / SAC"
                >
                    <Pencil className="size-3" />
                </Button>
            )}
        </div>
    );
}

// ── Taxability cell ────────────────────────────────────────────────────────

interface TaxabilityCellProps extends BaseCellProps {
    ownTaxability: string | null;
    resolvedTaxability: string | null;
    resolvedSource: CascadeSource;
}

export function TaxabilityCell({
    ownTaxability,
    resolvedTaxability,
    resolvedSource,
    patchUrl,
    onSaved,
    canEdit,
}: TaxabilityCellProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(ownTaxability ?? NONE);
    const [saving, setSaving] = useState(false);

    async function commit(next: string) {
        const nextValue = next === NONE ? null : next;
        setSaving(true);
        try {
            await axios.patch(patchUrl, { taxability: nextValue });
            toast.success("Taxability updated");
            setEditing(false);
            onSaved();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Save failed" : "Save failed");
        } finally {
            setSaving(false);
        }
    }

    if (editing && canEdit) {
        return (
            <Select
                value={draft}
                onValueChange={(v) => { setDraft(v); commit(v); }}
                disabled={saving}
                open
                onOpenChange={(open) => { if (!open) setEditing(false); }}
            >
                <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={NONE}>— inherit —</SelectItem>
                    {TAXABILITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <span className={ownTaxability ? "font-medium" : "italic text-muted-foreground"}>
                {resolvedTaxability ? TAXABILITY_LABEL[resolvedTaxability] ?? resolvedTaxability : "—"}
            </span>
            <SourceChip source={resolvedSource} />
            {canEdit && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => { setDraft(ownTaxability ?? NONE); setEditing(true); }}
                    title="Edit taxability"
                >
                    <Pencil className="size-3" />
                </Button>
            )}
        </div>
    );
}
