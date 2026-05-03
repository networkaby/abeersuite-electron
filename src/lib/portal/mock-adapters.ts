export type PortalOrderDto = {
    id: number;
    orderNo: string;
    createdAt: string;
    amountInr: number;
    status: "Paid" | "Processing" | "Shipped" | "Delivered";
    accountLabel: string;
    items: number;
};

export type PortalRepairDto = {
    id: number;
    ticketNo: string;
    device: string;
    status: string;
    updatedAt: string;
    eta: string;
};

export type PortalCouponDto = {
    id: string;
    code: string;
    title: string;
    description: string;
    expiresAt: string;
    state: "active" | "used" | "expired";
};

export type PortalWalletTxnDto = {
    id: string;
    date: string;
    type: "credit" | "debit";
    label: string;
    amountInr: number;
};

export type PortalSocialPostDto = {
    id: string;
    author: string;
    text: string;
    at: string;
};

export type PortalFriendDto = {
    id: string;
    name: string;
    role: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getMockOrders(): Promise<PortalOrderDto[]> {
    await delay(150);
    return [
        { id: 3201, orderNo: "ORD-3201", createdAt: "2026-04-28", amountInr: 12999, status: "Shipped", accountLabel: "Personal", items: 2 },
        { id: 3188, orderNo: "ORD-3188", createdAt: "2026-04-17", amountInr: 2499, status: "Delivered", accountLabel: "Acme Retail Pvt Ltd", items: 1 },
        { id: 3154, orderNo: "ORD-3154", createdAt: "2026-03-31", amountInr: 8999, status: "Processing", accountLabel: "Personal", items: 3 },
    ];
}

export async function getMockRepairs(): Promise<PortalRepairDto[]> {
    await delay(120);
    return [
        { id: 901, ticketNo: "T-901", device: "Dell Inspiron 5410", status: "In diagnosis", updatedAt: "2h ago", eta: "2 days" },
        { id: 857, ticketNo: "T-857", device: "iPhone 13", status: "Parts ordered", updatedAt: "1 day ago", eta: "4 days" },
        { id: 799, ticketNo: "T-799", device: "HP LaserJet M1136", status: "Ready for pickup", updatedAt: "3 days ago", eta: "Today" },
    ];
}

export async function getMockCoupons(): Promise<PortalCouponDto[]> {
    await delay(100);
    return [
        { id: "cpn1", code: "WELCOME15", title: "15% off on accessories", description: "Applicable on orders above ₹999.", expiresAt: "2026-06-30", state: "active" },
        { id: "cpn2", code: "FREESHIP", title: "Free shipping", description: "One-time shipping waiver.", expiresAt: "2026-05-30", state: "active" },
        { id: "cpn3", code: "SUMMER50", title: "₹50 off", description: "Used on prior purchase.", expiresAt: "2026-03-01", state: "used" },
    ];
}

export async function getMockWallet(): Promise<{ balanceInr: number; txns: PortalWalletTxnDto[] }> {
    await delay(100);
    return {
        balanceInr: 850,
        txns: [
            { id: "w1", date: "2026-04-27", type: "credit", label: "Refund for order ORD-3162", amountInr: 550 },
            { id: "w2", date: "2026-04-20", type: "debit", label: "Used on order ORD-3188", amountInr: 200 },
            { id: "w3", date: "2026-04-02", type: "credit", label: "Loyalty bonus", amountInr: 500 },
        ],
    };
}

export async function getMockSocial(): Promise<{ posts: PortalSocialPostDto[]; friends: PortalFriendDto[] }> {
    await delay(120);
    return {
        posts: [
            { id: "p1", author: "Network Service", text: "Welcome to the customer network community.", at: "Today, 9:45 AM" },
            { id: "p2", author: "Support Team", text: "Tip: You can track repair stages under My Repairs.", at: "Yesterday, 4:10 PM" },
        ],
        friends: [
            { id: "u1", name: "Rafiq Hasan", role: "Support Lead" },
            { id: "u2", name: "Jannat Karim", role: "Service Advisor" },
            { id: "u3", name: "Imran Sayeed", role: "Quality Manager" },
        ],
    };
}

