"use client";

// Pay Rules — the shop's money rules for time. An hour rate is written as a
// plain multiple (1.5, not 150%), because that is how the shop says it out loud:
// "overtime is one and a half times". Rupee figures deliberately do not appear
// here: a basic is per person and lives on the staff record, so this screen stays
// the rule and the staff record stays the amount.
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
    /** Smallest step the box moves by — quarter-multiples for a rate, whole for a count. */
    step: number;
    explain: (value: number) => string;
}

/** "1.5", "2", "1.25" — never "1.50" or "2.0", which read like a machine wrote them. */
const times = (n: number) => `${Number(n.toFixed(2))} times`;

const OVERTIME_RULES: Rule[] = [
    {
        key: "overtimeRate",
        label: "Overtime rate",
        suffix: "times the normal hour",
        step: 0.25,
        explain: (v) => `Each extra hour is paid ${times(v)} the person's own normal hour.`,
    },
    {
        key: "shortHoursRate",
        label: "Hours still owed at month end",
        suffix: "times the normal hour",
        step: 0.25,
        explain: (v) =>
            v === 0
                ? "Hours still owed at month end are forgiven — nothing is cut."
                : `Each hour still owed is cut at ${times(v)} the normal hour.`,
    },
];

const WEEKEND_RULES: Rule[] = [
    {
        key: "weeklyOffRate",
        label: "Duty on his own weekly off",
        suffix: "times the normal hour",
        step: 0.25,
        explain: (v) => `An hour worked on his own weekly off is paid ${times(v)} the normal hour.`,
    },
    {
        key: "holidayRate",
        label: "Duty on a shop holiday",
        suffix: "times the normal hour",
        step: 0.25,
        explain: (v) => `An hour worked on a listed holiday is paid ${times(v)} the normal hour.`,
    },
];

const PENALTY_RULES: Rule[] = [
    {
        key: "lateGraceMinutes",
        label: "Late is forgiven up to",
        suffix: "minutes",
        step: 5,
        explain: (v) =>
            `Signing in within ${v} minute${v === 1 ? "" : "s"} of opening is not counted late. The minutes are still not credited as duty.`,
    },
    {
        key: "lateFreeDays",
        label: "Free late days in a month",
        suffix: "days",
        step: 1,
        explain: (v) =>
            v === 0
                ? "Every late day is charged."
                : `The first ${v} late day${v === 1 ? "" : "s"} of the month cost nothing. The penalty starts from the next one.`,
    },
    {
        key: "latePenaltyDays",
        label: "Penalty per late day",
        suffix: "days of basic",
        step: 0.25,
        explain: (v) =>
            v === 0
                ? "No penalty — late arrival costs only the minutes not worked."
                : `Each charged late day cuts ${Number(v.toFixed(2))} day${v === 1 ? "" : "s"} of basic.`,
    },
];

/* Held as text, not numbers: a box being typed into passes through "1." and "",
   and turning those into 0 on the way would fight the person's fingers. */
const DEFAULTS: Record<string, string> = {
    overtimeRate: "1.5",
    shortHoursRate: "1",
    weeklyOffRate: "2",
    holidayRate: "2",
    lateGraceMinutes: "15",
    lateFreeDays: "2",
    latePenaltyDays: "0",
};

export default function PayRulesCard({ canEdit }: { canEdit: boolean }) {
    const [values, setValues] = useState<Record<string, string>>(DEFAULTS);

    const num = (key: string) => {
        const n = Number(values[key]);
        return Number.isFinite(n) && n >= 0 ? n : 0;
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
                                        step={r.step}
                                        disabled={!canEdit}
                                        value={values[r.key]}
                                        onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                                        className="h-9 w-24 text-sm"
                                    />
                                    <span className="text-xs text-muted-foreground">{r.suffix}</span>
                                </div>
                            )}
                        </Field>
                        <p className="mt-1 text-xs text-muted-foreground">{r.explain(num(r.key))}</p>
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
                    Every rule is a multiple, never a rupee figure. A person&apos;s normal hour is his own basic
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
