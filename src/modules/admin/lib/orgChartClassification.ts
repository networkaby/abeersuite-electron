// ── Org-chart position classification ────────────────────────────────────────
//
// Controls which row a position lands in inside the Executive Council band
// (and HQ container). Rules are evaluated top-to-bottom; the first match wins.
//
// Each rule has:
//   section   — which row it belongs to
//   match     — "startsWith" | "contains" | "pattern"
//   values    — list of lowercase strings or regex patterns to test against
//
// The title is lowercased before matching. "startsWith" and "contains" are
// plain string checks; "pattern" uses a RegExp.
//
// To add "President" to Chief Executive, just add "president" to that rule's
// values list. No component code needs to change.

export type OrgSection = "board" | "chiefExecutive" | "cLevel" | "other";

export interface ClassificationRule {
    section: OrgSection;
    match: "startsWith" | "contains" | "pattern";
    values: (string | RegExp)[];
}

export const ORG_CLASSIFICATION_RULES: ClassificationRule[] = [
    // ── Board of Directors ────────────────────────────────────────────────────
    {
        section: "board",
        match: "contains",
        values: [
            "chairman",
            "chairperson",
            "board director",
            "board member",
            "independent director",
        ],
    },

    // ── Chief Executive ───────────────────────────────────────────────────────
    {
        section: "chiefExecutive",
        match: "startsWith",
        values: [
            "chief executive",
            "ceo",
            "managing director",
            "md",
            "president",       // ← add / remove freely
        ],
    },
    {
        // also catch "Group CEO", "Co-CEO", etc.
        section: "chiefExecutive",
        match: "contains",
        values: ["ceo"],
    },

    // ── C-Level (Chief Officers) ──────────────────────────────────────────────
    {
        section: "cLevel",
        match: "startsWith",
        values: [
            "cfo",
            "cto",
            "coo",
            "cio",
            "cmo",
            "cso",
            "chief",
        ],
    },
    {
        // catch any 3-letter C_O abbreviation: CFO, CTO, COO, CXO …
        section: "cLevel",
        match: "pattern",
        values: [/\bc[a-z]o\b/],
    },

];

// ── Classifier ────────────────────────────────────────────────────────────────

export function classifyPosition(title: string): OrgSection {
    const t = title.toLowerCase();
    for (const rule of ORG_CLASSIFICATION_RULES) {
        for (const v of rule.values) {
            let hit = false;
            if (v instanceof RegExp) {
                hit = v.test(t);
            } else if (rule.match === "startsWith") {
                hit = t.startsWith(v);
            } else {
                // "contains" — word-boundary aware for common cases
                hit = t.includes(v);
            }
            if (hit) return rule.section;
        }
    }
    return "other";
}

export const SECTION_LABELS: Record<OrgSection, string> = {
    board: "Board of Directors",
    chiefExecutive: "Chief Executive",
    cLevel: "C-Level",
    other: "Org-Wide",
};
