"use client";

// Upload one bank statement against one bank ledger.
//
// The file is read in the browser (CSV, tab-separated text, real Excel), the
// bank's layout is recognised or the columns are mapped by hand, the rows are
// normalised into the one statement shape, and a DRY RUN against the server
// shows what would be saved — new lines, lines already on file, lines before
// the lock, running-balance breaks, an account-number mismatch — before the
// same rows are saved for real. Nothing is written until "Save".

import { useEffect, useMemo, useRef, useState, useEffectEvent } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { readTabularFile } from "@/shared/lib/import/spreadsheetRead";
import {
    IGNORE_FIELD, STATEMENT_FIELD_LABELS, checkContinuity, cleanAccountNumber, normaliseStatementRows, orderStatementRows, parseStatementGrid,
    type FieldChoice, type ParsedStatement, type StatementField, type StatementRow,
} from "@/shared/lib/import/bankStatement";
import { useValueChange } from "@/shared/hooks/useValueChange";

interface Report {
    importId: number | null;
    inserted: number;
    skipped: number;
    beforeLock: number;
    continuityBreaks: number;
    warnings: string[];
    fromDate: string | null;
    toDate: string | null;
}

const FIELD_ORDER: StatementField[] = ["date", "valueDate", "narration", "reference", "withdrawal", "deposit", "balance", "amount", "drcr"];

function mappingKey(accountId: number) { return `bank-recon:mapping:${accountId}`; }
/** The header cell the user once picked as the account number — for a bank whose
 *  layout the parser cannot read. Per ledger, like the column mapping. */
function acCellKey(accountId: number) { return `bank-recon:acno-cell:${accountId}`; }
type CellPos = { row: number; col: number };
/** {row 11, col 1} ↔ "B12", as Excel names it. */
function cellRef(p: CellPos) {
    let n = p.col + 1, letters = "";
    while (n > 0) { letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters; n = Math.floor((n - 1) / 26); }
    return `${letters}${p.row + 1}`;
}
function parseCellRef(v: string): CellPos | null {
    const m = /^([A-Z]{1,3})(\d{1,5})$/.exec(v.trim().toUpperCase());
    if (!m) return null;
    const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { row: Number(m[2]) - 1, col };
}
const cellText = (grid: string[][], p: CellPos) => String(grid[p.row]?.[p.col] ?? "").trim();
/** Looks like an account number: mostly digits (bank masks/underscores allowed), 8+ of them. */
const looksLikeAcNo = (v: string) => /^[\s_\-xX*0-9]+$/.test(v) && v.replace(/\D/g, "").length >= 8;

