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
 * Every number in `value`, with the unit that follows it ("999gbps", "5year",
 * "8" for a bare one). Read from normForCheck text, so "10,000 mAh" → 10000 mah.
 */
function numberTokens(value: string): { num: string; unit: string }[] {
    return [...normForCheck(value).matchAll(/(\d+(?:\.\d+)?)-?([a-z]*)/g)].map((m) => ({ num: m[1], unit: m[2] }));
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
    if (!words.length) return false;
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
