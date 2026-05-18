import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Identity-only user creation. Role, branch, department, and reporting line
// are NOT accepted — they all flow from Post appointments on
// /office/admin/posts. New users have `role = null` (zero permissions).
// Per-user permission overrides (punishment/reward) are managed via the
// PermissionsModal on the users page.
const createUserSchema = z.object({
    name:     z.string().trim().min(1, "Name is required"),
    email:    z.string().trim().email("Valid email is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

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
    posts: {
        select: {
            post: {
                select: {
                    id:           true,
                    title:        true,
                    branch:       { select: { id: true, name: true } },
                    department:   { select: { id: true, name: true } },
                    roleTemplate: { select: { id: true, label: true, color: true } },
                },
            },
        },
    },
} as const;

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: USER_SELECT,
        });
        // Flatten the UserPost junction so the client gets `positions: [...]`
        // directly (cleaner than `posts: [{ post: {...} }]`).
        const shaped = users.map((u) => {
            const { posts, ...rest } = u;
            return {
                ...rest,
                positions: posts.map((up) => up.post),
            };
        });
        return NextResponse.json(shaped);
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
            select: USER_SELECT,
        });

        return NextResponse.json(user);
    } catch (e) {
        return handleApiError(e, "Failed to create user");
    }
}
