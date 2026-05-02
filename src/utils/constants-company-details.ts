/**
 * Single source of truth for company / brand details used across the app
 * (root layout SEO, shop header/footer, emails, etc.).
 *
 * These are DEMO values — replace with the real business data when ready.
 * Keep keys stable; consumers import the named `COMPANY_DETAILS` object.
 */

export type CompanyDetails = {
    /** Public-facing brand shown to customers in the storefront. */
    brandName: string;
    /** Legal / internal company name (used on invoices, staff app). */
    legalName: string;
    /** One-line tagline used under the logo / OG cards. */
    tagline: string;
    /** Short description for SEO meta + OG/Twitter cards. */
    description: string;
    /** Long-form description for About sections. */
    longDescription: string;

    /** Canonical site URL. Falls back to env if you prefer; this is the demo default. */
    siteUrl: string;
    /** Locale tag for OpenGraph (e.g. "en_IN"). */
    locale: string;
    /** Currency symbol shown in UI. */
    currencySymbol: string;
    /** ISO currency code (Razorpay / pricing). */
    currencyCode: string;

    /** SEO keywords for the storefront. */
    keywords: string[];

    /** Theme colors for the mobile browser chrome (light/dark). */
    themeColor: { light: string; dark: string };

    /** Contact channels shown in footer / order emails. */
    contact: {
        email: string;
        supportEmail: string;
        phone: string;
        whatsapp: string;
    };

    /** Postal address for the company. */
    address: {
        line1: string;
        line2?: string;
        city: string;
        state: string;
        pin: string;
        country: string;
    };

    /** Tax / regulatory IDs (shown on invoices). */
    tax: {
        gstin: string;
        pan: string;
    };

    /** Working-hours line shown in the footer / contact strip. */
    hours: string;

    /** Social media handles (full URLs). Empty string = hidden. */
    social: {
        facebook: string;
        instagram: string;
        x: string;
        youtube: string;
        linkedin: string;
    };

    /** Business policy snippets (display-only, not legal). */
    policies: {
        freeShippingMinPaise: number;
        returnWindowDays: number;
        warrantyNote: string;
    };
};

export const COMPANY_DETAILS: CompanyDetails = {
    brandName: "Network Shop",
    legalName: "Network Service",
    tagline: "IT hardware & components — delivered fast across India",
    description:
        "Computers, laptops, printers, CCTV, monitors, and PC components — curated for India with secure checkout in ₹.",
    longDescription:
        "Network Shop is the online storefront for Network Service. Buy laptops, desktops, ink & laser printers, CCTV kits, monitors, RAM, SSDs, PSUs, and networking gear with GST invoices, fast metro dispatch, and Razorpay-secured checkout in Indian Rupees.",

    siteUrl: "http://localhost:3000",
    locale: "en_IN",
    currencySymbol: "₹",
    currencyCode: "INR",

    keywords: [
        "buy laptops India",
        "buy desktops India",
        "printer shop India",
        "CCTV camera kit",
        "PC components",
        "RAM",
        "SSD",
        "monitors",
        "networking",
        "GST invoice",
        "Razorpay",
        "Network Shop",
        "Network Service",
    ],

    themeColor: {
        light: "#ffffff",
        dark: "#0a0a0a",
    },

    contact: {
        email: "hello@networkservice.in",
        supportEmail: "support@networkservice.in",
        phone: "+91 88769 96969",
        whatsapp: "+91 88769 96969",
    },

    address: {
        line1: "Kalaparishad Market, Main Road",
        line2: "Abhayapuri, District Bongaigaon",
        city: "Bongaigaon",
        state: "Assam",
        pin: "783384",
        country: "India",
    },

    tax: {
        gstin: "00ABCDE1234F1Z5",
        pan: "ABCDE1234F",
    },

    hours: "Mon–Sat · 10:00 AM – 7:00 PM IST",

    social: {
        facebook: "",
        instagram: "",
        x: "",
        youtube: "",
        linkedin: "",
    },

    policies: {
        freeShippingMinPaise: 200000,
        returnWindowDays: 7,
        warrantyNote: "Manufacturer warranty as per category — check product page for details.",
    },
};
