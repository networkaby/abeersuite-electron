import type { PortalAccountOption } from "@/shared/lib/auth/portalAccountContext";

/**
 * Wire shape of GET /api/portal/me — shared by the server loader
 * (`portalProfile.ts`) and the browser store so neither drifts.
 */

export type PortalContact = {
    id: number;
    value: string;
    isPrimary: boolean;
    /** Staff-entered or OTP-proved. Only a verified contact may be primary or sign in. */
    verified: boolean;
    /** The contact the password login is bound to — cannot be removed. */
    isLogin: boolean;
};

export type PortalProfile = {
    id: number;
    name: string;
    address: string | null;
    avatarUrl: string | null;
    phones: PortalContact[];
    emails: PortalContact[];
    /** Personal + linked companies; `activeAccountId` says which one is in use. */
    profiles: PortalAccountOption[];
    activeAccountId: number;
    social: { handle: string } | null;
    hasPassword: boolean;
};
