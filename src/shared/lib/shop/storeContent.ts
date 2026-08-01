/**
 * Central registry of marketing imagery used across the storefront homepage.
 *
 * All URLs are verified live during development; replace with your own
 * Cloudinary / S3 assets before production. The shape is intentionally simple
 * so any field can be swapped without touching components.
 *
 * Image hosts in use:
 *   - images.pexels.com  → hero, category, promo banners (direct CDN; free to use per Pexels license)
 *   - cdn.simpleicons.org  → brand logos (electronics manufacturers)
 */

export type HeroSlide = {
    id: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    imageUrl: string;
    imageAlt: string;
    ctaLabel: string;
    ctaHref: string;
    accent: "primary" | "violet" | "emerald" | "amber";
};

export type PromoBanner = {
    id: string;
    eyebrow: string;
    title: string;
    subtitle?: string;
    imageUrl: string;
    imageAlt: string;
    ctaLabel: string;
    ctaHref: string;
    height?: "sm" | "md" | "lg";
};

export type BrandLogo = { name: string; logoUrl: string };

/**
 * The store home page's one true <h1>.
 *
 * The hero slides used to carry the h1 — three of them, one per slide, rotating
 * on a timer. That gave the page three competing top-level headings, none of
 * which said what the business actually is: a screen reader announced a
 * different page title depending on when it arrived, and a crawler got a
 * discount offer where the site's identity belongs.
 *
 * So the slides are h2 now (they are promotions, not the page subject) and this
 * is the heading. It is visually hidden because the wordmark and the hero
 * already carry the brand visually — the text exists for readers and crawlers
 * that need the structure spelled out. Edit the string here to change it.
 */
export const STORE_PAGE_HEADING =
    "Buy computers, CCTV systems and office supplies online — Network Service";

/** Auto-rotating top hero. Three slides keep load light and message fresh. */
export const HERO_SLIDES: HeroSlide[] = [
    {
        id: "laptops",
        eyebrow: "Limited time",
        title: "Up to 30% off Laptops",
        subtitle:
            "Latest 13th-gen ultrabooks, gaming rigs and business notebooks — with GST invoice and Razorpay-secured checkout.",
        imageUrl:
            "https://images.pexels.com/photos/1229861/pexels-photo-1229861.jpeg?auto=compress&cs=tinysrgb&w=1600",
        imageAlt: "Open laptop on a wooden desk in soft daylight",
        ctaLabel: "Shop laptops",
        ctaHref: "#cat-Laptops",
        accent: "primary",
    },
    {
        id: "cctv",
        eyebrow: "New bundles",
        title: "Smart-home CCTV that just works",
        subtitle:
            "4-channel & 8-channel kits with NVR, cabling and bullet/dome cameras. Live view from your phone.",
        imageUrl:
            "https://images.pexels.com/photos/8463140/pexels-photo-8463140.jpeg?auto=compress&cs=tinysrgb&w=1600",
        imageAlt: "White security camera mounted on a wall",
        ctaLabel: "Shop CCTV kits",
        ctaHref: "#cat-CCTV%20%26%20Security",
        accent: "violet",
    },
    {
        id: "components",
        eyebrow: "Build season",
        title: "Build your dream PC",
        subtitle:
            "Genuine RAM, NVMe SSDs, gold-rated PSUs, AM5 boards, and RTX-tier graphics. We dispatch from metro warehouses.",
        imageUrl:
            "https://images.pexels.com/photos/325229/pexels-photo-325229.jpeg?auto=compress&cs=tinysrgb&w=1600",
        imageAlt: "Memory module and PC components in close-up",
        ctaLabel: "Shop components",
        ctaHref: "#cat-Components",
        accent: "emerald",
    },
];

/**
 * Per-category showcase imagery. Looked up by category name from Prisma —
 * unknown categories fall back to the product's own imageUrl.
 */
export const CATEGORY_IMAGES: Record<string, { imageUrl: string; imageAlt: string }> = {
    Laptops: {
        imageUrl:
            "https://images.pexels.com/photos/7514838/pexels-photo-7514838.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "Sleek silver laptop on a clean white surface",
    },
    Desktops: {
        imageUrl:
            "https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "RGB-lit gaming desktop tower",
    },
    Printers: {
        imageUrl:
            "https://images.pexels.com/photos/1714208/pexels-photo-1714208.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "Modern office printer printing a document",
    },
    "CCTV & Security": {
        imageUrl:
            "https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "Outdoor CCTV camera on a building corner",
    },
    Components: {
        imageUrl:
            "https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "PC components on a workbench",
    },
    Monitors: {
        imageUrl:
            "https://images.pexels.com/photos/265087/pexels-photo-265087.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "Curved monitor on a tidy work desk",
    },
    Networking: {
        imageUrl:
            "https://images.pexels.com/photos/159304/network-cable-ethernet-computer-159304.jpeg?auto=compress&cs=tinysrgb&w=800",
        imageAlt: "Ethernet cables plugged into a network switch",
    },
};

/** Top 2-up promo strip, shown above the trending row. */
export const PROMO_BANNERS_TOP: PromoBanner[] = [
    {
        id: "office-bundle",
        eyebrow: "For business",
        title: "Office bundle savings",
        subtitle: "Desktop + monitor + printer combos — fleet pricing built in.",
        imageUrl:
            "https://images.pexels.com/photos/442150/pexels-photo-442150.jpeg?auto=compress&cs=tinysrgb&w=1200",
        imageAlt: "Modern office workspace with desks and monitors",
        ctaLabel: "Browse office",
        ctaHref: "#cat-Desktops",
        height: "md",
    },
    {
        id: "build-day",
        eyebrow: "Build day",
        title: "Components week — 20% off",
        subtitle: "RAM, SSDs, PSUs and motherboards from trusted brands.",
        imageUrl:
            "https://images.pexels.com/photos/3862139/pexels-photo-3862139.jpeg?auto=compress&cs=tinysrgb&w=1200",
        imageAlt: "Custom built PC with RGB lights",
        ctaLabel: "Shop components",
        ctaHref: "#cat-Components",
        height: "md",
    },
];

