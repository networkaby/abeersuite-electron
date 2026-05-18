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
        label: "Overview",
        links: [
            { label: "All Vouchers", href: `${BASE}/all`, icon: ClipboardList },
        ],
    },
    {
        label: "Trading",
        links: [
            { label: "Sales", href: `${BASE}/sales`, icon: Receipt },
            { label: "Purchases", href: `${BASE}/purchases`, icon: ShoppingCart },
            { label: "Sale Returns", href: `${BASE}/sale-returns`, icon: Receipt },
            { label: "Purchase Returns", href: `${BASE}/purchase-returns`, icon: ShoppingCart },
            { label: "Estimates", href: `${BASE}/estimates`, icon: ScrollText, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
        ],
    },
    {
        label: "Money & GL",
        links: [
            { label: "Payments", href: `${BASE}/payments`, icon: Wallet, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Receipts", href: `${BASE}/receipts`, icon: Wallet, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Contras", href: `${BASE}/contras`, icon: Wallet, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Credit Notes", href: `${BASE}/credit-notes`, icon: FileText, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Debit Notes", href: `${BASE}/debit-notes`, icon: FileText, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Journal Entries", href: `${BASE}/journal-entries`, icon: FileText, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
        ],
    },
    {
        label: "Orders & delivery",
        links: [
            { label: "Sales Orders", href: `${BASE}/sales-orders`, icon: ClipboardList, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "Purchase Orders", href: `${BASE}/purchase-orders`, icon: ClipboardList, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "GRN", href: `${BASE}/grn`, icon: PackageCheck, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "Challans", href: `${BASE}/challans`, icon: Truck, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "Rejections In", href: `${BASE}/rejections-in`, icon: PackageX, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "Rejections Out", href: `${BASE}/rejections-out`, icon: PackageX, permission: PERMISSIONS.INVENTORY_MANAGE },
        ],
    },
    {
        label: "Stock movement",
        links: [
            { label: "Goods Receipts", href: `${BASE}/goods-receipts`, icon: PackageCheck, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Issues", href: `${BASE}/issues`, icon: ArrowUpRight, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Adjustments", href: `${BASE}/adjustments`, icon: ArrowLeftRight, permission: PERMISSIONS.FINANCE_VOUCHER_CREATE },
            { label: "Manufacturing Journals", href: `${BASE}/manufacturing-journals`, icon: ArrowLeftRight, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "Physical Stock", href: `${BASE}/physical-stock`, icon: ClipboardCheck, permission: PERMISSIONS.INVENTORY_MANAGE },
            { label: "Branch Transfers", href: `${BASE}/branch-transfers`, icon: ArrowLeftRight, permission: PERMISSIONS.INVENTORY_MANAGE },
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
