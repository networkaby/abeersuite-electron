"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCsv } from "@/shared/lib/import/csvParse";
import { type CustomerImportField } from "@/shared/lib/import/customerImportFields";
import { toCsv } from "@/shared/lib/import/csvSerialize";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { formatInrLoose } from "@/shared/lib/format/moneyInr";

const FIELD_LABELS: Record<CustomerImportField, string> = {
    name: "Name *",
    kind: "Kind (person / company)",
    accountGroup: "Group (debtor / creditor)",
    address: "Address",
    agreedToTerms: "Agreed to terms",
    phone1: "Phone — primary",
    phone2: "Phone 2",
    phone3: "Phone 3",
    email1: "Email — primary",
    email2: "Email 2",
    email3: "Email 3",
    gstin: "GSTIN",
    gstStateCode: "GST state code",
    gstRegType: "GST reg type",
    shippingStateCode: "Shipping state code",
    companyReg: "Company registration",
    taxId: "Tax ID / PAN",
    receivableBalance: "Receivable balance — Dr",
    payableBalance: "Payable balance — Cr",
    openingBalance: "Opening balance (signed: + Dr, − Cr)",
    creditLimit: "Credit limit",
};

// Visual grouping for the mapping dropdown. Order matches the order we expect a
// user to scan when wiring up a fresh CSV — identity → contact → tax → company
// → balances → other.
const FIELD_GROUPS: Array<{ label: string; fields: CustomerImportField[] }> = [
    { label: "Identity", fields: ["name", "kind", "accountGroup", "address", "agreedToTerms"] },
    { label: "Phones", fields: ["phone1", "phone2", "phone3"] },
    { label: "Emails", fields: ["email1", "email2", "email3"] },
    { label: "GST", fields: ["gstin", "gstStateCode", "gstRegType", "shippingStateCode"] },
    { label: "Company only", fields: ["companyReg", "taxId"] },
    { label: "Opening balance (pick one shape)", fields: ["receivableBalance", "payableBalance", "openingBalance"] },
    { label: "Other", fields: ["creditLimit"] },
];

const IGNORE = "__ignore__" as const;
type Mapping = Record<string, CustomerImportField | typeof IGNORE>;
type Mode = "skip" | "update";

interface RowResult {
    rowIndex: number;
    action: "create" | "update" | "skip" | "error";
    kind: "person" | "company";
    name: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    accountGroup: "Sundry Debtors" | "Sundry Creditors" | null;
    openingBalance: number | null;
    openingType: "DEBIT" | "CREDIT" | null;
    errors: string[];
}

interface PreviewResult {
    willCreate: number;
    willUpdate: number;
    willSkip: number;
    errorCount: number;
    results: RowResult[];
}

function autoSuggestField(header: string): CustomerImportField | typeof IGNORE {
    // Normalize: lowercase + strip spaces, periods, underscores, dashes.
    // "Phone No." → "phoneno", "Receivable Balance" → "receivablebalance".
    const h = header.toLowerCase().replace(/[\s._-]/g, "");
    if (/^(name|customername|personname|fullname|contactname|partyname|partname)$/.test(h)) return "name";
    if (/^(kind|type|customertype|partytype|category)$/.test(h)) return "kind";
    if (/^(accountgroup|group|debtorcreditor|creditordebtor|drcr|partygroup|ledgergroup)$/.test(h)) return "accountGroup";
    if (/^(address|addr|location|street|billingaddress)$/.test(h)) return "address";
    if (/^(agreed|agreedtoterms|consent|optin)$/.test(h)) return "agreedToTerms";
    if (/^(phone|phoneno|phonenumber|mobile|mobileno|mobilenumber|phone1|mobile1|contact|tel|contactno)$/.test(h)) return "phone1";
    if (/^(phone2|phoneno2|mobile2|mobileno2|altphone|altmobile|alternatephone|alternatemobile|secondaryphone)$/.test(h)) return "phone2";
    if (/^(phone3|mobile3|tertiaryphone)$/.test(h)) return "phone3";
    if (/^(email|email1|mail|emailaddress|emailid|emailid1)$/.test(h)) return "email1";
    if (/^(email2|altemail|alternateemail|secondaryemail|emailid2)$/.test(h)) return "email2";
    if (/^(email3)$/.test(h)) return "email3";
    if (/^(gstin|gst|gstno|gstnumber|gstinno)$/.test(h)) return "gstin";
    if (/^(gststatecode|statecode|gststate)$/.test(h)) return "gstStateCode";
    if (/^(gstregtype|gsttype|regtype|registrationtype)$/.test(h)) return "gstRegType";
    if (/^(shippingstatecode|shipstate|deliverystate|shippingstate)$/.test(h)) return "shippingStateCode";
    if (/^(companyreg|companyregistration|cin|registrationno|regno)$/.test(h)) return "companyReg";
    if (/^(taxid|pan|panno|pannumber|tin)$/.test(h)) return "taxId";
    if (/^(receivable|receivablebalance|receivableamount|debit|debitbalance|drbalance|openingdr|openingreceivable)$/.test(h)) return "receivableBalance";
    if (/^(payable|payablebalance|payableamount|credit|creditbalance|crbalance|openingcr|openingpayable)$/.test(h)) return "payableBalance";
    if (/^(openingbalance|opening|ob|balance|signedbalance|netbalance)$/.test(h)) return "openingBalance";
    if (/^(creditlimit|crlimit|limit|maxcredit)$/.test(h)) return "creditLimit";
    return IGNORE;
}

