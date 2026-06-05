export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/** A pipeline stage = a TicketStatus row; the board renders one column per stage. */
export interface TaskStage {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
}

export interface TaskUserLite {
    id: number;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
}

export interface TaskCommentDto {
    id: number;
    body: string;
    kind: "COMMENT" | "SYSTEM";
    createdAt: string;
    user: TaskUserLite;
}

export interface TaskDto {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    priority: TaskPriority;
    pipelineId: string;
    status: string;
    assigneeId: number | null;
    createdById: number;
    dueDate: string | null;
    completedAt: string | null;
    order: number;
    createdAt: string;
    updatedAt: string;
    ticketStatus: TaskStage;
    assignee: TaskUserLite | null;
    createdBy: { id: number; name: string };
    _count: { comments: number };
}

export interface TaskDetailDto extends TaskDto {
    comments: TaskCommentDto[];
}
