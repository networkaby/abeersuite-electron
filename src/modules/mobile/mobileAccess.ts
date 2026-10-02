import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export type MobileUser = { id: string; name: string; permissions: string[] };

/** The signed-in staff member on a phone screen. With `permissionId` (the screen's
 *  tick, from mobileScreens.ts), a person without it is sent back to Home rather
 *  than shown an empty screen whose API would refuse anyway. */
export async function mobileUser(permissionId?: string): Promise<MobileUser> {
    const session = await auth();
    const user = session?.user as { id?: string; name?: string | null; permissions?: string[] } | undefined;
    if (!user?.id) redirect("/staff/login?callbackUrl=/m");
    const permissions = user.permissions ?? [];
    if (permissionId && !permissions.includes(permissionId) && !permissions.includes(PERMISSIONS.ADMIN_BYPASS)) redirect("/m");
    return { id: user.id, name: user.name ?? "", permissions };
}
