export interface OrgNode {
    id: number;
    name: string;
    title: string | null;
    role: string;
    avatarUrl: string | null;
    userRole: { label: string; color: string; rank: number };
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
        user: { id: number; name: string; avatarUrl: string | null; role: string; title: string | null; userRole: { label: string; color: string } };
    }[];
    children: PostNode[];
}
