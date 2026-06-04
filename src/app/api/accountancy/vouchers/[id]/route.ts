import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/accountancy/vouchers/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            createdBy:    { select: { id: true, name: true } },
            cancelledBy:  { select: { id: true, name: true } },
            deletedBy:    { select: { id: true, name: true } },
            partyAccount: { select: { id: true, code: true, name: true } },
            lines: {
                include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } },
            },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(voucher);
}

// ── PATCH ──────────────────────────────────────────────────────────────────
//
// Edit an existing GL voucher in place — reference + audit timestamps stay.
//
//   • DRAFT  → straightforward swap: delete old lines, create new lines,
//              update header. No GL impact (DRAFT never touched balances).
//
//   • POSTED → Tally-style atomic reversal + re-apply:
//                1. Decrement account.balance by the OLD line impact.
//                2. Delete old voucher.lines and the linked JE's lines.
//                3. Create new voucher.lines + JE.lines from payload.
//                4. Increment account.balance by the NEW line impact.
//                5. Update headers (date, narration, totalAmount, partyAccountId
//                   on the voucher; date + description on the JE).
//              The reference number and status stay; Trial Balance reflects
//              the new values without a counter-entry.
//
// CANCELLED / soft-deleted vouchers are rejected (409). Clients should
// short-circuit this call client-side when no fields actually changed.

const lineSchema = z.object({
    accountId:   z.number().int().positive(),
    type:        z.enum(["DEBIT", "CREDIT"]),
    amount:      z.number().positive(),
    description: z.string().trim().optional(),
});

const patchSchema = z.object({
    date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    narration:      z.string().trim().optional(),
    partyAccountId: z.number().int().positive().optional(),
    lines:          z.array(lineSchema).min(2, "At least 2 lines required"),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.FINANCE_VOUCHER_CREATE);
    if (response) return response;

    const { id } = await params;
    const voucherId = Number(id);

    const existing = await prisma.voucher.findUnique({
        where:   { id: voucherId },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.deletedAt) {
        return NextResponse.json({ error: "Voucher is deleted — restore it first" }, { status: 409 });
    }
    if (existing.status === "CANCELLED") {
        return NextResponse.json({ error: "Cancelled vouchers cannot be edited" }, { status: 409 });
    }

    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;
    const body = data;

    if (!isBalanced(body.lines)) {
        return NextResponse.json(
            { error: "Voucher is not balanced — debits must equal credits" },
            { status: 422 },
        );
    }

    const newTotalAmount = body.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0);

    try {
        await prisma.$transaction(async (tx) => {
            // ── POSTED: reverse the old GL impact first ─────────────────
            if (existing.status === "POSTED") {
                for (const line of existing.lines) {
                    const delta = balanceDelta(
                        line.account.normalBalance!,
                        line.type,
                        toNumber(line.amount),
                    );
                    await tx.account.update({
                        where: { id: line.accountId },
                        data:  { balance: { decrement: delta } },
                    });
                }
            }

            // Delete old voucher lines (always)
            await tx.voucherLine.deleteMany({ where: { voucherId } });

            // Delete linked JE's lines (POSTED only — DRAFT has no JE).
            if (existing.status === "POSTED" && existing.journalEntryId) {
                await tx.journalLine.deleteMany({
                    where: { journalEntryId: existing.journalEntryId },
                });
            }

            // Create new voucher lines
            await tx.voucherLine.createMany({
                data: body.lines.map((l) => ({
                    voucherId,
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                })),
            });

            // Create new JE lines mirroring the new voucher lines (POSTED only).
            if (existing.status === "POSTED" && existing.journalEntryId) {
                await tx.journalLine.createMany({
                    data: body.lines.map((l) => ({
                        journalEntryId: existing.journalEntryId!,
                        accountId:      l.accountId,
                        type:           l.type,
                        amount:         l.amount,
                        description:    l.description ?? null,
                    })),
                });

                // Apply the NEW GL impact
                for (const line of body.lines) {
                    const acct = await tx.account.findUnique({
                        where:  { id: line.accountId },
                        select: { normalBalance: true },
                    });
                    if (!acct?.normalBalance) continue;
                    const delta = balanceDelta(acct.normalBalance, line.type, line.amount);
                    await tx.account.update({
                        where: { id: line.accountId },
                        data:  { balance: { increment: delta } },
                    });
                }

                // Update the linked JE header — JE.description is required,
                // so only swap it when we have a non-empty narration; otherwise
                // leave the existing description untouched.
                await tx.journalEntry.update({
                    where: { id: existing.journalEntryId },
                    data:  {
                        date: new Date(body.date),
                        ...(body.narration ? { description: body.narration } : {}),
                    },
                });
            }

            // Update voucher header
            await tx.voucher.update({
                where: { id: voucherId },
                data:  {
                    date:           new Date(body.date),
                    narration:      body.narration ?? null,
                    partyAccountId: body.partyAccountId ?? null,
                    totalAmount:    newTotalAmount,
                },
            });
        // Posted edit = reverse + per-new-line findUnique + re-apply + JE/voucher
        // header updates; over the Supabase pooler this can exceed the default
        // 5s interactive-tx ceiling (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });

        const updated = await prisma.voucher.findUnique({
            where: { id: voucherId },
            include: {
                createdBy:    { select: { id: true, name: true } },
                partyAccount: { select: { id: true, code: true, name: true } },
                lines: {
                    include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } },
                },
            },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update voucher");
    }
}
