// Pure helpers for a counter's payment-account list (PosCounterPaymentAccount).
// No DB, no React — safe to import from both the sale route (server) and the
// checkout/admin screens (client). Type-only Prisma import so nothing runtime
// bundles into the client.

import type { PosPayChannel, PaymentMethod } from "@/generated/prisma/client";

/// The channels offered in the counter "method" dropdown, in display order.
export const POS_PAY_CHANNELS: PosPayChannel[] = [
    "UPI",
    "CARD",
    "CHEQUE",
    "WALLET",
    "BANK_TRANSFER",
    "GATEWAY",
];

/// Cashier/admin-facing channel names.
export const CHANNEL_LABEL: Record<PosPayChannel, string> = {
    UPI: "UPI",
    CARD: "Card",
    CHEQUE: "Cheque",
    WALLET: "Wallet",
    BANK_TRANSFER: "Bank Transfer",
    GATEWAY: "Gateway (Razorpay/Cashfree)",
};

/// Channels that collect via a UPI ID / gateway VPA — they get a VPA field in the
/// admin form and the "Share QR" action at checkout. The rest are manual tenders.
export const VPA_CHANNELS: PosPayChannel[] = ["UPI", "GATEWAY"];

export function channelNeedsVpa(channel: PosPayChannel): boolean {
    return VPA_CHANNELS.includes(channel);
}

/// Map a counter payment channel → the InvVoucherTender.method (PaymentMethod)
/// tag used for GL classification / reporting. The ledger debited is separate
/// (the account's own `accountId`); this is only the method label on the tender.
export function channelToPaymentMethod(channel: PosPayChannel): PaymentMethod {
    switch (channel) {
        case "UPI":
        case "GATEWAY":
            return "MOBILE_PAYMENT";
        case "CARD":
            return "CARD";
        case "CHEQUE":
            return "CHEQUE";
        case "BANK_TRANSFER":
            return "BANK_TRANSFER";
        case "WALLET":
            return "OTHER";
    }
}
