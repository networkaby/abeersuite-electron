import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// GST pages live under accountancy/reports/gst/* for code-organization
// reasons, but the sidebar treats them as their own "Compliance" module
// (separate from Accountancy) — so this breadcrumb roots at Compliance
// instead of inheriting the parent reports/layout's Accountancy root.
export default function ComplianceReportsLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/accountancy/reports/gst", label: "Compliance" }}
                escapeBack
                labels={{
                    "outward-supplies": "Outward Supplies",
                    "inward-supplies": "Inward Supplies",
                    "hsn-summary": "HSN Summary",
                    "liability": "Net GST Liability",
                    "classification": "Tax Classification",
                }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
