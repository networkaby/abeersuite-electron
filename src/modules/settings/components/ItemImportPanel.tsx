"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCsv } from "@/shared/lib/import/csvParse";
import { PRODUCT_IMPORT_FIELDS, type ProductImportField } from "@/shared/lib/import/productImportFields";

const FIELD_LABELS: Record<ProductImportField, string> = {
    name: "Name (required)",
    sku: "SKU (auto if empty)",
    unit: "Unit (code or label)",
    category: "Category (by name)",
    group: "Group (by name)",
    brand: "Brand (by name)",
    warrantyTerm: "Warranty term (by name)",
    modelNo: "Model number",
    barcode1: "Barcode",
    hsnCode: "HSN code",
    gstRate: "GST rate (e.g. 18)",
    taxability: "Taxability (TAXABLE/EXEMPT/NIL_RATED/NON_GST)",
    costPrice: "Cost price (₹)",
    salePrice: "Sale price (₹)",
    mrp: "MRP (₹)",
    openingStock: "Opening stock (qty)",
    openingRate: "Opening rate (₹)",
    openingDate: "Opening date (YYYY-MM-DD)",
};

const IGNORE = "__ignore__" as const;
type Mapping = Record<string, ProductImportField | typeof IGNORE>;
type Mode = "skip" | "update";

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

function autoSuggestField(header: string): ProductImportField | typeof IGNORE {
    const h = header.toLowerCase().replace(/[\s_-]/g, "");
    if (/^(name|productname|itemname|description)$/.test(h)) return "name";
    if (/^(sku|code|itemcode|productcode)$/.test(h)) return "sku";
    if (/^(unit|uom|measure)$/.test(h)) return "unit";
    if (/^(category|cat)$/.test(h)) return "category";
    if (/^(group|productgroup|itemgroup)$/.test(h)) return "group";
    if (/^(brand|make|manufacturer)$/.test(h)) return "brand";
    if (/^(warranty|warrantyterm)$/.test(h)) return "warrantyTerm";
    if (/^(model|modelno|modelnumber)$/.test(h)) return "modelNo";
    if (/^(barcode|ean|upc)/.test(h)) return "barcode1";
    if (/^(hsn|hsncode|sac)$/.test(h)) return "hsnCode";
    if (/^(gst|gstrate|tax|taxrate)$/.test(h)) return "gstRate";
    if (/^(taxability)$/.test(h)) return "taxability";
    if (/^(cost|costprice|purchaseprice|buyingprice|costrate)$/.test(h)) return "costPrice";
    if (/^(price|saleprice|sellingprice|sellrate)$/.test(h)) return "salePrice";
    if (/^(mrp|maxretailprice|listprice)$/.test(h)) return "mrp";
    if (/^(openingstock|stock|qty|openingqty|stockonhand)$/.test(h)) return "openingStock";
    if (/^(openingrate|stockrate|stockvalue)$/.test(h)) return "openingRate";
    if (/^(openingdate|stockdate|date|asofdate)$/.test(h)) return "openingDate";
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

    const sampleRow = rows[0] ?? [];

    const mappedFields = useMemo(() => {
        const set = new Set<ProductImportField>();
        for (const v of Object.values(mapping)) if (v !== IGNORE) set.add(v);
        return set;
    }, [mapping]);

    const hasRequired = mappedFields.has("name") && mappedFields.has("unit");

    async function handleFile(f: File | null) {
        setFile(f);
        setPreview(null);
        setCommitResult(null);
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
                values[target] = cell;
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
                            Pick which product field each of your columns maps to. <strong>Name</strong> and{" "}
                            <strong>Unit</strong> are required; everything else is optional. Unmapped columns are
                            ignored.
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
                                                className="h-8 rounded border bg-background px-2 text-xs"
                                                value={mapping[h] ?? IGNORE}
                                                onChange={(e) =>
                                                    setMapping((m) => ({
                                                        ...m,
                                                        [h]: e.target.value as ProductImportField | typeof IGNORE,
                                                    }))
                                                }
                                            >
                                                <option value={IGNORE}>— Ignore —</option>
                                                {PRODUCT_IMPORT_FIELDS.map((f) => (
                                                    <option key={f} value={f}>
                                                        {FIELD_LABELS[f]}
                                                    </option>
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
                            Map at least <strong>Name</strong> and <strong>Unit</strong> to continue.
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
                        <div className="flex gap-4 text-xs">
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
                                Update the existing product
                            </label>
                        </div>
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
                    <Button onClick={handlePreview} disabled={!hasRequired || previewing} size="sm">
                        <FileText className="mr-1.5 size-3.5" />
                        {previewing ? "Previewing…" : "Preview"}
                    </Button>
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
