/**
 * Rows → CSV text (RFC 4180 quoting, CRLF line ends). The write-side twin of
 * `csvParse.ts`, used by the import panels' "download template / errors" links.
 */
export function toCsv(rows: string[][]): string {
    const escape = (cell: string) => {
        if (cell == null) return "";
        const needsQuote = /[",\r\n]/.test(cell);
        const escaped = cell.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
    };
    return rows.map((r) => r.map(escape).join(",")).join("\r\n");
}
