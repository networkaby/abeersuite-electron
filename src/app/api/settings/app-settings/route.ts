import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { APP_SETTING_DEFS, normalizeAppSettings, type AppSettingKey } from "@/shared/lib/constants/appSettings";
import { APP_SETTINGS_TAG, envAppSetting } from "@/shared/lib/settings/appSettings.server";
import { listWaPhoneNumbers } from "@/shared/lib/whatsapp/metaTemplates";

// Settings → App Settings. Stored on OrgDefaults.appSettingsJson; a blank key falls
// back to .env. Only low-sensitivity ids live here — secrets stay in Vercel.

/** Saved values, plus what .env holds for each key so the form can say where a value comes from.
 *  `?numbers=1` also lists the WABA's phone numbers from Meta (live, not cached). */
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    try {
        if (new URL(req.url).searchParams.get("numbers")) {
            try {
                return NextResponse.json({ numbers: await listWaPhoneNumbers() });
            } catch (e) {
                return NextResponse.json({ error: (e as Error).message }, { status: 502 });
            }
        }
        const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { appSettingsJson: true } });
        const env = Object.fromEntries(APP_SETTING_DEFS.map((d) => [d.key, envAppSetting(d.key) ?? ""]));
        return NextResponse.json({ values: normalizeAppSettings(od?.appSettingsJson), env });
    } catch (e) {
        return handleApiError(e, "Failed to load app settings");
    }
}

const putSchema = z.object(
    Object.fromEntries(
        APP_SETTING_DEFS.map((d) => {
            let f = z.string().trim().max(200);
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
        const values = normalizeAppSettings(data);
        await prisma.orgDefaults.upsert({
            where: { id: 1 },
            create: { id: 1, appSettingsJson: values },
            update: { appSettingsJson: values },
        });
        revalidateTag(APP_SETTINGS_TAG, { expire: 0 });
        return NextResponse.json({ values });
    } catch (e) {
        return handleApiError(e, "Failed to save app settings");
    }
}
