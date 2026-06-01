// PATCH  /api/pos/counters/[id]  — rename or toggle active
// DELETE /api/pos/counters/[id]  — only allowed when no shifts have ever used this counter

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Nullable id = "clear this mapping" (method becomes not accepted at this counter).
// Positive int = link to that Account ledger.
const accountIdOrClear = z.union([z.number().int().positive(), z.null()]).optional();
// Empty string from the form coerces to null — operator wiped the override.
const labelOrClear     = z.union([z.string().trim().max(30), z.null()]).optional()
    .transform((v) => (typeof v === "string" && v.length === 0) ? null : v);

const updateSchema = z.object({
    name:                  z.string().trim().min(1).max(60).optional(),
    isActive:              z.boolean().optional(),
    upiAccountId:          accountIdOrClear, upiLabel:          labelOrClear,
    cardAccountId:         accountIdOrClear, cardLabel:         labelOrClear,
    walletAccountId:       accountIdOrClear, walletLabel:       labelOrClear,
    chequeAccountId:       accountIdOrClear, chequeLabel:       labelOrClear,
    bankTransferAccountId: accountIdOrClear, bankTransferLabel: labelOrClear,
    // Allowed POS-expenditure ledgers (EXPENSE group). Empty = no restriction.
    // Deduped on save.
    allowedExpenseAccountIds: z.array(z.number().int().positive())
        .max(50)
        .transform((arr) => [...new Set(arr)])
        .optional(),
});

