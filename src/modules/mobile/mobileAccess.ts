import { auth } from "@/auth";
import { redirect } from "next/navigation";

export type MobileUser = { id: string; name: string; permissions: string[] };

/** The signed-in staff member on a phone screen. With `permissionId`, a person
 *  without that tick is sent back to the app's home rather than shown an empty
 *  screen whose API would refuse anyway. */
export async function mobileUser(permissionId?: string): Promise<MobileUser> {
    const session = await auth();
    const user = session?.user as { id?: string; name?: string | null; permissions?: string[] } | undefined;
    if (!user?.id) redirect("/staff/login?callbackUrl=/m");
    const permissions = user.permissions ?? [];
    if (permissionId && !permissions.includes(permissionId) && !permissions.includes("admin:bypass")) redirect("/m");
    return { id: user.id, name: user.name ?? "", permissions };
}

export function holds(user: MobileUser, permissionId: string): boolean {
    return user.permissions.includes(permissionId) || user.permissions.includes("admin:bypass");
}
