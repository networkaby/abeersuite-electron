/**
 * Single source of truth for company / brand details used across the app
 * (root layout SEO, shop header/footer, emails, printed invoices, vouchers).
 *
 * This is CODE-OWNED, deliberately: there is no Organisation settings table and
 * no settings page behind it. Editing this file and deploying is how the shop's
 * identity, address, GSTIN and bank details change. Print templates can still
 * override any of it per document — see `mergeTemplateWithOrg.ts`.
 *
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

    /** Canonical site URL — the company home page, and the website line on invoices. */
    siteUrl: string;

    /**
     * One business, two deployments. The split is ours for technical reasons —
     * to customers, Google and the tax authorities this is a single website and
     * a single legal entity, and the policies below cover both.
     */
    sites: {
        /** Company home page — the public face of the business. */
        company: string;
        /** Online store + customer portal. */
        shop: string;
        /**
         * Internal staff app. Not a public site — blocked in robots.txt and
         * never linked from the storefront. Listed here so code can name it
         * without asking an environment variable what its own hostname is.
         */
        office: string;
    };
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

    /** Staff sign-in addresses are `name@<this>`. No mailboxes — Cloudflare Email
     *  Routing forwards each to the person's own inbox (cloudflareRouting.ts). */
    staffMailDomain: string;

    /** Contact channels shown in footer / order emails. */
    contact: {
        email: string;
        supportEmail: string;
        phone: string;
        whatsapp: string;
    };

    /**
     * Company-level UPI payee identity. The VPA itself is configured PER COUNTER
     * (PosCounter.upiVpa, set under /office/admin/counters) so different tills can
     * collect to different UPI IDs; only the payee *name* shown in the customer's
     * UPI app is company-level.
     */
    upi: {
        /** Payee name shown in the customer's UPI app. */
        payeeName: string;
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

    /** Logo shown on the storefront and on printed documents. Empty = text brand only. */
    logoUrl: string;

    /**
     * The shop's primary bank, printed on vouchers so customers can pay in.
     * Opt-in per document via the print template's "Bank details" toggle.
     */
    bank: {
        beneficiary: string;
        bankName: string;
        accountNumber: string;
        ifsc: string;
        branch: string;
        upiVpa: string;
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
        threads: string;
    };

    /** Business policy snippets (display-only, not legal). */
    policies: {
        freeShippingMinPaise: number;
        returnWindowDays: number;
        warrantyNote: string;
    };
};

export const COMPANY_DETAILS: CompanyDetails = {
    brandName: "Network Service",
    legalName: "Network Service",
    tagline: "IT hardware & components — delivered fast across India",
    description:
        "Computers, laptops, printers, CCTV, monitors, and PC components — curated for India with secure checkout in ₹.",
    longDescription:
        "Network Service is a computer hardware retail and repair business, and this is its online storefront. Buy laptops, desktops, ink & laser printers, CCTV kits, monitors, RAM, SSDs, PSUs, and networking gear with GST invoices, fast metro dispatch, and Razorpay-secured checkout in Indian Rupees.",

    siteUrl: "https://networkservice.in",

    sites: {
        company: "https://networkservice.in",
        shop: "https://shop.networkservice.in",
        office: "https://office.networkservice.in",
    },

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
        "Network Service",
    ],

    themeColor: {
        light: "#ffffff",
        dark: "#0a0a0a",
    },

    staffMailDomain: "networkservice.in",

    contact: {
        email: "hello@networkservice.in",
        supportEmail: "support@networkservice.in",
        phone: "+91 88769 96996",
        whatsapp: "+91 88769 96996",
    },

    upi: {
        payeeName: "Network Service",   // VPA is per-counter — see /office/admin/counters
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
        gstin: "18AXEPJ4673R1ZO",
        pan: "AXEPJR673R",
    },

    logoUrl: "/logo.svg",

    // Previously stored in the Organisation settings row. Now code-owned:
    // changing these is a code edit + deploy, not a settings-page change.
    bank: {
        beneficiary: "Network Service",
        bankName: "State Bank of India",
        accountNumber: "33605435873",
        ifsc: "SBIN0008462",
        branch: "Abhayapuri",
        upiVpa: "network.service@ybl",
    },

    hours: "Mon–Sat · 10:00 AM – 7:00 PM IST",

    social: {
        facebook: "https://www.facebook.com/network.service.aby",
        instagram: "https://www.instagram.com/network.service.aby",
        x: "",
        youtube: "",
        linkedin: "",
        threads: "https://www.threads.com/@network.service.aby",
    },

    policies: {
        freeShippingMinPaise: 200000,
        returnWindowDays: 7,
        warrantyNote: "Manufacturer warranty as per category — check product page for details.",
    },
};
