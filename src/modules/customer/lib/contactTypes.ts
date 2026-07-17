export type ContactLifecycle = "LEAD" | "PROSPECT" | "CUSTOMER" | "INACTIVE";

export interface ContactOwnerHolder {
    id: number;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
}

export interface ContactOwnerLite {
    id: string;
    title: string;
    branch: { name: string } | null;
    holders: { user: ContactOwnerHolder }[];
}

export interface ContactDto {
    id: number;
    name: string;
    lifecycleStage: ContactLifecycle;
    ownerPositionId: string | null;
    tags: string[];
    isActive: boolean;
    createdAt: string;
    owner: ContactOwnerLite | null;
    /** creditLimit is the per-customer MANUAL limit (Prisma Decimal → string); null = none set. */
    account: { id: number; creditLimit: string | null } | null;
    phones: { phone: string; isPrimary: boolean }[];
    emails: { email: string; isPrimary: boolean }[];
    _count: { deals: number };
}

export interface ContactsResponse {
    items: ContactDto[];
    total: number;
    page: number;
    pageSize: number;
}

/** Position option for owner filter + bulk-assign. */
export interface ContactPositionOption {
    id: string;
    title: string;
    branchName?: string | null;
}

export const LIFECYCLE_META: Record<ContactLifecycle, { label: string; color: string }> = {
    LEAD: { label: "Lead", color: "bg-gray-100 text-gray-600" },
    PROSPECT: { label: "Prospect", color: "bg-blue-100 text-blue-700" },
    CUSTOMER: { label: "Customer", color: "bg-green-100 text-green-700" },
    INACTIVE: { label: "Inactive", color: "bg-muted text-muted-foreground" },
};

export const LIFECYCLES: ContactLifecycle[] = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"];
