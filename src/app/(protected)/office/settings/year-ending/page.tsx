"use client";

import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Pencil, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gridRowClass } from "@/shared/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
    assembleReference,
    fyClosingDate,
    fyStartDate,
    type SeriesShape,
    type YearFormat,
} from "@/modules/accountancy/lib/voucherRef";
import { TallyDateInput } from "@/shared/components/TallyDateInput";

interface SeriesRow extends SeriesShape {
    kind: string;
    label: string;
    updatedAt: string;
}

interface BooksConfig {
    id: number;
    restartMonth: number;
    restartDay: number;
    /// Org period anchors. Null = never stated; the page then PREFILLS the 1st
    /// of the current FY without saving it, so an install that has not been
    /// told its start date never quietly claims one.
    financialYearFrom: string | null;
    booksBeginningFrom: string | null;
    updatedAt: string;
}

interface ConfigDraft {
    restartMonth: number;
    restartDay: number;
    /** ISO yyyy-mm-dd, or "" for cleared. TallyDateInput binds these directly. */
    financialYearFrom: string;
    booksBeginningFrom: string;
}

const YEAR_FORMATS: { value: YearFormat; label: string; example: string }[] = [
    { value: "CALENDAR", label: "Calendar (2026)", example: "2026" },
    { value: "CALENDAR_SHORT", label: "Calendar short (26)", example: "26" },
    { value: "FY_SHORT", label: "Fiscal short (26-27)", example: "26-27" },
    { value: "FY_LONG", label: "Fiscal long (2026-27)", example: "2026-27" },
];

// Each preset is a CSV of reserved tokens (type/counter/year/number) and
// literals (anything else — e.g. "/" "-" "india"). Mix freely.
const PART_PRESETS = [
    "type,-,year,-,counter,number",
    "type,/,year,/,counter,number",
    "type,-,year,-,number",
    "type,/,number,/,year",
    "counter,number",
    "type,counter,number",
    "type,/,number",
];

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const VOUCHER_GROUPS: { title: string; kinds: string[] }[] = [
    {
        title: "Financial & GL Vouchers",
        kinds: ["CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE", "JOURNAL"],
    },
    {
        title: "Sales & Billing",
        kinds: ["SALE", "POS", "ONLINE_INVOICE", "ONLINE_ORDER", "ESTIMATE", "SALE_RETURN", "SALES_ORDER"],
    },
    {
        title: "Purchases & Inward",
        kinds: ["PURCHASE", "PURCHASE_RETURN", "PURCHASE_ORDER"],
    },
    {
        title: "Inventory & Warehouse",
        kinds: ["GRN", "CHALLAN", "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER", "REJECTION_IN", "REJECTION_OUT"],
    },
    {
        title: "Services & Repairs",
        kinds: ["REPAIR_TICKET"],
    },
];

function previewNext(row: SeriesShape, sampleCounter = 24): string {
    return assembleReference({ ...row, nextSeq: row.nextSeq + 1 }, sampleCounter);
}

function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** API datetime → the ISO yyyy-mm-dd TallyDateInput binds. "" when unset. */
function isoDay(v: string | null | undefined): string {
    return v ? v.slice(0, 10) : "";
}

