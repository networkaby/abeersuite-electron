// ── Session revocation on permission change ──────────────────────────────────
// Permissions ride the JWT, so a role or override change would otherwise sit
// dormant until the user happens to log in again. These helpers bump
// `User.tokensValidFrom` — the same stamp the sign-out event uses — so every
// existing token for the affected user(s) is rejected on its next request and
// the user re-logs with fresh grants. Blunt (it logs the user out) but safe:
// a permission change takes effect on the very next click.

import { prisma } from "@/shared/lib/prisma/prismaClient";

/** Revoke all sessions of one user (their roles/overrides/positions changed). */
export async function revokeUserSessions(userId: number): Promise<void> {
    await prisma.user
        .update({ where: { id: userId }, data: { tokensValidFrom: new Date() } })
        .catch(() => { /* best-effort — the change itself already saved */ });
}

/** Revoke sessions of every user whose grants flow from this role — a direct
 * `User.role` assignment or any held Position carrying the role as template. */
export async function revokeRoleSessions(roleId: string): Promise<void> {
    await prisma.user
        .updateMany({
            where: {
                OR: [
                    { role: roleId },
                    { userPositions: { some: { position: { roleTemplates: { some: { roleId } } } } } },
                ],
            },
            data: { tokensValidFrom: new Date() },
        })
        .catch(() => { /* best-effort */ });
}

/** Revoke sessions of every current holder of a position (its role templates
 * or branch/department stamp changed). */
export async function revokePositionSessions(positionId: string): Promise<void> {
    await prisma.user
        .updateMany({
            where: { userPositions: { some: { positionId } } },
            data: { tokensValidFrom: new Date() },
        })
        .catch(() => { /* best-effort */ });
}
