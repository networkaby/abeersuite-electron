import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/customer-retention/* — mirrors the accountancy areas:
// a consistent breadcrumb strip rooted at the module index, plus Esc → back.
// Per-section permission gating still lives in each subfolder's own layout.
// None of the leaf pages (coupons / gift-cards / loyalty / customer-tiers) bind
// Esc themselves, so layout-level `escapeBack` is safe (no double-binding).
export default function CustomerRetentionLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/customer-retention", label: "Customer Retention" }}
                escapeBack
                labels={{
                    "coupons": "Coupons",
                    "gift-cards": "Gift Cards",
                    "loyalty": "Loyalty",
                    "customer-tiers": "Spend Tiers",
                    "protection": "Protection",
                }}

            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
