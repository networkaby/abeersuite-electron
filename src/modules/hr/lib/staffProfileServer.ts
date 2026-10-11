import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { createStaffLedger } from "./staffLedger";
import { parseSalaryLines } from "./salaryLines";
import type { StaffProfileDto, StaffSalaryDto } from "./staffTypes";

/** Everything the profile workspace reads off a StaffProfile row. */
export const STAFF_PROFILE_INCLUDE = {
    ledgerAccount:  { select: { id: true, name: true, balance: true, normalBalance: true } },
    salaries:       { orderBy: { effectiveFrom: "desc" as const } },
} satisfies Prisma.StaffProfileInclude;

export type StaffProfileWithRels = Prisma.StaffProfileGetPayload<{ include: typeof STAFF_PROFILE_INCLUDE }>;

export const STAFF_CODE_BASE = 786;
export const STAFF_CODE_PREFIX = "EMP-";

/**
 * Generate the next sequential Staff ID.
 * Starts from EMP-786. If existing EMP-xxx codes exist, increments the maximum.
 */
export async function generateNextStaffCode(
    tx: Prisma.TransactionClient | typeof prisma,
): Promise<string> {
    const profiles = await tx.staffProfile.findMany({
        where: { staffCode: { not: null } },
        select: { staffCode: true },
    });
    let max = STAFF_CODE_BASE - 1;
    for (const p of profiles) {
        if (!p.staffCode) continue;
        const match = p.staffCode.match(/^EMP-(\d+)$/i);
        if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > max) max = num;
        }
    }
    return `${STAFF_CODE_PREFIX}${max + 1}`;
}

/**
 * The profile row for a user, created bare if HR has never saved one — with its
 * ledger, because a profile without a ledger has nowhere for salary to go.
 * A ledger deleted from the chart (the FK is SET NULL) is made again here.
 */
export async function ensureStaffProfile(
    tx: Prisma.TransactionClient,
    user: { id: number; name: string },
): Promise<{ userId: number; ledgerAccountId: number | null; leftOn: Date | null; staffCode: string | null }> {
    const existing = await tx.staffProfile.findUnique({
        where: { userId: user.id },
        select: { userId: true, ledgerAccountId: true, leftOn: true, staffCode: true },
    });
    if (existing?.ledgerAccountId) {
        if (!existing.staffCode) {
            const nextCode = await generateNextStaffCode(tx);
            await tx.staffProfile.update({ where: { userId: user.id }, data: { staffCode: nextCode } });
            return { ...existing, staffCode: nextCode };
        }
        return existing;
    }

    const ledgerAccountId = await createStaffLedger(tx, user);
    const staffCode = existing?.staffCode ?? (await generateNextStaffCode(tx));
    if (existing) {
        await tx.staffProfile.update({ where: { userId: user.id }, data: { ledgerAccountId, staffCode } });
        return { ...existing, ledgerAccountId, staffCode };
    }
    const created = await tx.staffProfile.create({
        data: { userId: user.id, ledgerAccountId, staffCode },
        select: { userId: true, ledgerAccountId: true, leftOn: true, staffCode: true },
    });
    return created;
}

const iso = (d: Date | null | undefined): string | null => (d ? toDateOnlyUtc(d) : null);

export function toStaffProfileDto(p: StaffProfileWithRels): StaffProfileDto {
    return {
        staffCode: p.staffCode,
        joinedOn: iso(p.joinedOn),
        leftOn: iso(p.leftOn),
        leftReason: p.leftReason,
        employmentType: p.employmentType,
        weeklyOff: p.weeklyOff,
        dutyMinutes: p.dutyMinutes,
        dutyStart: p.dutyStart,
        dutyEnd: p.dutyEnd,
        idleLimitMinutes: p.idleLimitMinutes,
        fatherName: p.fatherName,
        address: p.address,
        bloodGroup: p.bloodGroup,
        emergencyName: p.emergencyName,
        emergencyPhone: p.emergencyPhone,
        aadhaarLast4: p.aadhaarLast4,
        panNumber: p.panNumber,
        uanNumber: p.uanNumber,
        esiNumber: p.esiNumber,
        bankJson: p.bankJson,
        notes: p.notes,
        ledgerAccountId: p.ledgerAccountId,
    };
}

export function toStaffSalaryDto(s: StaffProfileWithRels["salaries"][number]): StaffSalaryDto {
    return {
        id: s.id,
        effectiveFrom: toDateOnlyUtc(s.effectiveFrom),
        payDays: s.payDays,
        lines: parseSalaryLines(s.linesJson),
        grossPaise: s.grossPaise,
        netPaise: s.netPaise,
        note: s.note,
        createdAt: s.createdAt.toISOString(),
    };
}

/** A DATE column wants UTC midnight of the calendar day — never local midnight,
 *  which in IST is the previous evening in UTC and lands on the day before. */
export function dateOnlyFromIso(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
}
