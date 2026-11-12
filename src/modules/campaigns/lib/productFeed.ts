import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { BUSINESS_TIME_ZONE } from "@/shared/lib/constants/business";
import { isR2Configured, messagesBucket, presignR2, putR2 } from "@/shared/lib/storage/r2";
import { productPath, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadStorefrontProducts } from "@/shared/lib/shop/storefrontProducts";

/**
 * Product feeds — the shop's catalogue for Google Merchant Center (RSS/XML) and
 * the Meta catalog (CSV), at /feeds/google.xml and /feeds/meta.csv on the shop
 * host. Owner, 2026-10-23: "max one rebuild in a day only if dirty".
 *
 * Google and Meta each fetch once a day (their schedule, set by us). The first
 * fetch of a business day asks Postgres for one md5 of the feed's inputs (~32
 * bytes of egress): unchanged → the stored files stand; changed → both files are
 * rebuilt from the shop's own list (loadStorefrontProducts — the same products,
 * prices and stock status the shop shows) and stored. Every other fetch that day
 * only reads the small state file. Files live in private R2 and the route
 * redirects to a short signed link, so serving them costs no Vercel bandwidth.
 * The weighted-average cost, which changes on every sale, is not an input; the
 * sale price and "in stock" are, so a sale that moves either rebuilds once.
 */

// The bucket is shared with live: a dev server writes its own folder, so a feed
// built from the local copy can never stand in for the live one for a day.
const PREFIX = process.env.NODE_ENV === "production" ? "feeds/" : "feeds-dev/";

export const FEED_FILES = {
    google: { key: `${PREFIX}google.xml`, type: "application/xml; charset=utf-8" },
    meta: { key: `${PREFIX}meta.csv`, type: "text/csv; charset=utf-8" },
} as const;
export type FeedKind = keyof typeof FEED_FILES;

const STATE_KEY = `${PREFIX}state.json`;
/** How long the signed link Google / Meta are redirected to stays valid. */
const LINK_SECONDS = 3600;

