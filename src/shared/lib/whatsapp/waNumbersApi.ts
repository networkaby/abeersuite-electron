import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasScrambleSecret } from "@/shared/lib/security/secretBox";
import { clearWaNumbersCache, listWaNumbers } from "./waNumbers";
import { clearWaTemplateCache } from "./waTemplateStore";

/** Shared by the /api/settings/whatsapp-numbers routes. */

const digits = (what: string) => z.string().trim().regex(/^\d{5,25}$/, `${what}: digits only`);
export const cloudNumberSchema = z.object({
    label: z.string().trim().min(1, "Give it a name").max(80),
    phone: z.string().trim().regex(/^\d{10,15}$/, "Phone: digits with country code, e.g. 918876996996"),
    phoneNumberId: digits("Phone number ID"),
    wabaId: digits("WhatsApp account ID"),
    /** Undefined = keep / none; "" = clear (use the main token). */
    token: z.string().trim().max(1000).optional(),
    /** Adding only: "COEXIST" = already on the Business app, connected elsewhere. */
    type: z.enum(["CLOUD", "COEXIST"]).optional(),
});

/** Saving a token needs the secrets permission too, like App Settings. */
export async function denyTokenEdit(token: string | undefined): Promise<NextResponse | null> {
    if (token === undefined) return null;
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_SECRETS);
    if (response) return response;
    if (token && !hasScrambleSecret()) {
        return NextResponse.json({ error: "SCRAMBLE_KEY_SECRET is not set on this server — a token cannot be saved locked." }, { status: 422 });
    }
    return null;
}

/** The account name a number shows under: its account's existing name, else `fallback`. */
export async function accountLabelFor(wabaId: string, fallback: string, exceptId?: number) {
    return (await listWaNumbers()).find((n) => n.wabaId === wabaId && n.id !== exceptId)?.accountLabel ?? fallback;
}

/** Any change to the numbers: senders and the bills-template cache read afresh. */
export function afterWaNumbersChange() {
    clearWaNumbersCache();
    clearWaTemplateCache();
}
