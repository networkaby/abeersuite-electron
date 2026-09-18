/**
 * Bank statement → one shape, whatever the bank.
 *
 * Every bank prints its statement differently — SBI is a tab-separated text
 * file wearing a `.xls` name with seventeen lines of account particulars above
 * the table, HDFC is a real Excel sheet with a title block, Kotak is a plain
 * CSV. Matching must never see any of that. This module turns a grid of cells
 * (from `spreadsheetRead.ts`) into `StatementRow`s, and everything downstream —
 * the preview, the upload, the matcher — speaks only that shape.
 *
 * Pure: no React, no DOM, no Node. Runs in the browser at upload time and on the
 * server for the checks that must not trust the browser.
 *
 * Two layers:
 *   • PROFILES — a bank we have studied. Recognised by its header signature; the
 *     column map and the metadata (account number, IFSC, opening balance, period)
 *     are known, so the user maps nothing. `sbi-tsv` is the first.
 *   • GENERIC — any other layout. The header row is found by content, the
 *     columns are guessed from their names, and the user confirms the mapping.
 */

export type StatementField =
    | "date" | "valueDate" | "narration" | "reference"
    | "withdrawal" | "deposit" | "balance"
    | "amount" | "drcr";

export const IGNORE_FIELD = "__ignore__" as const;
export type FieldChoice = StatementField | typeof IGNORE_FIELD;

export const STATEMENT_FIELD_LABELS: Record<StatementField, string> = {
    date:       "Date *",
    valueDate:  "Value date",
    narration:  "Narration / description *",
    reference:  "Cheque / ref no",
    withdrawal: "Withdrawal (Dr)",
    deposit:    "Deposit (Cr)",
    balance:    "Balance",
    amount:     "Amount (single column)",
    drcr:       "Dr / Cr indicator",
};

/** One statement line, normalised. Amounts are positive numbers in rupees. */
export interface StatementRow {
    /** yyyy-mm-dd */
    date: string;
    valueDate?: string | null;
    narration: string;
    reference: string | null;
    withdrawal: number | null;
    deposit: number | null;
    balance: number | null;
}

export interface StatementMeta {
    bankAccountNumber?: string | null;
    ifsc?: string | null;
    /** yyyy-mm-dd */
    fromDate?: string | null;
    toDate?: string | null;
    openingBalance?: number | null;
}

export interface ParsedStatement {
    profile: string;
    headerRowIndex: number;
    headers: string[];
    /** Raw cell rows below the header, footer stripped. */
    dataRows: string[][];
    mapping: Record<string, FieldChoice>;
    meta: StatementMeta;
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoOf(y: number, m: number, d: number): string | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Every date spelling Indian banks use → yyyy-mm-dd, or null.
 *   18 Mar 2026 · 18-Mar-26 · 18/03/2026 · 18-03-2026 · 2026-03-18 · 18.03.26
 *   Excel serials (45000) when the sheet stored a real date and the reader
 *   handed the number through.
 * Day-first is assumed for numeric forms: no Indian bank prints month-first.
 */
export function parseStatementDate(raw: string | number | null | undefined): string | null {
    if (raw == null) return null;
    if (typeof raw === "number") {
        if (raw > 20000 && raw < 80000) {
            const ms = Math.round((raw - 25569) * 86400 * 1000);
            const dt = new Date(ms);
            return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
        }
        return null;
    }
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) return null;

    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    if (m) return isoOf(+m[1], +m[2], +m[3]);

    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T].*)?$/);
    if (m) return isoOf(+m[3], +m[2], +m[1]);

    m = s.match(/^(\d{1,2})[ \-\/]([A-Za-z]{3,9})[ \-\/,]+(\d{2,4})(?:[ T].*)?$/);
    if (m) {
        const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
        return mon ? isoOf(+m[3], mon, +m[1]) : null;
    }

    m = s.match(/^([A-Za-z]{3,9})[ \-\/](\d{1,2})[ ,\-\/]+(\d{2,4})$/);
    if (m) {
        const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
        return mon ? isoOf(+m[3], mon, +m[2]) : null;
    }
    return null;
}

/**
 * "1,23,456.78" · "(1,234.00)" · "1234.5 Dr" · "-4,89,310.06" · "₹ 500" → number.
 * Returns null for blank / dash / non-numeric. Parentheses and a trailing "Dr"
 * mean negative only for the single-amount column; callers that split
 * withdrawal/deposit take the absolute value.
 */
