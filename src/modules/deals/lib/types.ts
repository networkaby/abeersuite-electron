export type DealPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type DealActivityKind = "NOTE" | "CALL" | "MEETING" | "TASK" | "SYSTEM";

/** A pipeline stage = a TicketStatus row; the board renders one column per stage. */
export interface DealStage {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
}

/** Frozen actor snapshot (mirrors ActorSnapshot in src/shared/lib/auth/actorSnapshot.ts). */
export interface DealActor {
    userId: number;
    userName: string;
    avatarUrl?: string | null;
    positionId?: string | null;
    positionTitle?: string | null;
}

export interface DealPositionHolder {
    id: number;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
}

/** The seat a deal is owned by, with its current live holders. */
export interface DealAssignedPosition {
    id: string;
    title: string;
    branch: { name: string } | null;
    department: { name: string } | null;
    holders: { user: DealPositionHolder }[];
}

/** Option shape for the owner (position) picker. */
export interface DealPositionOption {
    id: string;
    title: string;
    branchName?: string | null;
    departmentName?: string | null;
}

export interface DealLinkLite {
    id: number;
    name: string;
}

export interface DealActivityDto {
    id: number;
    kind: DealActivityKind;
    body: string;
    dueAt: string | null;
    doneAt: string | null;
    createdAt: string;
    author: DealActor;
}

export interface DealDto {
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
    priority: DealPriority;
    nextFollowUpAt: string | null;
    closedAt: string | null;
    lostReason: string | null;
    order: number;
    assignedPositionId: string | null;
    createdBy: DealActor;
    createdAt: string;
    updatedAt: string;
    ticketStatus: DealStage;
    assignedPosition: DealAssignedPosition | null;
    person: DealLinkLite | null;
    company: DealLinkLite | null;
    _count: { activities: number };
}

export interface DealDetailDto extends DealDto {
    notes: string | null;
    activities: DealActivityDto[];
}
