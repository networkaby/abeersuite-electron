// PATCH  /api/pos/counters/[id]  — rename / toggle active / manage payment accounts
// DELETE /api/pos/counters/[id]  — only allowed when no shifts have ever used this counter

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError, pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { tillBalancePaise } from "@/modules/pos/lib/shiftMath";
import { normalizeExtensions } from "@/shared/lib/counter/idRange";
import { prismaUniqueError } from "@/shared/lib/api/prismaUniqueError";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { revalidateTag } from "next/cache";
import { COUNTER_EXTENSIONS_TAG } from "@/shared/lib/calls/followUp";

// One payment account on the counter. `id` present = update that row; absent =
// create. `accountId` is the bank/cash-style ledger debited when collected here.
// `vpa` is optional (UPI/gateway pay-to id); validated only when supplied.
const paymentAccountSchema = z.object({
    id: z.number().int().positive().optional(),
    channel: z.enum(["UPI", "CARD", "CHEQUE", "WALLET", "BANK_TRANSFER", "GATEWAY"]),
    label: z.string().trim().min(1).max(40),
    accountId: z.number().int().positive(),
    vpa: z.union([z.string().trim().max(60), z.null()]).optional()
        .transform((v) => (typeof v === "string" && v.trim().length ? v.trim() : null))
        .refine((v) => v == null || /^[\w.\-]+@[\w.\-]+$/.test(v), "Enter a valid UPI ID like name@bank"),
    // Optional link to a configured gateway from the Settings catalog (PaymentGateway).
    // Only meaningful for the GATEWAY channel; validated below. null = no gateway.
    gatewayId: z.union([z.number().int().positive(), z.null()]).optional(),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    defaultVisible: z.boolean().optional(),
});

const updateSchema = z.object({
    name: z.string().trim().min(1).max(60).optional(),
    counterNumber: z.coerce.number().int().positive("Counter number must be greater than 0").optional(),
    isActive: z.boolean().optional(),
    // EPBX/intercom extension(s) of the phone(s) at this counter — one number, or
    // several as a comma-separated list ("201,202"). Empty string/null clears it; an
    // absent field is left untouched (.optional() outermost so the transform never
    // runs on undefined and accidentally nulls it on unrelated PATCHes).
    epbxExtension: z.union([z.string().trim().max(200), z.null()])
        .transform((v, ctx) => {
            if (typeof v !== "string" || !v.trim().length) return null;
            const normalized = normalizeExtensions(v);
            if (normalized === null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter whole numbers, separated by commas" });
                return z.NEVER;
            }
            return normalized;
        })
        .optional(),
    // Full replace of the counter's payment-account list when supplied.
    paymentAccounts: z.array(paymentAccountSchema).max(20).optional(),
    // Allowed POS-expenditure ledgers (EXPENSE group). Empty = no restriction.
    allowedExpenseAccountIds: z.array(z.number().int().positive())
        .max(50)
        .transform((arr) => [...new Set(arr)])
        .optional(),
    // Release the device lock — the next PC to open a shift here rebinds it.
    releaseLock: z.boolean().optional(),
});

