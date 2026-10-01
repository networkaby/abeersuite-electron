import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Thin layout for /office/accountancy/reports/*. Adds a consistent
// breadcrumb header + Esc-to-back keyboard shortcut to every report page
// (Balance Sheet, P&L, Trial Balance, Day Book, GST reports, …). Per-page
// content is unchanged — this only prepends a breadcrumb strip.
export default function AccountancyReportsLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/accountancy", label: "Accountancy" }}
                // Day Book renders its own back-button header inside the
                // page — hide the layout breadcrumb so it doesn't duplicate.
                // GST pages live under this route folder for code-organization
                // reasons only — the sidebar treats them as their own
                // "Compliance" module, so they get their own breadcrumb via
                // gst/layout.tsx instead of this one.
                hideOn={[
                    "/office/accountancy/reports/day-book",
                    "/office/accountancy/reports/gst",
                    "/office/accountancy/reports/gst/outward-supplies",
                    "/office/accountancy/reports/gst/inward-supplies",
                    "/office/accountancy/reports/gst/hsn-summary",
                    "/office/accountancy/reports/gst/liability",
                    "/office/accountancy/reports/gst/classification",
                ]}
                // "reports" is a route-folder implementation detail — the
                // sidebar has no matching "Reports" node, so it's hidden
                // rather than shown as a crumb (see the sidebar-follows-not-
                // route breadcrumb rule).
                hide={new Set(["reports"])}
                labels={{
                    "balance-sheet": "Balance Sheet",
                    "profit-loss": "Profit & Loss",
                    "trial-balance": "Trial Balance",
                    "day-book": "Day Book",
                    "cash-book": "Cash Book",
                    "bank-book": "Bank Book",
                    "cash-flow": "Cash Flow",
                    "fund-flow": "Fund Flow",
                    "ratio-analysis": "Ratio Analysis",
                    "bank-reconciliation": "Bank Reconciliation",
                    "pending-vouchers": "Pending Inventory",
                }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
