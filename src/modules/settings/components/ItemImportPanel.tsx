"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCsv } from "@/shared/lib/import/csvParse";
import { type ProductImportField } from "@/shared/lib/import/productImportFields";

const FIELD_LABELS: Record<ProductImportField, string> = {
    name: "Name (required)",
    sku: "SKU (required)",
    unit: "Unit (code or label)",
    category: "Category — by name",
    group: "Group — by name (HSN / tax bucket)",
    brand: "Brand — by name",
    warrantyTerm: "Warranty term — by name",
    modelNo: "Model number",
    barcode1: "Barcode",
    hsnCode: "HSN code",
    gstRate: "GST rate (e.g. 18)",
    taxability: "Taxability (TAXABLE / EXEMPT / NIL_RATED / NON_GST)",
    salePrice: "Sale price (₹)",
    mrp: "MRP / Max retail price (₹)",
    openingStock: "Opening stock qty — books-beginning physical count",
    openingRate: "Opening rate (₹/unit) — books-beginning rate",
    openingDate: "Opening date (YYYY-MM-DD) — books-beginning",
};

/// Visual groups in the mapping dropdown — `<optgroup>` headers so the
/// operator scans 5 short lists instead of one 18-row list. Order = each
/// product-import field name; the type system catches any drift.
const FIELD_GROUPS: Array<{ label: string; fields: ProductImportField[] }> = [
    { label: "Identification",   fields: ["name", "sku", "unit"] },
    { label: "Classification",   fields: ["category", "group", "brand", "warrantyTerm"] },
    { label: "Identifiers",      fields: ["modelNo", "barcode1"] },
    { label: "Tax",              fields: ["hsnCode", "gstRate", "taxability"] },
    { label: "Pricing",          fields: ["salePrice", "mrp"] },
    { label: "Opening stock (books-beginning)", fields: ["openingStock", "openingRate", "openingDate"] },
];

const IGNORE = "__ignore__" as const;
type Mapping = Record<string, ProductImportField | typeof IGNORE>;
type Mode = "skip" | "update" | "patch";

interface UnitMaster {
    id: number;
    code: string;
    label: string | null;
}

/// Unit values are matched exactly the way the server does it
/// (`norm` in productImport.ts) — trim + lowercase, against code and label.
/// Keep the two in step: this panel resolves the operator's spelling to a
/// master **code** and sends that, so the server never needs alias logic.
const normUnit = (s: string) => s.trim().toLowerCase();

/// Auto-pick for a source unit value. Only exact code/label hits — anything
/// else (e.g. "Meters" against our MTR/"Metre") is left for the operator to
/// map by hand rather than guessed at.
function autoMatchUnit(raw: string, units: UnitMaster[]): string | null {
    const k = normUnit(raw);
    const hit = units.find((u) => normUnit(u.code) === k || (u.label != null && normUnit(u.label) === k));
    return hit?.code ?? null;
}

interface RowResult {
    rowIndex: number;
    action: "create" | "update" | "skip" | "error";
    sku: string | null;
    name: string | null;
    errors: string[];
    resolved?: {
        unitCode?: string | null;
        categoryName?: string | null;
        groupName?: string | null;
        brandName?: string | null;
        warrantyTermName?: string | null;
        gstRateLabel?: string | null;
    };
}

interface PreviewResult {
    willCreate: number;
    willUpdate: number;
    willSkip: number;
    errorCount: number;
    mastersAutoCreated: {
        categories: string[];
        groups: string[];
        brands: string[];
        warrantyTerms: string[];
    };
    results: RowResult[];
}

