// The "did anything change?" snapshot of a Payment / Receipt / Contra / Note
// voucher form. Moved out of GlVoucherPage.tsx unchanged; tested in
// glVoucherSnapshot.test.ts.

import { round2 } from "@/shared/lib/format/moneyInr";
import type { DenomJson } from "@/shared/lib/accountancy/denomJson";

// Normalized line for dirty-check comparison.
// `instrument` = "<method>|<reference>" of the line ("" when none).
export type SnapLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string; instrument: string };
// `denom` = the deposit-slip capture as a stable key — a Payment's note count
// never moves its lines, so without it a count-only edit read as "no changes".
export type Snapshot = { date: string; narration: string; lines: SnapLine[]; denom: string };
export const denomKey = (d: DenomJson | null): string => d
    ? JSON.stringify([
        Object.entries(d.notes).filter(([, c]) => c > 0).sort(([a], [b]) => Number(a) - Number(b)),
        d.cheques.map((c) => [c.no, round2(c.amount), c.account ?? ""]),
    ])
    : "";
export const instrumentKey = (method?: string | null, reference?: string | null) =>
    method || (reference ?? "").trim() ? `${method ?? ""}|${(reference ?? "").trim()}` : "";

export function normalizeLines(lines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string | null; method?: string | null; reference?: string | null }[]): SnapLine[] {
    return lines
        .map((l) => ({
            accountId:   l.accountId,
            type:        l.type,
            amount:      round2(l.amount),
            description: (l.description ?? "").trim(),
            instrument:  instrumentKey(l.method, l.reference),
        }))
        .sort((a, b) =>
            a.accountId - b.accountId
            || a.type.localeCompare(b.type)
            || a.amount - b.amount,
        );
}

export function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
    if (a.date !== b.date) return false;
    if (a.narration !== b.narration) return false;
    if (a.denom !== b.denom) return false;
    if (a.lines.length !== b.lines.length) return false;
    for (let i = 0; i < a.lines.length; i++) {
        const x = a.lines[i], y = b.lines[i];
        if (x.accountId !== y.accountId) return false;
        if (x.type !== y.type) return false;
        if (Math.abs(x.amount - y.amount) > 0.005) return false;
        if (x.description !== y.description) return false;
        if (x.instrument !== y.instrument) return false;
    }
    return true;
}
