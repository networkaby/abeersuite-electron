import { auth } from "@/auth";
import { VouchersRegistersNav } from "@/modules/accountancy/components/VouchersRegistersNav";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

export default async function VouchersRegistersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="container max-w-7xl py-0 space-y-0">
            <PathBreadcrumb
                root={{ href: "/office/accountancy", label: "Accountancy" }}
                labels={{
                    "vouchers-registers": "Registers",
                    "all": "All Vouchers",
                    "sale-returns": "Sale Returns",
                    "purchase-returns": "Purchase Returns",
                    "sales-orders": "Sales Orders",
                    "purchase-orders": "Purchase Orders",
                    "credit-notes": "Credit Notes",
                    "debit-notes": "Debit Notes",
                    "journal-entries": "Journal Entries",
                    "rejections-in": "Rejections In",
                    "rejections-out": "Rejections Out",
                    "manufacturing-journals": "Manufacturing Journals",
                    "physical-stock": "Physical Stock",
                    "branch-transfers": "Branch Transfers",
                    "grn": "GRN",
                }}
            />
            <VouchersRegistersNav permissions={permissions} />
            {children}
        </div>
    );
}