export function parseStatementAmount(raw: string | number | null | undefined): number | null {
    if (raw == null) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    let s = raw.trim();
    if (!s || s === "-" || s === "—") return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (/\bdr\b\.?$/i.test(s)) { negative = true; }
    s = s.replace(/\b(dr|cr)\b\.?/gi, "").replace(/[₹,\s]/g, "").replace(/^INR/i, "");
    if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
}

/** Two decimals, the way every money figure is compared in this app. */
export function money2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Reference tokens ─────────────────────────────────────────────────────────

/**
 * The instrument number hiding in a narration — the one thing that identifies a
 * transfer on both sides of the reconciliation:
 *   NEFT UTR NO: SBIN226078758463      → SBIN226078758463
 *   NEFT*UTIB0000553*AXNGG25472660224* → AXNGG25472660224
 *   UPI/CR/120630786145/NABAJYOT       → 120630786145
 *   IMPS/607917005030/ybr-XX057        → 607917005030
 *   CHQ 483920 / Chq No 000123          → 483920 / 000123
 * Returns the tokens in order of confidence; the first is stored as the line's
 * reference when the bank has no ref column of its own.
 */
export function extractReferenceTokens(text: string): string[] {
    const out: string[] = [];
    const push = (t: string | undefined) => {
        if (!t) return;
        const v = t.trim();
        if (v.length >= 6 && !out.includes(v)) out.push(v);
    };
    // UTR forms: 16-char alnum starting with the bank code (SBIN2..., AXNGG2...).
    for (const m of text.matchAll(/\b([A-Z]{4}[A-Z0-9]{8,18})\b/g)) {
        if (/\d{4,}/.test(m[1])) push(m[1]);
    }
    // Net-banking transfer ids: letters and digits mixed, e.g. CT0ABYQDL4, SI90787226CT0ACNDHL8.
    for (const m of text.matchAll(/\b([A-Z]{2}\d[A-Z0-9]{7,17})\b/g)) push(m[1]);
    // UPI / IMPS / RRN: a 10–12 digit run in a UPI/IMPS segment.
    for (const m of text.matchAll(/\b(?:UPI|IMPS|RRN|RTGS|NEFT)\b[^0-9]{0,12}(\d{10,16})\b/gi)) push(m[1]);
    // Cheque numbers.
    for (const m of text.matchAll(/\b(?:CHQ|CHEQUE|CHQ\.?\s*NO\.?|CHEQUE\s*NO\.?)\s*[:#-]?\s*(\d{6})\b/gi)) push(m[1]);
    // Any bare long digit run as a last resort.
    for (const m of text.matchAll(/\b(\d{12,16})\b/g)) push(m[1]);
    return out;
}

// ── Header detection & column guessing ───────────────────────────────────────

function norm(h: string): string {
    return h.toLowerCase().replace(/[\s._\-\/()*:]/g, "");
}

/** Best guess of what a column holds, from its header text. */
export function autoSuggestStatementField(header: string): FieldChoice {
    const h = norm(header);
    if (!h) return IGNORE_FIELD;
    if (/^(valuedate|valuedt|valdate)$/.test(h)) return "valueDate";
    if (/^(txndate|transactiondate|trandate|date|txndt|postdate|postingdate|bookingdate|transdate|tradate)$/.test(h)) return "date";
    if (/^(description|narration|particulars|transactionremarks|remarks|details|transactiondetails|transactiondescription|txndescription|narrative)$/.test(h)) return "narration";
    if (/^(refnochequeno|chqrefno|chequeno|chqno|refno|referenceno|reference|chequerefno|instrumentno|instrno|chqrefnumber|utr|utrno|transactionid|txnid)$/.test(h)) return "reference";
    if (/^(debit|withdrawal|withdrawalamt|withdrawalamount|debitamount|debitamt|dr|dramount|withdrawals|withdrawalinr|debitinr|paidout)$/.test(h)) return "withdrawal";
    if (/^(credit|deposit|depositamt|depositamount|creditamount|creditamt|cr|cramount|deposits|depositinr|creditinr|paidin)$/.test(h)) return "deposit";
    if (/^(balance|closingbalance|runningbalance|balanceamt|balanceinr|closingbalanceinr|availablebalance)$/.test(h)) return "balance";
    if (/^(amount|amt|transactionamount|txnamount|amountinr)$/.test(h)) return "amount";
    if (/^(drcr|crdr|type|txntype|transactiontype|debitcredit|creditdebit|dc)$/.test(h)) return "drcr";
    return IGNORE_FIELD;
}

function looksLikeHeaderRow(cells: string[]): boolean {
    const fields = new Set(cells.map(autoSuggestStatementField).filter((f) => f !== IGNORE_FIELD));
    if (!fields.has("date") && !fields.has("valueDate")) return false;
    return fields.has("balance") || fields.has("withdrawal") || fields.has("deposit") || fields.has("amount");
}

/** The first row that reads as the table header; rows above it are metadata. */
export function findHeaderRow(grid: string[][]): number {
    for (let i = 0; i < Math.min(grid.length, 60); i++) {
        if (looksLikeHeaderRow(grid[i])) return i;
    }
    return -1;
}

// ── Metadata (the particulars block above the table) ─────────────────────────

/** "Account Number : _00000033605435873" → "00000033605435873" */
export function cleanAccountNumber(v: string | null | undefined): string | null {
    if (!v) return null;
    const s = v.replace(/[^0-9A-Za-z]/g, "");
    return s.length >= 6 ? s : null;
}

/** Two account numbers name the same account when their last 6+ digits agree —
 *  banks pad with zeros and the user types the short form on the ledger. */
export function sameAccountNumber(a: string | null | undefined, b: string | null | undefined): boolean {
    const x = cleanAccountNumber(a);
    const y = cleanAccountNumber(b);
    if (!x || !y) return false;
    const n = Math.min(x.length, y.length, 10);
    if (n < 6) return false;
    return x.slice(-n).toLowerCase() === y.slice(-n).toLowerCase();
}

function readLabelledRows(rows: string[][]): Map<string, string> {
    const out = new Map<string, string>();
    for (const cells of rows) {
        const joined = cells.map((c) => c ?? "").join("\t");
        // "Label :\tvalue" or "Label : value" — split at the first colon.
        const idx = joined.indexOf(":");
        if (idx <= 0) continue;
        const label = norm(joined.slice(0, idx));
        const value = joined.slice(idx + 1).replace(/\t/g, " ").trim();
        if (label && value && !out.has(label)) out.set(label, value);
    }
    return out;
}

export function extractStatementMeta(metaRows: string[][]): StatementMeta {
    const kv = readLabelledRows(metaRows);
    const pick = (...keys: string[]) => {
        for (const k of keys) { const v = kv.get(k); if (v) return v; }
        // Prefix match: "openingbalanceason18mar2026" → opening balance.
        for (const k of keys) for (const [lk, v] of kv) if (lk.startsWith(k)) return v;
        return null;
    };
    const ifscRaw = pick("ifscode", "ifsc", "ifsccode");
    const ifsc = ifscRaw ? (ifscRaw.match(/[A-Z]{4}0[A-Z0-9]{6}/i)?.[0]?.toUpperCase() ?? null) : null;
    return {
        bankAccountNumber: cleanAccountNumber(pick("accountnumber", "accountno", "acno", "acnumber", "accno")),
        ifsc,
        fromDate: parseStatementDate(pick("startdate", "fromdate", "periodfrom", "statementfrom")),
        toDate:   parseStatementDate(pick("enddate", "todate", "periodto", "statementto")),
        openingBalance: parseStatementAmount(pick("openingbalance", "openingbal")),
    };
}

// ── Profiles ─────────────────────────────────────────────────────────────────

interface Profile {
    id: string;
    label: string;
    /** Recognise the header row of this bank's export. */
    matches(headers: string[]): boolean;
    mapping(headers: string[]): Record<string, FieldChoice>;
}

const PROFILES: Profile[] = [
    {
        id: "sbi-tsv",
        label: "State Bank of India (statement download)",
        matches: (headers) => {
            const n = headers.map(norm);
            return n.includes("txndate") && n.includes("valuedate") && n.includes("description")
                && n.some((h) => h.startsWith("refno")) && n.includes("balance");
        },
        mapping: (headers) => Object.fromEntries(headers.map((h) => [h, autoSuggestStatementField(h)])),
    },
];

/**
 * Cell grid → parsed statement. Never throws: a grid with no recognisable
 * header comes back with `headerRowIndex: -1` for the UI to explain.
 */
export function parseStatementGrid(grid: string[][]): ParsedStatement {
    const clean = grid.map((r) => r.map((c) => (c ?? "").toString()));
    const headerRowIndex = findHeaderRow(clean);
    if (headerRowIndex < 0) {
        return { profile: "generic", headerRowIndex, headers: [], dataRows: [], mapping: {}, meta: {} };
    }
    const headers = clean[headerRowIndex].map((h) => h.trim());
    const profile = PROFILES.find((p) => p.matches(headers));
    const mapping = profile
        ? profile.mapping(headers)
        : Object.fromEntries(headers.map((h) => [h, autoSuggestStatementField(h)]));
    const dateCol = headers.findIndex((h) => mapping[h] === "date");

    // Data = rows below the header whose date cell parses; the footer ("This is
    // a computer generated statement…") and blank spacer rows fall away. A row
    // whose date is blank but sits between dated rows is a wrapped narration —
    // glue it to the previous row rather than lose the text.
    const dataRows: string[][] = [];
    for (let i = headerRowIndex + 1; i < clean.length; i++) {
        const cells = clean[i];
        if (cells.every((c) => c.trim() === "")) continue;
        const dated = dateCol >= 0 && parseStatementDate(cells[dateCol]) !== null;
        if (dated) { dataRows.push(cells); continue; }
        const prev = dataRows[dataRows.length - 1];
        const nonEmpty = cells.filter((c) => c.trim() !== "");
        if (prev && nonEmpty.length === 1 && i < clean.length - 1) {
            const narrCol = headers.findIndex((h) => mapping[h] === "narration");
            if (narrCol >= 0) prev[narrCol] = `${prev[narrCol] ?? ""} ${nonEmpty[0].trim()}`.trim();
        }
    }

    const meta = extractStatementMeta(clean.slice(0, headerRowIndex));
    return { profile: profile?.id ?? "generic", headerRowIndex, headers, dataRows, mapping, meta };
}

// ── Normalise ────────────────────────────────────────────────────────────────

export interface NormaliseResult {
    rows: StatementRow[];
    /** Row indexes (into dataRows) that could not be read, with the reason. */
    errors: Array<{ rowIndex: number; reason: string }>;
}

/** Apply a column mapping to the raw rows. Amounts come out positive. */
export function normaliseStatementRows(
    headers: string[],
    dataRows: string[][],
    mapping: Record<string, FieldChoice>,
): NormaliseResult {
    const col = (f: StatementField) => headers.findIndex((h) => mapping[h] === f);
    const cDate = col("date"), cValue = col("valueDate"), cNarr = col("narration"), cRef = col("reference");
    const cW = col("withdrawal"), cD = col("deposit"), cBal = col("balance"), cAmt = col("amount"), cDrCr = col("drcr");
    const rows: StatementRow[] = [];
    const errors: NormaliseResult["errors"] = [];

    dataRows.forEach((cells, rowIndex) => {
        const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
        const date = parseStatementDate(get(cDate)) ?? parseStatementDate(get(cValue));
        if (!date) { errors.push({ rowIndex, reason: "date not readable" }); return; }
        const narration = get(cNarr).replace(/\s+/g, " ").trim();

        let withdrawal: number | null = null;
        let deposit: number | null = null;
        if (cW >= 0 || cD >= 0) {
            const w = parseStatementAmount(get(cW));
            const d = parseStatementAmount(get(cD));
            withdrawal = w != null && w !== 0 ? Math.abs(w) : null;
            deposit    = d != null && d !== 0 ? Math.abs(d) : null;
        } else if (cAmt >= 0) {
            const a = parseStatementAmount(get(cAmt));
            if (a == null) { errors.push({ rowIndex, reason: "amount not readable" }); return; }
            const ind = get(cDrCr).toLowerCase();
            const isDebit = ind ? /^(dr|d|debit|withdrawal)/.test(ind) : a < 0;
            if (isDebit) withdrawal = Math.abs(a); else deposit = Math.abs(a);
        }
        if (withdrawal == null && deposit == null) { errors.push({ rowIndex, reason: "no amount" }); return; }

        const balance = parseStatementAmount(get(cBal));
        const refCell = get(cRef).replace(/\s+/g, " ").replace(/\s*\/\s*$/, "").trim();
        // The instrument number wins over the bank's ref cell: SBI fills that
        // cell with "TRANSFER TO 4398… / JSK COMPUTER", which is the counterparty,
        // not a reference. A short ref cell (a cheque number) is kept as it is.
        const refTokens = extractReferenceTokens(`${narration} ${refCell}`);
        const reference = refTokens[0] ?? (refCell && refCell.length <= 24 ? refCell : null);
        // A long ref cell is narrative (who the money went to) — keep it readable.
        const fullNarration = refCell && refCell.length > 24 && !narration.includes(refCell)
            ? `${narration} · ${refCell}`.trim()
            : narration;

        rows.push({
            date,
            valueDate: cValue >= 0 ? parseStatementDate(get(cValue)) : null,
            narration: fullNarration || (refCell || "(no narration)"),
            reference: reference ? reference.replace(/\s+/g, " ").trim().slice(0, 120) : null,
            withdrawal: withdrawal != null ? money2(withdrawal) : null,
            deposit:    deposit != null ? money2(deposit) : null,
            balance:    balance != null ? money2(balance) : null,
        });
    });
    return { rows, errors };
}

// ── Continuity ───────────────────────────────────────────────────────────────

export interface ContinuityBreak {
    /** Index into `rows` of the line whose printed balance disagrees. */
    rowIndex: number;
    expected: number;
    actual: number;
}

/**
 * Walk the running balance: each line's balance must equal the previous one
 * minus withdrawal plus deposit. A break means a line is missing, doubled, or
 * mis-read — and it is found BEFORE anything is saved. Statements without a
 * balance column skip this (nothing to walk).
 *
 * Direction is inferred from the first pair rather than assumed, because some
 * banks list newest-first.
 */
export function checkContinuity(rows: StatementRow[], openingBalance: number | null): {
    breaks: ContinuityBreak[];
    newestFirst: boolean;
    checked: number;
} {
    const withBal = rows.filter((r) => r.balance != null);
    if (withBal.length < 2) return { breaks: [], newestFirst: false, checked: 0 };

    const forward = (prev: number, r: StatementRow) => money2(prev - (r.withdrawal ?? 0) + (r.deposit ?? 0));
    const fits = (order: StatementRow[]) => {
        let ok = 0;
        for (let i = 1; i < Math.min(order.length, 6); i++) {
            if (order[i].balance == null || order[i - 1].balance == null) continue;
            if (Math.abs(forward(order[i - 1].balance!, order[i]) - order[i].balance!) < 0.005) ok++;
        }
        return ok;
    };
    const asIs = fits(rows);
    const reversed = fits([...rows].reverse());
    const newestFirst = reversed > asIs;
    const order = newestFirst ? [...rows].reverse() : rows;

    const breaks: ContinuityBreak[] = [];
    let prev: number | null = openingBalance;
    let checked = 0;
    order.forEach((r) => {
        if (r.balance == null) { prev = null; return; }
        if (prev != null) {
            checked++;
            const expected = forward(prev, r);
            if (Math.abs(expected - r.balance) >= 0.005) {
                breaks.push({ rowIndex: rows.indexOf(r), expected, actual: r.balance });
            }
        }
        prev = r.balance;
    });
    return { breaks, newestFirst, checked };
}

/** The text a line's fingerprint is taken from; hashed by whoever has a hasher. */
export function fingerprintSource(accountId: number, r: StatementRow, nth: number): string {
    return [
        accountId, r.date,
        r.withdrawal == null ? "" : r.withdrawal.toFixed(2),
        r.deposit == null ? "" : r.deposit.toFixed(2),
        r.balance == null ? "" : r.balance.toFixed(2),
        r.narration.toLowerCase().replace(/\s+/g, " ").trim(),
        nth,
    ].join("|");
}

/** nth = how many identical rows came before this one in the same file. */
export function occurrenceIndexes(accountId: number, rows: StatementRow[]): number[] {
    const seen = new Map<string, number>();
    return rows.map((r) => {
        const key = fingerprintSource(accountId, r, 0);
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        return n;
    });
}
