// Pure helpers for a counter's payment-account list (PosCounterPaymentAccount).
// No DB, no React — safe to import from both the sale route (server) and the
// checkout/admin screens (client). Type-only Prisma import so nothing runtime
// bundles into the client.

import type { PosPayChannel, PaymentMethod } from "@/generated/prisma/client";

/// Cashier/admin-facing channel names. The counter "method" dropdown itself is
/// built from Settings → Payment Methods (PAYMENT_METHOD_DEFAULTS), not from here.
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

/// One checkout payment as the till sends it: `paymentAccountId` null = cash.
export type CounterPayment = { paymentAccountId: number | null; amount: number; reference?: string };

/// Resolve checkout payments to tender rows against ONE counter — cash debits the
/// counter's till, every other line the ledger of the counter payment account it
/// names. Shared by a fresh POS sale and a POS sale re-saved from edit, so the
/// two can never route the same money to different ledgers. `null` = a line names
/// an account this counter does not have.
export function resolveCounterPayments(
    payments: CounterPayment[],
    tillAccountId: number,
    payAcctById: Map<number, { channel: PosPayChannel; accountId: number }>,
): { method: PaymentMethod; accountId: number; amount: number; reference?: string }[] | null {
    const out: { method: PaymentMethod; accountId: number; amount: number; reference?: string }[] = [];
    for (const p of payments) {
        if (p.paymentAccountId == null) {
            out.push({ method: "CASH", accountId: tillAccountId, amount: p.amount, reference: p.reference });
            continue;
        }
        const acct = payAcctById.get(p.paymentAccountId);
        if (!acct) return null;
        out.push({ method: channelToPaymentMethod(acct.channel), accountId: acct.accountId, amount: p.amount, reference: p.reference });
    }
    return out;
}

/// The reference a gift-card tender carries ("Gift card GC-1234") — written by
/// the sale, read back by an edit so the card's draw is kept as it was.
export const giftCardTenderRef = (code: string) => `Gift card ${code}`;
export const isGiftCardTender = (t: { reference?: string | null }) => !!t.reference?.startsWith("Gift card ");
