// A goods line's stored text, read back for printing.
//
// POS stores "<sku> — <name> · <note>": the SKU and name for the office's own
// lists, then whatever the cashier typed in the line's Note box (serial no.,
// colour, config). The office trading form stores only the note. Every print
// splits the text here, so the item always prints as the item and the note
// prints under it (behind the template's showLineNote flag), never as the name.

const SKU_SEP  = " — ";
const NOTE_SEP = " · ";

export type LineText = { name: string; note: string | null };

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
