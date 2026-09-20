import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, pickDefined, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { staffProfilePatchSchema, STAFF_JOB_KEYS } from "@/shared/lib/schemas/hrSchema";
import { resolvePartyBank } from "@/shared/lib/schemas/partyBankSchema";
import { STAFF_USER_SELECT, shapeStaffUser } from "@/shared/lib/users/staffSelect";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { moneyNumber } from "@/shared/lib/format/moneyInr";
import {
    STAFF_PROFILE_INCLUDE, ensureStaffProfile, dateOnlyFromIso,
    toStaffProfileDto, toStaffSalaryDto, type StaffProfileWithRels,
} from "@/modules/hr/lib/staffProfileServer";
import type { StaffDetail } from "@/modules/hr/lib/staffTypes";

// /api/hr/staff/[userId] — one staff member's HR record.
//
//   GET   — the profile workspace's payload. Default-open like every read.
//   PATCH — partial update. HR (hr:staff:edit) may change anything; a person may
//           change the PERSONAL fields of their own record (the same self rule as
//           PUT /api/users/[id]). The first save creates the profile together
//           with the person's own "Salary Payable" ledger. Setting `leftOn` to
//           today or earlier vacates their seats and signs out every session —
//           from that day the sign-in paths refuse them (staffHasLeft).

const DETAIL_SELECT = { ...STAFF_USER_SELECT, staffProfile: { include: STAFF_PROFILE_INCLUDE } } as const;

function parseUserId(raw: string): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function toDetail(user: { staffProfile: StaffProfileWithRels | null } & Parameters<typeof shapeStaffUser>[0]): StaffDetail {
    const shaped = shapeStaffUser(user);
    const p = user.staffProfile;
    return {
        user: {
            id: shaped.id, name: shaped.name, email: shaped.email, title: shaped.title,
            role: shaped.role, avatarUrl: shaped.avatarUrl, phone: shaped.phone,
            positions: shaped.positions,
            scope: shaped.scope, managerId: shaped.managerId,
            manager: shaped.manager, userRole: shaped.userRole,
        },
        profile: p ? toStaffProfileDto(p) : null,
        salaries: p ? p.salaries.map(toStaffSalaryDto) : [],
        ledger: p?.ledgerAccount
            ? { id: p.ledgerAccount.id, name: p.ledgerAccount.name, balance: moneyNumber(p.ledgerAccount.balance), normalBalance: p.ledgerAccount.normalBalance }
            : null,
        expenseAccount: p?.expenseAccount ?? null,
    };
}

export async function GET(_: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const userId = parseUserId((await params).userId);
        if (userId == null) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
        const user = await prisma.user.findUnique({ where: { id: userId }, select: DETAIL_SELECT });
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
        return NextResponse.json(toDetail(user));
    } catch (e) {
        return handleApiError(e, "Failed to fetch the staff record");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;

    const userId = parseUserId((await params).userId);
    if (userId == null) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const { data: body, error } = await validateRequest(req, staffProfilePatchSchema);
    if (error) return error;

    // Who may change what. HR changes anything; anyone may keep their own
    // personal / bank details current, never the job side.
    const isHr = hasPermissionWithScope(caller.permissions, PERMISSIONS.HR_STAFF_EDIT);
    if (!isHr) {
        const isSelf = caller.id === userId;
        const touchesJob = Object.keys(body).some((k) => (STAFF_JOB_KEYS as readonly string[]).includes(k));
        if (!isSelf || touchesJob) {
            return NextResponse.json({ error: "Only HR can change these details" }, { status: 403 });
        }
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

        // The expense ledger must be one — a salary posted to a bank would be silent nonsense.
        if (body.expenseAccountId != null) {
            const acc = await prisma.account.findUnique({
                where: { id: body.expenseAccountId },
                select: { group: { select: { type: true } } },
            });
            if (!acc || acc.group?.type !== "EXPENSE") {
                return NextResponse.json({ error: "Pick an expense ledger for the salary" }, { status: 400 });
            }
        }

        let bankJson: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
        if (body.bankJson !== undefined) {
            const r = resolvePartyBank(body.bankJson);
            if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
            bankJson = r.value ?? Prisma.DbNull;
        }

        const optDate = (v: string | null | undefined) => (v === undefined ? undefined : v ? dateOnlyFromIso(v) : null);
        const data = pickDefined({
            staffCode:        body.staffCode === undefined ? undefined : (body.staffCode?.trim() || null),
            joinedOn:         optDate(body.joinedOn),
            leftOn:           optDate(body.leftOn),
            leftReason:       body.leftReason,
            employmentType:   body.employmentType,
            weeklyOff:        body.weeklyOff ? [...new Set(body.weeklyOff)].sort((a, b) => a - b) : undefined,
            expenseAccountId: body.expenseAccountId,
            fatherName:       body.fatherName,
            address:          body.address,
            bloodGroup:       body.bloodGroup,
            emergencyName:    body.emergencyName,
            emergencyPhone:   body.emergencyPhone,
            aadhaarLast4:     body.aadhaarLast4,
            panNumber:        body.panNumber,
            uanNumber:        body.uanNumber,
            esiNumber:        body.esiNumber,
            notes:            body.notes,
            bankJson,
        });

        const leavingNow = body.leftOn != null && staffHasLeft({ leftOn: body.leftOn });

        const result = await prisma.$transaction(async (tx) => {
            const before = await ensureStaffProfile(tx, user);
            const wasLeft = staffHasLeft(before);
            const profile = await tx.staffProfile.update({
                where: { userId },
                data,
                include: STAFF_PROFILE_INCLUDE,
            });
            // Leaving: the seats go, so nothing keeps resolving work to this
            // person. Only when the date has come — a notice period set for next
            // month leaves the seats alone until then.
            let vacatedSeats = 0;
            if (leavingNow && !wasLeft) {
                vacatedSeats = (await tx.userPosition.deleteMany({ where: { userId } })).count;
            }
            return { profile, vacatedSeats, signOut: leavingNow && !wasLeft };
        });

        if (result.signOut) await revokeUserSessions(userId);

        const fresh = await prisma.user.findUnique({ where: { id: userId }, select: DETAIL_SELECT });
        if (!fresh) return NextResponse.json({ error: "User not found" }, { status: 404 });
        return NextResponse.json({ ...toDetail(fresh), vacatedSeats: result.vacatedSeats });
    } catch (e) {
        const conflict = prismaUniqueError(e, { staffCode: "That staff ID is already used by someone else" });
        if (conflict) return conflict;
        return handleApiError(e, "Failed to save the staff record");
    }
}
