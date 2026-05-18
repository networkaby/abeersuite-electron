import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import type { OrgNode } from "@/shared/types/orgChart";

const USER_SELECT = {
    id:          true,
    name:        true,
    title:       true,
    role:        true,
    avatarUrl:   true,
    managerId:   true,
    userRole:    { select: { label: true, color: true, rank: true } },
    departments: { select: { id: true, name: true } },
    branches:    { select: { id: true, name: true } },
} as const;

type FlatUser = {
    id: number;
    name: string;
    title: string | null;
    role: string | null;
    avatarUrl: string | null;
    managerId: number | null;
    userRole: { label: string; color: string; rank: number } | null;
    departments: { id: string; name: string }[];
    branches: { id: string; name: string }[];
};

function buildTree(users: FlatUser[]): OrgNode[] {
    const map = new Map<number, OrgNode>();
    for (const u of users) {
        map.set(u.id, { ...u, children: [] });
    }
    const roots: OrgNode[] = [];
    for (const node of map.values()) {
        const flat = users.find(u => u.id === node.id)!;
        if (flat.managerId && map.has(flat.managerId)) {
            map.get(flat.managerId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }
    // Sort by rank desc (highest rank first), then alphabetically
    const sort = (nodes: OrgNode[]) => {
        nodes.sort((a, b) => (b.userRole?.rank ?? 0) - (a.userRole?.rank ?? 0) || a.name.localeCompare(b.name));
        nodes.forEach(n => sort(n.children));
    };
    sort(roots);
    return roots;
}

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const users = await prisma.user.findMany({ select: USER_SELECT });
        return NextResponse.json(buildTree(users));
    } catch (e) {
        return handleApiError(e, "Failed to load org chart");
    }
}
