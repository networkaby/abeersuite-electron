// Opaque identifiers — the property name is the stable code reference,
// the value is what the DB stores. Renaming a label never touches these.
// When statuses move to a DB table (Phase 2), these values become the
// primary keys of those rows.

export const TICKET_STATUS = {
    RECEIVED:      "S1",
    DIAGNOSING:    "S2",
    REPAIRING:     "S3",
    ESCALATED:     "S4",
    RECEIVED_BACK: "S5",
    READY:         "S6",
    RETURNED:      "S7",
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

export const PRIORITY = {
    LOW:    "P1",
    NORMAL: "P2",
    HIGH:   "P3",
    URGENT: "P4",
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const ROLE = {
    ADMIN:      "R1",
    TECHNICIAN: "R2",
    FRONT_DESK: "R3",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const STATUS_LABELS: Record<string, string> = {
    [TICKET_STATUS.RECEIVED]:      "Received",
    [TICKET_STATUS.DIAGNOSING]:    "Diagnosing",
    [TICKET_STATUS.REPAIRING]:     "Repairing",
    [TICKET_STATUS.ESCALATED]:     "Escalated",
    [TICKET_STATUS.RECEIVED_BACK]: "Received Back",
    [TICKET_STATUS.READY]:         "Ready for Pickup",
    [TICKET_STATUS.RETURNED]:      "Returned",
};

export const STATUS_COLORS: Record<string, string> = {
    [TICKET_STATUS.RECEIVED]:      "bg-gray-100 text-gray-600",
    [TICKET_STATUS.DIAGNOSING]:    "bg-blue-100 text-blue-600",
    [TICKET_STATUS.REPAIRING]:     "bg-yellow-100 text-yellow-600",
    [TICKET_STATUS.ESCALATED]:     "bg-orange-100 text-orange-600",
    [TICKET_STATUS.RECEIVED_BACK]: "bg-purple-100 text-purple-600",
    [TICKET_STATUS.READY]:         "bg-green-100 text-green-600",
    [TICKET_STATUS.RETURNED]:      "bg-gray-100 text-gray-400",
};

export const PRIORITY_LABELS: Record<string, string> = {
    [PRIORITY.LOW]:    "Low",
    [PRIORITY.NORMAL]: "Normal",
    [PRIORITY.HIGH]:   "High",
    [PRIORITY.URGENT]: "Urgent",
};

export const PRIORITY_COLORS: Record<string, string> = {
    [PRIORITY.LOW]:    "bg-gray-100 text-gray-500",
    [PRIORITY.NORMAL]: "bg-blue-50 text-blue-500",
    [PRIORITY.HIGH]:   "bg-orange-100 text-orange-500",
    [PRIORITY.URGENT]: "bg-red-100 text-red-600",
};

export const ROLE_LABELS: Record<string, string> = {
    [ROLE.ADMIN]:      "Admin",
    [ROLE.TECHNICIAN]: "Technician",
    [ROLE.FRONT_DESK]: "Front Desk",
};

export const ROLE_COLORS: Record<string, string> = {
    [ROLE.ADMIN]:      "bg-red-100 text-red-600",
    [ROLE.TECHNICIAN]: "bg-blue-100 text-blue-600",
    [ROLE.FRONT_DESK]: "bg-green-100 text-green-600",
};

// State machine: which primary statuses can follow the current one.
// Stepping stone before this moves to the DB (StatusTransition table in Phase 2).
export const NEXT_STATUSES: Record<string, string[]> = {
    [TICKET_STATUS.RECEIVED]:      [TICKET_STATUS.DIAGNOSING],
    [TICKET_STATUS.DIAGNOSING]:    [TICKET_STATUS.REPAIRING, TICKET_STATUS.ESCALATED],
    [TICKET_STATUS.REPAIRING]:     [TICKET_STATUS.READY, TICKET_STATUS.ESCALATED],
    [TICKET_STATUS.ESCALATED]:     [TICKET_STATUS.RECEIVED_BACK],
    [TICKET_STATUS.RECEIVED_BACK]: [TICKET_STATUS.REPAIRING, TICKET_STATUS.READY],
    [TICKET_STATUS.READY]:         [TICKET_STATUS.RETURNED],
    [TICKET_STATUS.RETURNED]:      [TICKET_STATUS.RECEIVED],
};
