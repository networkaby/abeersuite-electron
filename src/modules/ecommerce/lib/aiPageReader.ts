import "server-only";
import { AI_PHOTO_LIMITS, AI_SELLER_SITES, AI_VERIFIED_LIMITS } from "@/shared/lib/constants/ai";
import { AiKeysExhaustedError, AiNoKeyError, AiRegularKeysOutError } from "@/shared/lib/ai/aiKeys";
import { readPage, webSearch, type WebPage } from "@/shared/lib/ai/aiWeb";
import { isPublicHttps, normForCheck } from "@/modules/ecommerce/lib/aiFactCheck";

// Verified flow, the part with no AI: find the maker's and sellers' pages for
// one product, download them, and match our codes. Tested on 6 real products
// (owner, 2026-10-21): a plain download read HP, Epson, Portronics, CP Plus and
// Flipkart; Canon answered a bot check (202) and SanDisk builds its page in
// JavaScript — those fall to the Read page keys on AI Setup, when set.
// Codes often sit in the page's built-in data, not its visible text
// (Portronics' EAN), so both are read.

export type PageRead = {
    url: string;
    /** Host without www — shown to staff and used as the fact source. */
    site: string;
    /** The brand's own site (or the one printed on the box), not a seller. */
    maker: boolean;
    /** Our EAN / UPC / part code is on the page — the same product, final. */
    codeMatch: boolean;
    /** Text for the prompt, cut to the product part. */
    text: string;
    /** The same page through normForCheck, for the fact check. */
    norm: string;
    /** Product photos the page names in its share preview and built-in data (none when read through a key). */
    photos: string[];
};

export type PageSearch = {
    pages: PageRead[];
    /** Pages dropped before the AI saw them, with why — for the staff note. */
    dropped: string[];
    /** No search key, every search key failed, or nothing found. */
    searchNote?: string;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_PAGE_BYTES = 3_000_000;
/** Less visible text than this = a bot check or a page built in the browser. */
const MIN_PAGE_CHARS = 1500;

const hostOf = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");
/** Codes compare without spaces, dashes or case; a barcode also without leading zeros (UPC-12 = EAN-13 with a 0). */
const codeKey = (c: string) => {
    const k = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(k) ? k.replace(/^0+/, "") : k;
};
/** EAN / UPC / GTIN: 8–14 digits and nothing else (a part number or SKU has letters). */
const isBarcode = (c: string) => /^\d{8,14}$/.test(c.replace(/[\s-]/g, ""));

/** Visible text and the codes in its built-in data (JSON-LD, shop JSON). */
function readHtml(html: string, pageUrl: string): { visible: string; codes: string[]; photos: string[] } {
    const codes = [...html.matchAll(/"(?:barcode|gtin(?:8|12|13|14)?|ean|upc|mpn|sku)"\s*:\s*"([^"]{4,40})"/gi)].map((m) => m[1].trim());
    const visible = html
        .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
        .split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");
    return { visible, codes: [...new Set(codes)], photos: photosIn(html, pageUrl) };
}

/** Logos, icons and placeholders are not product photos. */
const NOT_A_PHOTO = /logo|icon|sprite|placeholder|favicon|banner-?ad|blank\.|\.svg(\?|$)|\.gif(\?|$)/i;

/**
 * Photo URLs a page states itself: the share preview (og:image) and the
 * product data's "image" (JSON-LD, shop JSON). Costs nothing — the HTML is
 * already downloaded for the text.
 */
/** Image hosts big shops serve product photos from (a different host from the page). */
const PHOTO_CDNS = ["cdn.shopify.com", "m.media-amazon.com", "images-na.ssl-images-amazon.com", "rukminim1.flixcart.com", "rukminim2.flixcart.com", "res.cloudinary.com"];
/** The site part of a host: "www.portronics.com" → "portronics.com", "shop.in.canon" → "in.canon". */
const siteOf = (host: string) => host.toLowerCase().split(".").slice(-2).join(".");

function photosIn(html: string, pageUrl: string): string[] {
    const site = siteOf(new URL(pageUrl).hostname);
    const og = [...html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*>/gi)]
        .map((m) => /content=["']([^"']+)["']/i.exec(m[0])?.[1] ?? "");
    // The product data's photo lists too: JSON-LD "image", and a shop's own product
    // JSON (Shopify: "images" / "featured_image" / "media" → "src", often "//cdn…"
    // with no https:) — the owner's #989 maker page gave 1 photo of its gallery.
    const data = [...html.matchAll(/"(?:image|images|featured_image|src|original_src|contentUrl)"\s*:\s*(\[[^\]]{0,8000}\]|"[^"]{8,1000}")/gi)]
        .flatMap((m) => m[1].match(/(?:https?:)?\\?\/\\?\/[^"\s,\]\\]+(?:\\\/[^"\s,\]\\]+)*/g) ?? []);
    const clean = (u: string) => u.replace(/\\\//g, "/").replace(/&amp;/g, "&").trim().replace(/^\/\//, "https://");
    const urls = [
        ...og.map(clean),
        // A "src" can be a script or a font — from the data, image files only.
        ...data.map(clean).filter((u) => /\.(jpe?g|png|webp|avif)(\?|$)/i.test(u)),
    ].filter((u) => {
        const h = isPublicHttps(u)?.hostname.toLowerCase();
        // The page's own site or a shop CDN — not a widget's button; not a collection banner (another model).
        return !!h && (siteOf(h) === site || PHOTO_CDNS.includes(h)) && !NOT_A_PHOTO.test(u) && !/\/collections?\//i.test(new URL(u).pathname);
    });
    // One photo once, whatever size or version the link asks for (Shopify "_800x", "?v=", "width=").
    const sameKey = (u: string) => u.split("?")[0].replace(/_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.\w+$)/i, "");
    const seen = new Set<string>();
    return urls.filter((u) => !seen.has(sameKey(u)) && seen.add(sameKey(u))).slice(0, AI_PHOTO_LIMITS.perPage);
}

