// The wire shapes and small helpers of a person's profile page, shared by the
// Employee Portal (/office/me — yourself) and a colleague's profile
// (/office/user/[id]). They used to live inside one 1,400-line page file.

export interface Permission {
    id: string; label: string; module: string; description: string | null;
}
export interface StaffCard {
    id: number; name: string; title: string | null; role: string | null;
    avatarUrl: string | null;
    userRole: { label: string; color: string } | null;
}
export interface UserProfile {
    id: number; name: string; email: string; title: string | null;
    role: string | null; scope: string; createdAt: string; managerId: number | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    phone: string | null;
    birthday: string | null;
    bio: string | null;
    linkedIn: string | null;
    twitter: string | null;
    instagram: string | null;
    facebook: string | null;
    userRole: { id: string; label: string; color: string; rank: number; permissions: { permission: Permission }[] } | null;
    manager: StaffCard | null;
    reports: StaffCard[];
    /** Their HR seats — the first one's title is their job title. */
    positions: { id: string; title: string }[];
    departments: { id: string; name: string }[];
    branches: { id: string; name: string }[];
}
export interface WallPost {
    id: number; body: string; createdAt: string;
    // Resolved SocialActor — author may be a staff User or a customer Person.
    author: {
        kind: "USER" | "PERSON"; id: number; name: string; avatarUrl: string | null;
        href: string; role: string | null;
        roleBadge: { label: string; color: string } | null;
        isCustomer: boolean;
    };
}
export interface UserActivity {
    id: string;
    type: "ticket_created" | "ticket_updated" | "wall_post" | "user_joined" | "login_untracked" | "logout_untracked";
    title: string;
    description: string;
    createdAt: string;
    meta?: { ticketId?: number; wallUserId?: number; wallUserName?: string };
}
export type ActivityPeriod = "today" | "7d" | "30d";

/** Where a person's page is. Your own id lands on the portal, anyone else on their profile. */
export const userProfileHref = (id: number) => `/office/user/${id}`;
export const MY_PORTAL_HREF = "/office/me";

export const SCOPE_LABELS: Record<string, string> = {
    OWN: "Own records", TEAM: "Direct reports", DEPARTMENT: "Full department",
    BRANCH: "Full branch", REGION: "Region-wide", ORG: "Entire organisation",
};
const COVER_GRADIENT: Record<string, string> = {
    R1: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)",
    R2: "linear-gradient(135deg,#1d4ed8 0%,#3b82f6 100%)",
    R3: "linear-gradient(135deg,#15803d 0%,#22c55e 100%)",
    R4: "linear-gradient(135deg,#c2410c 0%,#f97316 100%)",
    R5: "linear-gradient(135deg,#be185d 0%,#ec4899 100%)",
};

/** The job title everyone sees: the HR seat's, then an old self-typed one for a
 *  person with no seat yet. Staff no longer type it themselves. */
export const jobTitleOf = (u: { title: string | null; positions?: { title: string }[] }) =>
    u.positions?.[0]?.title || u.title?.trim() || null;

export function coverBg(role: string | null) {
    return COVER_GRADIENT[role ?? ""] ?? "linear-gradient(135deg,#334155 0%,#64748b 100%)";
}
export function formatBirthday(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}
export function ensureUrl(url: string) {
    return url.startsWith("http") ? url : `https://${url}`;
}
export function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
