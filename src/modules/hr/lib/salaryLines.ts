// The salary structure — a handful of named lines, each an earning or a
// deduction, in paise. Read whole from StaffSalary.linesJson; the two totals are
// denormalised onto the row so a list never parses JSON.

export type SalaryLineKind = "EARNING" | "DEDUCTION";

export interface SalaryLine {
    name: string;
    kind: SalaryLineKind;
    amountPaise: number;
}

/** The lines a brand-new revision starts with. One earning, nothing withheld. */
export const DEFAULT_SALARY_LINES: SalaryLine[] = [
    { name: "Basic", kind: "EARNING", amountPaise: 0 },
];

export function sumLines(lines: readonly SalaryLine[], kind: SalaryLineKind): number {
    return lines.reduce((sum, l) => (l.kind === kind ? sum + l.amountPaise : sum), 0);
}

/** gross = every earning; net = gross − every deduction. */
export function salaryTotals(lines: readonly SalaryLine[]): { grossPaise: number; deductionsPaise: number; netPaise: number } {
    const grossPaise = sumLines(lines, "EARNING");
    const deductionsPaise = sumLines(lines, "DEDUCTION");
    return { grossPaise, deductionsPaise, netPaise: grossPaise - deductionsPaise };
}

/** Defensive read of the JSON column — a malformed row yields no lines, never a crash. */
export function parseSalaryLines(v: unknown): SalaryLine[] {
    if (!Array.isArray(v)) return [];
    const out: SalaryLine[] = [];
    for (const raw of v) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const name = typeof r.name === "string" ? r.name : "";
        const kind = r.kind === "DEDUCTION" ? "DEDUCTION" : "EARNING";
        const amountPaise = typeof r.amountPaise === "number" && Number.isFinite(r.amountPaise) ? Math.round(r.amountPaise) : 0;
        if (name) out.push({ name, kind, amountPaise });
    }
    return out;
}