function formatBalance(amt: number | null, type: "DEBIT" | "CREDIT" | null): string {
    if (amt == null || amt === 0 || type == null) return "—";
    return `${formatInrLoose(amt)} ${type === "DEBIT" ? "Dr" : "Cr"}`;
}

export function CustomerImportPanel() {
    const [file, setFile] = useState<File | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<string[][]>([]);
    const [mapping, setMapping] = useState<Mapping>({});
    const [mode, setMode] = useState<Mode>("skip");
    const [previewing, setPreviewing] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [commitResult, setCommitResult] = useState<PreviewResult | null>(null);

    const sampleRow = rows[0] ?? [];

    const mappedFields = useMemo(() => {
        const set = new Set<CustomerImportField>();
        for (const v of Object.values(mapping)) if (v !== IGNORE) set.add(v);
        return set;
    }, [mapping]);

    // A row normally needs a phone or email to be reachable. Contact-less
    // ledger-only rows (GST number or a carried-forward balance, no captured
    // contact) are still importable — the backend stamps a placeholder email
    // for those — so mapping a GSTIN/balance column also satisfies this gate.
    const hasContactColumn = mappedFields.has("phone1") || mappedFields.has("email1");
    const hasFallbackColumn = mappedFields.has("gstin")
        || mappedFields.has("receivableBalance")
        || mappedFields.has("payableBalance")
        || mappedFields.has("openingBalance");
    const hasRequired = mappedFields.has("name") && (hasContactColumn || hasFallbackColumn);

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
        const payload: Array<{ rowIndex: number; values: Partial<Record<CustomerImportField, string>> }> = [];
        for (let i = 0; i < rows.length; i++) {
            const values: Partial<Record<CustomerImportField, string>> = {};
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
            const res = await fetch("/api/settings/customer-import/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: buildRowsPayload(), mode }),
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
        if (!(await confirmAction({ title: `Commit ${total} rows?`, body: `This writes to the customers table and ledger.`, confirmLabel: "Commit", destructive: false }))) return;
        setCommitting(true);
        try {
            const res = await fetch("/api/settings/customer-import/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: buildRowsPayload(), mode }),
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
                        First row must be the column headers — actual names don&apos;t matter, you&apos;ll map them in the
                        next step. Each row creates a Person (default) or Company plus a matching ledger account under
                        Sundry Debtors or Sundry Creditors, with the opening balance and credit limit applied to that
                        account.
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
                            Pick which Person field each of your columns maps to. <strong>Name</strong> plus at least
                            one of <strong>Phone — primary</strong> or <strong>Email — primary</strong> are required —
                            unless the row is a contact-less ledger-only party, in which case a{" "}
                            <strong>GSTIN</strong> or an opening balance column stands in for it (a placeholder email
                            is stamped so the row still has a contact key). Use <strong>Receivable Balance</strong> +{" "}
                            <strong>Payable Balance</strong> as two columns, OR a single signed{" "}
                            <strong>Opening Balance</strong> (positive = receivable, negative = payable) — never both.
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
                                                className="h-8 rounded border bg-background px-2 text-xs"
                                                value={mapping[h] ?? IGNORE}
                                                onChange={(e) =>
                                                    setMapping((m) => ({
                                                        ...m,
                                                        [h]: e.target.value as CustomerImportField | typeof IGNORE,
                                                    }))
                                                }
                                            >
                                                <option value={IGNORE}>— Ignore —</option>
                                                {FIELD_GROUPS.map((g) => (
                                                    <optgroup key={g.label} label={g.label}>
                                                        {g.fields.map((f) => (
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
                            Map at least <strong>Name</strong> and one of <strong>Phone — primary</strong> /{" "}
                            <strong>Email — primary</strong> — or, for contact-less rows, a <strong>GSTIN</strong> /
                            opening balance column — to continue.
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
                            A row is treated as a duplicate when any of its phones or emails already belongs to an
                            existing customer. Pick what should happen then, then preview before committing.
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">When phone or email already exists</Label>
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
                                Update the existing customer
                            </label>
                        </div>
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
                                    <th className="py-1 px-1.5 text-left">Kind</th>
                                    <th className="py-1 px-1.5 text-left">Name</th>
                                    <th className="py-1 px-1.5 text-left">Phone</th>
                                    <th className="py-1 px-1.5 text-left">Email</th>
                                    <th className="py-1 px-1.5 text-left">Group</th>
                                    <th className="py-1 px-1.5 text-left">Opening</th>
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
                                        <td className="py-1 px-1.5">{r.kind}</td>
                                        <td className="py-1 px-1.5">{r.name ?? "—"}</td>
                                        <td className="py-1 px-1.5 font-mono">{r.phone ?? "—"}</td>
                                        <td className="py-1 px-1.5">{r.email ?? "—"}</td>
                                        <td className="py-1 px-1.5">
                                            {r.accountGroup === "Sundry Debtors"
                                                ? "Debtor"
                                                : r.accountGroup === "Sundry Creditors"
                                                ? "Creditor"
                                                : "—"}
                                        </td>
                                        <td className="py-1 px-1.5 font-mono">
                                            {formatBalance(r.openingBalance, r.openingType)}
                                        </td>
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
