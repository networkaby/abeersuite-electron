import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { STAFF_USER_SELECT, excludingSuperAdmin, shapeStaffUser } from "@/shared/lib/users/staffSelect";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { dateOnlyFromIso } from "@/modules/hr/lib/staffProfileServer";
import type { StaffRow } from "@/modules/hr/lib/staffTypes";

// GET /api/hr/staff?includeLeft=1 — the Staff Directory.
//
// Every User is a staff member; the HR profile rides along (null until HR has
// saved something) with the salary revision in force today. Reads are
// default-open like every other list. Left staff are dropped unless asked for.

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const includeLeft = searchParams.get("includeLeft") === "1";
        const todayIso = businessTodayIso();

        const users = await prisma.user.findMany({
            where: excludingSuperAdmin(),
            orderBy: { name: "asc" },
            select: {
                ...STAFF_USER_SELECT,
                staffProfile: {
                    select: {
                        ...STAFF_USER_SELECT.staffProfile.select,
                        salaries: {
                            where: { effectiveFrom: { lte: dateOnlyFromIso(todayIso) } },
                            orderBy: { effectiveFrom: "desc" },
                            take: 1,
                            select: { effectiveFrom: true, grossPaise: true, netPaise: true },
                        },
                    },
                },
            },
        });

        const rows: StaffRow[] = users
            .filter((u) => includeLeft || !staffHasLeft(u.staffProfile, todayIso))
            .map((u) => {
                const shaped = shapeStaffUser(u);
                const p = u.staffProfile;
                const current = p?.salaries[0] ?? null;
                return {
                    id: shaped.id,
                    name: shaped.name,
                    email: shaped.email,
                    title: shaped.title,
                    role: shaped.role,
                    avatarUrl: shaped.avatarUrl,
                    phone: shaped.phone,
                    createdAt: shaped.createdAt.toISOString(),
                    positions: shaped.positions,
                    branches: shaped.branches,
                    departments: shaped.departments,
                    staffProfile: p
                        ? {
                            staffCode: p.staffCode,
                            joinedOn: p.joinedOn ? toDateOnlyUtc(p.joinedOn) : null,
                            leftOn: p.leftOn ? toDateOnlyUtc(p.leftOn) : null,
                            employmentType: p.employmentType,
                            ledgerAccountId: p.ledgerAccountId,
                        }
                        : null,
                    currentSalary: current
                        ? { effectiveFrom: toDateOnlyUtc(current.effectiveFrom), grossPaise: current.grossPaise, netPaise: current.netPaise }
                        : null,
                };
            });

        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch staff");
    }
}
