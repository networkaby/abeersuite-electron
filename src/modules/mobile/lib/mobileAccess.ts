import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { PARTY_TICKS } from "./mobileScreens";
import { PHONE_APP_HOME, PHONE_APP_SIGN_IN } from "@/shared/lib/device/phone";

export type MobileUser = { id: string; name: string; permissions: string[] };

/** The signed-in staff member on a phone screen. With `permissionId` (the screen's
 *  tick, from mobileScreens.ts — or a list, any one of which will do), a person
 *  without it is sent back to Home rather than shown an empty screen whose API
 *  would refuse anyway. */
export async function mobileUser(permissionId?: string | readonly string[]): Promise<MobileUser> {
    const session = await auth();
    const user = session?.user as { id?: string; name?: string | null; permissions?: string[] } | undefined;
    if (!user?.id) redirect(PHONE_APP_SIGN_IN);
    const permissions = user.permissions ?? [];
    const needs = permissionId == null ? [] : typeof permissionId === "string" ? [permissionId] : permissionId;
    if (needs.length > 0 && !needs.some((p) => permissions.includes(p)) && !permissions.includes(PERMISSIONS.ADMIN_BYPASS)) {
        redirect(PHONE_APP_HOME);
    }
    return { id: user.id, name: user.name ?? "", permissions };
}

/** One party's balance and bills open from any of the party lists — party search,
 *  receivables or payables — so any one of their ticks opens it. */
export const PARTY_DETAIL_PERMISSIONS = PARTY_TICKS;
