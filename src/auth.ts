import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authorizeStaffCredentials } from "@/lib/auth/authorize-staff";
import { authorizePortalCredentials } from "@/lib/auth/authorize-portal";

export const { handlers, signIn, signOut, auth } = NextAuth({
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt" },
    pages: {
        signIn: "/portal/login",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.role = "role" in user && typeof user.role === "string" ? user.role : "";
                token.roles = "roles" in user && Array.isArray(user.roles) ? (user.roles as string[]) : [];
                token.permissions =
                    "permissions" in user && Array.isArray(user.permissions)
                        ? (user.permissions as string[])
                        : [];
                token.rank = "rank" in user && typeof user.rank === "number" ? user.rank : 0;
                token.scope = "scope" in user && typeof user.scope === "string" ? user.scope : "OWN";
                token.roleLabel =
                    "roleLabel" in user && typeof user.roleLabel === "string" ? user.roleLabel : undefined;
                token.roleColor =
                    "roleColor" in user && typeof user.roleColor === "string" ? user.roleColor : undefined;
                token.departmentIds =
                    "departmentIds" in user && Array.isArray(user.departmentIds)
                        ? (user.departmentIds as string[])
                        : [];
                token.branchIds =
                    "branchIds" in user && Array.isArray(user.branchIds) ? (user.branchIds as string[]) : [];
                token.title = "title" in user ? (user.title as string | undefined) : undefined;
                token.avatarUrl = "avatarUrl" in user ? (user.avatarUrl as string | undefined) : undefined;
                token.kind = "kind" in user && user.kind === "customer" ? "customer" : "staff";
                token.customerId =
                    "customerId" in user && typeof user.customerId === "string" ? user.customerId : undefined;
            }
            return token;
        },
        async session({ session, token }) {
            if (token) {
                const sessionUser = session.user as typeof session.user & {
                    id: string;
                    role: string;
                    roles: string[];
                    permissions: string[];
                    rank: number;
                    scope: string;
                    roleLabel?: string;
                    roleColor?: string;
                    departmentIds: string[];
                    branchIds: string[];
                    title?: string;
                    avatarUrl?: string;
                    kind?: "staff" | "customer";
                    customerId?: string;
                };
                sessionUser.id = token.id as string;
                sessionUser.role = typeof token.role === "string" ? token.role : "";
                sessionUser.roles = Array.isArray(token.roles) ? (token.roles as string[]) : [sessionUser.role];
                sessionUser.permissions = Array.isArray(token.permissions) ? (token.permissions as string[]) : [];
                sessionUser.rank = typeof token.rank === "number" ? token.rank : 0;
                sessionUser.scope = typeof token.scope === "string" ? token.scope : "OWN";
                sessionUser.roleLabel = typeof token.roleLabel === "string" ? token.roleLabel : undefined;
                sessionUser.roleColor = typeof token.roleColor === "string" ? token.roleColor : undefined;
                sessionUser.departmentIds = Array.isArray(token.departmentIds)
                    ? (token.departmentIds as string[])
                    : [];
                sessionUser.branchIds = Array.isArray(token.branchIds) ? (token.branchIds as string[]) : [];
                sessionUser.title = typeof token.title === "string" ? token.title : undefined;
                sessionUser.avatarUrl = typeof token.avatarUrl === "string" ? token.avatarUrl : undefined;
                sessionUser.kind = token.kind === "customer" ? "customer" : "staff";
                sessionUser.customerId =
                    typeof token.customerId === "string" ? token.customerId : undefined;
            }
            return session;
        },
    },
    providers: [
        Credentials({
            id: "credentials-staff",
            name: "Staff",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;
                return authorizeStaffCredentials(
                    prisma,
                    credentials.email as string,
                    credentials.password as string
                );
            },
        }),
        Credentials({
            id: "credentials-portal",
            name: "Portal",
            credentials: {
                identifier: { label: "Mobile or email", type: "text" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.identifier || !credentials?.password) return null;
                return authorizePortalCredentials(
                    prisma,
                    credentials.identifier as string,
                    credentials.password as string
                );
            },
        }),
    ],
});
