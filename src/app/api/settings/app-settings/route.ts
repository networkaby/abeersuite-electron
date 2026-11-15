import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { APP_SETTING_DEFS, SECRET_APP_SETTING_KEYS, maskSecret, normalizeAppSettings, type AppSettingKey, type AppSettingValues } from "@/shared/lib/constants/appSettings";
import { APP_SETTINGS_TAG, envAppSetting, openSavedSecret } from "@/shared/lib/settings/appSettings.server";
import { hasScrambleSecret, lockSecret } from "@/shared/lib/security/secretBox";
import { listWaPhoneNumbers, registerWaPhoneNumber, setWaTwoStepPin } from "@/shared/lib/whatsapp/metaTemplates";
import { ENV_ONLY_KEYS } from "@/shared/lib/constants/appSettingsHelp";
import { clearWaTemplateCache } from "@/shared/lib/whatsapp/waTemplateStore";

// Settings → App Settings. Stored on OrgDefaults.appSettingsJson; a blank key falls
// back to .env. Secrets may be saved here too (owner, 2026-11-12 — for testing
// without a deploy; later moved to Vercel and cleared): stored locked with
// SCRAMBLE_KEY_SECRET, never sent back to the browser (GET gives only the last 4
// characters), and PUT keeps a saved secret unless the body names that key ("" clears).
// Changing a secret needs settings:app:secrets on top of settings:app:manage.

/** Secrets replaced by their mask — what the browser is allowed to see. `locked`
 *  says the value is stored locked (DB) and must be opened before masking. */
const masked = (v: Record<string, string | undefined>, locked: boolean) =>
    Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
            if (!SECRET_APP_SETTING_KEYS.has(k)) return [k, x ?? ""];
            const plain = locked ? openSavedSecret(x) : (x ?? "");
            return [k, plain === null ? (x ? "(cannot open — re-enter)" : "") : maskSecret(plain)];
        }),
    );

/** Saved values, plus what .env holds for each key so the form can say where a value comes from.
 *  `?numbers=1` lists every WhatsApp account's phone numbers from Meta (live, not
 *  cached); `accounts` says per account whether Meta let us read it. */
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    try {
        if (new URL(req.url).searchParams.get("numbers")) {
            try {
                const accounts = await listWaPhoneNumbers();
                return NextResponse.json({
                    numbers: accounts.flatMap((a) => a.numbers),
                    accounts: accounts.map(({ numbers, ...a }) => ({ ...a, count: numbers.length })),
                });
            } catch (e) {
                return NextResponse.json({ error: (e as Error).message }, { status: 502 });
            }
        }
        const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { appSettingsJson: true } });
        const env = Object.fromEntries(APP_SETTING_DEFS.map((d) => [d.key, envAppSetting(d.key) ?? ""]));
        // .env-only keys: set or not, never the value.
        const envOnly = Object.fromEntries(ENV_ONLY_KEYS.map((k) => [k, Boolean(process.env[k]?.trim())]));
        return NextResponse.json({
            values: masked(normalizeAppSettings(od?.appSettingsJson), true),
            env: masked(env, false),
            envOnly,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load app settings");
    }
}

const putSchema = z.object(
    Object.fromEntries(
        APP_SETTING_DEFS.map((d) => {
            let f = z.string().trim().max(1000);
            if ("numeric" in d && d.numeric) f = f.regex(/^\d*$/, `${d.label}: numbers only`);
            if ("options" in d && d.options) {
                const opts: readonly string[] = d.options;
                f = f.refine((v) => v === "" || opts.includes(v), `${d.label}: pick one of the list`);
            }
            return [d.key, f.optional()];
        }),
    ) as Record<AppSettingKey, z.ZodOptional<z.ZodString>>,
);

export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        const incoming = data as Record<string, string | undefined>;
        const touchesSecret = [...SECRET_APP_SETTING_KEYS].some((k) => incoming[k] !== undefined);
        if (touchesSecret) {
            const { response: denied } = await requirePermission(PERMISSIONS.SETTINGS_APP_SECRETS);
            if (denied) return denied;
            if ([...SECRET_APP_SETTING_KEYS].some((k) => incoming[k]) && !hasScrambleSecret()) {
                return NextResponse.json({ error: "SCRAMBLE_KEY_SECRET is not set on this server — secrets cannot be saved locked." }, { status: 422 });
            }
        }
        const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { appSettingsJson: true } });
        const saved = normalizeAppSettings(od?.appSettingsJson);
        // Non-secrets: the body is the whole set. Secrets: kept unless the body names them;
        // a new one is stored locked.
        const merged: Record<string, string | undefined> = { ...incoming };
        for (const k of SECRET_APP_SETTING_KEYS) {
            const v = incoming[k];
            merged[k] = v === undefined ? saved[k as AppSettingKey] : v.trim() ? lockSecret(v.trim(), "scramble") : undefined;
        }
        const values: AppSettingValues = normalizeAppSettings(merged);
        await prisma.orgDefaults.upsert({
            where: { id: 1 },
            create: { id: 1, appSettingsJson: values },
            update: { appSettingsJson: values },
        });
        revalidateTag(APP_SETTINGS_TAG, { expire: 0 });
        clearWaTemplateCache(); // the bills account may have changed
        return NextResponse.json({ values: masked(values, true) });
    } catch (e) {
        return handleApiError(e, "Failed to save app settings");
    }
}

const registerSchema = z.object({
    phoneNumberId: z.string().regex(/^\d+$/, "Phone number ID: digits only"),
    pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits"),
    /** "register" (Pending → Connected) or "pin" (change a Connected number's PIN). */
    action: z.enum(["register", "pin"]).default("register"),
});

/** POST — register a Pending number, or change a Connected number's 2-step PIN.
 *  The PIN is typed by staff and never stored here. */
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, registerSchema);
    if (error) return error;
    try {
        if (data.action === "pin") await setWaTwoStepPin(data.phoneNumberId, data.pin);
        else await registerWaPhoneNumber(data.phoneNumberId, data.pin);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
}
