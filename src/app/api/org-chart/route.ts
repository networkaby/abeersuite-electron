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
    userPositions: {
        select: {
            position: {
                select: {
                    branch:     { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                },
            },
        },
    },
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
    for (const u of users) {
        const node = map.get(u.id)!;
        if (u.managerId && map.has(u.managerId)) {
            map.get(u.managerId)!.children.push(node);
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
        const raw = await prisma.user.findMany({ select: USER_SELECT });
        // Derive branches/departments from the user's positions so the
        // OrgNode shape (which still exposes these arrays for tree rendering)
        // remains stable for consumers.
        const users: FlatUser[] = raw.map(u => {
            const branchMap = new Map<string, { id: string; name: string }>();
            const deptMap   = new Map<string, { id: string; name: string }>();
            for (const up of u.userPositions) {
                if (up.position.branch)     branchMap.set(up.position.branch.id, up.position.branch);
                if (up.position.department) deptMap.set(up.position.department.id, up.position.department);
            }
            const { userPositions: _up, ...rest } = u;
            void _up;
            return { ...rest, branches: [...branchMap.values()], departments: [...deptMap.values()] };
        });
        return NextResponse.json(buildTree(users));
    } catch (e) {
        return handleApiError(e, "Failed to load org chart");
    }
}
