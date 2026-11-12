import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { APP_SETTING_DEFS, normalizeAppSettings, type AppSettingKey, type AppSettingValues } from "@/shared/lib/constants/appSettings";

/** Invalidated by the App Settings save. */
export const APP_SETTINGS_TAG = "app-settings";

/** The DB half only, cached: senders call this on every message. Five minutes
 *  so a counter whose replica just synced a change picks it up soon. */
export const loadDbAppSettings = unstable_cache(
    async (): Promise<AppSettingValues> => {
        const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { appSettingsJson: true } });
        return normalizeAppSettings(od?.appSettingsJson);
    },
    ["org:app-settings"],
    { tags: [APP_SETTINGS_TAG], revalidate: 300 },
);

const FALLBACK = new Map<string, string | undefined>(
    APP_SETTING_DEFS.map((d) => [d.key, "fallback" in d ? d.fallback : undefined]),
);

export const envAppSetting = (key: AppSettingKey) => process.env[key]?.trim() || undefined;

/** DB value → .env → built-in default. Undefined when none is set. */
export async function appSetting(key: AppSettingKey): Promise<string | undefined> {
    const db = await loadDbAppSettings().catch(() => ({}) as AppSettingValues);
    return db[key] || envAppSetting(key) || FALLBACK.get(key);
}