function toCsv(rows: string[][]): string {
    const escape = (cell: string) => {
        if (cell == null) return "";
        const needsQuote = /[",\r\n]/.test(cell);
        const escaped = cell.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
    };
    return rows.map((r) => r.map(escape).join(",")).join("\r\n");
}

/// Header → field auto-suggest. Patterns are tested case-insensitive after
/// stripping whitespace / underscores / dashes. Match anywhere unless anchored.
/// Order matters: more specific patterns must come first (e.g. `defaultmrp`
/// before generic `mrp`, `purchaseprice` before generic `price`).
function autoSuggestField(header: string): ProductImportField | typeof IGNORE {
    const h = header.toLowerCase().replace(/[\s_-]/g, "");
    // Required + identification
    if (/^(name|productname|itemname|description)$/.test(h)) return "name";
    if (/^(sku|code|itemcode|productcode|skucode)$/.test(h)) return "sku";
    if (/^(unit|uom|measure|baseunit)$/.test(h)) return "unit";
    // Classification (must come before "code" / "id" generic matches)
    if (/^(category|cat|categoryname|itemcategory)$/.test(h)) return "category";
    if (/^(group|productgroup|itemgroup|stockgroup|groupname)$/.test(h)) return "group";
    if (/^(brand|make|manufacturer|brandname|company)$/.test(h)) return "brand";
    if (/^(warranty|warrantyterm|warrantyperiod)$/.test(h)) return "warrantyTerm";
    if (/^(model|modelno|modelnumber|modelcode)$/.test(h)) return "modelNo";
    if (/^(barcode|ean|upc|barcode1)/.test(h)) return "barcode1";
    // Tax (specific HSN/GST patterns before generic "tax")
    if (/^(hsn|hsncode|sac|saccode|hsnsac)$/.test(h)) return "hsnCode";
    if (/^(gst|gstrate|taxrate|gstpercent|gstpercentage)$/.test(h)) return "gstRate";
    if (/^(taxability|gststatus|taxstatus)$/.test(h)) return "taxability";
    // Pricing (specific patterns first; "defaultmrp"/"maxretailprice" before "mrp",
    // "onlinestoreprice" / "saleprice" before generic "price")
    if (/^(defaultmrp|mrp|maxretailprice|listprice|maximumretailprice)$/.test(h)) return "mrp";
    // Note: any "cost / purchase price" column should be mapped to `openingRate`
    // (books-beginning) instead. Running cost is managed by Purchase vouchers.
    if (/^(saleprice|sellingprice|sellrate|retailprice|onlinestoreprice|shopprice|price)$/.test(h)) return "salePrice";
    if (/^(cost|costprice|purchaseprice|buyingprice|costrate|purchaserate|purrate|costperunit|rateperunit)$/.test(h)) return "openingRate";
    // Opening stock (books-beginning) — accept "current stock", "stock on hand"
    // since most supplier CSVs use those names for the physical count.
    if (/^(openingstock|stock|qty|quantity|openingqty|stockonhand|currentstock|currentstockqty|currentstockquantity|onhand)$/.test(h)) return "openingStock";
    if (/^(openingrate|stockrate|stockvalue)$/.test(h)) return "openingRate";
    if (/^(openingdate|stockdate|asofdate|booksbeginning|booksbeginningdate)$/.test(h)) return "openingDate";
    return IGNORE;
}

export function ItemImportPanel() {
    const [file, setFile] = useState<File | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<string[][]>([]);
    const [mapping, setMapping] = useState<Mapping>({});
    const [mode, setMode] = useState<Mode>("skip");
    const [autoCreateMasters, setAutoCreateMasters] = useState(true);
    const [previewing, setPreviewing] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [commitResult, setCommitResult] = useState<PreviewResult | null>(null);
    const [units, setUnits] = useState<UnitMaster[]>([]);
    /// Manual unit picks only, keyed by the normalized source value. The
    /// effective choice is derived (see `unitResolution`) as
    /// `override ?? autoMatch`, so there is no state to keep in sync when the
    /// operator remaps the unit column or uploads a different file.
    const [unitOverrides, setUnitOverrides] = useState<Record<string, string>>({});

    const sampleRow = rows[0] ?? [];

    // Unit master drives the 2b dropdown. Small list (~13 rows) and the GET is
    // open to any signed-in user, so fetch once on mount.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/inventory/units");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = (await res.json()) as UnitMaster[];
                if (!cancelled) setUnits(json);
            } catch {
                if (!cancelled) toast.error("Could not load the unit master — unit mapping is unavailable");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const mappedFields = useMemo(() => {
        const set = new Set<ProductImportField>();
        for (const v of Object.values(mapping)) if (v !== IGNORE) set.add(v);
        return set;
    }, [mapping]);

    /// Patch mode only ever updates existing products, so SKU (the match key)
    /// is the single mandatory column — map SKU + HSN, or SKU + opening rate
    /// and qty, and just those columns are written. Skip/Replace can create
    /// rows, so they still need the full identity set.
    const hasRequired =
        mode === "patch"
            ? mappedFields.has("sku")
            : mappedFields.has("name") && mappedFields.has("unit") && mappedFields.has("sku");

    /// Column index the operator pointed at Unit, or -1.
    const unitColumnIndex = useMemo(() => headers.findIndex((h) => mapping[h] === "unit"), [headers, mapping]);

    /// Distinct unit spellings in the file, with a row count so the operator
    /// can see which ones actually matter. Keyed by the normalized value —
    /// "MTR" and "mtr" are one entry.
    const unitValues = useMemo(() => {
        if (unitColumnIndex < 0) return [];
        const seen = new Map<string, { raw: string; key: string; count: number }>();
        for (const r of rows) {
            const raw = (r[unitColumnIndex] ?? "").trim();
            if (raw === "") continue;
            const key = normUnit(raw);
            const hit = seen.get(key);
            if (hit) hit.count += 1;
            else seen.set(key, { raw, key, count: 1 });
        }
        return [...seen.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
    }, [rows, unitColumnIndex]);

    /// Source value → master unit code ("" when still unmapped).
    const unitResolution = useMemo(() => {
        const out = new Map<string, string>();
        for (const u of unitValues) out.set(u.key, unitOverrides[u.key] ?? autoMatchUnit(u.raw, units) ?? "");
        return out;
    }, [unitValues, unitOverrides, units]);

    const unresolvedUnitCount = useMemo(
        () => unitValues.filter((u) => !unitResolution.get(u.key)).length,
        [unitValues, unitResolution],
    );
    const unitsReady = unresolvedUnitCount === 0;

    async function handleFile(f: File | null) {
        setFile(f);
        setPreview(null);
        setCommitResult(null);
        setUnitOverrides({});
        if (!f) {
            setHeaders([]);
            setRows([]);
            setMapping({});
            return;
        }
        const text = await f.text();
        const parsed = parseCsv(text);
        if (parsed.headers.length === 0) {
            toast.error("CSV looks empty — no header row found");
            return;
        }
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        const next: Mapping = {};
        for (const h of parsed.headers) next[h] = autoSuggestField(h);
        setMapping(next);
    }

    function buildRowsPayload() {
        const payload: Array<{ rowIndex: number; values: Partial<Record<ProductImportField, string>> }> = [];
        for (let i = 0; i < rows.length; i++) {
            const values: Partial<Record<ProductImportField, string>> = {};
            for (let c = 0; c < headers.length; c++) {
                const target = mapping[headers[c]];
                if (!target || target === IGNORE) continue;
                const cell = rows[i][c] ?? "";
                if (cell.trim() === "") continue;
                // Send the resolved master code for unit, not the operator's
                // spelling — the server matches code/label exactly and knows
                // nothing about "Meters" vs "Metre". Falls back to the raw cell
                // if somehow unmapped, which the server then reports as an error
                // row exactly as before.
                values[target] =
                    target === "unit" ? unitResolution.get(normUnit(cell)) || cell : cell;
            }
            payload.push({ rowIndex: i, values });
        }
        return payload;
    }

    function downloadErrorRowsFor(result: PreviewResult, silent = false) {
        const errorByRow = new Map<number, string[]>();
        for (const r of result.results) {
            if (r.action === "error") errorByRow.set(r.rowIndex, r.errors);
        }
        if (errorByRow.size === 0) return;

        const outHeaders = [...headers, "_errors"];
        const outRows: string[][] = [];
        for (const [rowIndex, errs] of errorByRow) {
            const original = rows[rowIndex] ?? [];
            const padded = headers.map((_, i) => original[i] ?? "");
            outRows.push([...padded, errs.join("; ")]);
        }
        const csv = toCsv([outHeaders, ...outRows]);
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const base = file?.name.replace(/\.csv$/i, "") ?? "import";
        a.href = url;
        a.download = `${base}-errors.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (!silent) toast.success(`Downloaded ${errorByRow.size} error rows`);
    }

    function downloadErrorRows() {
        if (!preview) return;
        downloadErrorRowsFor(preview);
    }

    async function handlePreview() {
        setPreviewing(true);
        setCommitResult(null);
        try {
            const res = await fetch("/api/settings/item-import/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: buildRowsPayload(), mode, autoCreateMasters }),
            });
            const json = (await res.json()) as PreviewResult & { error?: string };
            if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
            setPreview(json);
            toast.success(
                `Preview: ${json.willCreate} create · ${json.willUpdate} update · ${json.willSkip} skip · ${json.errorCount} error`,
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Preview failed");
        } finally {
            setPreviewing(false);
        }
    }

    async function handleCommit() {
        if (!preview) return;
        const total = preview.willCreate + preview.willUpdate;
        if (total === 0) {
            toast.error("Nothing to commit — preview shows 0 create/update rows");
            return;
        }
        if (!window.confirm(`Commit ${total} rows? This writes to the products table.`)) return;
        setCommitting(true);
        try {
            const res = await fetch("/api/settings/item-import/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: buildRowsPayload(), mode, autoCreateMasters }),
            });
            const json = (await res.json()) as PreviewResult & { error?: string };
            if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
            setCommitResult(json);
            toast.success(`Committed: ${json.willCreate} created · ${json.willUpdate} updated`);
            if (json.errorCount > 0) {
                downloadErrorRowsFor(json, true);
                toast.info(`Downloaded ${json.errorCount} error rows — fix and re-import.`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Commit failed");
        } finally {
            setCommitting(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* Step 1 — upload */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
                <div>
                    <h2 className="text-sm font-semibold">1. Upload CSV</h2>
                    <p className="text-xs text-muted-foreground">
                        First row must be the column headers — actual names don&apos;t matter, you&apos;ll map them in the next
                        step.
                    </p>
                </div>
                <Input type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                {file && (
                    <p className="text-[11px] text-muted-foreground">
                        {file.name} · {headers.length} columns · {rows.length} rows
                    </p>
                )}
            </section>

            {/* Step 2 — map columns */}
            {headers.length > 0 && (
                <section className="rounded-lg border bg-card p-4 space-y-3">
                    <div>
                        <h2 className="text-sm font-semibold">2. Map your columns</h2>
                        <p className="text-xs text-muted-foreground">
                            Pick which product field each of your columns maps to.{" "}
                            {mode === "patch" ? (
                                <>
                                    In Patch mode only <strong>SKU</strong> is required — map just the columns you want
                                    to update.
                                </>
                            ) : (
                                <>
                                    <strong>Name</strong>, <strong>SKU</strong> and <strong>Unit</strong> are required;
                                    everything else is optional.
                                </>
                            )}{" "}
                            Unmapped columns are ignored.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="border-b text-muted-foreground">
                                <tr>
                                    <th className="py-1.5 px-2 text-left font-medium">Your column</th>
                                    <th className="py-1.5 px-2 text-left font-medium">Sample (row 1)</th>
                                    <th className="py-1.5 px-2 text-left font-medium">Maps to</th>
                                </tr>
                            </thead>
                            <tbody>
                                {headers.map((h, i) => (
                                    <tr key={h + i} className="border-b last:border-b-0">
                                        <td className="py-1.5 px-2 font-mono">{h}</td>
                                        <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[200px]">
                                            {sampleRow[i] ?? ""}
                                        </td>
                                        <td className="py-1.5 px-2">
                                            <select
                                                className="h-8 rounded border bg-background px-2 text-xs min-w-[280px]"
                                                value={mapping[h] ?? IGNORE}
                                                onChange={(e) =>
                                                    setMapping((m) => ({
                                                        ...m,
                                                        [h]: e.target.value as ProductImportField | typeof IGNORE,
                                                    }))
                                                }
                                            >
                                                <option value={IGNORE}>— Ignore —</option>
                                                {FIELD_GROUPS.map((grp) => (
                                                    <optgroup key={grp.label} label={grp.label}>
                                                        {grp.fields.map((f) => (
                                                            <option key={f} value={f}>
                                                                {FIELD_LABELS[f]}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                ))}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!hasRequired && (
                        <p className="text-[11px] text-amber-600">
                            {mode === "patch" ? (
                                <>
                                    Map <strong>SKU</strong> to continue.
                                </>
                            ) : (
                                <>
                                    Map at least <strong>Name</strong>, <strong>SKU</strong> and <strong>Unit</strong>{" "}
                                    to continue.
                                </>
                            )}
                        </p>
                    )}
                </section>
            )}

            {/* Step 2b — map unit values to the unit master */}
            {mappedFields.has("unit") && unitValues.length > 0 && (
                <section className="rounded-lg border bg-card p-4 space-y-3">
                    <div>
                        <h2 className="text-sm font-semibold">2b. Map units</h2>
                        <p className="text-xs text-muted-foreground">
                            Every unit value in your file must point at a unit in our master. Exact code or label
                            matches are picked automatically — set the rest yourself. Units are never auto-created, so
                            an unmapped value would error out every row using it.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="border-b text-muted-foreground">
                                <tr>
                                    <th className="py-1.5 px-2 text-left font-medium">Your unit</th>
                                    <th className="py-1.5 px-2 text-left font-medium">Rows</th>
                                    <th className="py-1.5 px-2 text-left font-medium">Maps to</th>
                                </tr>
                            </thead>
                            <tbody>
                                {unitValues.map((u) => {
                                    const chosen = unitResolution.get(u.key) ?? "";
                                    return (
                                        <tr key={u.key} className="border-b last:border-b-0">
                                            <td className="py-1.5 px-2 font-mono">{u.raw}</td>
                                            <td className="py-1.5 px-2 text-muted-foreground">{u.count}</td>
                                            <td className="py-1.5 px-2">
                                                <select
                                                    className={
                                                        chosen
                                                            ? "h-8 rounded border bg-background px-2 text-xs min-w-[220px]"
                                                            : "h-8 rounded border border-amber-500 bg-background px-2 text-xs min-w-[220px]"
                                                    }
                                                    value={chosen}
                                                    onChange={(e) =>
                                                        setUnitOverrides((m) => ({ ...m, [u.key]: e.target.value }))
                                                    }
                                                >
                                                    <option value="">— Select unit —</option>
                                                    {units.map((m) => (
                                                        <option key={m.id} value={m.code}>
                                                            {m.label ? `${m.code} — ${m.label}` : m.code}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {!unitsReady && (
                        <p className="text-[11px] text-amber-600">
                            {unresolvedUnitCount} unit {unresolvedUnitCount === 1 ? "value is" : "values are"} still
                            unmapped
                            {units.length === 0 ? " — unit master could not be loaded" : ""}.
                        </p>
                    )}
                </section>
            )}

            {/* Step 3 — options + preview */}
            {headers.length > 0 && (
                <section className="rounded-lg border bg-card p-4 space-y-3">
                    <div>
                        <h2 className="text-sm font-semibold">3. Mode &amp; preview</h2>
                        <p className="text-xs text-muted-foreground">
                            Choose what happens when a row&apos;s SKU already exists, then preview before committing.
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">When SKU already exists</Label>
                        <div className="flex flex-wrap gap-4 text-xs">
                            <label className="flex items-center gap-1.5">
                                <input
                                    type="radio"
                                    checked={mode === "skip"}
                                    onChange={() => setMode("skip")}
                                />
                                Skip the row
                            </label>
                            <label className="flex items-center gap-1.5">
                                <input
                                    type="radio"
                                    checked={mode === "update"}
                                    onChange={() => setMode("update")}
                                />
                                Replace (full-row update)
                            </label>
                            <label className="flex items-center gap-1.5">
                                <input
                                    type="radio"
                                    checked={mode === "patch"}
                                    onChange={() => setMode("patch")}
                                />
                                Patch (only mapped columns)
                            </label>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            {mode === "skip" && "Existing SKUs are left untouched. Only new products are created."}
                            {mode === "update" && "Existing rows are fully replaced — columns not in your CSV become NULL. Upload a complete snapshot."}
                            {mode === "patch" && "Only the columns you mapped are written. Other fields stay untouched. Patch mode never creates — SKUs not in the DB error out. Useful for opening-stock refresh, brand fixes, etc."}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Missing masters</Label>
                        <label className="flex items-center gap-1.5 text-xs">
                            <input
                                type="checkbox"
                                checked={autoCreateMasters}
                                onChange={(e) => setAutoCreateMasters(e.target.checked)}
                            />
                            Auto-create missing categories, groups, brands, and warranty terms
                        </label>
                        <p className="text-[10px] text-muted-foreground">
                            Units and GST rates are not auto-created — those must already exist.
                        </p>
                    </div>
                    <Button onClick={handlePreview} disabled={!hasRequired || !unitsReady || previewing} size="sm">
                        <FileText className="mr-1.5 size-3.5" />
                        {previewing ? "Previewing…" : "Preview"}
                    </Button>
                    {hasRequired && !unitsReady && (
                        <p className="text-[11px] text-amber-600">
                            Finish mapping your units in step 2b to preview.
                        </p>
                    )}
                </section>
            )}

            {/* Preview results */}
            {preview && (
                <section className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                            <h2 className="text-sm font-semibold">Preview results</h2>
                            <p className="text-xs text-muted-foreground">Nothing written yet.</p>
                        </div>
                        <div className="flex gap-3 text-xs flex-wrap">
                            <span className="text-green-700">{preview.willCreate} create</span>
                            <span className="text-blue-700">{preview.willUpdate} update</span>
                            <span className="text-muted-foreground">{preview.willSkip} skip</span>
                            <span className={preview.errorCount > 0 ? "text-destructive" : "text-muted-foreground"}>
                                {preview.errorCount} error
                            </span>
                        </div>
                    </div>
                    {(preview.mastersAutoCreated.categories.length > 0 ||
                        preview.mastersAutoCreated.groups.length > 0 ||
                        preview.mastersAutoCreated.brands.length > 0 ||
                        preview.mastersAutoCreated.warrantyTerms.length > 0) && (
                        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] space-y-1">
                            <div className="font-semibold text-amber-800">
                                {autoCreateMasters
                                    ? "Will auto-create these missing masters:"
                                    : "These masters are missing (rows will error):"}
                            </div>
                            {preview.mastersAutoCreated.categories.length > 0 && (
                                <div>
                                    <span className="text-muted-foreground">Categories ({preview.mastersAutoCreated.categories.length}):</span>{" "}
                                    {preview.mastersAutoCreated.categories.slice(0, 20).join(", ")}
                                    {preview.mastersAutoCreated.categories.length > 20 ? ` … +${preview.mastersAutoCreated.categories.length - 20}` : ""}
                                </div>
                            )}
                            {preview.mastersAutoCreated.groups.length > 0 && (
                                <div>
                                    <span className="text-muted-foreground">Groups ({preview.mastersAutoCreated.groups.length}):</span>{" "}
                                    {preview.mastersAutoCreated.groups.slice(0, 20).join(", ")}
                                    {preview.mastersAutoCreated.groups.length > 20 ? ` … +${preview.mastersAutoCreated.groups.length - 20}` : ""}
                                </div>
                            )}
                            {preview.mastersAutoCreated.brands.length > 0 && (
                                <div>
                                    <span className="text-muted-foreground">Brands ({preview.mastersAutoCreated.brands.length}):</span>{" "}
                                    {preview.mastersAutoCreated.brands.slice(0, 20).join(", ")}
                                    {preview.mastersAutoCreated.brands.length > 20 ? ` … +${preview.mastersAutoCreated.brands.length - 20}` : ""}
                                </div>
                            )}
                            {preview.mastersAutoCreated.warrantyTerms.length > 0 && (
                                <div>
                                    <span className="text-muted-foreground">Warranty terms ({preview.mastersAutoCreated.warrantyTerms.length}):</span>{" "}
                                    {preview.mastersAutoCreated.warrantyTerms.slice(0, 20).join(", ")}
                                    {preview.mastersAutoCreated.warrantyTerms.length > 20 ? ` … +${preview.mastersAutoCreated.warrantyTerms.length - 20}` : ""}
                                </div>
                            )}
                        </div>
                    )}

                    {preview.errorCount > 0 && (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] text-muted-foreground">
                                    Fix the rows below in Excel, then re-upload — the corrected file works without
                                    changes.
                                </p>
                                <Button
                                    onClick={downloadErrorRows}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px]"
                                >
                                    <Download className="mr-1 size-3" />
                                    Download {preview.errorCount} error rows
                                </Button>
                            </div>
                            <div className="rounded border border-destructive/30 bg-destructive/5 p-2 max-h-40 overflow-y-auto text-[11px] space-y-1">
                                {preview.results
                                    .filter((r) => r.action === "error")
                                    .slice(0, 50)
                                    .map((r) => (
                                        <div key={r.rowIndex}>
                                            <span className="font-mono text-muted-foreground">
                                                row {r.rowIndex + 2}:
                                            </span>{" "}
                                            {r.errors.join("; ")}
                                        </div>
                                    ))}
                                {preview.errorCount > 50 && (
                                    <div className="text-muted-foreground">
                                        …showing first 50 of {preview.errorCount}. Click &quot;Download error rows&quot; for the
                                        full list.
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead className="border-b text-muted-foreground">
                                <tr>
                                    <th className="py-1 px-1.5 text-left">Row</th>
                                    <th className="py-1 px-1.5 text-left">Action</th>
                                    <th className="py-1 px-1.5 text-left">SKU</th>
                                    <th className="py-1 px-1.5 text-left">Name</th>
                                    <th className="py-1 px-1.5 text-left">Unit</th>
                                    <th className="py-1 px-1.5 text-left">Brand</th>
                                    <th className="py-1 px-1.5 text-left">GST</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.results.slice(0, 20).map((r) => (
                                    <tr
                                        key={r.rowIndex}
                                        className={
                                            r.action === "error"
                                                ? "border-b last:border-b-0 bg-destructive/5"
                                                : "border-b last:border-b-0"
                                        }
                                    >
                                        <td className="py-1 px-1.5 font-mono text-muted-foreground">{r.rowIndex + 2}</td>
                                        <td className="py-1 px-1.5">{r.action}</td>
                                        <td className="py-1 px-1.5 font-mono">{r.sku ?? "—"}</td>
                                        <td className="py-1 px-1.5">{r.name ?? "—"}</td>
                                        <td className="py-1 px-1.5">{r.resolved?.unitCode ?? "—"}</td>
                                        <td className="py-1 px-1.5">{r.resolved?.brandName ?? "—"}</td>
                                        <td className="py-1 px-1.5">{r.resolved?.gstRateLabel ?? "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {preview.results.length > 20 && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                                …showing first 20 of {preview.results.length}
                            </p>
                        )}
                    </div>

                    <Button onClick={handleCommit} disabled={committing} size="sm">
                        <Upload className="mr-1.5 size-3.5" />
                        {committing
                            ? "Committing…"
                            : `Commit ${preview.willCreate + preview.willUpdate} rows`}
                    </Button>
                </section>
            )}

            {/* Commit result */}
            {commitResult && (
                <section className="rounded-lg border border-green-500/40 bg-green-500/5 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-green-700" />
                        <h2 className="text-sm font-semibold text-green-800">Import complete</h2>
                    </div>
                    <p className="text-xs">
                        {commitResult.willCreate} created · {commitResult.willUpdate} updated ·{" "}
                        {commitResult.willSkip} skipped
                        {commitResult.errorCount > 0 ? ` · ${commitResult.errorCount} errored` : ""}
                    </p>
                    {commitResult.errorCount > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
                            <AlertTriangle className="size-3.5" />
                            Some rows errored and were skipped — re-run after fixing the CSV.
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
