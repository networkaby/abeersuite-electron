import "server-only";

// Checks a fact the AI says it read on a web page against that page's text:
// the value must really be there. The AI copies wrong or drifts, so nothing
// from a page reaches the description without passing here. The page itself
// is downloaded once by aiPageReader.ts.

/** Public https pages only — URLs come from search results, so never our own network. */
export function isPublicHttps(raw: string): URL | null {
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return null;
    if (/^[\d.]+$/.test(h) || h.includes(":")) return null; // bare IPv4 / IPv6
    return u;
}

/** Page text as the check compares it: lower case, no commas or spaces. */
export const normForCheck = (s: string) => s.toLowerCase().replace(/&nbsp;|&#160;/g, " ").replace(/[, ]/g, "").replace(/\s+/g, " ");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A word right after a number counts as its unit only when it is a real unit —
 * otherwise "30 Hz HDMI" (spaces gone in the page text) read as unit "hzhdmi",
 * and "USB 3.0 and" as unit "and" (owner's test, 2026-11-07, dropped a true
 * "4K @ 30 Hz" highlight). Whole word, plural allowed ("years").
 */
const UNIT = /^(k|p|x|w|v|a|kw|mah|wh|hz|khz|mhz|ghz|b|kb|mb|gb|tb|kbps|mbps|gbps|bit|mm|cm|m|km|in|inch|ft|g|kg|ml|l|ppm|dpi|nm|db|rpm|lm|year|yr|month|mo|day|hr|hour|min|sec|watt|volt|amp)s?$/;

/** Every number in `value`, with its unit when one follows ("999 Gbps" → 999 gbps; "8" bare). */
function numberTokens(value: string): { num: string; unit: string }[] {
    const v = value.toLowerCase().replace(/&nbsp;|&#160;/g, " ").replace(/,/g, "");
    return [...v.matchAll(/(\d+(?:\.\d+)?)[\s-]?([a-z]*)/g)].map((m) => ({ num: m[1], unit: UNIT.test(m[2]) ? m[2] : "" }));
}

/**
 * Is every number of `value` on the page as a whole number, with its unit?
 * A bare "999" or "5" is somewhere on nearly every long page (a price, a
 * date), so digits alone proved nothing (owner, 2026-11-07: a made-up
 * "999 Gbps" and "5 Year" passed). Now the number must stand alone — not part
 * of a longer number — and, when the value gives a unit, be followed by that
 * unit's first letters ("5 years" / "5-year" match "5 Year"; "5 yrs" does not,
 * so it goes to "unsure" — the safe side). `pageNorm` is normForCheck text.
 */
export function numbersOnPage(pageNorm: string, value: string): boolean {
    return numberTokens(value).every(({ num, unit }) => {
        const tail = unit ? `-?${escape(unit.slice(0, 3))}` : "(?![\\d.]\\d)";
        return new RegExp(`(?<![\\d.])${escape(num)}${tail}`).test(pageNorm);
    });
}

/** Every number in the value must be on the page (numbersOnPage); a value with no numbers needs most of its words. */
function pageHas(text: string, value: string): boolean {
    if (numberTokens(value).length) return numbersOnPage(text, value);
    const words = value.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    // Only short words ("HP", "LG"): each one must be there — "Brand: HP" never passed before.
    if (!words.length) {
        const short = value.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length === 2);
        return short.length > 0 && short.every((w) => text.includes(w));
    }
    return words.filter((w) => text.includes(w)).length / words.length >= 0.75;
}

const isListLabel = (label: string) => /compatib|works with|supported (printer|model|device)/i.test(label);

/**
 * The value as far as the page shows it, or null. A compatibility list is
 * checked item by item and keeps the models the page really names.
 * `pageNorm` is the page text through normForCheck.
 */
export function checkFact(pageNorm: string, label: string, value: string): string | null {
    if (!value.trim()) return null;
    if (isListLabel(label)) {
        const kept = value.split(/[,;\n]|\band\b/).map((x) => x.trim()).filter((x) => x && pageHas(pageNorm, x));
        return kept.length ? kept.join(", ") : null;
    }
    return pageHas(pageNorm, value) ? value : null;
}

/** "~0.05 kg" / "50 g" / "1.2kg" → whole grams (rounded up); null when no weight is in the text. */
export function gramsOf(text: string): number | null {
    const m = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?)\b/i.exec(text.replace(/,/g, ""));
    if (!m) return null;
    const g = Number(m[1]) * (m[2].toLowerCase().startsWith("k") ? 1000 : 1);
    return g > 0 && g <= 1_000_000 ? Math.ceil(g) : null;
}

/** "116.26 x 36.46 x 100.94 mm" → [12, 4, 11] whole cm (rounded up); null when not three sizes. */
export function cmOf(text: string): [number, number, number] | null {
    const m = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)?/i.exec(text.replace(/,/g, ""));
    if (!m) return null;
    const unit = (m[4] ?? "cm").toLowerCase();
    const f = unit === "mm" ? 0.1 : unit.startsWith("in") ? 2.54 : 1;
    const out = [m[1], m[2], m[3]].map((x) => Math.ceil(Number(x) * f)) as [number, number, number];
    return out.every((x) => x > 0 && x <= 1000) ? out : null;
}
