import { type ComponentType } from "react";
import {
    Wrench,
    ShoppingCart,
    Truck,
    MessageSquarePlus,
    Package,
    CreditCard,
    Boxes,
} from "lucide-react";

/**
 * Single source of truth for the Front Office quick actions, consumed by both
 * the grid {@link QuickActionTiles} and the slim {@link QuickActionBar}. Keep
 * the action set here so the two surfaces never drift.
 */
export interface QuickAction {
    label: string;
    hint: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    accent: string;
    /** Either a navigation href OR a click handler (mutually exclusive). */
    href?: string;
    onClick?: () => void;
    /** Stub actions show a "soon" badge and don't navigate. */
    soon?: boolean;
}

/** Build the action list, wiring up the handler-backed actions. */
export function buildQuickActions(handlers: { onNewTicket: () => void }): QuickAction[] {
    return [
        {
            label: "New repair ticket",
            hint: "Customer dropped off a device",
            icon: Wrench,
            accent: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
            onClick: handlers.onNewTicket,
        },
        {
            label: "New POS sale",
            hint: "Counter sale to a walk-in",
            icon: ShoppingCart,
            accent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            href: "/vouchers/pos/new",
        },
        {
            label: "New delivery order",
            hint: "Send goods to a customer address",
            icon: Truck,
            accent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
            href: "/office/ecommerce",
        },
        {
            label: "Log enquiry / lead",
            hint: "Phone, WhatsApp or walk-in query",
            icon: MessageSquarePlus,
            accent: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
            href: "/office/crm/leads/new",
        },
        {
            label: "Courier arrived (GRN)",
            hint: "Receive a parcel from a supplier",
            icon: Package,
            accent: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
            href: "/vouchers/grn/new",
        },
        {
            label: "Pay a bill",
            hint: "Electricity, rent, supplier payment",
            icon: CreditCard,
            accent: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
            href: "/vouchers/payments/new",
        },
        {
            label: "Internal request",
            hint: "Packaging, consumables, supplies",
            icon: Boxes,
            accent: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            soon: true,
        },
    ];
}
