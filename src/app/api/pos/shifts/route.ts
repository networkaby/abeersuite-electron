// /api/pos/shifts — shift lifecycle endpoints (list, open).
//
// GET  — list shifts (filterable). Default scope: active branch (radius is
//        always branch). `branchId=all` is admin-only (admin:bypass).
// POST — open a new shift at a specific counter. Body: { counterId, vaultTopUpPaise, notes? }.
//        The counter's till account carries any existing balance (carry-over from
//        the previous close). Only the `vaultTopUpPaise` portion triggers a Contra
//        (Vault → Counter till). If 0, no Contra is posted.

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, requireWritableBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { auth } from "@/auth";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { tillBalancePaise } from "@/modules/pos/lib/shiftMath";
import { blockStartFor } from "@/shared/lib/counter/idRange";

const openSchema = z.object({
    counterId:       z.number().int().positive(),
    vaultTopUpPaise: z.number().int().min(0).default(0), // fresh cash drawn from vault
    notes:           z.string().trim().max(500).optional(),
    // This PC's identity — Electron's installation id when available, else the
    // local bridge's id. On first open the counter is bound to it; a later open
    // from a different PC is refused (device lock). Absent when neither Electron
    // nor the bridge is present — then the lock can't be enforced (open is free).
    deviceId:        z.string().trim().min(1).max(100).optional(),
    deviceLabel:     z.string().trim().max(100).optional(), // friendly name for the admin list
});

