/**
 * Central registry of marketing imagery used across the storefront homepage.
 *
 * All URLs are verified live during development; replace with your own
 * Cloudinary / S3 assets before production. The shape is intentionally simple
 * so any field can be swapped without touching components.
 *
 * Image hosts in use:
 *   - images.unsplash.com  → hero, category, promo banners
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

/** Auto-rotating top hero. Three slides keep load light and message fresh. */
export const HERO_SLIDES: HeroSlide[] = [
    {
        id: "laptops",
        eyebrow: "Limited time",
        title: "Up to 30% off Laptops",
        subtitle:
            "Latest 13th-gen ultrabooks, gaming rigs and business notebooks — with GST invoice and Razorpay-secured checkout.",
        imageUrl:
            "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=1600&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1558002038-1055907df827?w=1600&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=1600&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&q=80&auto=format&fit=crop",
        imageAlt: "Sleek silver laptop on a clean white surface",
    },
    Desktops: {
        imageUrl:
            "https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=800&q=80&auto=format&fit=crop",
        imageAlt: "RGB-lit gaming desktop tower",
    },
    Printers: {
        imageUrl:
            "https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?w=800&q=80&auto=format&fit=crop",
        imageAlt: "Modern office printer printing a document",
    },
    "CCTV & Security": {
        imageUrl:
            "https://images.unsplash.com/photo-1547119957-637f8679db1e?w=800&q=80&auto=format&fit=crop",
        imageAlt: "Outdoor CCTV camera on a building corner",
    },
    Components: {
        imageUrl:
            "https://images.unsplash.com/photo-1587202372634-32705e3bf49c?w=800&q=80&auto=format&fit=crop",
        imageAlt: "PC components on a workbench",
    },
    Monitors: {
        imageUrl:
            "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&q=80&auto=format&fit=crop",
        imageAlt: "Curved monitor on a tidy work desk",
    },
    Networking: {
        imageUrl:
            "https://images.unsplash.com/photo-1606904825846-647eb07f5be2?w=800&q=80&auto=format&fit=crop",
        imageAlt: "Wireless router on a glossy table",
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
            "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1587202372616-b43abea06c2a?w=1200&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1623126908029-58cb08a2b272?w=1200&q=80&auto=format&fit=crop",
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
            "https://images.unsplash.com/photo-1531492746076-161ca9bcad58?w=1200&q=80&auto=format&fit=crop",
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
