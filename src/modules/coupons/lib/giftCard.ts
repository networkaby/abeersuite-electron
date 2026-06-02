// Gift-card helpers. Issuance GL (Dr Cash / Cr Liability) lives in the issue
// route (it needs a JE reference series); these are the tx-aware balance moves
// shared by the POS sale (redeem) and return (refund) routes.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface GiftCardLite {
    id: number;
    code: string;
    balance: number;
    status: string;
    enabled: boolean;
    expiresAt: Date | null;
}

/// Find a redeemable gift card by code: ACTIVE, enabled, not expired, positive
/// balance. `enabled` is surfaced so callers can reject a manually-disabled card.
export async function lookupActiveGiftCard(tx: Tx, code: string, now: Date): Promise<GiftCardLite | null> {
    const gc = await tx.giftCard.findFirst({ where: { code: { equals: code.trim(), mode: "insensitive" } } });
    if (!gc) return null;
    const lite: GiftCardLite = { id: gc.id, code: gc.code, balance: Number(gc.balance), status: gc.status, enabled: gc.enabled, expiresAt: gc.expiresAt };
    if (gc.status !== "ACTIVE") return lite;            // surfaced to the caller with status
    if (gc.expiresAt && gc.expiresAt < now) return { ...lite, status: "EXPIRED" };
    return lite;
}

/// Draw down a gift card inside the sale tx (validated by the caller).
export async function redeemGiftCard(
    tx: Tx, args: { giftCardId: number; amount: number; voucherId: number; createdById: number },
): Promise<number> {
    const gc = await tx.giftCard.findUniqueOrThrow({ where: { id: args.giftCardId }, select: { balance: true, status: true } });
    const newBal = Math.round((Number(gc.balance) - args.amount) * 100) / 100;
    await tx.giftCard.update({
        where: { id: args.giftCardId },
        data: { balance: newBal, status: newBal <= 0.005 ? "REDEEMED" : gc.status },
    });
    await tx.giftCardTxn.create({
        data: { giftCardId: args.giftCardId, type: "REDEEM", amount: -args.amount, voucherId: args.voucherId, balanceAfter: newBal, createdById: args.createdById },
    });
    return newBal;
}

/// Restore balance on a return (proportional amount computed by the caller).
export async function refundGiftCard(
    tx: Tx, args: { giftCardId: number; amount: number; voucherId: number; createdById: number },
): Promise<number> {
    const gc = await tx.giftCard.findUniqueOrThrow({ where: { id: args.giftCardId }, select: { balance: true, status: true } });
    const newBal = Math.round((Number(gc.balance) + args.amount) * 100) / 100;
    await tx.giftCard.update({
        where: { id: args.giftCardId },
        data: { balance: newBal, status: gc.status === "REDEEMED" ? "ACTIVE" : gc.status },
    });
    await tx.giftCardTxn.create({
        data: { giftCardId: args.giftCardId, type: "REFUND", amount: args.amount, voucherId: args.voucherId, balanceAfter: newBal, createdById: args.createdById },
    });
    return newBal;
}