/** Our own download; null when the page is blocked, empty or not public. */
async function download(url: string): Promise<{ visible: string; codes: string[]; photos: string[] } | null> {
    try {
        const res = await fetch(url, {
            headers: { "user-agent": UA, "accept-language": "en-IN,en" },
            redirect: "follow",
            signal: AbortSignal.timeout(AI_VERIFIED_LIMITS.fetchMs),
        });
        if (res.status !== 200 || !isPublicHttps(res.url)) return null;
        const page = readHtml((await res.text()).slice(0, MAX_PAGE_BYTES), res.url);
        return page.visible.length >= MIN_PAGE_CHARS ? page : null;
    } catch {
        return null;
    }
}

/** Through the Read page keys (renders JavaScript, passes bot checks); null when none is set or all fail. */
async function readThroughKey(url: string): Promise<{ visible: string; codes: string[]; photos: string[] } | null> {
    try {
        const p = await readPage(url);
        return p.text.length >= MIN_PAGE_CHARS ? { visible: p.text, codes: [], photos: [] } : null;
    } catch {
        return null;
    }
}

/** From a little before the first product word, so the menus at the top are skipped. */
function productPart(visible: string, hints: string[]): string {
    const low = visible.toLowerCase();
    const at = hints.map((h) => low.indexOf(h.toLowerCase())).filter((i) => i >= 0);
    const start = at.length ? Math.max(0, Math.min(...at) - 500) : 0;
    return visible.slice(start, start + AI_VERIFIED_LIMITS.pageChars);
}

/** The maker's own site: the website printed on the box, else a host carrying the brand's name. */
function isMakerSite(host: string, brand: string, labelSite: string): boolean {
    if (labelSite && (host === labelSite || host.endsWith(`.${labelSite}`))) return true;
    const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
    return b.length >= 3 && host.replace(/[^a-z0-9]/g, "").includes(b);
}

const isSeller = (host: string) => AI_SELLER_SITES.some((s) => host === s || host.endsWith(`.${s}`));

/** The Indian site of a brand: a .in host, "in." in the host (shop.in.canon), or an India path (/en-in/, /in-en/, /in/). */
function isIndia(url: string): boolean {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host.endsWith(".in") || /(^|\.)in\./.test(host) || /^\/(en-in|in-en|in)(\/|$)/i.test(u.pathname);
}

async function searchSafe(query: string): Promise<WebPage[] | string> {
    try {
        return await webSearch(query);
    } catch (e) {
        if (e instanceof AiNoKeyError || e instanceof AiRegularKeysOutError) return "No Web search key on AI Setup";
        if (e instanceof AiKeysExhaustedError) return "Every Web search key failed";
        return `Web search failed (${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`;
    }
}

/**
 * Pages for this product: the maker's site first, then the big Indian
 * sellers. A page showing a different barcode of ours is a different product
 * and is dropped here, before the AI sees it.
 */
