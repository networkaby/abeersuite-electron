import { ShopOrderStatus } from "@/generated/prisma/enums";

/** Allowed next statuses from each current status (strict fulfilment flow). */
export const ORDER_STATUS_TRANSITIONS: Record<ShopOrderStatus, ShopOrderStatus[]> = {
    DRAFT: [],
    PENDING_PAYMENT: [ShopOrderStatus.PAID, ShopOrderStatus.CANCELLED],
    PAID: [ShopOrderStatus.PACKED, ShopOrderStatus.REFUNDED],
    PACKED: [ShopOrderStatus.SHIPPED],
    SHIPPED: [ShopOrderStatus.DELIVERED],
    DELIVERED: [ShopOrderStatus.REFUNDED],
    REFUNDED: [],
    CANCELLED: [],
};

export function canTransition(from: ShopOrderStatus, to: ShopOrderStatus): boolean {
    return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
