import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Slug → human label for breadcrumb segments. BI is full of acronym routes, and
// PathBreadcrumb's fallback title-caser would render them wrong — "Abc", "Fsn",
// "Rfm", "Gst Purchase Planning". Mirrors the labels in MODULE_SECTIONS' `bi`
// children (utils/constants.ts), which is the breadcrumb's source of truth per
// the sidebar-follows-not-route rule quoted in accountancy/reports/layout.tsx.
//
// Six of these read shorter than the page's own <h1> ("Bill Profit" vs
// "Bill-wise Profit", and likewise customer-profit, item-profit,
// movement-register, purchase-price-variance, sales-trend). The sidebar wins
// deliberately — the crumb should say what the user clicked to get here.
const BI_CRUMB_LABELS: Record<string, string> = {
    abc: "ABC Analysis",
    basket: "Basket Analysis",
    "bill-profit": "Bill Profit",
    "branch-comparison": "Branch Comparison",
    "customer-profit": "Customer Profit",
    "discount-impact": "Discount Impact",
    fsn: "FSN & Dead Stock",
    "gst-purchase-planning": "GST Purchase Planning",
    "inactive-customers": "Inactive Customers",
    "item-by-party": "Item by Party",
    "item-profit": "Item Profit",
    "movement-register": "Movement Register",
    "party-sale-purchase": "Party Sale & Purchase",
    "purchase-price-variance": "Price Variance",
    rfm: "RFM Segmentation",
    "sales-trend": "Sales Trend",
    "stock-health": "Stock Health",
    "stock-turnover": "Stock Turnover",
    "supplier-purchases": "Supplier Purchases",
    "top-customers": "Top Customers",
};

// Area layout for /office/bi/* — the breadcrumb strip every other office area
// already has, plus Esc → back. BI had neither: there was no layout anywhere in
// this subtree, so its 21 pages were the largest block in the office with no
// crumb and nothing carrying the module hue line.
//
// Deliberately NOT gated. Four of the sibling area layouts open with
// `auth()` + `hasModuleNavAccess(...)` + redirect, but BI has no server gate
// today — adding one here would be an access-rule change hidden inside a
// breadcrumb commit.
//
// `escapeBack` is safe: no BI page binds Escape itself, so there is no second
// handler to double-fire with useEscapeBack's window listener.
//
// Every BI page opens `<ScrollArea className="h-full">` and owns its own
// padding, so children pass through bare inside a bounded flex child. `min-h-0`
// is load-bearing — without it the child refuses to shrink below its content and
// the pages' own scroller never engages. Do NOT add `overflow-auto` or padding
// here (ecommerce/layout.tsx does, for pages that do not scroll themselves):
// either would give BI a second scrollbar and doubled gutters.
export default function BiLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/bi", label: "Business Intelligence" }}
                escapeBack
                labels={BI_CRUMB_LABELS}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
