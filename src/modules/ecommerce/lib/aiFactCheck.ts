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

/** Every number in the value must be on the page; a value with no numbers needs most of its words. */
function pageHas(text: string, value: string): boolean {
    const v = normForCheck(value);
    const nums = v.match(/\d+(?:\.\d+)?/g) ?? [];
    if (nums.length) return nums.every((n) => text.includes(n));
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
