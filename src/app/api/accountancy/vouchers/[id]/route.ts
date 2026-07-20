import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { parseDenomJson } from "@/shared/lib/accountancy/denomJson";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { auditSnapshot } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

// Phase 5 5E: the UniversalVoucher spine IS the financial voucher (Voucher table
// dropped). `id` is the spine id; lines are VoucherGlLine. The spine is scalar/
// id-only for party/creator/account, so those are enriched from lookups to keep
// the old response shape the voucher UI consumes.

async function enrichVoucher(v: { id: number; createdById: number; cancelledById: number | null; deletedById: number | null; partyAccountId: number | null; lines: { accountId: number; type: string; amount: unknown }[] } & Record<string, unknown>) {
    const userIds = [v.createdById, v.cancelledById, v.deletedById].filter((x): x is number => x != null);
    const acctIds = [...new Set([...(v.partyAccountId != null ? [v.partyAccountId] : []), ...v.lines.map((l) => l.accountId)])];
    const [users, accounts] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
        acctIds.length === 0 ? Promise.resolve([]) : prisma.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, code: true, name: true, normalBalance: true } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    return {
        ...v,
        createdBy:    userById.get(v.createdById) ?? null,
        cancelledBy:  v.cancelledById != null ? (userById.get(v.cancelledById) ?? null) : null,
        deletedBy:    v.deletedById   != null ? (userById.get(v.deletedById)   ?? null) : null,
        partyAccount: v.partyAccountId != null ? (acctById.get(v.partyAccountId) ?? null) : null,
        totalAmount:  v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0),
        lines:        v.lines.map((l) => ({ ...l, account: acctById.get(l.accountId) ?? null })),
    };
}

// GET /api/accountancy/vouchers/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucher = await prisma.universalVoucher.findUnique({
        where:   { id: Number(id) },
        include: { lines: { orderBy: [{ type: "asc" }, { id: "asc" }] } },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(await enrichVoucher(voucher));
}

// ── PATCH — edit a financial voucher in place (the spine), reference + audit kept.
//   • DRAFT  → swap GL lines + header. No balance impact (gated out until POSTED).
//   • POSTED → reverse old balance, rewrite GL lines, re-apply, update header.
//   • CANCELLED / deleted → 409.
const lineSchema = z.object({
    accountId:   z.number().int().positive(),
    type:        z.enum(["DEBIT", "CREDIT"]),
    amount:      z.number().positive(),
    description: z.string().trim().optional(),
});

// Contra deposit-slip capture — same shape as the create route; the FINAL
// combined breakdown stored once on the spine. `null` clears a saved capture.
const denomJsonSchema = z.object({
    notes:   z.record(z.string(), z.number().int().min(0)),
    cheques: z.array(z.object({
        no:      z.string().trim().min(1),
        amount:  z.number().positive(),
        account: z.string().trim().optional(),
    })),
});

const patchSchema = z.object({
    date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    narration:      z.string().trim().optional(),
    partyAccountId: z.number().int().positive().optional(),
    lines:          z.array(lineSchema).min(2, "At least 2 lines required"),
    denomJson:      denomJsonSchema.nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const voucherId = Number(id);

    const existing = await prisma.universalVoucher.findUnique({
        where:   { id: voucherId },
        include: { lines: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // "Who can cancel can edit also" — gated by the per-kind cancel permission.
    if (!userCanVoucher(user, existing.type, "cancel")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

    // Spine lines are scalar — resolve normalBalance for the reverse/apply.
    const allAcctIds = [...new Set([...existing.lines.map((l) => l.accountId), ...body.lines.map((l) => l.accountId)])];
    const nbRows = await prisma.account.findMany({ where: { id: { in: allAcctIds } }, select: { id: true, normalBalance: true } });
    const nbById = new Map(nbRows.map((a) => [a.id, a.normalBalance]));

    try {
        await prisma.$transaction(async (tx) => {
            const wasPosted = existing.status === "POSTED";
            if (wasPosted) {
                // Snapshot the pre-edit spine to AuditLog (matches the inventory edit).
                await tx.auditLog.create({
                    data: auditSnapshot({
                        entityType:  "GL_VOUCHER",
                        subtype:     existing.type,
                        originalId:  existing.id,
                        originalRef: (existing.voucherNo ?? formatUvNo(existing.id)),
                        reason:      `Edit (in-place) of ${(existing.voucherNo ?? formatUvNo(existing.id))}`,
                        snapshot:    { ...existing },
                        actorId:     user!.id,
                    }),
                });
                // Reverse the old GL impact.
                for (const line of existing.lines) {
                    const nb = nbById.get(line.accountId);
                    if (!nb) continue;
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: balanceDelta(nb, line.type, toNumber(line.amount)) } } });
                }
            }

            // Rewrite the spine's GL lines.
            await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: voucherId } });
            await tx.voucherGlLine.createMany({
                data: body.lines.map((l, idx) => ({
                    universalVoucherId: voucherId,
                    accountId:   l.accountId,
                    type:        l.type,
                    amount:      l.amount,
                    description: l.description ?? null,
                    seq:         idx,
                })),
            });

            if (wasPosted) {
                // Apply the new GL impact.
                for (const line of body.lines) {
                    const nb = nbById.get(line.accountId);
                    if (!nb) continue;
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { increment: balanceDelta(nb, line.type, line.amount) } } });
                }
            }

            // Update the spine header. denomJson: undefined = leave untouched;
            // null or an empty/zero-only payload clears the saved capture.
            const denom = body.denomJson === undefined ? undefined : parseDenomJson(body.denomJson);
            await tx.universalVoucher.update({
                where: { id: voucherId },
                data:  {
                    date:           new Date(body.date),
                    partyAccountId: body.partyAccountId ?? null,
                    ...(body.narration ? { narration: body.narration, description: body.narration } : {}),
                    ...(denom !== undefined ? { denomJson: denom ?? Prisma.DbNull } : {}),
                },
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        const updated = await prisma.universalVoucher.findUnique({ where: { id: voucherId }, include: { lines: true } });
        return NextResponse.json(updated ? await enrichVoucher(updated) : null);
    } catch (e) {
        return handleApiError(e, "Failed to update voucher");
    }
}
