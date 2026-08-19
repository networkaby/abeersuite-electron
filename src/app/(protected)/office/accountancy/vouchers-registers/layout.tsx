import { auth } from "@/auth";
import { VouchersRegistersNav } from "./_components/VouchersRegistersNav";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

export default async function VouchersRegistersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/accountancy", label: "Accountancy" }}
                escapeBack
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
            <div className="flex-none px-0">
                <VouchersRegistersNav permissions={permissions} />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
