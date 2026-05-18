import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Identity-only user creation. Role / branches / departments are NOT accepted
// here — they're granted by appointing the user to a Post on
// /office/admin/posts. New users land in the R-GUEST role (zero permissions).
const createUserSchema = z.object({
    name:      z.string().trim().min(1, "Name is required"),
    email:     z.string().trim().email("Valid email is required"),
    password:  z.string().min(6, "Password must be at least 6 characters"),
    title:     z.string().trim().optional().nullable(),
    managerId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
});

const GUEST_ROLE_ID = "R-GUEST";

const USER_SELECT = {
    id:          true,
    name:        true,
    email:       true,
    role:        true,
    title:       true,
    scope:       true,
    createdAt:   true,
    managerId:   true,
    avatarUrl:   true,
    userRole:    { select: { id: true, label: true, color: true, rank: true } },
    manager:     { select: { id: true, name: true } },
    departments: { select: { id: true, name: true } },
    branches:    { select: { id: true, name: true } },
} as const;

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: USER_SELECT,
        });
        return NextResponse.json(users);
    } catch (e) {
        return handleApiError(e, "Failed to fetch users");
    }
}

export async function POST(req: Request) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.USERS_MANAGE);
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

        // Always create with the Guest role. Operational authority is granted
        // by appointing the user to a Post — see /office/admin/posts.
        const guestRole = await prisma.role.findUnique({
            where: { id: GUEST_ROLE_ID },
            select: { id: true },
        });
        if (!guestRole) {
            return NextResponse.json(
                { error: "Guest role missing — run bootstrap-seed." },
                { status: 500 }
            );
        }

        // Silence unused caller (rank guard is no longer needed at creation
        // because the Guest role has rank 0 and no permissions).
        void caller;

        const password = await bcrypt.hash(body.password, 10);
        const user = await prisma.user.create({
            data: {
                name:     body.name,
                email:    body.email,
                password,
                role:     GUEST_ROLE_ID,
                title:    body.title ?? null,
                scope:    "OWN",
                ...(body.managerId ? { managerId: Number(body.managerId) } : {}),
            },
            select: USER_SELECT,
        });

        return NextResponse.json(user);
    } catch (e) {
        return handleApiError(e, "Failed to create user");
    }
}