export type FeedState = {
    /** Business day (YYYY-MM-DD, shop time zone) the inputs were last checked. */
    day: string;
    /** md5 of the inputs the files were built from. */
    hash: string;
    builtAt: string;
    checkedAt: string;
    count: number;
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(new Date());

/**
 * One md5 over every column that can change what the feed says, for products
 * the shop lists — computed in the database, so only the hash crosses the wire.
 * Deliberately left out: cost, valuation and anything else a sale rewrites that
 * the customer never sees; stock enters only as "has some / tracked or not".
 */
async function inputsHash(): Promise<string> {
    const rows = await prisma.$queryRaw<{ h: string }[]>`
        SELECT md5(coalesce(string_agg(concat_ws('~',
            p.id, p."isActive", p.name, p."shopSubheading", p."shopDescription", p.slug,
            p."imageUrl", p."galleryJson"::text, p."effectiveSalePricePaise", p."mrpPaise",
            p."shopCategory", p."shopBadge", p."groupId", p."categoryId", b.name, p."modelNo",
            p."allowBackorder", p.stock IS NULL, p.stock - p.reserved > 0
        ), '|' ORDER BY p.id), '')) AS h
        FROM "InvProduct" p LEFT JOIN "InvBrand" b ON b.id = p."brandId"
        WHERE p."isListedInShop" = true`;
    return rows[0]?.h ?? "";
}

async function readState(): Promise<FeedState | null> {
    try {
        const res = await fetch(presignR2({ bucket: messagesBucket(), key: STATE_KEY, method: "GET", expiresSec: 60 }), { cache: "no-store" });
        return res.ok ? ((await res.json()) as FeedState) : null;
    } catch {
        return null;
    }
}

const writeState = (s: FeedState) =>
    putR2(messagesBucket(), STATE_KEY, new TextEncoder().encode(JSON.stringify(s)).buffer as ArrayBuffer, "application/json");

// ── Building ───────────────────────────────────────────────────────────────

const rupees = (paise: number) => `${(paise / 100).toFixed(2)} INR`;
const plain = (s: string | null, max: number) =>
    (s ?? "").replace(/<[^>]*>/g, " ").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const csv = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

type FeedItem = {
    id: string;
    title: string;
    description: string;
    link: string;
    image: string;
    more: string[];
    availability: ShopProductPublic["stockStatus"];
    /** Regular price; `sale` set only when the shop sells below it (MRP above the price). */
    price: number;
    sale: number | null;
    brand: string | null;
    mpn: string | null;
    type: string;
};

function toItem(p: ShopProductPublic, extra: { brand: string | null; mpn: string | null } | undefined): FeedItem | null {
    const image = p.imageUrl ?? p.galleryUrls[0];
    if (!image || p.pricePaise <= 0) return null; // Google and Meta refuse both
    const discounted = p.mrpPaise != null && p.mrpPaise > p.pricePaise;
    return {
        id: String(p.id),
        title: plain(p.displayName, 150),
        description: plain(p.description, 5000) || plain(p.displayName, 150),
        link: `${COMPANY_DETAILS.sites.shop}${productPath(p)}`,
        image,
        more: p.galleryUrls.filter((u) => u !== image).slice(0, 10),
        availability: p.stockStatus,
        price: discounted ? p.mrpPaise! : p.pricePaise,
        sale: discounted ? p.pricePaise : null,
        brand: extra?.brand ?? null,
        mpn: extra?.mpn ?? null,
        type: [...p.categoryPath].reverse().concat(p.category).join(" > "),
    };
}

function googleXml(items: FeedItem[]): string {
    const body = items
        .map((i) =>
            [
                "<item>",
                `<g:id>${xml(i.id)}</g:id>`,
                `<g:title>${xml(i.title)}</g:title>`,
                `<g:description>${xml(i.description)}</g:description>`,
                `<g:link>${xml(i.link)}</g:link>`,
                `<g:image_link>${xml(i.image)}</g:image_link>`,
                ...i.more.map((u) => `<g:additional_image_link>${xml(u)}</g:additional_image_link>`),
                `<g:availability>${i.availability}</g:availability>`,
                `<g:price>${rupees(i.price)}</g:price>`,
                ...(i.sale != null ? [`<g:sale_price>${rupees(i.sale)}</g:sale_price>`] : []),
                `<g:condition>new</g:condition>`,
                ...(i.brand ? [`<g:brand>${xml(i.brand)}</g:brand>`] : []),
                // No barcode in the feed yet: brand + model number when we have both, else say so.
                ...(i.brand && i.mpn ? [`<g:mpn>${xml(i.mpn)}</g:mpn>`] : [`<g:identifier_exists>no</g:identifier_exists>`]),
                ...(i.type ? [`<g:product_type>${xml(i.type)}</g:product_type>`] : []),
                "</item>",
            ].join(""),
        )
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${xml(COMPANY_DETAILS.brandName)}</title>
<link>${xml(COMPANY_DETAILS.sites.shop)}</link>
<description>${xml(COMPANY_DETAILS.tagline)}</description>
${body}
</channel>
</rss>
`;
}

const META_AVAILABILITY: Record<FeedItem["availability"], string> = {
    in_stock: "in stock",
    out_of_stock: "out of stock",
    backorder: "available for order",
};

function metaCsv(items: FeedItem[]): string {
    const head = "id,title,description,availability,condition,price,sale_price,link,image_link,additional_image_link,brand,mpn,product_type";
    const rows = items.map((i) =>
        [
            i.id, i.title, i.description, META_AVAILABILITY[i.availability], "new", rupees(i.price), i.sale != null ? rupees(i.sale) : "",
            i.link, i.image, i.more.join(","), i.brand ?? COMPANY_DETAILS.brandName, i.mpn ?? "", i.type,
        ]
            .map(csv)
            .join(","),
    );
    return [head, ...rows].join("\n") + "\n";
}

/** Read the shop's list once and write both files. Returns how many products went in. */
async function rebuild(hash: string): Promise<FeedState> {
    const products = await loadStorefrontProducts();
    const extras = await prisma.invProduct.findMany({
        where: { id: { in: products.map((p) => p.id) } },
        select: { id: true, modelNo: true, brand: { select: { name: true } } },
    });
    const byId = new Map(extras.map((e) => [e.id, { brand: e.brand?.name ?? null, mpn: e.modelNo?.trim() || null }]));
    const items = products.map((p) => toItem(p, byId.get(p.id))).filter((i): i is FeedItem => i !== null);

    const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
    await Promise.all([
        putR2(messagesBucket(), FEED_FILES.google.key, enc(googleXml(items)), FEED_FILES.google.type),
        putR2(messagesBucket(), FEED_FILES.meta.key, enc(metaCsv(items)), FEED_FILES.meta.type),
    ]);
    const now = new Date().toISOString();
    const state: FeedState = { day: today(), hash, builtAt: now, checkedAt: now, count: items.length };
    await writeState(state);
    return state;
}

/**
 * Make sure today's files stand, by the once-a-day rule, and return the state.
 * `force` (the office's "Rebuild now") skips the day gate and the hash check.
 */
export async function ensureFeeds(force = false): Promise<FeedState> {
    if (!isR2Configured()) throw new Error("File storage (R2) is not set up on this server.");
    const state = await readState();
    if (!force && state && state.day === today()) return state;

    const hash = await inputsHash();
    if (!force && state && state.hash === hash) {
        const checked = { ...state, day: today(), checkedAt: new Date().toISOString() };
        await writeState(checked);
        return checked;
    }
    return rebuild(hash);
}

/** A short signed link to one stored feed file — where the public route redirects. */
export const feedFileLink = (kind: FeedKind) =>
    presignR2({ bucket: messagesBucket(), key: FEED_FILES[kind].key, method: "GET", expiresSec: LINK_SECONDS });

/** The stored state only — no hash, no rebuild. For the office page. */
export const feedState = () => (isR2Configured() ? readState() : Promise.resolve(null));