// Helper: pull only the non-undefined mapping fields off the parsed body.
const PAYMENT_MAP_FIELDS = ["upiAccountId", "cardAccountId", "walletAccountId", "chequeAccountId", "bankTransferAccountId"] as const;
type PaymentMapField = typeof PAYMENT_MAP_FIELDS[number];
const PAYMENT_LABEL_FIELDS = ["upiLabel", "cardLabel", "walletLabel", "chequeLabel", "bankTransferLabel"] as const;
type PaymentLabelField = typeof PAYMENT_LABEL_FIELDS[number];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    try {
        const { id: idStr } = await params;
        const id = Number(idStr);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });

        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;

        const existing = await prisma.posCounter.findUnique({ where: { id }, include: { tillAccount: true, branch: { select: { name: true } } } });
        if (!existing) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        // ── Validate any newly set payment-method mappings reference real ASSET ledgers.
        // Null is fine ("clear mapping"). Each non-null id must resolve to an ASSET-type
        // account so we don't accidentally route a Card receipt to, say, a Revenue ledger.
        const mappingIdsToCheck: number[] = [];
        for (const f of PAYMENT_MAP_FIELDS) {
            const v = data[f];
            if (typeof v === "number") mappingIdsToCheck.push(v);
        }
        if (mappingIdsToCheck.length > 0) {
            const accounts = await prisma.account.findMany({
                where: { id: { in: mappingIdsToCheck } },
                select: { id: true, group: { select: { type: true } } },
            });
            const byId = new Map(accounts.map((a) => [a.id, a]));
            for (const aid of mappingIdsToCheck) {
                const a = byId.get(aid);
                if (!a)                          return NextResponse.json({ error: `Account ${aid} not found` }, { status: 400 });
                if (a.group?.type !== "ASSET")   return NextResponse.json({ error: `Account ${aid} is not an ASSET ledger (cash/bank-style) — cannot route payment receipts here.` }, { status: 400 });
            }
        }

        // Validate allowed-expenditure ledgers are real EXPENSE-group accounts.
        if (data.allowedExpenseAccountIds && data.allowedExpenseAccountIds.length > 0) {
            const accs = await prisma.account.findMany({
                where:  { id: { in: data.allowedExpenseAccountIds } },
                select: { id: true, name: true, group: { select: { type: true } } },
            });
            const byId = new Map(accs.map((a) => [a.id, a]));
            for (const aid of data.allowedExpenseAccountIds) {
                const a = byId.get(aid);
                if (!a)                          return NextResponse.json({ error: `Account ${aid} not found` }, { status: 400 });
                if (a.group?.type !== "EXPENSE") return NextResponse.json({ error: `"${a.name}" is not an expense ledger.` }, { status: 400 });
            }
        }

        // If renaming, ensure no other counter in the same branch has that name.
        if (data.name && data.name !== existing.name) {
            const dup = await prisma.posCounter.findFirst({ where: { branchId: existing.branchId, name: data.name, NOT: { id } } });
            if (dup) return NextResponse.json({ error: `Counter "${data.name}" already exists in this branch` }, { status: 409 });
        }

        // Block deactivation while a shift is OPEN or AWAITING_HANDOVER.
        if (data.isActive === false) {
            const active = await prisma.posShift.findFirst({
                where: { counterId: id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                select: { id: true },
            });
            if (active) return NextResponse.json({ error: "Cannot deactivate counter with an active shift" }, { status: 400 });
        }

        const updated = await prisma.$transaction(async (tx) => {
            // Keep the till account name in sync if the counter is renamed.
            if (data.name && data.name !== existing.name) {
                const newTillName = `Cash – ${data.name} – ${existing.branch.name}`;
                await tx.account.update({ where: { id: existing.tillAccountId }, data: { name: newTillName } });
            }
            // Only include each mapping field if the caller actually sent it
            // (undefined = leave as-is; null = clear; number = set).
            const mapUpdates: Partial<Record<PaymentMapField, number | null>> = {};
            for (const f of PAYMENT_MAP_FIELDS) {
                if (data[f] !== undefined) mapUpdates[f] = data[f] as number | null;
            }
            const labelUpdates: Partial<Record<PaymentLabelField, string | null>> = {};
            for (const f of PAYMENT_LABEL_FIELDS) {
                if (data[f] !== undefined) labelUpdates[f] = data[f] as string | null;
            }
            return tx.posCounter.update({
                where: { id },
                data: {
                    ...(data.name     !== undefined && { name: data.name }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.allowedExpenseAccountIds !== undefined && { allowedExpenseAccountIds: data.allowedExpenseAccountIds }),
                    ...mapUpdates,
                    ...labelUpdates,
                },
                include: {
                    tillAccount:         { select: { id: true, name: true, balance: true } },
                    branch:              { select: { id: true, name: true } },
                    upiAccount:          { select: { id: true, name: true } },
                    cardAccount:         { select: { id: true, name: true } },
                    walletAccount:       { select: { id: true, name: true } },
                    chequeAccount:       { select: { id: true, name: true } },
                    bankTransferAccount: { select: { id: true, name: true } },
                },
            });
        });

        return NextResponse.json({
            id:       updated.id,
            name:     updated.name,
            branchId: updated.branchId,
            branch:   updated.branch,
            isActive: updated.isActive,
            tillAccount: {
                id:      updated.tillAccount.id,
                name:    updated.tillAccount.name,
                balance: updated.tillAccount.balance.toString(),
            },
            upiAccount:          updated.upiAccount,          upiLabel:          updated.upiLabel,
            cardAccount:         updated.cardAccount,         cardLabel:         updated.cardLabel,
            walletAccount:       updated.walletAccount,       walletLabel:       updated.walletLabel,
            chequeAccount:       updated.chequeAccount,       chequeLabel:       updated.chequeLabel,
            bankTransferAccount: updated.bankTransferAccount, bankTransferLabel: updated.bankTransferLabel,
            allowedExpenseAccountIds: updated.allowedExpenseAccountIds,
        });
    } catch (e) {
        return handleApiError(e, "Failed to update counter");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    try {
        const { id: idStr } = await params;
        const id = Number(idStr);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });

        const counter = await prisma.posCounter.findUnique({
            where: { id },
            include: { _count: { select: { shifts: true } }, tillAccount: { select: { id: true, balance: true } } },
        });
        if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        if (counter._count.shifts > 0) {
            return NextResponse.json(
                { error: `Cannot delete: this counter has ${counter._count.shifts} shift(s) in history. Deactivate instead.` },
                { status: 400 },
            );
        }
        if (Number(counter.tillAccount.balance) !== 0) {
            return NextResponse.json(
                { error: "Cannot delete: till account has a non-zero balance. Sweep to vault first." },
                { status: 400 },
            );
        }

        await prisma.posCounter.delete({ where: { id } });
        // We intentionally KEEP the till GL account (audit trail) — just unlinked from the counter now.
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete counter");
    }
}
