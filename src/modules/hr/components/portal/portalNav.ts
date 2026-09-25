// The portal's map: six groups across the top, a few views inside the bigger
// ones. Career first, social last (owner, 2026-09-26: "it should not distract
// user from official career information"). Keys are what `?tab=&view=` carry.

export const GROUPS = ["overview", "work", "leave", "pay", "me", "social"] as const;
export type Group = (typeof GROUPS)[number];

export const VIEWS: Record<Group, readonly string[]> = {
    overview: [],
    work: ["attendance", "activity", "penalties"],
    leave: [],
    pay: ["payslips", "salary", "money", "target"],
    me: ["job", "personal", "id card", "profile", "security"],
    social: ["wall", "friends", "activity", "about"],
};

export interface PortalNav {
    group: Group;
    view: string | null;
    go: (group: Group, view?: string) => void;
}
