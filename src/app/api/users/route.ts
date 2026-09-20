import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { STAFF_USER_SELECT, shapeStaffUser } from "@/shared/lib/users/staffSelect";

// Identity-only user creation. Role, branch, department, and reporting line
// are NOT accepted — they all flow from Position appointments on
// /office/admin/positions. New users have `role = null` (zero permissions).
// Per-user permission overrides (punishment/reward) are managed via the
// PermissionsModal on the users page.
const createUserSchema = z.object({
    name:     z.string().trim().min(1, "Name is required"),
    email:    z.string().trim().email("Valid email is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

// The row shape and the flattening live in src/shared/lib/users/staffSelect.ts,
// shared with /api/hr/staff so both lists describe a person the same way.

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: STAFF_USER_SELECT,
        });
        return NextResponse.json(users.map(shapeStaffUser));
    } catch (e) {
        return handleApiError(e, "Failed to fetch users");
    }
}

export async function POST(req: Request) {
    const { user: caller, response } = await requireAnyPermission(PERMISSIONS.USERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createUserSchema);
        if (error) return error;
        const body = data;

        if (!isStaffEmailDomainAllowed(body.email)) {
            return NextResponse.json(
                { error: "Email domain is not allowed for staff accounts" },
                { status: 400 }
            );
        }

        // Silence unused caller (rank guard isn't needed at creation —
        // the new user has no role and no permissions until appointed).
        void caller;

        const password = await bcrypt.hash(body.password, 10);
        const user = await prisma.user.create({
            data: {
                name:     body.name,
                email:    body.email,
                password,
                role:     null,
                scope:    "OWN",
            },
            select: STAFF_USER_SELECT,
        });

        return NextResponse.json(shapeStaffUser(user));
    } catch (e) {
        return handleApiError(e, "Failed to create user");
    }
}
