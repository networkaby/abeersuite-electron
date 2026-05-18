export interface OrgNode {
    id: number;
    name: string;
    title: string | null;
    role: string | null;
    avatarUrl: string | null;
    userRole: { label: string; color: string; rank: number } | null;
    departments: { id: string; name: string }[];
    branches:    { id: string; name: string }[];
    children: OrgNode[];
}

export interface PostNode {
    id: string;
    title: string;
    branchId: string | null;
    departmentId: string | null;
    parentPostId: string | null;
    branch:     { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    holders: {
        user: { id: number; name: string; avatarUrl: string | null; role: string | null; title: string | null; userRole: { label: string; color: string } | null };
    }[];
    children: PostNode[];
}

// ── Structure chart shape ─────────────────────────────────────────────────────
// Returned by /api/posts/structure. Groups posts by org-wide → branch → dept
// so the Structure Chart can render the correct 4-level hierarchy instead of
// a flat list of parentPostId-based roots.
export interface DeptGroup {
    dept: { id: string; name: string } | null; // null = no dept (branch-level posts)
    posts: PostNode[];
}

export interface BranchGroup {
    branch: { id: string; name: string };
    deptGroups: DeptGroup[];
}

export interface OrgStructure {
    orgWidePosts: PostNode[];   // branchId = null → Executive Council tier
    branches: BranchGroup[];   // all active branches, each with dept sub-groups
}
