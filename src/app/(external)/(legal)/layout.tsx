import StorefrontChrome from "@/modules/external/shop/StorefrontChrome";

/**
 * Chrome for the policy pages. Route group only — the URLs stay flat
 * (/privacy, /terms, /refunds, /shipping) because those are the links pasted
 * into the Razorpay activation form and the Google OAuth consent screen.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return <StorefrontChrome>{children}</StorefrontChrome>;
}
