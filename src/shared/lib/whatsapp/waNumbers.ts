import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { WhatsAppNumber } from "@/generated/prisma/client";
import { appSetting, openSavedSecret } from "@/shared/lib/settings/appSettings.server";
import { lockSecret } from "@/shared/lib/security/secretBox";
import { META_GRAPH } from "@/shared/lib/constants/meta";

/**
 * WhatsApp numbers — one WhatsAppNumber record per number, each on its own
 * (owner, 2026-11-15). Everything that sends on WhatsApp asks here which
 * number to use and with which token:
 *   OTP              → the record with useForOtp
 *   bills, new chats → the record with useForBills
 *   a reply          → the number the customer wrote to (its own record)
 * A record's token is its own (locked) or, when empty, the main token
 * META_WA_ACCESS_TOKEN — one system-user token can serve every account the
 * bot has been given in Meta.
 *
 * Read on every send, so the list is cached in memory for a minute and dropped
 * on any change made through here.
 */

export type WaNumberType = "CLOUD" | "COEXIST";

/** The main token — App Settings, else .env. */
export const mainWaToken = () => appSetting("META_WA_ACCESS_TOKEN");

const TTL_MS = 60_000;
let cache: { at: number; rows: Promise<WhatsAppNumber[]> } | null = null;

export function clearWaNumbersCache() {
    cache = null;
}

/** Every number, oldest first. Fills the table once from the old settings. */
export function listWaNumbers(): Promise<WhatsAppNumber[]> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
    const rows = (async () => {
        let list = await prisma.whatsAppNumber.findMany({ orderBy: { id: "asc" } });
        if (!list.length && (await adoptLegacyNumbers())) list = await prisma.whatsAppNumber.findMany({ orderBy: { id: "asc" } });
        return list;
    })();
    cache = { at: Date.now(), rows };
    rows.catch(() => { cache = null; });
    return rows;
}

export const otpWaNumber = async () => (await listWaNumbers()).find((n) => n.useForOtp) ?? null;
export const billsWaNumber = async () => (await listWaNumbers()).find((n) => n.useForBills) ?? null;
export const waNumberById = async (phoneNumberId: string | null | undefined) =>
    phoneNumberId ? ((await listWaNumbers()).find((n) => n.phoneNumberId === phoneNumberId) ?? null) : null;

/** A record's own token, else the main one. A token that cannot be opened here
 *  (lock key missing / changed) falls back to the main token too. */
async function tokenOf(n: WhatsAppNumber | null | undefined): Promise<string | undefined> {
    const own = n?.token ? openSavedSecret(n.token) : null;
    return own || (await mainWaToken());
}

/** Token for calls made as this number (send, register, block, test). */
export const waTokenForNumber = async (phoneNumberId: string | null | undefined) => tokenOf(await waNumberById(phoneNumberId));

/** Token for calls on a WhatsApp account (templates): any of its numbers' own token, else the main one. */
export async function waTokenForWaba(wabaId: string): Promise<string | undefined> {
    const withOwn = (await listWaNumbers()).find((n) => n.wabaId === wabaId && n.token);
    return tokenOf(withOwn);
}

/** Store a token locked; empty → null (= use the main token). */
export const lockWaToken = (plain: string | null | undefined) => (plain?.trim() ? lockSecret(plain.trim(), "scramble") : null);

/** Last 4 characters of a record's own token, for the screen; null = main token. */
export function waTokenTail(n: WhatsAppNumber): string | null {
    if (!n.token) return null;
    const plain = openSavedSecret(n.token);
    return plain ? plain.slice(-4) : "????";
}

/**
 * First read after the 2026-11-15 change: the old App Settings slots become
 * records — Number 1 (OTP) and Number 2 (bills), one record when they are the
 * same number. Their phone and name come from Meta when it answers. Returns
 * whether anything was created. Idempotent (phoneNumberId is unique).
 */
async function adoptLegacyNumbers(): Promise<boolean> {
    const otpId = await appSetting("META_WA_PHONE_NUMBER_ID");
    const otpWaba = await appSetting("META_WA_BUSINESS_ACCOUNT_ID");
    const billsId = (await appSetting("WA_CONVERSATION_NUMBER_ID")) || otpId;
    const billsWaba = (await appSetting("WA_CONVERSATION_BUSINESS_ACCOUNT_ID")) || otpWaba;
    const slots = [
        { id: otpId, waba: otpWaba, otp: true, bills: billsId === otpId },
        ...(billsId && billsId !== otpId ? [{ id: billsId, waba: billsWaba, otp: false, bills: true }] : []),
    ].filter((s): s is { id: string; waba: string; otp: boolean; bills: boolean } => Boolean(s.id && s.waba));
    if (!slots.length) return false;

    const token = await mainWaToken();
    for (const s of slots) {
        const info = token ? await fetchNumberInfo(s.id, token).catch(() => null) : null;
        const label = s.otp && s.bills ? "OTP & bills" : s.otp ? "OTP" : "Bills";
        await prisma.whatsAppNumber.upsert({
            where: { phoneNumberId: s.id },
            create: {
                label,
                type: "CLOUD",
                phone: info?.phone ?? "",
                phoneNumberId: s.id,
                wabaId: s.waba,
                accountLabel: info?.name || "Main account",
                useForOtp: s.otp,
                useForBills: s.bills,
                status: info?.status ?? "Not tested",
            },
            update: {},
        });
    }
    return true;
}

export type WaNumberInfo = { phone: string; name: string; status: string; quality: string };

/** Meta's own view of a number. Throws Meta's wording (e.g. missing permissions). */
export async function fetchNumberInfo(phoneNumberId: string, token: string): Promise<WaNumberInfo> {
    const res = await fetch(`${META_GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name,status,quality_rating`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
        display_phone_number?: string;
        verified_name?: string;
        status?: string;
        quality_rating?: string;
        error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok || json.error) throw new Error(json.error?.error_user_msg || json.error?.message || `Meta answered ${res.status}`);
    return {
        phone: (json.display_phone_number ?? "").replace(/\D/g, ""),
        name: json.verified_name ?? "",
        status: json.status ?? "",
        quality: json.quality_rating ?? "",
    };
}

/** The client's view of a record — never the token itself. */
export type WaNumberView = {
    id: number;
    label: string;
    type: WaNumberType;
    phone: string;
    phoneNumberId: string;
    wabaId: string;
    accountLabel: string;
    tokenTail: string | null;
    useForOtp: boolean;
    useForBills: boolean;
    status: string;
    checkedAt: string | null;
};

export function toWaNumberView(n: WhatsAppNumber): WaNumberView {
    return {
        id: n.id,
        label: n.label,
        type: n.type === "COEXIST" ? "COEXIST" : "CLOUD",
        phone: n.phone,
        phoneNumberId: n.phoneNumberId,
        wabaId: n.wabaId,
        accountLabel: n.accountLabel,
        tokenTail: waTokenTail(n),
        useForOtp: n.useForOtp,
        useForBills: n.useForBills,
        status: n.status,
        checkedAt: n.checkedAt?.toISOString() ?? null,
    };
}

export const listWaNumberViews = async () => (await listWaNumbers()).map(toWaNumberView);
