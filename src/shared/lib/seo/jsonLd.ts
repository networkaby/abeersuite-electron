/**
 * JSON-LD structured data for the public storefront.
 *
 * Builders only — pure, no React, no prisma — so a route can compose the object
 * and hand it to `<JsonLd />`. Everything is derived from COMPANY_DETAILS and
 * the product's own public shape, so the markup can never claim something the
 * visible page does not say. That equivalence is the whole point: Google treats
 * structured data that contradicts the rendered page as spam.
 *
 * Only the storefront emits these. The internal build is noindex end to end
 * (see lib/appMode.ts), so describing it to a crawler would be pointless.
 */
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { productPath } from "@/shared/lib/shop/productPublic";

const { sites, address, contact } = COMPANY_DETAILS;

/** Stable node ids so the graph nodes can reference each other. */
const ORG_ID = `${sites.shop}/#organization`;
const SITE_ID = `${sites.shop}/#website`;
const STORE_ID = `${sites.shop}/#store`;

const postalAddress = {
    "@type": "PostalAddress",
    streetAddress: [address.line1, address.line2].filter(Boolean).join(", "),
    addressLocality: address.city,
    addressRegion: address.state,
    postalCode: address.pin,
    addressCountry: "IN",
};

/** Configured social profiles only — an empty string is "not set", not a link. */
const sameAs = Object.values(COMPANY_DETAILS.social).filter((url) => url.length > 0);

/**
 * The site-level graph: who we are, what the website is, and the physical shop.
 *
 * Three nodes rather than one because they answer different questions — the
 * Organization is the legal entity behind both hostnames, the WebSite is this
 * storefront, and the Store is the counter a customer can actually walk into.
 * Emitted once, on the store home page.
 */
export function buildSiteLd() {
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": ORG_ID,
                name: COMPANY_DETAILS.brandName,
                legalName: COMPANY_DETAILS.legalName,
                url: sites.shop,
                description: COMPANY_DETAILS.description,
                logo: `${sites.shop}${COMPANY_DETAILS.logoUrl}`,
                address: postalAddress,
                vatID: COMPANY_DETAILS.tax.gstin,
                contactPoint: {
                    "@type": "ContactPoint",
                    contactType: "customer support",
                    telephone: contact.phone,
                    email: contact.supportEmail,
                    areaServed: "IN",
                    availableLanguage: ["en", "hi", "as"],
                },
                ...(sameAs.length > 0 ? { sameAs } : {}),
            },
            {
                "@type": "WebSite",
                "@id": SITE_ID,
                url: sites.shop,
                name: COMPANY_DETAILS.brandName,
                publisher: { "@id": ORG_ID },
                inLanguage: "en-IN",
            },
            {
                "@type": "Store",
                "@id": STORE_ID,
                name: COMPANY_DETAILS.brandName,
                parentOrganization: { "@id": ORG_ID },
                url: sites.shop,
                image: `${sites.shop}${COMPANY_DETAILS.logoUrl}`,
                telephone: contact.phone,
                email: contact.supportEmail,
                address: postalAddress,
                priceRange: "₹₹",
                currenciesAccepted: COMPANY_DETAILS.currencyCode,
            },
        ],
    };
}

/**
 * A single product offer.
 *
 * `price` comes from the same `pricePaise` the page renders, so the markup and
 * the visible price can never drift apart. Availability mirrors the storefront's
 * own resolution rather than raw stock — a backorderable item is genuinely
 * orderable, and saying otherwise would cost a valid listing.
 */
export function buildProductLd(p: ShopProductPublic) {
    const url = `${sites.shop}${productPath(p)}`;
    const images = p.galleryUrls.length > 0 ? p.galleryUrls : p.imageUrl ? [p.imageUrl] : [];

    const availability = !p.orderable
        ? "https://schema.org/OutOfStock"
        : p.stockStatus === "backorder"
          ? "https://schema.org/BackOrder"
          : "https://schema.org/InStock";

    return {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.displayName,
        url,
        ...(p.description ? { description: p.description } : {}),
        ...(images.length > 0 ? { image: images } : {}),
        ...(p.category ? { category: p.category } : {}),
        // Offers without a real price are worse than no offers — Google rejects
        // the listing and the page loses its Product markup entirely.
        ...(p.pricePaise > 0
            ? {
                  offers: {
                      "@type": "Offer",
                      url,
                      price: (p.pricePaise / 100).toFixed(2),
                      priceCurrency: COMPANY_DETAILS.currencyCode,
                      availability,
                      itemCondition: "https://schema.org/NewCondition",
                      seller: { "@id": ORG_ID },
                  },
              }
            : {}),
    };
}
