import { type ComponentType } from "react";
import {
    Wrench,
    Monitor,
    Send,
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
    /**
     * Owning module key (see MODULES). The tile's colour comes from the module
     * hue, so a quick action is the same colour as the module it lands you in —
     * these used to carry an ad-hoc palette that matched nothing else.
     */
    module: string;
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
            module: "repair",
            onClick: handlers.onNewTicket,
        },
        {
            label: "New POS sale",
            hint: "Counter sale to a walk-in",
            icon: Monitor,
            module: "pos",
            href: "/vouchers/pos/new",
        },
        {
            label: "New delivery order",
            hint: "Send goods to a customer address",
            icon: Send,
            module: "orders",
            href: "/office/ecommerce",
        },
        {
            label: "Log enquiry / lead",
            hint: "Phone, WhatsApp or walk-in query",
            icon: MessageSquarePlus,
            module: "crm",
            href: "/office/crm/deals?new=1",
        },
        {
            label: "Courier arrived (GRN)",
            hint: "Receive a parcel from a supplier",
            icon: Package,
            module: "inventory",
            href: "/vouchers/grn/new",
        },
        {
            label: "Pay a bill",
            hint: "Electricity, rent, supplier payment",
            icon: CreditCard,
            module: "accountancy",
            href: "/vouchers/payments/new",
        },
        {
            label: "Internal request",
            hint: "Packaging, consumables, supplies",
            icon: Boxes,
            module: "inventory",
            soon: true,
        },
    ];
}
