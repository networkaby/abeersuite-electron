/**
 * Tiny CSV parser — RFC 4180 subset. Handles double-quoted fields with
 * embedded commas, newlines, and escaped quotes (`""`). Returns headers +
 * rows as plain string arrays; empty rows are skipped.
 *
 * Used by the Settings → Item Import page so we don't need a CSV dependency
 * just for one feature.
 */

export interface ParsedCsv {
    headers: string[];
    rows: string[][];
}

/**
 * Which separator a delimited text file uses, decided from its first lines.
 * Bank exports are the reason this exists: SBI hands out a tab-separated file
 * with a `.xls` name, and a comma-parse of it yields one column per row.
 */
export function sniffDelimiter(text: string): "," | "\t" | "|" | ";" {
    const head = text.slice(0, 4000).split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 12);
    const candidates: Array<"," | "\t" | "|" | ";"> = [",", "\t", "|", ";"];
    let best: "," | "\t" | "|" | ";" = ",";
    let bestScore = -1;
    for (const d of candidates) {
        const counts = head.map((l) => l.split(d).length - 1);
        const linesWithIt = counts.filter((c) => c > 0).length;
        const total = counts.reduce((a, b) => a + b, 0);
        // Prefer the separator that appears on the most lines, then the most often.
        const score = linesWithIt * 1000 + total;
        if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
}

export function parseCsv(text: string, delimiter: string = ","): ParsedCsv {
    const records: string[][] = [];
    let field = "";
    let row: string[] = [];
    let inQuotes = false;
    let i = 0;
    const len = text.length;

    while (i < len) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (ch === delimiter) {
            row.push(field);
            field = "";
            i++;
            continue;
        }
        if (ch === "\r") {
            if (text[i + 1] === "\n") i++;
            row.push(field);
            if (row.some((c) => c !== "")) records.push(row);
            row = [];
            field = "";
            i++;
            continue;
        }
        if (ch === "\n") {
            row.push(field);
            if (row.some((c) => c !== "")) records.push(row);
            row = [];
            field = "";
            i++;
            continue;
        }
        field += ch;
        i++;
    }

    // Tail
    if (field !== "" || row.length > 0) {
        row.push(field);
        if (row.some((c) => c !== "")) records.push(row);
    }

    if (records.length === 0) return { headers: [], rows: [] };

    const [headers, ...rest] = records;
    return { headers: headers.map((h) => h.trim()), rows: rest };
}
