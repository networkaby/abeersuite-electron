export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/** A pipeline stage = a TicketStatus row; the board renders one column per stage. */
export interface TaskStage {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
}

/**
 * Actor audit snapshot stored as JSON on Task.createdBy / TaskComment.author.
 * Frozen at action time — NOT a live User FK — so history survives staff
 * turnover. `position*` is the actor's seat at that moment (display only).
 */
export interface TaskActor {
    userId: number;
    userName: string;
    avatarUrl?: string | null;
    positionId?: string | null;
    positionTitle?: string | null;
}

/** A person currently holding the assigned position (resolved via UserPosition). */
export interface TaskPositionHolder {
    id: number;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
}

/** The seat a task is assigned to, with its current live holders. */
export interface TaskAssignedPosition {
    id: string;
    title: string;
    branch: { name: string } | null;
    department: { name: string } | null;
    holders: { user: TaskPositionHolder }[];
}

/** Option shape for the assignee (position) picker in the task form. */
export interface TaskPositionOption {
    id: string;
    title: string;
    branchName?: string | null;
    departmentName?: string | null;
}

export interface TaskCommentDto {
    id: number;
    body: string;
    kind: "COMMENT" | "SYSTEM";
    createdAt: string;
    author: TaskActor;
}

export interface TaskDto {
    id: number;
    title: string;
    description: string | null;
    category: string | null;
    priority: TaskPriority;
    pipelineId: string;
    status: string;
    assignedPositionId: string | null;
    dueDate: string | null;
    completedAt: string | null;
    order: number;
    /** Set only on tasks a TaskRecurrence generated — drives the repeat chip. */
    recurrenceId: number | null;
    occurrenceNo: number | null;
    /** The recurrence's instalment/rent figure, lifted off `Ticket.context`.
     *  Decision support shown on the card — never posted to the ledger. */
    amountPaise: number | null;
    createdAt: string;
    updatedAt: string;
    ticketStatus: TaskStage;
    assignedPosition: TaskAssignedPosition | null;
    createdBy: TaskActor;
    _count: { comments: number };
}

export interface TaskDetailDto extends TaskDto {
    comments: TaskCommentDto[];
}

// ── Recurring tasks ───────────────────────────────────────────────────────────

/** A task repeats by calendar unit; minute/hour stay worker-retry-only. */
export type RecurrenceUnit = "day" | "week" | "month" | "year";

/**
 * A recurring-task template. `totalCount` is the whole instalment-vs-rent
 * distinction: a number means a fixed run ("#3 of 12"), null means endless.
 * `amountPaise` is decision support only — nothing is ever posted to the ledger.
 */
export interface TaskRecurrenceDto {
    id: number;
    title: string;
    description: string | null;
    category: string | null;
    priority: TaskPriority;
    pipelineId: string;
    assignedPositionId: string | null;
    assignedPosition: TaskAssignedPosition | null;
    unit: RecurrenceUnit;
    every: number;
    totalCount: number | null;
    /** Due date of occurrence #1 and the permanent anchor for every later one. */
    anchorAt: string;
    lastOccurrenceNo: number;
    leadDays: number;
    isActive: boolean;
    endedAt: string | null;
    amountPaise: number | null;
    accountId: number | null;
    /** Computed server-side so the UI never re-implements the interval math. */
    nextDueAt: string | null;
    generatedCount: number;
    createdBy: TaskActor;
    createdAt: string;
    updatedAt: string;
}
