// Cross-cutting URL-slug helper. Lowercases, replaces every non-alphanumeric
// run with the separator, trims separator from both ends, optionally truncates.
//
// Mirrors the `sku.ts` single-helper-source-of-truth pattern: any code that
// needs to turn a human-readable string into a URL handle MUST call this —
// inline regex variations drift apart silently.

export interface SlugifyOptions {
    separator?: string;
    /** 0 = uncapped */
    maxLength?: number;
}

export function slugify(input: string, opts: SlugifyOptions = {}): string {
    const sep = opts.separator ?? "-";
    const max = opts.maxLength ?? 0;

    const escaped = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let out = input
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, sep);

    if (sep) {
        const trimRe = new RegExp(`^${escaped}+|${escaped}+$`, "g");
        out = out.replace(trimRe, "");
        const collapseRe = new RegExp(`${escaped}{2,}`, "g");
        out = out.replace(collapseRe, sep);
    }

    if (max > 0 && out.length > max) {
        out = out.slice(0, max);
        if (sep) {
            const trimRe = new RegExp(`${escaped}+$`);
            out = out.replace(trimRe, "");
        }
    }
    return out;
}
