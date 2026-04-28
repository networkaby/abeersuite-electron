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
                token.departmentId = "departmentId" in user ? user.departmentId as string | undefined : undefined;
                token.branchId    = "branchId"    in user ? user.branchId as string | undefined    : undefined;
                token.title       = "title"       in user ? user.title as string | undefined       : undefined;
            }
            return token;
        },
        async session({ session, token }) {
            if (token) {
                const sessionUser = session.user as typeof session.user & {
                    id: string; role: string; roles: string[]; permissions: string[];
                    rank: number; scope: string; departmentId?: string; branchId?: string; title?: string;
                };
                sessionUser.id           = token.id as string;
                sessionUser.role         = typeof token.role === "string" ? token.role : "";
                sessionUser.roles        = Array.isArray(token.roles) ? token.roles as string[] : [sessionUser.role];
                sessionUser.permissions  = Array.isArray(token.permissions) ? token.permissions as string[] : [];
                sessionUser.rank         = typeof token.rank === "number" ? token.rank : 0;
                sessionUser.scope        = typeof token.scope === "string" ? token.scope : "OWN";
                sessionUser.departmentId = typeof token.departmentId === "string" ? token.departmentId : undefined;
                sessionUser.branchId     = typeof token.branchId === "string" ? token.branchId : undefined;
                sessionUser.title        = typeof token.title === "string" ? token.title : undefined;
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

                // Union of role-granted permissions
                const rolePermIds = new Set<string>();
                for (const rp of user.userRole.permissions) {
                    const permId = rp.permission?.id;
                    if (permId) {
                        rolePermIds.add(permId);
                    }
                }
                // Per-user permission overrides removed — role-based only

                return {
                    id:           String(user.id),
                    name:         user.name,
                    email:        user.email,
                    role:         primaryRole,
                    roles,
                    permissions:  [...rolePermIds],
                    rank:         user.userRole.rank,
                    scope:        user.scope,
                    departmentId: user.departmentId ?? undefined,
                    branchId:     user.branchId ?? undefined,
                    title:        user.title ?? undefined,
                };
            },
        }),
    ],
});