export async function findProductPages(o: { query: string; brand: string; labelSite: string; codes: string[] }): Promise<PageSearch> {
    const labelSite = o.labelSite.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const searches = await Promise.all([
        // India first (owner, 2026-10-21): an Indian shop's buyers want the Indian pack and printer list.
        searchSafe(labelSite ? `${o.query} site:${labelSite}` : `${o.query} India official`),
        searchSafe(`${o.query} ${AI_SELLER_SITES.slice(0, 2).join(" OR ")}`),
    ]);
    const found = searches.flatMap((s) => (typeof s === "string" ? [] : s));
    const failed = searches.find((s): s is string => typeof s === "string");
    if (!found.length) return { pages: [], dropped: [], searchNote: failed ?? "Search found no pages" };

    // Maker first, then sellers; anything else (blogs, price sites, other shops) is left out.
    // Within the maker's sites, India first; when an Indian maker page exists, other countries' are left out.
    const seen = new Set<string>();
    const ranked = found
        .map((r) => r.url)
        .filter((u) => isPublicHttps(u) && !seen.has(u) && seen.add(u))
        .map((u) => ({ u, host: hostOf(u), india: isIndia(u) }))
        .map((x) => ({ ...x, rank: isMakerSite(x.host, o.brand, labelSite) ? 0 : isSeller(x.host) ? 1 : 2 }))
        .filter((x) => x.rank < 2);
    const indianMaker = ranked.some((x) => x.rank === 0 && x.india);
    const picked = ranked
        .filter((x) => x.rank !== 0 || x.india || !indianMaker)
        .sort((a, b) => a.rank - b.rank || Number(b.india) - Number(a.india))
        .slice(0, AI_VERIFIED_LIMITS.pages);
    if (!picked.length) return { pages: [], dropped: [], searchNote: "Search found no maker or seller page" };
    return readPicked(picked, { brand: o.brand, codes: o.codes, hints: [o.query.split(/\s+/).pop() ?? ""] });
}

/**
 * Pages someone else found — Claude's sources on the Cowork route
 * (/api/agent/products/[id]/copy). Read by us exactly as our own search's
 * pages: only the maker's site or a known seller counts, and a page showing a
 * different barcode of ours is dropped. So Step 4 checks facts against what
 * the page really says, not what the caller says it says.
 */
export async function readGivenPages(o: { urls: string[]; brand: string; labelSite: string; codes: string[] }): Promise<PageSearch> {
    const labelSite = o.labelSite.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const dropped: string[] = [];
    const picked = [...new Set(o.urls)]
        .filter((u) => (isPublicHttps(u) ? true : (dropped.push(`${u}: not a public https page`), false)))
        .map((u) => ({ u, host: hostOf(u) }))
        .map((x) => ({ ...x, rank: isMakerSite(x.host, o.brand, labelSite) ? 0 : isSeller(x.host) ? 1 : 2 }))
        .filter((x) => (x.rank < 2 ? true : (dropped.push(`${x.host}: not the maker's site or a known seller`), false)))
        .slice(0, AI_VERIFIED_LIMITS.pages);
    if (!picked.length) return { pages: [], dropped, searchNote: "No maker or seller page was given" };
    const read = await readPicked(picked, { brand: o.brand, codes: o.codes, hints: [] });
    return { ...read, dropped: [...dropped, ...read.dropped] };
}

/** Download each picked page and match our codes (shared by both callers above). */
async function readPicked(picked: { u: string; host: string; rank: number }[], o: { brand: string; codes: string[]; hints: string[] }): Promise<PageSearch> {
    const ours = o.codes.map(codeKey).filter((c) => c.length >= 6);
    const ourBarcodes = o.codes.filter(isBarcode).map(codeKey);
    const hints = [...o.hints, ...o.codes].filter((h) => h.length >= 3);
    const dropped: string[] = [];

    const reads = await Promise.all(picked.map(async ({ u, host, rank }): Promise<PageRead | null> => {
        const page = (await download(u)) ?? (await readThroughKey(u));
        if (!page) { dropped.push(`${host}: blocked or empty`); return null; }
        const pageKeys = page.codes.map(codeKey);
        const flat = page.visible.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const codeMatch = ours.some((c) => pageKeys.includes(c) || flat.includes(c));
        // Same kind of code, different value = a different product (owner's rule), whatever else matches.
        const pageBarcodes = page.codes.filter(isBarcode).map(codeKey);
        if (!codeMatch && ourBarcodes.length && pageBarcodes.length && !pageBarcodes.some((c) => ourBarcodes.includes(c))) {
            dropped.push(`${host}: shows a different barcode`);
            return null;
        }
        const codeLine = page.codes.length ? `Codes in the page data: ${page.codes.join(", ")}\n` : "";
        const textPart = productPart(page.visible, hints);
        return { url: u, site: host, maker: rank === 0, codeMatch, text: codeLine + textPart, norm: normForCheck(codeLine + page.visible), photos: page.photos };
    }));
    const pages = reads.filter((p): p is PageRead => p !== null);
    return { pages, dropped, ...(pages.length ? {} : { searchNote: "No page could be read" }) };
}
