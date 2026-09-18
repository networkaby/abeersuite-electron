"use client";

/**
 * A file the user picked → a grid of text cells, whatever it really is.
 *
 * Decided by CONTENT, not by extension: SBI's statement download is a
 * tab-separated text file named `.xls`, and a real `.xls` (OLE) or `.xlsx`
 * (zip) is told apart by its first bytes. Text files go through the house
 * `parseCsv` with a sniffed delimiter; binary sheets go through SheetJS, which
 * is loaded on demand so no other page pays for it.
 */

import { parseCsv, sniffDelimiter } from "./csvParse";

export interface TabularFile {
    grid: string[][];
    /** "text" | "xlsx" | "xls" — for the import record and the UI. */
    container: "text" | "xlsx" | "xls";
    /** sha1 of the bytes, hex — the whole-file duplicate check. */
    sha1: string;
}

function isZip(b: Uint8Array) { return b[0] === 0x50 && b[1] === 0x4b; }
function isOle(b: Uint8Array) { return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; }

async function sha1Hex(buf: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-1", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readTabularFile(file: File): Promise<TabularFile> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const sha1 = await sha1Hex(buf);

    if (isZip(bytes) || isOle(bytes)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(bytes, { type: "array", cellDates: false, raw: false });
        const first = wb.SheetNames[0];
        const sheet = wb.Sheets[first];
        // raw:false → every cell as the text Excel would show, so dates and
        // Indian-grouped amounts arrive as the user sees them and one parser
        // handles both spreadsheets and text files.
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
        const grid = rows.map((r) => r.map((c) => (c == null ? "" : String(c))));
        return { grid, container: isZip(bytes) ? "xlsx" : "xls", sha1 };
    }

    // Text. Strip a UTF-8 BOM; SBI's file is plain ASCII with tabs.
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const delimiter = sniffDelimiter(text);
    const parsed = parseCsv(text, delimiter);
    const grid = parsed.headers.length ? [parsed.headers, ...parsed.rows] : parsed.rows;
    return { grid, container: "text", sha1 };
}
