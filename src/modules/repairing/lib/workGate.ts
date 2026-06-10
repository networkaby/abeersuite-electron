import { hasPermission, type ResolvedUser } from "@/shared/lib/auth/permissions";

/**
 * A status / sub-status carries a Work. When that Work is gated (has a
 * `permissionId`), the user must hold that permission to set it. An ungated
 * Work — or a status/sub-status with no Work at all — is open to any
 * authenticated staff. `hasPermission` already honours `admin:bypass`.
 */
export function passesWorkGate(
    user: ResolvedUser,
    work: { permissionId: string | null } | null | undefined,
): boolean {
    if (!work || !work.permissionId) return true;
    return hasPermission(user, work.permissionId);
}
