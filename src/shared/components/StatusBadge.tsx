import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUS_COLORS, JOURNAL_STATUS_COLORS, GL_TYPE_COLORS, type GlAccountType } from "@/shared/lib/constants/badges";

/**
 * Coloured status pill. Pass a `kind` (`"invoice" | "journal" | "glType"`) and a
 * `value` (the status string / GL type); the badge resolves the right Tailwind
 * class set from `src/shared/lib/constants/badges.ts`.
 *
 *   <StatusBadge kind="invoice" value={invoice.status} />
 *   <StatusBadge kind="journal" value={je.status} />
 *   <StatusBadge kind="glType"  value={account.group.type} />
 *
 * For ad-hoc colours (roles, customer levels, etc.) keep using inline class
 * strings — this badge only covers the three canonical maps that recur across
 * accountancy + ledger UIs.
 */
type Kind = "invoice" | "journal" | "glType";

const MAPS: Record<Kind, Record<string, string>> = {
    invoice: INVOICE_STATUS_COLORS,
    journal: JOURNAL_STATUS_COLORS,
    glType: GL_TYPE_COLORS as Record<GlAccountType, string>,
};

export function StatusBadge({
    kind,
    value,
    fallback = "bg-muted text-muted-foreground",
    className = "",
}: {
    kind: Kind;
    value: string | null | undefined;
    fallback?: string;
    className?: string;
}) {
    const key = value ?? "";
    const cls = MAPS[kind][key] ?? fallback;
    return <Badge className={`${cls} ${className}`}>{key || "—"}</Badge>;
}
