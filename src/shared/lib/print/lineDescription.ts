// A goods line's stored text, read back for printing.
//
// Since B3b (2026-10-02) the line note has its own column (`note`) and
// `description` holds only the item text (POS: "<sku> — <name>"). Before that,
// POS stored "<sku> — <name> · <note>" and the office trading form stored only
// the note in `description`; the migration split those once where it could.
// `readLineText` reads both: the note column when set, else the old split —
// so the item always prints as the item and the note under it (behind the
// template's showLineNote flag), never as the name.

const SKU_SEP  = " — ";
const NOTE_SEP = " · ";

export type LineText = { name: string; note: string | null };

/**
 * The POS's stored item text: "<sku> — <name>". The note goes to its own column
 * (`note`) — the POS sale, its edit and the POS order / estimate all save
 * through here.
 */
export function composeLineDescription(line: { sku: string; name: string }): string {
    return `${line.sku}${SKU_SEP}${line.name}`;
}

/** The line note as stored: trimmed, and null when empty. */
export function cleanLineNote(note: string | null | undefined): string | null {
    const t = (note ?? "").trim();
    return t || null;
}

/**
 * A goods line's item name and note, for any line old or new. The `note`
 * column wins when set; a line from before it falls back to splitting the text.
 */
export function readLineText(
    line: { description?: string | null; note?: string | null },
    product: { sku?: string | null; name?: string | null } | null | undefined,
): LineText {
    const split = splitLineDescription(line.description, product);
    const note = cleanLineNote(line.note);
    return note ? { name: split.name, note } : split;
}

/**
 * Split a stored line text into the item name and the note.
 *   - POS "<sku> — <name> · <note>" → the name as sold, and the note.
 *   - Anything else on a product line → the product name; the text is the note
 *     (dropped when it only repeats the name).
 *   - No product → the text is the name itself; no note.
 * A product renamed after the sale keeps the name printed on the day.
 */
export function splitLineDescription(
    description: string | null | undefined,
    product: { sku?: string | null; name?: string | null } | null | undefined,
): LineText {
    const desc  = (description ?? "").trim();
    const pname = (product?.name ?? "").trim();
    if (!pname) return { name: desc, note: null };

    const prefix = product?.sku ? `${product.sku}${SKU_SEP}` : "";
    if (!prefix || !desc.startsWith(prefix)) {
        return { name: pname, note: desc && desc !== pname ? desc : null };
    }
    const rest = desc.slice(prefix.length);
    const name = rest === pname || rest.startsWith(pname + NOTE_SEP)
        ? pname
        : rest.split(NOTE_SEP)[0];
    const note = rest.slice(name.length + NOTE_SEP.length).trim();
    return { name, note: note || null };
}
