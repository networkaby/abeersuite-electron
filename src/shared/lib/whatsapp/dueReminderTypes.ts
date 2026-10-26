// Due reminders — the shapes and words the office screens and the server share.
// No DB, no React: safe to import from either side. Server logic is in
// dueReminders.ts; the screens are Receivables (send one / send to all) and
// Campaigns → Due Reminders (automation).

export type ReminderTone = "SOFT" | "FIRM";
export type ReminderAction = ReminderTone | "CALL_LIST";
export type ReminderMode = "MANUAL" | "ALL" | "AUTO";

export const TONE_LABEL: Record<ReminderTone, string> = {
    SOFT: "Soft reminder",
    FIRM: "Firm reminder",
};

export const ACTION_LABEL: Record<ReminderAction, string> = {
    SOFT: "Soft WhatsApp",
    FIRM: "Firm WhatsApp",
    CALL_LIST: "Owner's call list",
};

export const MODE_LABEL: Record<ReminderMode, string> = {
    MANUAL: "By hand",
    ALL: "Send to all",
    AUTO: "Automatic",
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Rough per-message WhatsApp charge, for the "Send to all" estimate only.
 *  A due reminder is a utility template; the real rate comes from Meta. */
export const EST_COST_PER_MESSAGE = 0.12;

/** Send to all goes in batches this big — one request each, so the screen can
 *  show real progress and no single request runs long. */
export const SEND_BATCH = 10;

export type ReminderRule = {
    id: number;
    name: string;
    minDays: number;
    minAmount: number;
    /** 0 = once until the balance clears; N = again every N days. */
    repeatDays: number;
    action: ReminderAction;
    enabled: boolean;
};

export type ReminderSettings = {
    enabled: boolean;
    sendTime: string;
    skipDays: number[];
    dailyCap: number;
    minBalance: number;
    /** Skip below this % of the auto / manual credit limit; 0 = off. */
    minPctAutoLimit: number;
    minPctCreditLimit: number;
    excluded: { accountId: number; name: string }[];
    rules: ReminderRule[];
    lastRunDate: string | null;
};

export type ReminderLogRow = {
    id: number;
    at: string;
    accountId: number;
    party: string;
    amount: number;
    action: ReminderAction;
    mode: ReminderMode;
    waStatus: string;
    pushStatus: string;
    waError: string | null;
};

/** Today's automatic run as Campaigns → Scheduled shows it (previewDueReminders). */
export type DuePreview = {
    enabled: boolean;
    sendTime: string;
    ranToday: boolean;
    /** Today is in "Don't send on". */
    skipToday: boolean;
    dailyCap: number;
    /** Who it would reach; `overCap` = past the day's message limit, waits for tomorrow. */
    list: { accountId: number; name: string; balance: number; oldestDays: number; rule: string; action: ReminderAction; overCap: boolean }[];
};

/** Per party: when it was last reminded — the dialogs warn on a repeat. */
export type LastReminded = Record<number, string>;

/** GET /api/due-reminders/send — what the Receivables dialogs read before sending. */
export type ReminderSendInfo = {
    lastReminded: LastReminded;
    /** state: "ready" | "not-approved" | "off" (billTemplates WaSendState); body: the
     *  approved wording, or the default while none is approved — for the preview. */
    templates: Record<ReminderTone, { state: string; body: string }>;
};

/** One line under a sent reminder, in plain words. */
export function waStatusText(s: string): string {
    switch (s) {
        case "sent": return "Sent";
        case "no-mobile": return "No mobile";
        case "disabled": return "Template not approved / off";
        case "not-configured": return "WhatsApp not set up";
        case "failed": return "Failed";
        case "call-list": return "On call list";
        default: return s;
    }
}