/** "2023-04-01" → "1 Apr 2023", for the sentence under the fields. */
function fmtHuman(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

export default function YearEndingPage() {
    const [series, setSeries] = useState<SeriesRow[]>([]);
    const [config, setConfig] = useState<BooksConfig | null>(null);
    const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);
    const [savingConfig, setSavingConfig] = useState(false);
    const [loading, setLoading] = useState(true);
    const [editKind, setEditKind] = useState<string | null>(null);
    const [draft, setDraft] = useState<SeriesRow | null>(null);
    const [saving, setSaving] = useState(false);
    const [resetKind, setResetKind] = useState<string | null>(null);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        Promise.all([
            axios.get<SeriesRow[]>("/api/accountancy/voucher-series"),
            axios.get<BooksConfig>("/api/accountancy/books-config"),
        ])
            .then(([s, c]) => {
                setSeries(s.data);
                setConfig(c.data);
                // Unset anchors open showing the 1st of the CURRENT financial
                // year, computed from the very restart day this page sets, so
                // the common case is one click. Nothing is written until Save.
                const fyDefault = fmtDate(fyStartDate(c.data.restartMonth, c.data.restartDay));
                setConfigDraft({
                    restartMonth:       c.data.restartMonth,
                    restartDay:         c.data.restartDay,
                    financialYearFrom:  isoDay(c.data.financialYearFrom)  || fyDefault,
                    booksBeginningFrom: isoDay(c.data.booksBeginningFrom) || fyDefault,
                });
            })
            .catch(() => toast.error("Failed to load year-ending settings"))
            .finally(() => setLoading(false));
    }, []);

    const configDirty = Boolean(
        config && configDraft &&
        (config.restartMonth !== configDraft.restartMonth ||
         config.restartDay   !== configDraft.restartDay ||
         // Prefilled-but-unsaved counts as dirty on purpose: the whole point of
         // the prefill is that Save is there to accept it.
         isoDay(config.financialYearFrom)  !== configDraft.financialYearFrom ||
         isoDay(config.booksBeginningFrom) !== configDraft.booksBeginningFrom),
    );

    async function saveConfig() {
        if (!configDraft) return;
        setSavingConfig(true);
        try {
            // "" means cleared — sent as null, not as an empty string zod would
            // refuse to coerce into a date.
            const { data } = await axios.patch<BooksConfig>("/api/accountancy/books-config", {
                ...configDraft,
                financialYearFrom:  configDraft.financialYearFrom  || null,
                booksBeginningFrom: configDraft.booksBeginningFrom || null,
            });
            setConfig(data);
            toast.success("Books settings updated");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save");
        } finally {
            setSavingConfig(false);
        }
    }

    function openEdit(row: SeriesRow) {
        setEditKind(row.kind);
        setDraft({ ...row });
    }

    async function handleSave() {
        if (!draft || !editKind) return;
        setSaving(true);
        try {
            const payload = {
                label: draft.label,
                typeEnabled: draft.typeEnabled,
                typeValue: draft.typeValue,
                counterEnabled: draft.counterEnabled,
                yearEnabled: draft.yearEnabled,
                yearFormat: draft.yearFormat,
                startFrom: draft.startFrom,
                padWidth: draft.padWidth,
                partOrder: draft.partOrder,
            };
            const { data } = await axios.patch<SeriesRow>(`/api/accountancy/voucher-series/${editKind}`, payload);
            setSeries((prev) => prev.map((r) => (r.kind === editKind ? data : r)));
            setEditKind(null);
            setDraft(null);
            toast.success("Voucher series updated");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    async function handleReset(kind: string) {
        setResetting(true);
        try {
            const { data } = await axios.post<SeriesRow>(`/api/accountancy/voucher-series/${kind}/reset`);
            setSeries((prev) => prev.map((r) => (r.kind === kind ? data : r)));
            setResetKind(null);
            toast.success("Counter reset to 0");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to reset");
        } finally {
            setResetting(false);
        }
    }

    const resetRow = series.find((r) => r.kind === resetKind);
    const previewLengthNote = useMemo(
        () => (draft ? previewNext(draft).length : 0),
        [draft],
    );

    const draftTokens = (draft?.partOrder ?? "").split(",").map((p) => p.trim());
    const hasCounterToken = draftTokens.includes("counter");
    const hasNumberToken = draftTokens.includes("number");
    const partOrderError = draft
        ? (!hasCounterToken && !hasNumberToken
            ? "Both 'counter' and 'number' tokens are mandatory in part order."
            : !hasCounterToken
                ? "The 'counter' token is mandatory in part order."
                : !hasNumberToken
                    ? "The 'number' token is mandatory in part order."
                    : null)
        : null;

    return (
        <ScrollArea className="h-full w-full" type="always">
            <div className="mx-auto min-w-0 max-w-full space-y-6 p-6">
                <div>
                    <h1 className="text-xl font-semibold">Year Ending — Voucher Numbering</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The Books Restart date below applies to every voucher series. When today crosses it,
                        each series advances its year part and resets its counter automatically.
                    </p>
                </div>

                {/* Books Restart — global setting */}
                <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-sm font-semibold">Books restart on</div>
                            <p className="text-xs text-muted-foreground">
                                Common closing/restart date for every voucher type (e.g. 1 April for Indian FY).
                            </p>
                        </div>
                        {configDraft && (
                            <div className="flex items-end gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Month</Label>
                                    <Select
                                        value={String(configDraft.restartMonth)}
                                        onValueChange={(v) =>
                                            setConfigDraft((d) => d && { ...d, restartMonth: Number(v) })
                                        }
                                    >
                                        <SelectTrigger className="h-9 w-36">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {MONTHS.map((m, i) => (
                                                <SelectItem key={i} value={String(i + 1)}>
                                                    {m}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Day</Label>
                                    <Input
                                        type="text"
                                        inputMode="numeric"
                                        className="h-9 w-20"
                                        value={configDraft.restartDay}
                                        onChange={(e) =>
                                            setConfigDraft((d) => d && { ...d, restartDay: Number(e.target.value) })
                                        }
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    onClick={saveConfig}
                                    disabled={!configDirty || savingConfig}
                                >
                                    <Save className="mr-1 size-3.5" />
                                    {savingConfig ? "Saving…" : "Save"}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Books beginning — org period anchors */}
                {configDraft && (
                    <div className="rounded-lg border bg-card p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-sm font-semibold">Books beginning</div>
                                <p className="text-xs text-muted-foreground">
                                    From which date this software holds our books. Anything earlier
                                    belongs to the previous software or register — and cannot be
                                    entered here.
                                </p>
                            </div>
                            <div className="flex items-end gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">First financial year from</Label>
                                    <TallyDateInput
                                        className="h-9 w-36"
                                        value={configDraft.financialYearFrom}
                                        onValueChange={(iso) =>
                                            setConfigDraft((d) => d && { ...d, financialYearFrom: iso })
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Books beginning from</Label>
                                    <TallyDateInput
                                        className="h-9 w-36"
                                        value={configDraft.booksBeginningFrom}
                                        onValueChange={(iso) =>
                                            setConfigDraft((d) => d && { ...d, booksBeginningFrom: iso })
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                        {/* Read from the SAVED config, not the draft — this sentence states
                            what the software will actually enforce, not what is typed. */}
                        {config?.booksBeginningFrom && (
                            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                                Before{" "}
                                <span className="font-medium text-foreground">
                                    {fmtHuman(isoDay(config.booksBeginningFrom))}
                                </span>{" "}
                                — look in the old books.
                                {config.financialYearFrom &&
                                    isoDay(config.financialYearFrom) !== isoDay(config.booksBeginningFrom) && (
                                    <>
                                        {" "}The financial year starting{" "}
                                        {fmtHuman(isoDay(config.financialYearFrom))} is only PART here —
                                        its earlier months are in the old books.
                                    </>
                                )}
                            </p>
                        )}
                        {!config?.booksBeginningFrom && (
                            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                                Not set yet — the dates above are only a suggestion. Until you save
                                them, a voucher may be dated any day at all.
                            </p>
                        )}
                    </div>
                )}

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <div className="rounded-lg border bg-card overflow-x-auto shadow-xs">
                        <Table className="min-w-237.5 whitespace-nowrap">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Voucher Type</TableHead>
                                    <TableHead>Type Code</TableHead>
                                    <TableHead>FY Start</TableHead>
                                    <TableHead>Closes</TableHead>
                                    <TableHead>Order</TableHead>
                                    <TableHead className="text-right">Issued</TableHead>
                                    <TableHead>Next Number</TableHead>
                                    <TableHead className="text-right">Len</TableHead>
                                    <TableHead className="text-right pr-4">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {VOUCHER_GROUPS.map((group) => {
                                    const groupRows = series.filter((s) => group.kinds.includes(s.kind));
                                    if (groupRows.length === 0) return null;
                                    return (
                                        <React.Fragment key={group.title}>
                                            <TableRow className="bg-muted/40 hover:bg-muted/40 border-y">
                                                <TableCell
                                                    colSpan={9}
                                                    className="py-2 px-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <span>{group.title}</span>
                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                                            {groupRows.length}
                                                        </Badge>
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                            {groupRows.map((row, index) => {
                                                const next = previewNext(row);
                                                const closing =
                                                    row.fyStartYear != null && config
                                                        ? fmtDate(fyClosingDate(row.fyStartYear, config.restartMonth, config.restartDay))
                                                        : "—";
                                                return (
                                                    <TableRow
                                                        key={row.kind}
                                                        className={gridRowClass({ odd: index % 2 === 1 })}
                                                    >
                                                        <TableCell>
                                                            <div className="font-medium">{row.label}</div>
                                                            <code className="text-xs text-muted-foreground">{row.kind}</code>
                                                        </TableCell>
                                                        <TableCell>
                                                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                                                {row.typeEnabled ? row.typeValue || "—" : <span className="opacity-50">off</span>}
                                                            </code>
                                                        </TableCell>
                                                        <TableCell className="text-sm">{row.fyStartYear ?? "—"}</TableCell>
                                                        <TableCell className="text-sm">{closing}</TableCell>
                                                        <TableCell>
                                                            <code className="text-xs text-muted-foreground">{row.partOrder}</code>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Badge variant="secondary">{row.nextSeq}</Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{next}</code>
                                                        </TableCell>
                                                        <TableCell className="text-right text-xs text-muted-foreground">
                                                            {next.length}
                                                        </TableCell>
                                                        <TableCell className="text-right pr-4">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <Button size="sm" variant="outline" onClick={() => openEdit(row)} title="Edit">
                                                                    <Pencil className="size-3.5" />
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => setResetKind(row.kind)}
                                                                    title="Reset counter"
                                                                >
                                                                    <RotateCcw className="size-3.5" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                                {(() => {
                                    const assigned = new Set(VOUCHER_GROUPS.flatMap((g) => g.kinds));
                                    const extraRows = series.filter((s) => !assigned.has(s.kind));
                                    if (extraRows.length === 0) return null;
                                    return (
                                        <React.Fragment key="other">
                                            <TableRow className="bg-muted/40 hover:bg-muted/40 border-y">
                                                <TableCell
                                                    colSpan={9}
                                                    className="py-2 px-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <span>Other Vouchers</span>
                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                                            {extraRows.length}
                                                        </Badge>
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                            {extraRows.map((row, index) => {
                                                const next = previewNext(row);
                                                const closing =
                                                    row.fyStartYear != null && config
                                                        ? fmtDate(fyClosingDate(row.fyStartYear, config.restartMonth, config.restartDay))
                                                        : "—";
                                                return (
                                                    <TableRow
                                                        key={row.kind}
                                                        className={gridRowClass({ odd: index % 2 === 1 })}
                                                    >
                                                        <TableCell>
                                                            <div className="font-medium">{row.label}</div>
                                                            <code className="text-xs text-muted-foreground">{row.kind}</code>
                                                        </TableCell>
                                                        <TableCell>
                                                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                                                {row.typeEnabled ? row.typeValue || "—" : <span className="opacity-50">off</span>}
                                                            </code>
                                                        </TableCell>
                                                        <TableCell className="text-sm">{row.fyStartYear ?? "—"}</TableCell>
                                                        <TableCell className="text-sm">{closing}</TableCell>
                                                        <TableCell>
                                                            <code className="text-xs text-muted-foreground">{row.partOrder}</code>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Badge variant="secondary">{row.nextSeq}</Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{next}</code>
                                                        </TableCell>
                                                        <TableCell className="text-right text-xs text-muted-foreground">
                                                            {next.length}
                                                        </TableCell>
                                                        <TableCell className="text-right pr-4">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <Button size="sm" variant="outline" onClick={() => openEdit(row)} title="Edit">
                                                                    <Pencil className="size-3.5" />
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => setResetKind(row.kind)}
                                                                    title="Reset counter"
                                                                >
                                                                    <RotateCcw className="size-3.5" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })()}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {/* Edit dialog */}
                <Dialog
                    open={!!editKind}
                    onOpenChange={(open) => {
                        if (!open) {
                            setEditKind(null);
                            setDraft(null);
                        }
                    }}
                >
                    <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl">
                        <DialogHeader className="border-b px-6 py-4">
                            <DialogTitle>Configure {draft?.label}</DialogTitle>
                            <DialogDescription className="text-xs">
                                Toggle each part on/off, set min width (zero padding), and reorder via the part-order field.
                                Books restart date is configured once on the main page.
                            </DialogDescription>
                        </DialogHeader>

                        {draft && (
                            <ScrollArea className="flex-1">
                                <div className="space-y-4 px-6 py-4">
                                    {/* Type + User parts side-by-side */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <fieldset className="space-y-2 rounded border p-3">
                                            <legend className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide">
                                                <Switch
                                                    checked={draft.typeEnabled}
                                                    onCheckedChange={(v) => setDraft((d) => d && { ...d, typeEnabled: v })}
                                                />
                                                Type part
                                            </legend>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Code (e.g. CV, PV)</Label>
                                                <Input
                                                    className="h-8"
                                                    value={draft.typeValue}
                                                    onChange={(e) => setDraft((d) => d && { ...d, typeValue: e.target.value })}
                                                    disabled={!draft.typeEnabled}
                                                />
                                            </div>
                                        </fieldset>

                                        <fieldset className="space-y-2 rounded border p-3 bg-muted/20">
                                            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">MANDATORY</Badge>
                                                Counter part
                                            </legend>
                                            <p className="text-[11px] text-muted-foreground">
                                                Billing station / POS counter number (e.g. 24).
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                Always embedded before number part (e.g. <span className="font-mono font-semibold text-foreground">24368</span>).
                                            </p>
                                        </fieldset>
                                    </div>

                                    {/* Year + Number side-by-side */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <fieldset className="space-y-2 rounded border p-3">
                                            <legend className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide">
                                                <Switch
                                                    checked={draft.yearEnabled}
                                                    onCheckedChange={(v) => setDraft((d) => d && { ...d, yearEnabled: v })}
                                                />
                                                Year part
                                            </legend>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Format</Label>
                                                <Select
                                                    value={draft.yearFormat}
                                                    onValueChange={(v) => setDraft((d) => d && { ...d, yearFormat: v })}
                                                    disabled={!draft.yearEnabled}
                                                >
                                                    <SelectTrigger className="h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {YEAR_FORMATS.map((f) => (
                                                            <SelectItem key={f.value} value={f.value}>
                                                                {f.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </fieldset>

                                        <fieldset className="space-y-2 rounded border p-3">
                                            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Number part (always on)
                                            </legend>
                                            <div className="grid grid-cols-3 gap-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Start</Label>
                                                    <Input
                                                        type="text"
                                                        inputMode="numeric"
                                                        className="h-8"
                                                        value={draft.startFrom}
                                                        onChange={(e) =>
                                                            setDraft((d) => d && { ...d, startFrom: Number(e.target.value) })
                                                        }
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Min Width</Label>
                                                    <Input
                                                        type="text"
                                                        inputMode="numeric"
                                                        className="h-8"
                                                        value={draft.padWidth}
                                                        onChange={(e) =>
                                                            setDraft((d) => d && { ...d, padWidth: Number(e.target.value) })
                                                        }
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Issued</Label>
                                                    <Input className="h-8" value={draft.nextSeq} disabled />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground mt-1.5">
                                                Zero-padded minimum digits (e.g. 0001). Auto-expands to 5+ digits when numbers grow.
                                            </p>
                                        </fieldset>
                                    </div>

                                    {/* Assembly — tokens + literals mixed CSV */}
                                    <fieldset className="space-y-3 rounded border p-3">
                                        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                            Part order &amp; separators
                                        </legend>
                                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                                            CSV of pieces. Reserved tokens{" "}
                                            <code className="rounded bg-muted px-1 text-[10px]">type</code>{" "}
                                            <code className="rounded bg-muted px-1 text-[10px]">counter</code>{" "}
                                            <code className="rounded bg-muted px-1 text-[10px]">year</code>{" "}
                                            <code className="rounded bg-muted px-1 text-[10px]">number</code>{" "}
                                            expand to their values. Anything else is taken as literal text — use it for
                                            separators (<code className="text-[10px]">/</code>,{" "}
                                            <code className="text-[10px]">-</code>) or labels (e.g.{" "}
                                            <code className="text-[10px]">india</code>).
                                        </p>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Preset</Label>
                                            <Select
                                                value={
                                                    PART_PRESETS.includes(draft.partOrder) ? draft.partOrder : "custom"
                                                }
                                                onValueChange={(v) => {
                                                    if (v !== "custom") {
                                                        setDraft((d) => d && { ...d, partOrder: v });
                                                    }
                                                }}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PART_PRESETS.map((p) => (
                                                        <SelectItem key={p} value={p}>
                                                            <code className="text-xs">{p}</code>
                                                        </SelectItem>
                                                    ))}
                                                    <SelectItem value="custom">Custom…</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">
                                                Custom order (e.g.{" "}
                                                <code className="text-[10px]">type,/,year,-,counter,number,/india</code>)
                                            </Label>
                                            <Input
                                                value={draft.partOrder}
                                                onChange={(e) =>
                                                    setDraft((d) => d && { ...d, partOrder: e.target.value })
                                                }
                                                className="h-8 font-mono text-xs"
                                                placeholder="type,-,year,-,counter,number"
                                            />
                                            {partOrderError && (
                                                <p className="text-xs font-medium text-destructive mt-1">
                                                    {partOrderError}
                                                </p>
                                            )}
                                        </div>
                                    </fieldset>
                                </div>
                            </ScrollArea>
                        )}

                        {draft && (
                            <div className={`border-t px-6 py-3 ${partOrderError ? "bg-red-50 dark:bg-red-950/30" : "bg-yellow-50 dark:bg-yellow-950/30"}`}>
                                <div className="flex items-baseline gap-3">
                                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${partOrderError ? "text-destructive" : "text-yellow-900 dark:text-yellow-300"}`}>
                                        Preview
                                    </span>
                                    {partOrderError ? (
                                        <span className="text-xs font-mono text-destructive">{partOrderError}</span>
                                    ) : (
                                        <>
                                            <code className="font-mono text-base text-yellow-900 dark:text-yellow-200">{previewNext(draft)}</code>
                                            <Badge variant="outline" className="border-yellow-300 text-yellow-900 dark:text-yellow-200">
                                                {previewLengthNote} chars
                                            </Badge>
                                            <span className="ml-auto text-[11px] text-yellow-700 dark:text-yellow-400">(sample counter&nbsp;24)</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        <DialogFooter className="border-t px-6 py-3">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setEditKind(null);
                                    setDraft(null);
                                }}
                                disabled={saving}
                            >
                                Cancel
                            </Button>
                            <Button onClick={handleSave} disabled={saving || !!partOrderError}>
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Reset confirmation */}
                <Dialog open={!!resetKind} onOpenChange={(open) => !open && setResetKind(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Reset Counter — {resetRow?.label}</DialogTitle>
                            <DialogDescription>
                                This sets <strong>nextSeq → 0</strong>. The next voucher will be:
                                <br />
                                <code className="mt-2 inline-block rounded bg-muted px-2 py-1 font-mono text-sm">
                                    {resetRow ? assembleReference({ ...resetRow, nextSeq: 1 }, 24) : ""}
                                </code>
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setResetKind(null)} disabled={resetting}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => resetKind && handleReset(resetKind)}
                                disabled={resetting}
                            >
                                {resetting ? "Resetting…" : "Reset Counter"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
            <ScrollBar orientation="horizontal" />
            <ScrollBar orientation="vertical" />
        </ScrollArea>
    );
}
