// Due Reminders — UI-first phase. Everything here is stand-in data so the
// screens can be seen and adjusted before the tables, APIs and daily job land.
// The wiring phase replaces these with real reads and deletes this file.

export type ReminderTone = "SOFT" | "FIRM";
export type ReminderAction = ReminderTone | "CALL_LIST";

export const TONE_LABEL: Record<ReminderTone, string> = {
    SOFT: "Soft reminder",
    FIRM: "Firm reminder",
};

export const ACTION_LABEL: Record<ReminderAction, string> = {
    SOFT: "Soft WhatsApp",
    FIRM: "Firm WhatsApp",
    CALL_LIST: "Owner's call list",
};

/** Rough per-message WhatsApp charge, for the "Send to all" estimate only.
 *  A due reminder is a utility template; the real rate comes from Meta. */
export const EST_COST_PER_MESSAGE = 0.12;

/** Stand-in wording until the two templates sit on the WhatsApp Templates page. */
export function sampleReminderText(tone: ReminderTone, v: { customer: string; amount: string; since: string; shop: string }): string {
    return tone === "SOFT"
        ? `Dear ${v.customer}, a friendly reminder that ₹${v.amount} is pending with ${v.shop}. You can see your bills and pay by UPI from the button below. Thank you!`
        : `Dear ${v.customer}, ₹${v.amount} has been due with ${v.shop} since ${v.since}. Please clear it at the earliest. Bills and UPI pay: button below.`;
}

export type ReminderRule = {
    id: number;
    name: string;
    minDays: number;
    minAmount: number;
    /** 0 = once per bill. */
    repeatDays: number;
    action: ReminderAction;
    enabled: boolean;
};

export const SAMPLE_RULES: ReminderRule[] = [
    { id: 1, name: "Gentle",    minDays: 7,  minAmount: 500,   repeatDays: 0,  action: "SOFT",      enabled: true },
    { id: 2, name: "Firm",      minDays: 30, minAmount: 2000,  repeatDays: 15, action: "FIRM",      enabled: true },
    { id: 3, name: "Big & old", minDays: 60, minAmount: 10000, repeatDays: 0,  action: "CALL_LIST", enabled: true },
];

export type ReminderLogRow = {
    at: string;
    party: string;
    amount: number;
    mode: "MANUAL" | "ALL" | "AUTO";
    tone: ReminderTone;
    status: "SENT" | "READ" | "FAILED";
};

export const SAMPLE_LOG: ReminderLogRow[] = [
    { at: "2026-10-07T10:00:00", party: "Rafiqul Islam",      amount: 4250,  mode: "AUTO",   tone: "SOFT", status: "READ" },
    { at: "2026-10-07T10:00:00", party: "Mondal Electricals", amount: 18900, mode: "AUTO",   tone: "FIRM", status: "SENT" },
    { at: "2026-10-06T16:42:00", party: "Sahidul Hoque",      amount: 1200,  mode: "MANUAL", tone: "SOFT", status: "READ" },
    { at: "2026-10-05T11:15:00", party: "Bina Traders",       amount: 7600,  mode: "ALL",    tone: "FIRM", status: "FAILED" },
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