// ── GET /api/pos/shifts ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const session = await auth();
        const { searchParams } = new URL(req.url);
        const branchParam  = searchParams.get("branchId");
        const userIdParam  = searchParams.get("userId");
        const counterParam = searchParams.get("counterId");
        const statusParam  = searchParams.get("status") as "OPEN" | "AWAITING_HANDOVER" | "CLOSED" | null;
        const fromParam    = searchParams.get("from");
        const toParam      = searchParams.get("to");

        let branchFilter: { branchId?: string } = {};
        if (branchParam === "all") {
            // Cross-branch view is admin-only (branch is the only radius).
            if (!user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS)) {
                return NextResponse.json({ error: "Cross-branch view not permitted" }, { status: 403 });
            }
        } else if (branchParam) {
            branchFilter = { branchId: branchParam };
        } else {
            try { branchFilter = { branchId: resolveActiveBranchId(req, session) }; }
            catch (e) {
                if (e instanceof BranchAccessError) return branchAccessResponse(e);
                throw e;
            }
        }

        const rows = await prisma.posShift.findMany({
            where: {
                ...branchFilter,
                ...(statusParam  ? { status: statusParam } : {}),
                ...(userIdParam  ? { userId: Number(userIdParam) } : {}),
                ...(counterParam ? { counterId: Number(counterParam) } : {}),
                ...(fromParam || toParam ? {
                    openedAt: {
                        ...(fromParam ? { gte: new Date(fromParam) } : {}),
                        ...(toParam   ? { lte: (() => { const d = new Date(toParam); d.setHours(23, 59, 59, 999); return d; })() } : {}),
                    },
                } : {}),
            },
            orderBy: [{ openedAt: "desc" }],
            include: {
                user:    { select: { id: true, name: true, email: true } },
                branch:  { select: { id: true, name: true } },
                counter: { select: { id: true, name: true, tillAccount: { select: { id: true, name: true } } } },
                _count: { select: { drops: true } },
            },
        });

        // Phase 5 5E: opening/closing contras are spines now — batch-resolve by id.
        const contraIds = [...new Set(rows.flatMap((s) => [s.openingContraVoucherId, s.closingContraVoucherId]).filter((x): x is number => x != null))];
        const contras = contraIds.length === 0 ? [] : await prisma.universalVoucher.findMany({
            where: { id: { in: contraIds } }, select: { id: true, voucherNo: true },
        });
        const contraById = new Map(contras.map((c) => [c.id, { id: c.id, reference: c.voucherNo ?? formatUvNo(c.id) }]));   // 5D-7

        return NextResponse.json(rows.map((s) => ({
            ...s,
            openingContraVoucher: s.openingContraVoucherId != null ? (contraById.get(s.openingContraVoucherId) ?? null) : null,
            closingContraVoucher: s.closingContraVoucherId != null ? (contraById.get(s.closingContraVoucherId) ?? null) : null,
            openingFloatPaise:   s.openingFloatPaise.toString(),
            carryOverFloatPaise: s.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     s.vaultTopUpPaise.toString(),
            declaredCashPaise:   s.declaredCashPaise?.toString()  ?? null,
            expectedCashPaise:   s.expectedCashPaise?.toString()  ?? null,
            variancePaise:       s.variancePaise?.toString()      ?? null,
            carryOverNextPaise:  s.carryOverNextPaise?.toString() ?? null,
            toVaultPaise:        s.toVaultPaise?.toString()       ?? null,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch shifts");
    }
}

// ── POST /api/pos/shifts ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const session = await auth();
    const { data, error } = await validateRequest(req, openSchema);
    if (error) return error;
    const body = data;

    let branchId: string;
    try { branchId = requireWritableBranchId(req, session); }
    catch (e) {
        if (e instanceof BranchAccessError) return branchAccessResponse(e);
        throw e;
    }

    // Resolve the counter + verify it belongs to this branch.
    //
    // Authoritative, and it must actually BE authoritative — `prisma` is the replica
    // on a counter PC, and the replica lags live by up to a sync cycle. This row
    // carries the device lock checked just below, so reading it locally is exactly
    // wrong on the path that matters most: an admin releases a dead PC's counter and
    // sets a replacement up on it, and the replacement's own replica still shows the
    // old lock, so the open is refused and the device swap fails.
    const counter = await prismaAuthoritative.posCounter.findUnique({
        where:   { id: body.counterId },
        include: { tillAccount: { select: { id: true, name: true } } },
    });
    if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });
    if (counter.branchId !== branchId) {
        return NextResponse.json({ error: "Counter does not belong to your active branch" }, { status: 400 });
    }
    if (!counter.isActive) {
        return NextResponse.json({ error: "Counter is inactive" }, { status: 400 });
    }

    // Device lock — a counter remembers the first PC that opened it. Opening from
    // a different PC is refused until an admin (Admin → POS Counters) or that PC
    // (Settings → Thermal Printer → Forget) releases the lock. When the caller
    // sends no id at all (neither Electron nor the bridge present) the lock can't
    // be checked — open free. The desktop app's id and the web bridge's id are never
    // cross-matched: a counter bound under the other one is another PC's.
    if (counter.boundDeviceId && body.deviceId && counter.boundDeviceId !== body.deviceId) {
        return NextResponse.json(
            { error: "This counter is locked to another computer. Ask an admin to release it (Admin → POS Counters)." },
            { status: 409 },
        );
    }

    // Resolve the branch vault (needed only if vaultTopUpPaise > 0). Authoritative —
    // it names the account an opening Contra is posted to.
    const branch = await prismaAuthoritative.branch.findUnique({
        where:  { id: branchId },
        select: { id: true, name: true, vaultAccountId: true },
    });
    if (body.vaultTopUpPaise > 0 && !branch?.vaultAccountId) {
        return NextResponse.json(
            { error: `Branch ${branch?.name ?? branchId} has no Vault account configured.` },
            { status: 400 },
        );
    }

    // Check whether the counter already has an active shift. Authoritative — a shift
    // closed on another terminal seconds ago must not still look open here, and an
    // admin's force-close (see CounterReconciler) must be visible immediately so the
    // cashier is offered a FRESH shift rather than handed back a shift the DB closed.
    const existing = await prismaAuthoritative.posShift.findFirst({
        where:   { counterId: counter.id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
        include: {
            counter: { include: { tillAccount: { select: { id: true, name: true } } } },
            branch:  { select: { id: true, name: true } },
        },
    });
    if (existing) {
        // ── Same cashier returning (e.g. browser crashed / reopened) ─────────
        // Hand back the running shift instead of blocking. The cashier can
        // continue billing seamlessly from any browser.
        if (existing.userId === user!.id && existing.status === "OPEN") {
            return NextResponse.json({
                id:                  existing.id,
                status:              existing.status,
                openedAt:            existing.openedAt,
                notes:               existing.notes,
                resumed:             true,
                openingFloatPaise:   existing.openingFloatPaise.toString(),
                carryOverFloatPaise: existing.carryOverFloatPaise.toString(),
                vaultTopUpPaise:     existing.vaultTopUpPaise.toString(),
                declaredCashPaise:   null,
                expectedCashPaise:   null,
                variancePaise:       null,
                counter: {
                    id:   existing.counter.id,
                    name: existing.counter.name,
                    tillAccount: { id: existing.counter.tillAccount.id, name: existing.counter.tillAccount.name },
                },
                branch: { id: existing.branch.id, name: existing.branch.name },
            });  // 200 — not created, resumed
        }
        // ── Same cashier but shift is AWAITING_HANDOVER ───────────────────────
        if (existing.userId === user!.id) {
            return NextResponse.json(
                { error: "Your shift is awaiting handover. Cancel it first or let the next cashier accept.", shiftId: existing.id },
                { status: 409 },
            );
        }
        // ── Different cashier — hard block ────────────────────────────────────
        return NextResponse.json(
            { error: "This counter is already in use by another cashier.", shiftId: existing.id },
            { status: 409 },
        );
    }

    // The existing till balance is the carry-over from the last close — summed
    // from the till's own POSTED GL lines plus its master opening, never from the
    // cached `Account.balance` (see `tillBalancesPaise`). Authoritative, like the
    // counter row above: the opening float is what the whole shift reconciles
    // against, so a replica lagging by a sync cycle must not set it.
    const carryOverPaise  = await tillBalancePaise(prismaAuthoritative, counter.tillAccountId);
    const totalFloatPaise = carryOverPaise + BigInt(body.vaultTopUpPaise);

    try {
        const shift = await prisma.$transaction(async (tx) => {
            // Post opening Contra ONLY for the vault top-up portion.
            let openingContraId: number | null = null;
            if (body.vaultTopUpPaise > 0) {
                const rupees = body.vaultTopUpPaise / 100;
                const contra = await postContra(tx, {
                    branchId,
                    date:      requestBusinessDate(req),
                    narration: `Shift opening top-up — ${counter.name} @ ${branch!.name}`,
                    userId:    user!.id,
                    lines: [
                        { accountId: counter.tillAccountId,   type: "DEBIT",  amount: rupees, description: "Opening top-up (into counter till)" },
                        { accountId: branch!.vaultAccountId!, type: "CREDIT", amount: rupees, description: "Opening top-up (from vault)" },
                    ],
                });
                openingContraId = contra.voucherId;
            }

            // Calculate or retrieve idRangeStart for this counter if counterNumber is configured.
            let idRangeStart = counter.idRangeStart;
            if (!idRangeStart && counter.counterNumber) {
                try {
                    idRangeStart = blockStartFor(counter.counterNumber);
                } catch (err) {
                    console.warn("[ShiftOpen] Invalid counterNumber for id-range reservation:", err);
                }
            }

            // Stamp idRangeStart if newly computed. Shift open does NOT bind the counter
            // to this PC any more: binding happens in counter onboarding only
            // (/setup/counter → claim-number), which is online, verified against the
            // DB, and followed by a full replica fill. A shift opened on an unbound
            // counter used to bind it silently — a second onboarding path with none of
            // those guarantees. The lock CHECK above stays; only the write is gone.
            const needsRange = Boolean(idRangeStart && idRangeStart !== counter.idRangeStart);
            if (needsRange) {
                await tx.posCounter.update({
                    where: { id: counter.id },
                    data:  { idRangeStart },
                });
            }

            return tx.posShift.create({
                data: {
                    userId:                user!.id,
                    counterId:             counter.id,
                    branchId,
                    openedById:            user!.id,
                    openingFloatPaise:     totalFloatPaise,
                    carryOverFloatPaise:   carryOverPaise,
                    vaultTopUpPaise:       BigInt(body.vaultTopUpPaise),
                    openingContraVoucherId: openingContraId,
                    notes:                 body.notes ?? null,
                },
                include: {
                    counter: { include: { tillAccount: { select: { id: true, name: true } } } },
                    branch:  { select: { id: true, name: true } },
                },
            });
        });

        // Explicit fields only — never spread the Prisma object; BigInt fields
        // (e.g. counter.defaultFloatPaise) would cause JSON.stringify to throw,
        // which would return a 500 while the shift is already committed in the DB.
        return NextResponse.json({
            id:                  shift.id,
            status:              shift.status,
            openedAt:            shift.openedAt,
            notes:               shift.notes,
            openingFloatPaise:   shift.openingFloatPaise.toString(),
            carryOverFloatPaise: shift.carryOverFloatPaise.toString(),
            vaultTopUpPaise:     shift.vaultTopUpPaise.toString(),
            declaredCashPaise:   null,
            expectedCashPaise:   null,
            variancePaise:       null,
            idRangeStart:        shift.counter.idRangeStart ?? null,
            counter: {
                id:            shift.counter.id,
                name:          shift.counter.name,
                counterNumber: shift.counter.counterNumber ?? null,
                tillAccount: {
                    id:   shift.counter.tillAccount.id,
                    name: shift.counter.tillAccount.name,
                },
            },
            branch: {
                id:   shift.branch.id,
                name: shift.branch.name,
            },
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to open shift");
    }
}
