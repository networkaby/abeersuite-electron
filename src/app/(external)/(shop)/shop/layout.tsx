import type { Metadata } from "next";

// Header/footer come from the `(shop)` group layout, shared with the
// root-level brand slug pages. This layout exists only to name the catalog
// section — a brand page must NOT inherit the "Shop" title.
export const metadata: Metadata = {
    // Bare word on purpose — the root title template appends the brand.
    title: "Shop",
    description:
        "Network Service online shop for computers, laptops, printers, CCTV, networking, and PC components, with GST invoices and secure checkout in Indian Rupees.",
};

export default function ShopSectionLayout({ children }: { children: React.ReactNode }) {
    return children;
}
