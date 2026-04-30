import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt" },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id          = user.id;
                token.role        = "role"        in user && typeof user.role === "string"    ? user.role        : undefined;
                token.roles       = "roles"       in user && Array.isArray(user.roles)        ? user.roles as string[]  : undefined;
                token.permissions = "permissions" in user && Array.isArray(user.permissions)  ? user.permissions as string[] : undefined;
                token.rank        = "rank"        in user && typeof user.rank === "number"    ? user.rank        : 0;
                token.scope       = "scope"       in user && typeof user.scope === "string"   ? user.scope       : "OWN";
                token.roleLabel    = "roleLabel" in user && typeof user.roleLabel === "string" ? user.roleLabel : undefined;
                token.roleColor    = "roleColor" in user && typeof user.roleColor === "string" ? user.roleColor : undefined;
                token.departmentIds = "departmentIds" in user && Array.isArray(user.departmentIds) ? user.departmentIds as string[] : [];
                token.branchIds    = "branchIds"    in user && Array.isArray(user.branchIds)    ? user.branchIds    as string[] : [];
                token.title       = "title"       in user ? user.title     as string | undefined : undefined;
                token.avatarUrl   = "avatarUrl"   in user ? user.avatarUrl as string | undefined : undefined;
            }
            return token;
        },
        async session({ session, token }) {
            if (token) {
                const sessionUser = session.user as typeof session.user & {
                    id: string; role: string; roles: string[]; permissions: string[];
                    rank: number; scope: string; roleLabel?: string; roleColor?: string;
                    departmentIds: string[]; branchIds: string[]; title?: string;
                    avatarUrl?: string;
                };
                sessionUser.id           = token.id as string;
                sessionUser.role         = typeof token.role === "string" ? token.role : "";
                sessionUser.roles        = Array.isArray(token.roles) ? token.roles as string[] : [sessionUser.role];
                sessionUser.permissions  = Array.isArray(token.permissions) ? token.permissions as string[] : [];
                sessionUser.rank         = typeof token.rank === "number" ? token.rank : 0;
                sessionUser.scope        = typeof token.scope === "string" ? token.scope : "OWN";
                sessionUser.roleLabel     = typeof token.roleLabel === "string" ? token.roleLabel : undefined;
                sessionUser.roleColor     = typeof token.roleColor === "string" ? token.roleColor : undefined;
                sessionUser.departmentIds = Array.isArray(token.departmentIds) ? token.departmentIds as string[] : [];
                sessionUser.branchIds     = Array.isArray(token.branchIds)    ? token.branchIds    as string[] : [];
                sessionUser.title        = typeof token.title     === "string" ? token.title     : undefined;
                sessionUser.avatarUrl    = typeof token.avatarUrl === "string" ? token.avatarUrl : undefined;
            }
            return session;
        },
    },
    providers: [
        Credentials({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email as string },
                    include: {
                        userRole: {
                            include: {
                                permissions: { include: { permission: true } },
                            },
                        },
                        departments: { select: { id: true } },
                        branches:    { select: { id: true } },
                    },
                });

                if (!user) return null;

                const isValid = await bcrypt.compare(
                    credentials.password as string,
                    user.password
                );

                if (!isValid) return null;

                const roles = [user.role];
                const primaryRole = user.role;

                // Role-granted permissions
                const effective = new Set<string>();
                for (const rp of user.userRole.permissions) {
                    const permId = rp.permission?.id;
                    if (permId) effective.add(permId);
                }

                // Per-user overrides (non-expired only)
                const now = new Date();
                const overrides = await prisma.userPermission.findMany({
                    where: {
                        userId: user.id,
                        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                    },
                    select: { permissionId: true, type: true },
                });
                for (const o of overrides) {
                    if (o.type === "GRANT") effective.add(o.permissionId);
                    else effective.delete(o.permissionId); // DENY wins
                }

                return {
                    id:            String(user.id),
                    name:          user.name,
                    email:         user.email,
                    role:          primaryRole,
                    roles,
                    permissions:   [...effective],
                    rank:          user.userRole.rank,
                    scope:         user.scope,
                    roleLabel:     user.userRole.label,
                    roleColor:     user.userRole.color,
                    departmentIds: user.departments.map(d => d.id),
                    branchIds:     user.branches.map(b => b.id),
                    title:         user.title    ?? undefined,
                    avatarUrl:     user.avatarUrl ?? undefined,
                };
            },
        }),
    ],
});
