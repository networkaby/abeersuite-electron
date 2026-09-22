"use client";

// Pay Rules — the shop's money rules for time, expressed as percentages so they
// follow every salary by themselves. Rupee figures deliberately do not appear
// here: a basic is per person and lives on the staff record, so this screen
// stays the rule and the staff record stays the amount.
//
// PREVIEW ONLY, deliberately. Nothing here is saved and nothing here pays
// anybody: it exists so the owner can see and feel the rules before they are
// wired to OrgDefaults and to the payroll run. The numbers below are proposed
// defaults, not settings. Wiring comes in a second commit once the shape is
// agreed — see PROJECT_BRAIN.md.

import { useState } from "react";
import { BadgeIndianRupee, Clock4, CalendarHeart, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { Field } from "@/shared/components/Field";

/** One line on the screen: a number, and the sentence that says what it means. */
interface Rule {
    key: string;
    label: string;
    suffix: string;
    explain: (value: number) => string;
}

const OVERTIME_RULES: Rule[] = [
    {
        key: "overtimePct",
        label: "Overtime rate",
        suffix: "% of normal hour",
        explain: (p) => `Each extra hour is paid ${(p / 100).toFixed(2)}x the person's own normal hour.`,
    },
    {
        key: "shortHoursPct",
        label: "Hours still owed at month end",
        suffix: "% of normal hour",
        explain: (p) =>
            p === 0
                ? "Hours still owed at month end are forgiven — nothing is cut."
                : `Each hour still owed is cut at ${(p / 100).toFixed(2)}x the normal hour.`,
    },
];

const WEEKEND_RULES: Rule[] = [
    {
        key: "weeklyOffPct",
        label: "Duty on his own weekly off",
        suffix: "% of normal hour",
        explain: (p) => `An hour worked on his own weekly off is paid ${(p / 100).toFixed(2)}x the normal hour.`,
    },
    {
        key: "holidayPct",
        label: "Duty on a shop holiday",
        suffix: "% of normal hour",
        explain: (p) => `An hour worked on a listed holiday is paid ${(p / 100).toFixed(2)}x the normal hour.`,
    },
];

const PENALTY_RULES: Rule[] = [
    {
        key: "lateGraceMinutes",
        label: "Late is forgiven up to",
        suffix: "minutes",
        explain: (p) =>
            `Signing in within ${p} minute${p === 1 ? "" : "s"} of opening is not counted late. The minutes are still not credited as duty.`,
    },
    {
        key: "lateFreeDays",
        label: "Free late days in a month",
        suffix: "days",
        explain: (p) =>
            p === 0
                ? "Every late day is charged."
                : `The first ${p} late day${p === 1 ? "" : "s"} of the month cost nothing. The penalty starts from the next one.`,
    },
    {
        key: "latePenaltyPct",
        label: "Penalty per late day",
        suffix: "% of one day's basic",
        explain: (p) =>
            p === 0
                ? "No penalty — late arrival costs only the minutes not worked."
                : `Each charged late day cuts ${p}% of one day's basic.`,
    },
];

const DEFAULTS: Record<string, number> = {
    overtimePct: 150,
    shortHoursPct: 100,
    weeklyOffPct: 200,
    holidayPct: 200,
    lateGraceMinutes: 15,
    lateFreeDays: 2,
    latePenaltyPct: 0,
};

export default function PayRulesCard({ canEdit }: { canEdit: boolean }) {
    const [values, setValues] = useState<Record<string, number>>(DEFAULTS);

    const set = (key: string, raw: string) => {
        const n = Number(raw);
        setValues((v) => ({ ...v, [key]: Number.isFinite(n) && n >= 0 ? n : 0 }));
    };

    const group = (title: string, icon: React.ReactNode, note: string, rules: Rule[]) => (
        <section className="mb-4 rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                {icon}
                {title}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">{note}</p>
            <div className="space-y-3">
                {rules.map((r) => (
                    <div key={r.key}>
                        <Field label={r.label} className="w-64">
                            {(id) => (
                                <div className="flex items-center gap-2">
                                    <Input
                                        id={id}
                                        type="number"
                                        min={0}
                                        disabled={!canEdit}
                                        value={values[r.key]}
                                        onChange={(e) => set(r.key, e.target.value)}
                                        className="h-9 w-24 text-sm"
                                    />
                                    <span className="text-xs text-muted-foreground">{r.suffix}</span>
                                </div>
                            )}
                        </Field>
                        <p className="mt-1 text-xs text-muted-foreground">{r.explain(values[r.key])}</p>
                    </div>
                ))}
            </div>
        </section>
    );

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-3xl px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Pay Rules"
                    subtitle="How time turns into money — one set of rules for the whole shop"
                    icon={<BadgeIndianRupee size={20} />}
                />

                <div className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                    <TriangleAlert size={16} className="mt-px shrink-0" />
                    <span>
                        <strong>Preview only.</strong> Change the numbers and watch the sentences — nothing is saved
                        and no payslip is affected yet. Once you agree with the shape, these get stored beside the
                        office hours and the monthly payroll starts obeying them.
                    </span>
                </div>

                <p className="mb-4 text-xs text-muted-foreground">
                    Every rule is a percentage, never a rupee figure. A person&apos;s normal hour is his own basic
                    divided by the duty hours of the month, so one rule fits every salary and nothing needs changing
                    when a salary is revised.
                </p>

                {group(
                    "Overtime",
                    <Clock4 size={15} />,
                    "Extra hours are netted over the month first — a day's extra hour pays back an hour fallen short elsewhere. Only what survives that is paid.",
                    OVERTIME_RULES,
                )}

                {group(
                    "Weekly off & holidays",
                    <CalendarHeart size={15} />,
                    "Hours worked on a day the shop is shut, or on his own weekly off.",
                    WEEKEND_RULES,
                )}

                {group(
                    "Late arrival",
                    <TriangleAlert size={15} />,
                    "Coming late already costs the minutes — duty is credited from the real sign-in. A penalty is a second, deliberate charge on top.",
                    PENALTY_RULES,
                )}
            </div>
        </ScrollArea>
    );
}
