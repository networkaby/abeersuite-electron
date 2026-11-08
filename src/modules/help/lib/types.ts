import type { WorkArg } from "@/modules/repairing/lib/ticketSources";
export type HelpPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type HelpInquiryType = "PRICE" | "AVAILABILITY" | "TECH_INFO" | "WARRANTY" | "OTHER";
export type HelpOutcome =
    | "NOT_FEASIBLE"
    | "CUSTOMER_DECLINED"
    | "RESOLVED_INFO"
    | "CONVERTED_TO_SERVICE"
    | "CONVERTED_TO_SALE";
export type HelpLogKind = "NOTE" | "COMMENT" | "CALL" | "MEETING" | "TASK" | "SYSTEM";

/** Fixed inquiry types + their labels (mirror helpInquiryTypeSchema). */
export const INQUIRY_TYPES: { value: HelpInquiryType; label: string }[] = [
    { value: "PRICE", label: "Price" },
    { value: "AVAILABILITY", label: "Availability" },
    { value: "TECH_INFO", label: "Technical info" },
    { value: "WARRANTY", label: "Warranty" },
    { value: "OTHER", label: "Other" },
];
export const INQUIRY_LABEL: Record<HelpInquiryType, string> = Object.fromEntries(
    INQUIRY_TYPES.map((i) => [i.value, i.label]),
) as Record<HelpInquiryType, string>;

export const OUTCOME_LABEL: Record<HelpOutcome, string> = {
    NOT_FEASIBLE: "Not feasible",
    CUSTOMER_DECLINED: "Customer declined",
    RESOLVED_INFO: "Resolved (info)",
    CONVERTED_TO_SERVICE: "Converted → service",
    CONVERTED_TO_SALE: "Converted → sale",
};

export interface HelpStage {
    id: string;
    label: string;
    color: string;
    order: number;
    isTerminal: boolean;
}

/** Frozen actor snapshot (mirrors ActorSnapshot). */
export interface HelpActor {
    userId: number;
    userName: string;
    avatarUrl?: string | null;
    positionId?: string | null;
    positionTitle?: string | null;
}

export interface HelpPositionHolder {
    id: number;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
}

export interface HelpAssignedPosition {
    id: string;
    title: string;
    branch: { name: string } | null;
    department: { name: string } | null;
    holders: { user: HelpPositionHolder }[];
}

export interface HelpPositionOption {
    id: string;
    title: string;
    branchName?: string | null;
    departmentName?: string | null;
}

export interface HelpLinkLite {
    id: number;
    name: string;
}

export interface HelpDto {
    id: number;
    pipelineId: string;
    status: string;
    subject: string | null;
    inquiryType: HelpInquiryType | null;
    notes: string | null;
    priority: HelpPriority;
    closedAt: string | null;
    order: number;
    assignedPositionId: string | null;
    assignedPosition: HelpAssignedPosition | null;
    createdBy: HelpActor;
    createdAt: string;
    updatedAt: string;
    ticketStatus: HelpStage;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    personId: number | null;
    companyId: number | null;
    outcome: HelpOutcome | null;
    person: HelpLinkLite | null;
    company: HelpLinkLite | null;
    _count: { logs: number };
}

export interface HelpLogDto {
    id: number;
    kind: HelpLogKind;
    note: string | null;
    createdAt: string;
    author: HelpActor;
    /** The WhatsApp photo / file behind this line (signed short-lived links). */
    media?: { mediaUrl: string | null; downloadUrl: string | null; mediaType: string | null; fileName: string | null } | null;
}

interface HelpRouteTarget { id: string; label: string }

/** The ticket's current sub-step (worker) — drives the shared WorkActions buttons. */
export interface HelpWorkerDto {
    id: string;
    label: string;
    color: string;
    actionLabel: string | null;
    work: {
        label: string; successLabel: string | null; failLabel: string | null; startLabel: string | null;
        prompt: string | null; successPopup: boolean; failPopup: boolean; args: WorkArg[] | null;
    } | null;
    successWorker: HelpRouteTarget | null;
    failWorker: HelpRouteTarget | null;
    successStatus: HelpRouteTarget | null;
    failStatus: HelpRouteTarget | null;
}

export interface HelpDetailDto extends HelpDto {
    logs: HelpLogDto[];
    ticketWorker: HelpWorkerDto | null;
    /** Stages this ticket may move to — its stage's "Transitions To" list. */
    nextStages: { id: string; label: string; isTerminal: boolean }[];
}

/** Best display name for a help ticket's customer (existing party or walk-in). */
export function helpCustomerName(t: Pick<HelpDto, "person" | "company" | "contactName">): string {
    return t.person?.name ?? t.company?.name ?? t.contactName ?? "Walk-in";
}

/** Board/list headline — the subject if set, else the customer name (quick tickets
 *  have no subject). */
export function helpTitle(t: Pick<HelpDto, "subject" | "person" | "company" | "contactName">): string {
    return t.subject?.trim() || helpCustomerName(t);
}