const counterInclude = {
    tillAccount: { select: { id: true, name: true } },
    branch: { select: { id: true, name: true } },
    paymentAccounts: {
        orderBy: { sortOrder: "asc" as const },
        select: {
            id: true, channel: true, label: true, accountId: true, vpa: true,
            sortOrder: true, isActive: true, defaultVisible: true, gatewayId: true,
            account: { select: { id: true, name: true } },
            gateway: { select: { id: true, displayName: true, provider: true } },
        },
    },
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.POS_COUNTERS_EDIT);
    if (response) return response;

    try {
        const { id: idStr } = await params;
        const id = Number(idStr);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });

        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;

        // Authoritative — every check below it gates a write to this same row.
        const existing = await prismaAuthoritative.posCounter.findUnique({ where: { id }, include: { tillAccount: true, branch: { select: { name: true } } } });
        if (!existing) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        // ── Each payment account's ledger must be a real ASSET account, so we never
        // route a receipt to, say, a Revenue ledger. ──────────────────────────────
        if (data.paymentAccounts && data.paymentAccounts.length > 0) {
            const ledgerIds = [...new Set(data.paymentAccounts.map((p) => p.accountId))];
            const accounts = await prisma.account.findMany({
                where: { id: { in: ledgerIds } },
                select: { id: true, group: { select: { type: true } } },
            });
            const byId = new Map(accounts.map((a) => [a.id, a]));
            for (const aid of ledgerIds) {
                const a = byId.get(aid);
                if (!a) return NextResponse.json({ error: `Account ${aid} not found` }, { status: 400 });
                if (a.group?.type !== "ASSET") return NextResponse.json({ error: `Account ${aid} is not an ASSET ledger (cash/bank-style) — cannot route payment receipts here.` }, { status: 400 });
            }

            // Any picked gateway must exist, be active, and be enabled for the counter.
            const gatewayIds = [...new Set(
                data.paymentAccounts.map((p) => p.gatewayId).filter((g): g is number => typeof g === "number"),
            )];
            if (gatewayIds.length > 0) {
                const gateways = await prisma.paymentGateway.findMany({
                    where: { id: { in: gatewayIds } },
                    select: { id: true, isActive: true, enabledForCounter: true, displayName: true },
                });
                const gById = new Map(gateways.map((g) => [g.id, g]));
                for (const gid of gatewayIds) {
                    const g = gById.get(gid);
                    if (!g) return NextResponse.json({ error: `Payment gateway ${gid} not found` }, { status: 400 });
                    if (!g.isActive || !g.enabledForCounter) return NextResponse.json({ error: `"${g.displayName}" is not available for counters. Enable it under Settings → Payment Methods.` }, { status: 400 });
                }
            }
        }

        // Validate allowed-expenditure ledgers are real EXPENSE-group accounts.
        if (data.allowedExpenseAccountIds && data.allowedExpenseAccountIds.length > 0) {
            const accs = await prisma.account.findMany({
                where: { id: { in: data.allowedExpenseAccountIds } },
                select: { id: true, name: true, group: { select: { type: true } } },
            });
            const byId = new Map(accs.map((a) => [a.id, a]));
            for (const aid of data.allowedExpenseAccountIds) {
                const a = byId.get(aid);
                if (!a) return NextResponse.json({ error: `Account ${aid} not found` }, { status: 400 });
                if (a.group?.type !== "EXPENSE") return NextResponse.json({ error: `"${a.name}" is not an expense ledger.` }, { status: 400 });
            }
        }

        // An extension is NOT unique across counters, on purpose. One EPBX extension
        // line is often wired to several phones in parallel, so the same extension
        // genuinely sits at more than one counter — a call on it rings at each of them,
        // and the follow-up popup is expected to appear at each of them too. Nothing is
        // keyed on this field (voucher prefix and offline id-range come from
        // counterNumber/branch), so a shared value costs nothing elsewhere.

        // If renaming, ensure no other counter in the same branch has that name.
        if (data.name && data.name !== existing.name) {
            const dup = await prismaAuthoritative.posCounter.findFirst({ where: { branchId: existing.branchId, name: data.name, NOT: { id } } });
            if (dup) return NextResponse.json({ error: `Counter "${data.name}" already exists in this branch` }, { status: 409 });
        }

        // counterNumber is GLOBALLY unique (not just per-branch): the offline id-range
        // block a counter PC mints its ids in is derived from it (blockStartFor in
        // shared/lib/counter/idRange.ts), and the per-counter voucher-number series is
        // keyed by it. Two counters on one number would share both.
        if (data.counterNumber && data.counterNumber !== existing.counterNumber) {
            // Same rule as POST: number 1 is the office's voucher-series slot.
            if (data.counterNumber === 1) return NextResponse.json({ error: "Counter number 1 is reserved for the office. Use 2 or higher." }, { status: 422 });
            const dup = await prisma.posCounter.findFirst({ where: { counterNumber: data.counterNumber, NOT: { id } }, select: { name: true, branch: { select: { name: true } } } });
            if (dup) return NextResponse.json({ error: `Counter number ${data.counterNumber} is already used by "${dup.name}" in ${dup.branch.name}` }, { status: 409 });
            // A PC set up on this counter has its sequences parked in the block of the
            // OLD number, and its own `_id_ranges` still names that block. Clearing
            // idRangeStart below never reaches the PC: it keeps minting in the old lane
            // until it next runs counter setup, and meanwhile the old number is free —
            // a new counter given it would mint in the same lane, and the push would
            // overwrite one machine's rows with the other's. So a bound counter is only
            // renumbered together with a release of its device lock: the released PC is
            // sent back to /setup/counter, which claims the new range and moves the
            // sequences into it (`_apply_id_range`).
            if (existing.boundDeviceId && !data.releaseLock) {
                return NextResponse.json(
                    { error: `"${existing.name}" is set up on a PC (${existing.boundDeviceLabel ?? existing.boundDeviceId}). Release its device lock first, then change the number — the PC will run counter setup again and take the new id range.`, code: "BOUND" },
                    { status: 409 },
                );
            }
        }

        // Block deactivation while a shift is OPEN or AWAITING_HANDOVER.
        if (data.isActive === false) {
            const active = await prismaAuthoritative.posShift.findFirst({
                where: { counterId: id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                select: { id: true },
            });
            if (active) return NextResponse.json({ error: "Cannot deactivate counter with an active shift" }, { status: 400 });
        }

        // ── The release, on its own, authoritative ───────────────────────────────
        // Not part of the transaction below, and not through `prisma`. On a counter PC
        // `prisma` is the replica: a release written there goes up through the outbox,
        // and the push sees the server still naming a device and RESTORES the binding
        // (reconcileCounterBinding in sync/push.ts). The admin would see "released"
        // while the counter kept billing, until the next pull put the binding back on
        // screen too. Same rule, and the same reasoning, as release-mine/route.ts and
        // claim-number/route.ts: a device lock is decided in the DB or not at all. If
        // Supabase is unreachable the caller gets the error rather than a local write
        // that will be reverted.
        //
        // Release clears the DEVICE BINDING only. counterNumber is permanent counter
        // config, set at creation and NOT NULL — a counter always has one, whichever PC
        // happens to be sitting at it. idRangeStart is derived from that number, so it
        // stays correct too; only a counterNumber CHANGE invalidates it, which the
        // transaction below handles.
        //
        // `releasedAt` is what separates "released" from "never claimed" — both leave
        // boundDeviceId null, and without the stamp a counter that was offline when it
        // was released wakes up, pushes its queued row and quietly takes itself back.
        const released = data.releaseLock
            ? await prismaAuthoritative.posCounter.update({
                where:  { id },
                data:   { boundDeviceId: null, boundDeviceLabel: null, boundAt: null, releasedAt: new Date() },
                select: { boundDeviceId: true, boundDeviceLabel: true, boundAt: true },
            })
            : null;

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
                        channel: p.channel,
                        label: p.label,
                        accountId: p.accountId,
                        vpa: p.vpa,
                        // Only the GATEWAY channel carries a gateway link; clear it otherwise.
                        gatewayId: p.channel === "GATEWAY" ? (p.gatewayId ?? null) : null,
                        sortOrder: p.sortOrder ?? i,
                        isActive: p.isActive ?? true,
                        defaultVisible: p.defaultVisible ?? false,
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
                    ...pickDefined({
                        name: data.name,
                        counterNumber: data.counterNumber,
                        isActive: data.isActive,
                        epbxExtension: data.epbxExtension,
                        allowedExpenseAccountIds: data.allowedExpenseAccountIds,
                    }),
                    // If counterNumber changed, clear idRangeStart so it will be recalculated
                    // on next offline setup. Mismatched counterNumber/idRangeStart would reserve
                    // the wrong id-range block for offline writes.
                    ...(data.counterNumber && data.counterNumber !== existing.counterNumber ? { idRangeStart: null } : {}),
                    // The release itself is NOT here — it is applied authoritatively
                    // above, before this transaction. See the comment there.
                },
                include: counterInclude,
            });
        });

        // A release must reach every other machine at once — the counter that just lost
        // its binding above all. It cannot ride the browser's own publisher: on a
        // counter PC that stays silent under WRITE_MODE=local and leaves announcing to
        // the outbox flusher, and the authoritative write above never enters the
        // outbox. So say it from here, the way /api/calls does. Best-effort.
        if (released) await publishChangeServer(["settings"]);
        // The call popup's "which extensions belong to a counter" list.
        if (data.epbxExtension !== undefined || data.isActive !== undefined) revalidateTag(COUNTER_EXTENSIONS_TAG, { expire: 0 });

        return NextResponse.json({
            id: updated.id,
            counterNumber: updated.counterNumber,
            name: updated.name,
            branchId: updated.branchId,
            branch: updated.branch,
            isActive: updated.isActive,
            epbxExtension: updated.epbxExtension,
            tillAccount: {
                id: updated.tillAccount.id,
                name: updated.tillAccount.name,
                balance: String(Number(await tillBalancePaise(prisma, updated.tillAccountId)) / 100),
            },
            paymentAccounts: updated.paymentAccounts,
            allowedExpenseAccountIds: updated.allowedExpenseAccountIds,
            // The DB's answer, not the replica's: on a counter PC `updated` came from
            // the local copy, which does not carry the release applied above.
            boundDeviceId: (released ?? updated).boundDeviceId,
            boundDeviceLabel: (released ?? updated).boundDeviceLabel,
            boundAt: (released ?? updated).boundAt,
        });
    } catch (e) {
        const conflict = prismaUniqueError(e, {});
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update counter");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.POS_COUNTERS_DELETE);
    if (response) return response;

    try {
        const { id: idStr } = await params;
        const id = Number(idStr);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });

        const counter = await prisma.posCounter.findUnique({
            where: { id },
            include: { _count: { select: { shifts: true } } },
        });
        if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        if (counter._count.shifts > 0) {
            return NextResponse.json(
                { error: `Cannot delete: this counter has ${counter._count.shifts} shift(s) in history. Deactivate instead.` },
                { status: 400 },
            );
        }
        // Ledger truth — a stale cache must not let a funded till be deleted.
        if ((await tillBalancePaise(prisma, counter.tillAccountId)) !== BigInt(0)) {
            return NextResponse.json(
                { error: "Cannot delete: till account has a non-zero balance. Sweep to vault first." },
                { status: 400 },
            );
        }

        // Payment-account rows cascade-delete with the counter (onDelete: Cascade).
        await prisma.posCounter.delete({ where: { id } });
        revalidateTag(COUNTER_EXTENSIONS_TAG, { expire: 0 });
        // We intentionally KEEP the till GL account (audit trail) — just unlinked from the counter now.
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete counter");
    }
}
