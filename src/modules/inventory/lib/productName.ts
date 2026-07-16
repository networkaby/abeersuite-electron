// Builds offline name / online name / online slug for an InvProduct from the
// master selects (brand / category / group / warranty / unit / modelNo) per
// the singleton InvNamingConfig. Token resolution walks: primary source →
// fallback chain (per kind) → token-level defaultValue → skip.
//
// Single source of truth for naming: any UI or server-side regenerator MUST
// call these helpers — inline string assembly drifts away from the user's
// configured template silently.

import { slugify } from "@/shared/lib/format/slugify";

export type TokenKind =
    | "brand"
    | "category"
    | "group"
    | "modelNo"
    | "warranty"
    | "unit"
    | "literal"
    | "attr"
    /// Operator-curated free text from InvProduct.namePart. Survives every
    /// regenerate-name pass — the auto-built tokens never overwrite it. Place
    /// this token in the template wherever the curated portion should appear
    /// (e.g. between brand and model, or at the end).
    | "userPart";

export interface NamingToken {
    kind: TokenKind;
    enabled: boolean;
    defaultValue?: string | null;
    /** Only used when kind === "literal". */
    literal?: string;
    /** Only used when kind === "attr" — the key to read from InvProduct.attrsJson. */
    attrKey?: string | null;
    /** Prepended to the resolved value (e.g. "(" or " ["). Empty/null = none. */
    prefix?: string | null;
    /** Appended to the resolved value (e.g. ")" or "]"). Empty/null = none. */
    suffix?: string | null;
}

export type FallbackMap = Partial<Record<TokenKind, TokenKind[]>>;

export interface NamingMasters {
    brand?: { name: string } | null;
    category?: { name: string } | null;
    group?: { name: string } | null;
    warranty?: { name: string } | null;
    unit?: { code: string } | null;
    modelNo?: string | null;
    /** Custom attribute bag from InvProduct.attrsJson — flat key→value. */
    attrs?: Record<string, string> | null;
    /** Operator-curated free text from InvProduct.namePart. */
    userPart?: string | null;
}

export interface NamingConfigShape {
    nameFields: NamingToken[];
    separator: string;
    onlineNameFields: NamingToken[];
    onlineSeparator: string;
    slugFields: NamingToken[];
    slugSeparator: string;
    slugEnabled: boolean;
    slugMaxLength: number;
    fallbackFields: FallbackMap;
}

function primarySource(kind: TokenKind, m: NamingMasters): string {
    switch (kind) {
        case "brand":    return m.brand?.name?.trim() ?? "";
        case "category": return m.category?.name?.trim() ?? "";
        case "group":    return m.group?.name?.trim() ?? "";
        case "warranty": return m.warranty?.name?.trim() ?? "";
        case "unit":     return m.unit?.code?.trim() ?? "";
        case "modelNo":  return (m.modelNo ?? "").trim();
        case "userPart": return (m.userPart ?? "").trim();
        case "literal":
        case "attr":     return ""; // handled directly in resolveToken
    }
}

function resolveToken(
    token: NamingToken,
    masters: NamingMasters,
    fallback: FallbackMap,
): string {
    if (!token.enabled) return "";

    let value: string;
    if (token.kind === "literal") {
        value = (token.literal ?? "").trim();
    } else if (token.kind === "attr") {
        // Reads directly from attrsJson by key — no fallback chain for custom attrs.
        value = (masters.attrs?.[token.attrKey ?? ""] ?? "").trim();
        if (!value) value = (token.defaultValue ?? "").trim();
    } else {
        const primary = primarySource(token.kind, masters);
        if (primary) {
            value = primary;
        } else {
            value = "";
            for (const next of fallback[token.kind] ?? []) {
                const v = primarySource(next, masters);
                if (v) { value = v; break; }
            }
            if (!value) value = (token.defaultValue ?? "").trim();
        }
    }

    if (!value) return "";
    return `${token.prefix ?? ""}${value}${token.suffix ?? ""}`;
}

function resolveAll(
    tokens: NamingToken[] | undefined,
    masters: NamingMasters,
    fallback: FallbackMap | undefined,
): string[] {
    const out: string[] = [];
    for (const t of tokens ?? []) {
        const v = resolveToken(t, masters, fallback ?? {});
        if (v) out.push(v);
    }
    return out;
}

export function buildOfflineName(masters: NamingMasters, cfg: NamingConfigShape): string {
    return resolveAll(cfg.nameFields, masters, cfg.fallbackFields).join(cfg.separator);
}

export function buildOnlineName(masters: NamingMasters, cfg: NamingConfigShape): string {
    return resolveAll(cfg.onlineNameFields, masters, cfg.fallbackFields).join(cfg.onlineSeparator);
}

export function buildOnlineSlug(masters: NamingMasters, cfg: NamingConfigShape): string {
    if (!cfg.slugEnabled) return "";
    const joined = resolveAll(cfg.slugFields, masters, cfg.fallbackFields).join(cfg.slugSeparator || "-");
    return slugify(joined, { separator: cfg.slugSeparator || "-", maxLength: cfg.slugMaxLength ?? 0 });
}

// Hard-coded defaults — used by the API when no row exists and by the seed.
export const DEFAULT_NAMING_CONFIG: NamingConfigShape = {
    nameFields: [
        { kind: "brand",    enabled: true, defaultValue: null },
        { kind: "group",    enabled: true, defaultValue: "General" },
        { kind: "modelNo",  enabled: true, defaultValue: null },
        // Operator-curated free text (InvProduct.namePart). Sits after the
        // master-driven tokens so regenerate rebuilds masters around it without
        // ever overwriting it. Must match bootstrap-seed.ts namingDefaults.
        { kind: "userPart", enabled: true, defaultValue: null },
    ],
    separator: " ",
    onlineNameFields: [
        { kind: "brand",    enabled: true, defaultValue: null },
        { kind: "group",    enabled: true, defaultValue: null },
        { kind: "category", enabled: true, defaultValue: null },
        { kind: "modelNo",  enabled: true, defaultValue: null },
        { kind: "warranty", enabled: true, defaultValue: null },
    ],
    onlineSeparator: " ",
    slugFields: [
        { kind: "brand",   enabled: true, defaultValue: null },
        { kind: "group",   enabled: true, defaultValue: null },
        { kind: "modelNo", enabled: true, defaultValue: null },
    ],
    slugSeparator: "-",
    slugEnabled: true,
    slugMaxLength: 80,
    fallbackFields: {
        group:    ["category", "brand"],
        category: ["group", "brand"],
        brand:    ["group", "category"],
    },
};
