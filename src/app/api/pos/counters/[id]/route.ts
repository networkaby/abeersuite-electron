// PATCH  /api/pos/counters/[id]  — rename / toggle active / manage payment accounts
// DELETE /api/pos/counters/[id]  — only allowed when no shifts have ever used this counter

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// One payment account on the counter. `id` present = update that row; absent =
// create. `accountId` is the bank/cash-style ledger debited when collected here.
// `vpa` is optional (UPI/gateway pay-to id); validated only when supplied.
const paymentAccountSchema = z.object({
    id:        z.number().int().positive().optional(),
    channel:   z.enum(["UPI", "CARD", "CHEQUE", "WALLET", "BANK_TRANSFER", "GATEWAY"]),
    label:     z.string().trim().min(1).max(40),
    accountId: z.number().int().positive(),
    vpa:       z.union([z.string().trim().max(60), z.null()]).optional()
        .transform((v) => (typeof v === "string" && v.trim().length ? v.trim() : null))
        .refine((v) => v == null || /^[\w.\-]+@[\w.\-]+$/.test(v), "Enter a valid UPI ID like name@bank"),
    sortOrder: z.number().int().min(0).optional(),
    isActive:  z.boolean().optional(),
});

const updateSchema = z.object({
    name:     z.string().trim().min(1).max(60).optional(),
    isActive: z.boolean().optional(),
    // Full replace of the counter's payment-account list when supplied.
    paymentAccounts: z.array(paymentAccountSchema).max(20).optional(),
    // Allowed POS-expenditure ledgers (EXPENSE group). Empty = no restriction.
    allowedExpenseAccountIds: z.array(z.number().int().positive())
        .max(50)
        .transform((arr) => [...new Set(arr)])
        .optional(),
});

const counterInclude = {
    tillAccount: { select: { id: true, name: true, balance: true } },
    branch:      { select: { id: true, name: true } },
    paymentAccounts: {
        orderBy: { sortOrder: "asc" as const },
        select: {
            id: true, channel: true, label: true, accountId: true, vpa: true,
            sortOrder: true, isActive: true,
            account: { select: { id: true, name: true } },
        },
    },
};

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

        // ── Each payment account's ledger must be a real ASSET account, so we never
        // route a receipt to, say, a Revenue ledger. ──────────────────────────────
        if (data.paymentAccounts && data.paymentAccounts.length > 0) {
            const ledgerIds = [...new Set(data.paymentAccounts.map((p) => p.accountId))];
            const accounts = await prisma.account.findMany({
                where:  { id: { in: ledgerIds } },
                select: { id: true, group: { select: { type: true } } },
            });
            const byId = new Map(accounts.map((a) => [a.id, a]));
            for (const aid of ledgerIds) {
                const a = byId.get(aid);
                if (!a)                        return NextResponse.json({ error: `Account ${aid} not found` }, { status: 400 });
                if (a.group?.type !== "ASSET") return NextResponse.json({ error: `Account ${aid} is not an ASSET ledger (cash/bank-style) — cannot route payment receipts here.` }, { status: 400 });
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

            // Diff-replace the payment-account list (only when the caller sent it).
            if (data.paymentAccounts !== undefined) {
                const owned = await tx.posCounterPaymentAccount.findMany({ where: { counterId: id }, select: { id: true } });
                const ownedIds = new Set(owned.map((r) => r.id));
                const keepIds = data.paymentAccounts.filter((p) => p.id && ownedIds.has(p.id)).map((p) => p.id!);
                await tx.posCounterPaymentAccount.deleteMany({ where: { counterId: id, id: { notIn: keepIds.length ? keepIds : [-1] } } });
                for (let i = 0; i < data.paymentAccounts.length; i++) {
                    const p = data.paymentAccounts[i];
                    const row = {
                        channel:   p.channel,
                        label:     p.label,
                        accountId: p.accountId,
                        vpa:       p.vpa,
                        sortOrder: p.sortOrder ?? i,
                        isActive:  p.isActive ?? true,
                    };
                    if (p.id && ownedIds.has(p.id)) {
                        await tx.posCounterPaymentAccount.update({ where: { id: p.id }, data: row });
                    } else {
                        await tx.posCounterPaymentAccount.create({ data: { counterId: id, ...row } });
                    }
                }
            }

            return tx.posCounter.update({
                where: { id },
                data: {
                    ...(data.name     !== undefined && { name: data.name }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.allowedExpenseAccountIds !== undefined && { allowedExpenseAccountIds: data.allowedExpenseAccountIds }),
                },
                include: counterInclude,
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
            paymentAccounts: updated.paymentAccounts,
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

        // Payment-account rows cascade-delete with the counter (onDelete: Cascade).
        await prisma.posCounter.delete({ where: { id } });
        // We intentionally KEEP the till GL account (audit trail) — just unlinked from the counter now.
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete counter");
    }
}
