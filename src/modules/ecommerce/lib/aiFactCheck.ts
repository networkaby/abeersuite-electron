import "server-only";

// Checks a fact the AI says it read on a web page: the page must load and
// actually contain the value. Gemini often invents believable product URLs
// (half were 404 on 2026-10-17), so nothing from the search step is kept
// without passing here.

export type CitedFact = { label: string; value: string; url: string };

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 3_000_000;

/** Public https pages only — the URL comes from the AI, so never our own network. */
function isPublicHttps(raw: string): URL | null {
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return null;
    if (/^[\d.]+$/.test(h) || h.includes(":")) return null; // bare IPv4 / IPv6
    return u;
}

const norm = (s: string) => s.toLowerCase().replace(/&nbsp;|&#160;/g, " ").replace(/[, ]/g, "").replace(/\s+/g, " ");

async function pageText(url: URL): Promise<string | null> {
    try {
        const res = await fetch(url, {
            headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "accept-language": "en-IN,en" },
            redirect: "follow",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok || !isPublicHttps(res.url)) return null;
        const html = (await res.text()).slice(0, MAX_PAGE_BYTES);
        return norm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
    } catch {
        return null;
    }
}

/** Every number in the value must be on the page; a value with no numbers needs most of its words. */
function pageHas(text: string, value: string): boolean {
    const v = norm(value);
    const nums = v.match(/\d+(?:\.\d+)?/g) ?? [];
    if (nums.length) return nums.every((n) => text.includes(n));
    const words = v.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (!words.length) return false;
    return words.filter((w) => text.includes(w)).length / words.length >= 0.75;
}

const isListLabel = (label: string) => /compatib|works with|supported (printer|model|device)/i.test(label);

/**
 * Keeps only facts whose page loaded and shows the value. A compatibility list
 * is checked item by item and keeps the models the page really names.
 */
export async function verifyFacts(facts: CitedFact[]): Promise<{ facts: CitedFact[]; urls: string[] }> {
    const pages = new Map<string, Promise<string | null>>();
    const load = (u: URL) => {
        const key = u.href;
        if (!pages.has(key)) pages.set(key, pageText(u));
        return pages.get(key)!;
    };

    const checked = await Promise.all(facts.map(async (f): Promise<CitedFact | null> => {
        const u = isPublicHttps(f.url);
        if (!u || !f.value.trim()) return null;
        const text = await load(u);
        if (!text) return null;
        if (isListLabel(f.label)) {
            const kept = f.value.split(/[,;\n]|\band\b/).map((x) => x.trim()).filter((x) => x && pageHas(text, x));
            return kept.length ? { ...f, value: kept.join(", ") } : null;
        }
        return pageHas(text, f.value) ? f : null;
    }));

    const ok = checked.filter((f): f is CitedFact => f !== null);
    return { facts: ok, urls: [...new Set(ok.map((f) => f.url))] };
}
