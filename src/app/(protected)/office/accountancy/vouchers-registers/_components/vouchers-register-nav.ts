import type { LucideIcon } from "lucide-react";
import {
    ArrowLeftRight,
    ArrowUpRight,
    ClipboardCheck,
    ClipboardList,
    FileText,
    PackageCheck,
    PackageX,
    Receipt,
    ScrollText,
    ShoppingCart,
    Truck,
    Wallet,
} from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export type VoucherRegisterNavLink = {
    label: string;
    href: string;
    icon: LucideIcon;
    /** When omitted, visible to anyone who can open the vouchers-registers section. */
    permission?: string;
};

export type VoucherRegisterNavGroup = {
    label: string;
    links: VoucherRegisterNavLink[];
};

const BASE = "/office/accountancy/vouchers-registers";

export const VOUCHERS_REGISTER_NAV_GROUPS: VoucherRegisterNavGroup[] = [
    {
        label: "Trading",
        links: [
            { label: "Sales", href: `${BASE}/sales`, icon: Receipt },
            { label: "Purchases", href: `${BASE}/purchases`, icon: ShoppingCart },
            { label: "Sale Returns", href: `${BASE}/sale-returns`, icon: Receipt },
            { label: "Purchase Returns", href: `${BASE}/purchase-returns`, icon: ShoppingCart },
            { label: "Estimates", href: `${BASE}/estimates`, icon: ScrollText },
        ],
    },
    {
        label: "Money & GL",
        links: [
            { label: "Payments", href: `${BASE}/payments`, icon: Wallet },
            { label: "Receipts", href: `${BASE}/receipts`, icon: Wallet },
            { label: "Contras", href: `${BASE}/contras`, icon: Wallet },
            { label: "Credit Notes", href: `${BASE}/credit-notes`, icon: FileText },
            { label: "Debit Notes", href: `${BASE}/debit-notes`, icon: FileText },
            { label: "Journal Entries", href: `${BASE}/journal-entries`, icon: FileText },
        ],
    },
    {
        label: "Orders & delivery",
        links: [
            { label: "Sales Orders", href: `${BASE}/sales-orders`, icon: ClipboardList },
            { label: "Purchase Orders", href: `${BASE}/purchase-orders`, icon: ClipboardList },
            { label: "GRN", href: `${BASE}/grn`, icon: PackageCheck },
            { label: "Challans", href: `${BASE}/challans`, icon: Truck },
            { label: "Rejections In", href: `${BASE}/rejections-in`, icon: PackageX },
            { label: "Rejections Out", href: `${BASE}/rejections-out`, icon: PackageX },
        ],
    },
    {
        label: "Stock movement",
        links: [
            { label: "Goods Receipts", href: `${BASE}/goods-receipts`, icon: PackageCheck },
            { label: "Issues", href: `${BASE}/issues`, icon: ArrowUpRight },
            { label: "Adjustments", href: `${BASE}/adjustments`, icon: ArrowLeftRight },
            { label: "Manufacturing Journals", href: `${BASE}/manufacturing-journals`, icon: ArrowLeftRight },
            { label: "Physical Stock", href: `${BASE}/physical-stock`, icon: ClipboardCheck },
            { label: "Branch Transfers", href: `${BASE}/branch-transfers`, icon: ArrowLeftRight },
        ],
    },
];

export function filterVouchersRegisterNav(
    groups: VoucherRegisterNavGroup[],
    permissions: string[],
): VoucherRegisterNavGroup[] {
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    return groups
        .map((group) => ({
            ...group,
            links: group.links.filter(
                (link) => isAdmin || !link.permission || permissions.includes(link.permission),
            ),
        }))
        .filter((group) => group.links.length > 0);
}
