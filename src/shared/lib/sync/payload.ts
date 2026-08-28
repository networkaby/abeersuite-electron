/**
 * Exact-value parsing for outbox payloads.
 *
 * Its own module so neither `outbox.ts` (which reads payloads) nor `push.ts` (which
 * applies them) has to import the other.
 */

/**
 * Re-parses a payload, keeping Decimal/BigInt fields as strings.
 *
 * The trigger stores `to_jsonb(NEW)`, which holds `numeric` exactly. The precision is
 * lost in JavaScript instead: `JSON.parse` makes every number a double, so a Decimal
 * past ~15 significant digits or a BigInt past 2^53 changes value in transit, silently.
 * Prisma accepts a string for both types, so the fix is to quote those fields before
 * parsing — and ONLY those, since Prisma validates Int and would reject a quoted one.
 *
 * Scans rather than regex-replacing: a `notes` column containing the text
 * `"amountPaise": 1` would otherwise be rewritten inside the string. Tracking string
 * state and depth makes that impossible, and only top-level keys are considered
 * because `exact` describes columns, not the contents of a jsonb column.
 */
export function parsePayloadExact(json: string, exact: readonly string[]): Record<string, unknown> {
    if (exact.length === 0) return JSON.parse(json) as Record<string, unknown>;
    const wanted = new Set(exact);

    let out = "";
    let i = 0;
    let depth = 0;
    let pendingKey: string | null = null;

    while (i < json.length) {
        const ch = json[i];

        if (ch === '"') {
            let j = i + 1;
            let raw = "";
            while (j < json.length) {
                if (json[j] === "\\") { raw += json[j] + json[j + 1]; j += 2; continue; }
                if (json[j] === '"') break;
                raw += json[j];
                j++;
            }
            out += json.slice(i, j + 1);
            i = j + 1;
            // A string is a KEY only if the next non-space character is a colon.
            let k = i;
            while (k < json.length && /\s/.test(json[k])) k++;
            pendingKey = json[k] === ":" ? raw : null;
            continue;
        }

        if (ch === "{" || ch === "[") { depth++; out += ch; i++; continue; }
        if (ch === "}" || ch === "]") { depth--; out += ch; i++; continue; }
        if (ch === ",") { pendingKey = null; out += ch; i++; continue; }

        if (depth === 1 && pendingKey !== null && wanted.has(pendingKey) && /[-\d]/.test(ch)) {
            let j = i;
            while (j < json.length && /[-+.eE\d]/.test(json[j])) j++;
            out += `"${json.slice(i, j)}"`;
            i = j;
            pendingKey = null;
            continue;
        }

        out += ch;
        i++;
    }

    return JSON.parse(out) as Record<string, unknown>;
}

