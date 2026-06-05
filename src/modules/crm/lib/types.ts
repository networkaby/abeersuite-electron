export type LeadPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type LeadActivityKind = "NOTE" | "CALL" | "MEETING" | "TASK" | "SYSTEM";

/** A pipeline stage = a TicketStatus row; the board renders one column per stage. */
export interface LeadStage {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
}

/** Frozen actor snapshot (mirrors ActorSnapshot in src/shared/lib/auth/actorSnapshot.ts). */
export interface LeadActor {
    userId: number;
    userName: string;
    avatarUrl?: string | null;
    positionId?: string | null;
    positionTitle?: string | null;
}

export interface LeadPositionHolder {
    id: number;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
}

/** The seat a lead is owned by, with its current live holders. */
export interface LeadAssignedPosition {
    id: string;
    title: string;
    branch: { name: string } | null;
    department: { name: string } | null;
    holders: { user: LeadPositionHolder }[];
}

/** Option shape for the owner (position) picker. */
export interface LeadPositionOption {
    id: string;
    title: string;
    branchName?: string | null;
    departmentName?: string | null;
}

export interface LeadLinkLite {
    id: number;
    name: string;
}

export interface LeadActivityDto {
    id: number;
    kind: LeadActivityKind;
    body: string;
    dueAt: string | null;
    doneAt: string | null;
    createdAt: string;
    author: LeadActor;
}

export interface LeadDto {
    id: number;
    pipelineId: string;
    status: string;
    title: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    companyName: string | null;
    personId: number | null;
    companyId: number | null;
    valuePaise: number | null;
    source: string | null;
    priority: LeadPriority;
    nextFollowUpAt: string | null;
    closedAt: string | null;
    lostReason: string | null;
    order: number;
    assignedPositionId: string | null;
    createdBy: LeadActor;
    createdAt: string;
    updatedAt: string;
    ticketStatus: LeadStage;
    assignedPosition: LeadAssignedPosition | null;
    person: LeadLinkLite | null;
    company: LeadLinkLite | null;
    _count: { activities: number };
}

export interface LeadDetailDto extends LeadDto {
    notes: string | null;
    activities: LeadActivityDto[];
}
