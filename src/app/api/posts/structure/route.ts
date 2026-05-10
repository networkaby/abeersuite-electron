import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";

export interface PostNode {
    id: string;
    title: string;
    branchId: string | null;
    departmentId: string | null;
    parentPostId: string | null;
    branch:     { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    holders: {
        user: { id: number; name: string; avatarUrl: string | null; role: string; title: string | null; userRole: { label: string; color: string } };
    }[];
    children: PostNode[];
}

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const posts = await prisma.post.findMany({
            include: {
                branch:     { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
                holders: {
                    select: {
                        user: { select: { id: true, name: true, avatarUrl: true, role: true, title: true, userRole: { select: { label: true, color: true } } } },
                    },
                },
            },
        });

        const map = new Map<string, PostNode>();
        for (const p of posts) {
            map.set(p.id, { ...p, children: [] });
        }

        const roots: PostNode[] = [];
        for (const node of map.values()) {
            if (node.parentPostId && map.has(node.parentPostId)) {
                map.get(node.parentPostId)!.children.push(node);
            } else {
                roots.push(node);
            }
        }

        const sort = (nodes: PostNode[]) => {
            nodes.sort((a, b) => a.title.localeCompare(b.title));
            nodes.forEach(n => sort(n.children));
        };
        sort(roots);

        return NextResponse.json(roots);
    } catch {
        return NextResponse.json({ error: "Failed to load structure" }, { status: 500 });
    }
}