/** Bottom 3-up promo strip, shown above the deals row. */
export const PROMO_BANNERS_BOTTOM: PromoBanner[] = [
    {
        id: "monitor-sale",
        eyebrow: "Display week",
        title: "Bigger screens, sharper work",
        imageUrl:
            "https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=1200",
        imageAlt: "Large monitor on a clean desk",
        ctaLabel: "Shop monitors",
        ctaHref: "#cat-Monitors",
        height: "sm",
    },
    {
        id: "print-smarter",
        eyebrow: "Print smarter",
        title: "Ink & laser, ready to ship",
        imageUrl:
            "https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=1200",
        imageAlt: "Workplace printer with paper output",
        ctaLabel: "Shop printers",
        ctaHref: "#cat-Printers",
        height: "sm",
    },
    {
        id: "storage-upgrade",
        eyebrow: "Storage upgrade",
        title: "Faster boot, more space",
        imageUrl:
            "https://images.pexels.com/photos/4302071/pexels-photo-4302071.jpeg?auto=compress&cs=tinysrgb&w=1200",
        imageAlt: "Server storage racks",
        ctaLabel: "Shop storage",
        ctaHref: "#cat-Components",
        height: "sm",
    },
];

/** Brand strip — Simple Icons CDN. Greyscale on hover until coloured. */
export const BRAND_LOGOS: BrandLogo[] = [
    { name: "Apple", logoUrl: "https://cdn.simpleicons.org/apple/000000" },
    { name: "Samsung", logoUrl: "https://cdn.simpleicons.org/samsung/1428A0" },
    { name: "Dell", logoUrl: "https://cdn.simpleicons.org/dell/007DB8" },
    { name: "HP", logoUrl: "https://cdn.simpleicons.org/hp/0096D6" },
    { name: "Lenovo", logoUrl: "https://cdn.simpleicons.org/lenovo/E2231A" },
    { name: "Asus", logoUrl: "https://cdn.simpleicons.org/asus/000000" },
    { name: "Acer", logoUrl: "https://cdn.simpleicons.org/acer/83B81A" },
    { name: "MSI", logoUrl: "https://cdn.simpleicons.org/msibusiness/FF0000" },
    { name: "Intel", logoUrl: "https://cdn.simpleicons.org/intel/0071C5" },
    { name: "AMD", logoUrl: "https://cdn.simpleicons.org/amd/ED1C24" },
    { name: "NVIDIA", logoUrl: "https://cdn.simpleicons.org/nvidia/76B900" },
    { name: "Razer", logoUrl: "https://cdn.simpleicons.org/razer/00FF00" },
    { name: "Sony", logoUrl: "https://cdn.simpleicons.org/sony/000000" },
    { name: "LG", logoUrl: "https://cdn.simpleicons.org/lg/A50034" },
    { name: "TP-Link", logoUrl: "https://cdn.simpleicons.org/tplink/4ACBD6" },
    { name: "Seagate", logoUrl: "https://cdn.simpleicons.org/seagate/6FBE44" },
];

/**
 * Plain-language description of who we are and what this app does.
 *
 * Rendered small and quiet in the shop footer, not as a mid-page section — a
 * customer on a storefront does not need it explained at them. It still has to
 * exist on the home page, because Google's brand verification requires the home
 * page to describe the app's functionality and link the privacy policy; a
 * footer satisfies that, prominence is not part of the rule.
 *
 * Keep `signInNote` truthful — we request only the default `profile` + `email`
 * scopes, and the privacy policy says the same thing in more detail.
 */
export type AboutApp = {
    title: string;
    /** Who we are and what the app is for. */
    paragraphs: string[];
    /** What a signed-in customer can actually do here. */
    capabilities: { title: string; body: string }[];
    /** Exactly what Google sign-in gives us. Must match the scopes we request. */
    signInNote: string;
};

export const ABOUT_APP: AboutApp = {
    title: "About Network Service",
    paragraphs: [
        "Network Service is a computer hardware retail and repair business in Abhayapuri, District Bongaigaon, Assam. We sell laptops, desktops, printers, CCTV kits, monitors and PC components, and we service and repair the hardware we sell.",
        "This website is our online storefront and customer portal. It lets our customers buy hardware with a GST invoice, follow the progress of a repair they have given us, and look back at their own orders, invoices and warranties in one place.",
    ],
    capabilities: [
        {
            title: "Shop with GST invoice",
            body: "Browse our catalogue, pay securely in Indian Rupees, and get a proper GST invoice for every purchase.",
        },
        {
            title: "Track your repairs",
            body: "See the live status of any device you have given us for service, without calling the shop.",
        },
        {
            title: "Your records in one place",
            body: "Every order, invoice and warranty tied to your account, available whenever you sign in.",
        },
    ],
    signInNote:
        "You can sign in with a one-time code sent to your mobile or email, with a password, or with your Google account. If you choose Google, we receive only your name and email address — enough to create your customer account and sign you in. We never see your Google password, and we do not read your contacts, Drive, Gmail or any other Google data.",
};
