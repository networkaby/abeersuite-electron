import type { LucideIcon } from "lucide-react";
import { MODULE_SECTIONS } from "@/utils/constants";

/** Sidebar module keys that use `(roadmap)/[moduleKey]` pages (hub + section stubs). */
export const ROADMAP_MODULE_KEYS = [
    "hrm",
    "delivery",
    "field-service",
    "helpdesk",
    "projects",
    "intelligence",
    "administration",
    "retention",
    "pricing-strategy",
] as const;

export type RoadmapModuleKey = (typeof ROADMAP_MODULE_KEYS)[number];

const KEY_SET = new Set<string>(ROADMAP_MODULE_KEYS);

export function isRoadmapModuleKey(key: string): key is RoadmapModuleKey {
    return KEY_SET.has(key);
}

export type RoadmapNavLink = {
    href: string;
    label: string;
    icon: LucideIcon;
};

export function roadmapModuleLinks(moduleKey: string): RoadmapNavLink[] {
    const section = MODULE_SECTIONS.find((m) => m.key === moduleKey);
    if (!section) return [];
    return section.children
        .filter(
            (c): c is typeof c & { href: string } =>
                typeof c.href === "string" && c.href.length > 0 && !c.disabled
        )
        .map((c) => ({ href: c.href, label: c.label, icon: c.icon }));
}

/** Hub landing: every roadmap module’s first nav entry is the overview at `/office/{key}`. */
export function roadmapHubHref(moduleKey: string): string {
    return `/office/${moduleKey}`;
}

/** Cards for the overview grid (everything except the overview URL itself). */
export function roadmapHubCards(moduleKey: string): RoadmapNavLink[] {
    const base = roadmapHubHref(moduleKey);
    return roadmapModuleLinks(moduleKey).filter((l) => l.href !== base);
}

export function findRoadmapSection(
    moduleKey: string,
    section: string
): RoadmapNavLink | undefined {
    const href = `/office/${moduleKey}/${section}`;
    return roadmapModuleLinks(moduleKey).find((l) => l.href === href);
}
