// One place that decides what goes on the staff identity card.
//
// Both callers use it, so the preview on screen and the card on paper can
// never say different things: the preview panel (client, fed by
// /api/hr/staff/[userId]) and the print sheet (server, fed by Prisma).

import { formatDate } from "@/shared/lib/format/formatDate";
import type { StaffIdCardData } from "@/shared/components/print/StaffIdCard";
import type { StaffDetail } from "./staffTypes";

/** The slice of a staff record the card reads — StaffDetail satisfies it. */
export type StaffIdCardSource = Pick<StaffDetail, "user" | "profile">;

export function toStaffIdCardData({ user, profile }: StaffIdCardSource): StaffIdCardData {
    return {
        name: user.name,
        // The person's own title first; their seat is the fallback, because a
        // new joiner often holds a position before anyone types a title.
        designation: user.title?.trim() || user.positions[0]?.title || null,
        photoUrl: user.avatarUrl,
        staffCode: profile?.staffCode ?? null,
        joinedOn: profile?.joinedOn ? formatDate(profile.joinedOn) : null,
        phone: user.phone,
        bloodGroup: profile?.bloodGroup ?? null,
        emergencyName: profile?.emergencyName ?? null,
        emergencyPhone: profile?.emergencyPhone ?? null,
        address: profile?.address ?? null,
    };
}
