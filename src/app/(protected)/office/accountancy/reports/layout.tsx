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
                hideOn={["/office/accountancy/reports/day-book"]}
                labels={{
                    "reports": "Reports",
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
                    "ledger-outstandings": "Ledger Outstandings",
                    "optional-vouchers": "Optional Vouchers",
                    "pending-vouchers": "Pending Vouchers",
                    "gst": "GST",
                    "outward-supplies": "Outward Supplies",
                    "inward-supplies": "Inward Supplies",
                    "hsn-summary": "HSN Summary",
                    "liability": "Liability",
                    "classification": "Classification",
                }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
