import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import type { PostNode, OrgStructure } from "@/shared/types/orgChart";

// Returns the org structure grouped as:
//   { orgWidePosts, branches: [{ branch, deptGroups: [{ dept, posts }] }] }
// This drives the Structure Chart in the Org Chart page.
// Unlike the old flat parentPostId tree, this groups by branch → department
// so the chart always shows the correct 4-level hierarchy regardless of
// whether Post.parentPostId chains are configured.

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const [posts, branches] = await Promise.all([
            prisma.post.findMany({
                include: {
                    branch:     { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                    holders: {
                        select: {
                            user: {
                                select: {
                                    id: true, name: true, avatarUrl: true,
                                    role: true, title: true,
                                    userRole: { select: { label: true, color: true } },
                                },
                            },
                        },
                    },
                },
                orderBy: { title: "asc" },
            }),
            prisma.branch.findMany({
                where:   { isActive: true },
                select:  { id: true, name: true },
                orderBy: { name: "asc" },
            }),
        ]);

        const toNode = (p: (typeof posts)[number]): PostNode => ({ ...p, children: [] });

        // ── Org-wide posts (branchId = null) ──────────────────────────────────
        const orgWidePosts: PostNode[] = posts
            .filter(p => !p.branchId)
            .map(toNode);

        // ── Branch groups ─────────────────────────────────────────────────────
        const branchGroups: OrgStructure["branches"] = branches.map(b => {
            const bPosts = posts.filter(p => p.branchId === b.id);

            // Collect unique department keys in insertion order
            const deptIds: (string | null)[] = [];
            for (const p of bPosts) {
                if (!deptIds.includes(p.departmentId)) deptIds.push(p.departmentId);
            }

            const deptGroups: OrgStructure["branches"][number]["deptGroups"] = deptIds
                .map(deptId => {
                    const dPosts = bPosts.filter(p => p.departmentId === deptId);
                    const dept   = dPosts[0]?.department ?? null;
                    return { dept, posts: dPosts.map(toNode) };
                })
                .filter(g => g.posts.length > 0);

            return { branch: b, deptGroups };
        });

        return NextResponse.json({ orgWidePosts, branches: branchGroups } satisfies OrgStructure);
    } catch (e) {
        return handleApiError(e, "Failed to load structure");
    }
}
