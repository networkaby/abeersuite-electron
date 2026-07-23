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

/** Non-convert close outcomes offered as buttons (convert outcomes are set by the
 *  convert flow, not chosen here). */
export const CLOSE_OUTCOMES: { value: HelpOutcome; label: string; hint: string }[] = [
    { value: "RESOLVED_INFO", label: "Resolved (info given)", hint: "Advice / price / info given, nothing more to do" },
    { value: "NOT_FEASIBLE", label: "Not feasible", hint: "We don't handle this / not available & can't be arranged" },
    { value: "CUSTOMER_DECLINED", label: "Customer declined", hint: "Customer chose not to proceed" },
];
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
}

export interface HelpDetailDto extends HelpDto {
    logs: HelpLogDto[];
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