export function BankStatementImportDialog({ accountId, accountName, lock, open, onClose, onImported }: {
    accountId: number;
    accountName: string;
    lock: string | null;
    open: boolean;
    onClose: () => void;
    onImported: () => void;
}) {
    const [file, setFile] = useState<File | null>(null);
    const [reading, setReading] = useState(false);
    const [parsed, setParsed] = useState<ParsedStatement | null>(null);
    const [fileHash, setFileHash] = useState("");
    const [mapping, setMapping] = useState<Record<string, FieldChoice>>({});
    const [report, setReport] = useState<Report | null>(null);
    const [reportError, setReportError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [force, setForce] = useState(false);
    const [grid, setGrid] = useState<string[][]>([]);
    const [acCell, setAcCell] = useState<CellPos | null>(null);
    const [skipAcNo, setSkipAcNo] = useState(false);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const [refDraft, setRefDraft] = useState<string | null>(null);

    // Reset when closed so the next upload starts clean.
    if (useValueChange(open) && !open) {
        setFile(null); setParsed(null); setFileHash(""); setMapping({}); setReport(null); setReportError(null); setForce(false);
        setGrid([]); setAcCell(null); setSkipAcNo(false); setRefDraft(null);
    }

    const rows = useMemo(() => {
        if (!parsed || parsed.headerRowIndex < 0) return { rows: [] as StatementRow[], errors: [] as Array<{ rowIndex: number; reason: string }> };
        const n = normaliseStatementRows(parsed.headers, parsed.dataRows, mapping);
        // Oldest first, whatever order the bank printed — the preview, the
        // continuity check and the upload all see the order that gets saved.
        return { ...n, rows: orderStatementRows(n.rows, parsed.meta.openingBalance ?? null) };
    }, [parsed, mapping]);

    const continuity = useMemo(
        () => checkContinuity(rows.rows, parsed?.meta.openingBalance ?? null),
        [rows.rows, parsed?.meta.openingBalance],
    );

    // Account number: the cell the user picked (it overrides a wrong read), else what the parser read.
    const pickedAcNo = acCell ? cleanAccountNumber(cellText(grid, acCell)) : null;
    const accountNo = pickedAcNo ?? parsed?.meta.bankAccountNumber ?? null;
    // Where the number sits, shown as "B12" — the picked cell, or the cell the parser read it from.
    const acRef = useMemo(() => {
        if (acCell) return cellRef(acCell);
        const read = parsed?.meta.bankAccountNumber;
        if (!read || !parsed) return null;
        for (let row = 0; row < parsed.headerRowIndex; row++) {
            const col = (grid[row] ?? []).findIndex((c) => String(c ?? "").includes(read));
            if (col >= 0) return cellRef({ row, col });
        }
        return null;
    }, [acCell, parsed, grid]);
    const acCandidates = useMemo(() => {
        if (!parsed || parsed.headerRowIndex < 0) return [];
        const out: Array<CellPos & { label: string; value: string }> = [];
        grid.slice(0, parsed.headerRowIndex).forEach((cells, row) => cells.forEach((c, col) => {
            const value = String(c ?? "").trim();
            if (!looksLikeAcNo(value)) return;
            const label = cells.slice(0, col).map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
            out.push({ row, col, label, value });
        }));
        return out;
    }, [grid, parsed]);

    const mapped = new Set(Object.values(mapping));
    const hasDate = mapped.has("date") || mapped.has("valueDate");
    const hasAmount = mapped.has("withdrawal") || mapped.has("deposit") || mapped.has("amount");
    const hasNarration = mapped.has("narration");
    const mappingOk = hasDate && hasAmount && hasNarration;

    async function handleFile(f: File | null) {
        setFile(f); setParsed(null); setReport(null); setReportError(null); setForce(false);
        setGrid([]); setAcCell(null); setSkipAcNo(false);
        if (!f) return;
        setReading(true);
        try {
            const tab = await readTabularFile(f);
            const p = parseStatementGrid(tab.grid);
            setFileHash(tab.sha1);
            setParsed(p);
            setGrid(tab.grid);
            // The cell picked for this ledger last time wins over the parser's read —
            // a pick is usually a correction.
            try {
                const saved = localStorage.getItem(acCellKey(accountId));
                if (saved) {
                    const pos = JSON.parse(saved) as CellPos;
                    if (pos.row < p.headerRowIndex && cleanAccountNumber(cellText(tab.grid, pos))) setAcCell(pos);
                }
            } catch { /* per-viewer convenience only */ }
            if (p.headerRowIndex < 0) {
                toast.error("Could not find the table in this file — no row with a date and an amount or balance column.");
                return;
            }
            // A remembered hand mapping for this ledger beats the guess — but a
            // recognised bank profile is exact and wins over both.
            let next = p.mapping;
            if (p.profile === "generic") {
                try {
                    const saved = localStorage.getItem(mappingKey(accountId));
                    if (saved) {
                        const m = JSON.parse(saved) as Record<string, FieldChoice>;
                        if (p.headers.every((h) => h in m)) next = m;
                    }
                } catch { /* per-viewer convenience only */ }
            }
            setMapping(next);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not read the file");
        } finally {
            setReading(false);
        }
    }

    function payload(dryRun: boolean) {
        return {
            fileName: file?.name ?? "statement",
            fileHash,
            profile: parsed?.profile ?? "generic",
            meta: { ...(parsed?.meta ?? {}), bankAccountNumber: accountNo },
            rows: rows.rows,
            dryRun,
            force,
        };
    }

    async function check() {
        setChecking(true); setReport(null); setReportError(null);
        try {
            const r = await axios.post<Report>(`/api/accountancy/bank-reconciliation/${accountId}/imports`, payload(true));
            setReport(r.data);
        } catch (e) {
            setReportError(extractApiError(e, "Could not check the file"));
        } finally {
            setChecking(false);
        }
    }

    // Re-check whenever the rows or the force flag change and the file is parsed.
    // check() reads the latest parse; these deps are what change its answer.
    const recheck = useEffectEvent(() => {
        if (!parsed || parsed.headerRowIndex < 0 || !mappingOk || rows.rows.length === 0) return;
        void check();
    });
    useEffect(() => {
        const t = setTimeout(() => recheck(), 250);
        return () => clearTimeout(t);
    }, [rows.rows, force, mappingOk, accountNo]);

    async function save() {
        setSaving(true);
        try {
            const r = await axios.post<Report>(`/api/accountancy/bank-reconciliation/${accountId}/imports`, payload(false));
            if (parsed?.profile === "generic") {
                try { localStorage.setItem(mappingKey(accountId), JSON.stringify(mapping)); } catch { /* optional */ }
            }
            if (acCell && pickedAcNo) {
                try { localStorage.setItem(acCellKey(accountId), JSON.stringify(acCell)); } catch { /* optional */ }
            }
            toast.success(`${r.data.inserted} line(s) saved${r.data.skipped ? `, ${r.data.skipped} already on file` : ""}${r.data.beforeLock ? `, ${r.data.beforeLock} before the lock` : ""}.`);
            onImported();
            onClose();
        } catch (e) {
            toast.error(extractApiError(e, "Import failed"));
        } finally {
            setSaving(false);
        }
    }

    const preview = rows.rows.slice(0, 12);
    const canSave = !!report && report.inserted > 0 && !reportError && !saving && (continuity.breaks.length === 0 || force) && (!!accountNo || skipAcNo);

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
            <DialogContent className={`flex max-h-[92vh] max-w-none flex-col gap-0 overflow-hidden p-0 ${parsed ? "w-[90vw] sm:max-w-[90vw]" : "w-[92vw] sm:max-w-lg"}`}>
                <div className="border-b px-5 py-3">
                    <DialogTitle className="text-base font-semibold">Upload bank statement — {accountName}</DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        Nothing is saved until you check the preview and press Save.
                    </DialogDescription>
                </div>

                <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
                    <input ref={fileRef} id="bank-stmt-file" type="file" className="hidden"
                        accept=".csv,.txt,.tsv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(e) => { void handleFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                    {!file ? (
                        // Empty state: one big drop zone — drag the file in or click to choose.
                        <label htmlFor="bank-stmt-file"
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files?.[0] ?? null); }}
                            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/60 hover:bg-muted/40"}`}>
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Upload size={22} /></span>
                            <span className="text-sm font-medium">Drop the bank statement here</span>
                            <span className="text-xs text-muted-foreground">or <span className="font-medium text-primary underline-offset-2 hover:underline">click to choose a file</span></span>
                            <span className="mt-1 flex flex-wrap justify-center gap-1.5">
                                {["CSV", "XLS", "XLSX", "TXT"].map((t) => <span key={t} className="rounded border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{t}</span>)}
                            </span>
                        </label>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                            <FileText size={18} className="shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium" title={file.name}>{file.name}</div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    {reading
                                        ? <><Loader2 size={12} className="animate-spin" /> reading…</>
                                        : parsed && parsed.headerRowIndex >= 0
                                            ? <>{parsed.profile === "generic" ? "Layout not recognised — check the columns below" : `Recognised: ${parsed.profile}`} · {parsed.dataRows.length} rows</>
                                            : "Could not read a table from this file"}
                                </div>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={saving}>Change file</Button>
                        </div>
                    )}
                    {!file && (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                            <li>• Download the statement from net banking as <b>CSV or Excel</b>, as the bank gives it. PDF is not read.</li>
                            {lock && <li>• Lines dated before the lock (<b>{formatDate(lock)}</b>) are skipped.</li>}
                            <li>• Lines already uploaded are skipped, so an overlapping period is safe.</li>
                        </ul>
                    )}

                    {parsed && parsed.headerRowIndex >= 0 && (
                        <>
                            {/* Statement particulars the bank printed above the table. */}
                            {(accountNo || parsed.meta.ifsc || parsed.meta.fromDate || parsed.meta.openingBalance != null) && (
                                <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                                    {accountNo && <span>A/c {accountNo}{acRef && <span className="text-muted-foreground"> · cell {acRef}</span>}{acCell && " (picked)"}</span>}
                                    {parsed.meta.ifsc && <span>IFSC {parsed.meta.ifsc}</span>}
                                    {parsed.meta.fromDate && <span>{formatDate(parsed.meta.fromDate)} → {parsed.meta.toDate ? formatDate(parsed.meta.toDate) : "…"}</span>}
                                    {parsed.meta.openingBalance != null && <span>Opening {fmt(parsed.meta.openingBalance)}</span>}
                                </div>
                            )}

                            {/* Account-number cell — always editable, like the columns; the pick is remembered for this ledger. */}
                            {(
                                <div className={accountNo ? "rounded-md border px-3 py-2 text-xs" : "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/40"}>
                                    <div className={accountNo ? "mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" : "mb-1.5 flex items-center gap-1 font-medium text-amber-900 dark:text-amber-100"}>
                                        {accountNo
                                            ? "Account number cell"
                                            : <><AlertTriangle size={12} /> Account number not found in this file. Click the cell that holds it — it is remembered for this ledger.</>}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {acCandidates.map((c) => {
                                            const on = acCell?.row === c.row && acCell?.col === c.col;
                                            return (
                                                <button key={`${c.row}:${c.col}`} type="button"
                                                    className={`rounded border px-2 py-0.5 ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
                                                    onClick={() => { setAcCell(on ? null : { row: c.row, col: c.col }); setSkipAcNo(false); }}>
                                                    {c.label && <span className="opacity-70">{c.label}: </span>}<span className="font-mono">{c.value}</span>
                                                    <span className="ml-1 opacity-50">{cellRef(c)}</span>
                                                </button>
                                            );
                                        })}
                                        {acCandidates.length === 0 && <span className="text-muted-foreground">No number-like cell above the table.</span>}
                                        <span className="flex items-center gap-1 text-muted-foreground">
                                            cell
                                            <Input value={refDraft ?? acRef ?? ""} placeholder="B12" className="h-6 w-16 px-1 text-xs uppercase"
                                                onChange={(e) => setRefDraft(e.target.value)}
                                                onBlur={() => {
                                                    const draft = refDraft?.trim();
                                                    setRefDraft(null);
                                                    if (!draft || draft.toUpperCase() === acRef) return;
                                                    const pos = parseCellRef(draft);
                                                    if (!pos || pos.row >= parsed.headerRowIndex || !cleanAccountNumber(cellText(grid, pos))) {
                                                        toast.error(`No account number in cell ${draft.toUpperCase()}.`);
                                                        return;
                                                    }
                                                    setAcCell(pos); setSkipAcNo(false);
                                                }} />
                                        </span>
                                    </div>
                                    {!accountNo && (
                                        <label className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
                                            <input type="checkbox" checked={skipAcNo} onChange={(e) => setSkipAcNo(e.target.checked)} />
                                            Upload without checking the account number
                                        </label>
                                    )}
                                </div>
                            )}

                            {/* Column mapping — editable; exact for a known bank. */}
                            <div>
                                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</div>
                                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                                    {parsed.headers.map((h, i) => (
                                        <div key={`${h}-${i}`} className="space-y-0.5">
                                            <Label htmlFor={`map-${i}`} className="block truncate text-[11px] text-muted-foreground" title={h || "(blank header)"}>{h || "(blank)"}</Label>
                                            <select
                                                id={`map-${i}`}
                                                value={mapping[h] ?? IGNORE_FIELD}
                                                onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as FieldChoice }))}
                                                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                                            >
                                                <option value={IGNORE_FIELD}>— ignore —</option>
                                                {FIELD_ORDER.map((f) => <option key={f} value={f}>{STATEMENT_FIELD_LABELS[f]}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                                {!mappingOk && <p className="mt-1.5 text-xs text-amber-600">Map a date, a narration and an amount column (withdrawal/deposit, or amount with Dr/Cr).</p>}
                            </div>

                            {/* What the server would do. */}
                            {mappingOk && (
                                <div className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
                                    {checking && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> checking against what is on file…</div>}
                                    {reportError && <div className="flex items-start gap-1.5 text-red-600"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{reportError}</span></div>}
                                    {report && !checking && (
                                        <>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                                <span className="flex items-center gap-1 font-medium text-green-700 dark:text-green-400"><CheckCircle2 size={14} /> {report.inserted} new</span>
                                                {report.skipped > 0 && <span className="text-muted-foreground">{report.skipped} already on file</span>}
                                                {report.beforeLock > 0 && <span className="text-muted-foreground">{report.beforeLock} before the lock</span>}
                                                {rows.errors.length > 0 && <span className="text-amber-600">{rows.errors.length} row(s) unreadable</span>}
                                            </div>
                                            {report.warnings.map((w) => (
                                                <div key={w} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{w}</span></div>
                                            ))}
                                        </>
                                    )}
                                    {continuity.breaks.length > 0 && (
                                        <div className="text-xs text-red-600">
                                            Running balance breaks at {continuity.breaks.length} line(s) — first on {formatDate(rows.rows[continuity.breaks[0].rowIndex].date)}
                                            {" "}(expected {fmt(continuity.breaks[0].expected)}, statement says {fmt(continuity.breaks[0].actual)}). A line is missing or doubled.
                                            <label className="ml-2 inline-flex items-center gap-1">
                                                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> save anyway
                                            </label>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Preview */}
                            {mappingOk && preview.length > 0 && (
                                <div className="overflow-auto rounded-md border">
                                    <table className="w-full text-xs">
                                        <thead className="bg-muted/60 text-muted-foreground">
                                            <tr>
                                                <th className="px-2 py-1.5 text-left font-medium">Date</th>
                                                <th className="px-2 py-1.5 text-left font-medium">Narration</th>
                                                <th className="px-2 py-1.5 text-left font-medium">Ref</th>
                                                <th className="px-2 py-1.5 text-right font-medium">Withdrawal</th>
                                                <th className="px-2 py-1.5 text-right font-medium">Deposit</th>
                                                <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {preview.map((r, i) => (
                                                <tr key={i}>
                                                    <td className="whitespace-nowrap px-2 py-1">{formatDate(r.date)}</td>
                                                    <td className="max-w-[28rem] truncate px-2 py-1" title={r.narration}>{r.narration}</td>
                                                    <td className="whitespace-nowrap px-2 py-1 font-mono">{r.reference ?? ""}</td>
                                                    <td className="px-2 py-1 text-right font-mono">{r.withdrawal != null ? fmt(r.withdrawal) : ""}</td>
                                                    <td className="px-2 py-1 text-right font-mono">{r.deposit != null ? fmt(r.deposit) : ""}</td>
                                                    <td className="px-2 py-1 text-right font-mono">{r.balance != null ? fmt(r.balance) : ""}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {rows.rows.length > preview.length && (
                                        <div className="px-2 py-1 text-[11px] text-muted-foreground">… and {rows.rows.length - preview.length} more</div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={!canSave}>
                        {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Upload size={14} className="mr-1" />}
                        Save {report?.inserted ? `${report.inserted} line(s)` : ""}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
