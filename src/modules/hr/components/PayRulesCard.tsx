"use client";

// Pay Rules — the shop's money rules for time. An hour rate is written as a
// plain multiple (1.5, not 150%), because that is how the shop says it out loud:
// "overtime is one and a half times". Rupee figures deliberately do not appear
// here: a basic is per person and lives on the staff record, so this screen stays
// the rule and the staff record stays the amount.
//
// The rules themselves live in `src/shared/lib/hr/payRules.ts` — shape, code
// defaults and the arithmetic — and are stored on `OrgDefaults.hrPayRulesJson`.
// This screen only edits them. Each box saves on its own the moment it is
// changed, the way the office-hours card does; there is no Save button to
// forget.

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { BadgeIndianRupee, Clock4, CalendarHeart, CalendarX2, TriangleAlert } from "lucide-react";
import { NumericInput } from "@/shared/components/NumericInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { Field } from "@/shared/components/Field";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { getOrgDefaults, invalidateOrgDefaultsCache } from "@/shared/lib/orgDefaults";
import { DEFAULT_PAY_RULES, parsePayRules, type LatePenaltyStyle, type PayRules } from "@/shared/lib/hr/payRules";

/** One line on the screen: a number, and the sentence that says what it means. */
interface Rule {
    key: string;
    label: string;
    suffix: string;
    /** Smallest step the rule moves by — quarter-multiples for a rate, whole for
     *  a count. A whole step means the box takes digits only. */
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

/** The two boxes that decide WHICH days are charged, before the charge itself. */
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
];

/**
 * Absence and the notice a leave must carry.
 *
 * An absent day is ALREADY unpaid — payroll prorates the month and the day is
 * worth nothing. So the penalty below is a second charge on top of that, and it
 * is meant only for the day he simply did not come and did not ask. A day that
 * was applied for and granted never reaches it.
 */
const ABSENCE_RULES: Rule[] = [
    {
        key: "absentPenaltyDays",
        label: "Absent without a granted leave",
        suffix: "days of basic, on top",
        step: 0.25,
        explain: (v) =>
            v === 0
                ? "An unasked absence costs the day itself and nothing more — that day is already paid at zero."
                : `Besides losing the day, each unasked absence cuts a further ${Number(v.toFixed(2))} day${v === 1 ? "" : "s"} of basic. Two such days in a month therefore cost about ${Number((2 * (1 + v)).toFixed(2))} days' pay.`,
    },
    {
        key: "leaveNoticeDays",
        label: "Leave must be applied at least",
        suffix: "days before the leave day",
        step: 1,
        explain: (v) =>
            v === 0
                ? "Leave may be applied for on the day itself."
                : `An application filed less than ${v} day${v === 1 ? "" : "s"} ahead is short notice. It can still be granted by hand — sickness and emergencies do not give notice — but the shop is not obliged to, and an ungranted absence falls under the rule above.`,
    },
];

/**
 * HOW a charged late day is charged — in money, or in time.
 *
 * Money is the blunt one: a slice of the day's basic, straight off the payslip.
 *
 * Time is the owner's own idea (2026-09-22) and it is the gentler, more honest
 * instrument: it does not touch the payslip at all, it shortens the duty the day
 * is credited with. That shortfall then goes through the machinery that already
 * exists — it eats his overtime first, and only what is still owed at month end
 * meets the "hours still owed" rate above. So a man who works the time back is
 * not punished twice, and a man who does not is charged once, at a rate the shop
 * has already agreed.
 *
 * One style is in force at a time. Mixing money and time for the same late day
 * would be two punishments for one offence, so the screen makes it a choice.
 */
/** A style's own box: which value it edits, what it is measured in, how it steps. */
interface LateField {
    key: string;
    suffix: string;
    step: number;
}

const LATE_STYLES: { id: LatePenaltyStyle; label: string; fields: LateField[] }[] = [
    { id: "none", label: "Nothing more", fields: [] },
    { id: "pay", label: "Cut from his pay", fields: [{ key: "latePenaltyDays", suffix: "days of basic", step: 0.25 }] },
    {
        id: "timesLate",
        label: "Cut from his hours — by the lateness",
        fields: [{ key: "lateTimesLate", suffix: "times the minutes late", step: 0.5 }],
    },
    {
        id: "sharePerSlab",
        label: "Cut from his hours — a slice for every slab of lateness",
        fields: [
            { key: "lateSlabPct", suffix: "% of the day's duty for every", step: 5 },
            { key: "lateSlabMinutes", suffix: "minutes late", step: 5 },
        ],
    },
    {
        id: "shareOfDay",
        label: "Cut from his hours — a flat slice of the day",
        fields: [{ key: "lateSharePct", suffix: "% of the day's duty", step: 5 }],
    },
];

/** A worked example, so the rule is felt and not merely read. */
const EXAMPLE_LATE_MINUTES = 12;
const EXAMPLE_DUTY_HOURS = 9;

const NOTHING_EXTRA = "Nothing extra is cut — only the minutes actually missed.";

function explainLate(style: LatePenaltyStyle, v: number, v2: number): string {
    const dutyMinutes = EXAMPLE_DUTY_HOURS * 60;
    switch (style) {
        case "pay":
            return v === 0
                ? "No penalty — late arrival costs only the minutes not worked."
                : `Each charged late day cuts ${Number(v.toFixed(2))} day${v === 1 ? "" : "s"} of basic from the payslip.`;
        case "timesLate":
            return v === 0
                ? NOTHING_EXTRA
                : `The lateness is counted ${times(v)} over. ${EXAMPLE_LATE_MINUTES} minutes late costs ${Math.round(EXAMPLE_LATE_MINUTES * v)} minutes of the day's duty.`;
        case "sharePerSlab": {
            if (v === 0 || v2 === 0) return NOTHING_EXTRA;
            /* A part slab counts as a whole one — 12 minutes late against a 5-minute
               slab is three slabs, not two and a bit. Rounding the other way would
               make the first minutes of every slab free, and the rule is meant to
               push him towards the shutter, not towards the next round number. */
            const slabs = Math.ceil(EXAMPLE_LATE_MINUTES / v2);
            const cut = Math.round((dutyMinutes * Math.min(100, slabs * v)) / 100);
            return `Every ${v2} minutes late — or part of it — costs ${v}% of the day's duty. ${EXAMPLE_LATE_MINUTES} minutes late is ${slabs} slab${slabs === 1 ? "" : "s"}, so ${slabs * v}% of a ${EXAMPLE_DUTY_HOURS}-hour day: ${cut} minutes.`;
        }
        case "shareOfDay":
            return v === 0
                ? NOTHING_EXTRA
                : `A charged late day is credited ${v}% less duty — on a ${EXAMPLE_DUTY_HOURS}-hour day that is ${Math.round((dutyMinutes * v) / 100)} minutes, however small the lateness.`;
        default:
            return "Late arrival costs only the minutes not worked. Nothing further is charged.";
    }
}

/**
 * The rules as the boxes hold them — text, not numbers.
 *
 * A box being typed into passes through "1." and "", and turning those into 0
 * on the way would fight the person's fingers. The numbers are read back out
 * only when a sentence needs one, or when the rule is saved.
 */
type Draft = Record<string, string>;

const toDraft = (r: PayRules): Draft =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, String(v)]));

export default function PayRulesCard({ canEdit }: { canEdit: boolean }) {
    /* The code defaults are on screen from the first paint, so the page never
       flashes empty boxes while the stored rules are on their way. */
    const [values, setValues] = useState<Draft>(() => toDraft(DEFAULT_PAY_RULES));
    const [lateStyle, setLateStyle] = useState<LatePenaltyStyle>(DEFAULT_PAY_RULES.latePenaltyStyle);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const d = await getOrgDefaults();
                if (!alive) return;
                const rules = parsePayRules(d.hrPayRulesJson);
                setValues(toDraft(rules));
                setLateStyle(rules.latePenaltyStyle);
            } catch {
                /* the defaults are already on screen */
            } finally {
                if (alive) setLoaded(true);
            }
        })();
        return () => { alive = false; };
    }, []);

    // Rules saved on another desk land here — never while this desk is mid-edit
    // (a keystroke sets `saving` until its write lands).
    useRealtimeTopics(["settings"], () => {
        invalidateOrgDefaultsCache();
        getOrgDefaults()
            .then((d) => {
                const rules = parsePayRules(d.hrPayRulesJson);
                setValues(toDraft(rules));
                setLateStyle(rules.latePenaltyStyle);
            })
            .catch(() => {});
    }, loaded && !saving);

    const num = (key: string) => {
        const n = Number(values[key]);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    /**
     * Save the whole rule set, a moment after the typing stops.
     *
     * `NumericInput` reports every sanitised keystroke as well as the clamped
     * value on blur, so saving on each call would send three or four writes for
     * one edit. The timer collapses them into one — and because the whole rule
     * set goes every time, the last write is always complete.
     *
     * The blob is small and it is one row: sending all of it costs nothing and
     * removes the class of bug where a half-saved rule set leaves the payroll
     * reading an overtime rate from today and a late rule from last week. The
     * caller passes what changed because React state has not caught up yet at
     * the moment of the call.
     */
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const save = (patch: Partial<Draft>, style: LatePenaltyStyle = lateStyle) => {
        if (!canEdit || !loaded) return;
        const draft = { ...values, ...patch };
        const rules = parsePayRules({
            ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])),
            latePenaltyStyle: style,
        });
        setSaving(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            void (async () => {
                try {
                    await axios.patch("/api/settings/org-defaults", { hrPayRulesJson: rules });
                    invalidateOrgDefaultsCache();
                } catch (e) {
                    toast.error(extractApiError(e, "Could not save the pay rule"));
                } finally {
                    setSaving(false);
                }
            })();
        }, 600);
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
                                    <NumericInput
                                        id={id}
                                        mode={Number.isInteger(r.step) ? "digits" : "decimal"}
                                        min={0}
                                        disabled={!canEdit}
                                        value={values[r.key]}
                                        onValueChange={(next) => {
                                            setValues((v) => ({ ...v, [r.key]: next }));
                                            save({ [r.key]: next });
                                        }}
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

                <p className="mb-4 text-xs text-muted-foreground">
                    Every box saves itself the moment you change it — there is no Save button to forget.
                    {saving ? " Saving…" : ""}
                </p>

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
                    "Absence & leave notice",
                    <CalendarX2 size={15} />,
                    "A day off that was asked for and granted is just leave. A day he simply did not come is the one charged here — and an absent day is already unpaid before any penalty is added.",
                    ABSENCE_RULES,
                )}

                {group(
                    "Late arrival",
                    <TriangleAlert size={15} />,
                    "Coming late already costs the minutes — duty is credited from the real sign-in. What follows is a second, deliberate charge on top.",
                    PENALTY_RULES,
                )}

                {/* The charge itself, kept apart from the two boxes above because it
                    is a choice and not a number: money OR time, never both for the
                    same late day. */}
                <section className="mb-4 rounded-lg border border-border p-3">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                        <TriangleAlert size={15} />
                        How a charged late day is punished
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                        Take it off his pay, or take it off his hours. Taking hours is the lighter hand — the day is
                        credited with less duty, and he can work it back as overtime in the same month before anything
                        is cut.
                    </p>
                    <div className="space-y-2">
                        {LATE_STYLES.map((s) => {
                            const active = lateStyle === s.id;
                            return (
                                <label
                                    key={s.id}
                                    className={`flex cursor-pointer flex-col gap-1 rounded-md border p-2 ${active ? "border-primary bg-primary/5" : "border-border"}`}
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <input
                                            type="radio"
                                            name="lateStyle"
                                            checked={active}
                                            disabled={!canEdit}
                                            onChange={() => { setLateStyle(s.id); save({}, s.id); }}
                                            className="accent-primary"
                                        />
                                        <span className="text-sm">{s.label}</span>
                                        {s.fields.length > 0 && (
                                            <span className="ml-auto flex flex-wrap items-center gap-2">
                                                {s.fields.map((f) => (
                                                    <span key={f.key} className="flex items-center gap-2">
                                                        <NumericInput
                                                            mode={Number.isInteger(f.step) ? "digits" : "decimal"}
                                                            min={0}
                                                            aria-label={`${s.label} — ${f.suffix}`}
                                                            disabled={!canEdit || !active}
                                                            value={values[f.key]}
                                                            onValueChange={(next) => {
                                                                setValues((v) => ({ ...v, [f.key]: next }));
                                                                save({ [f.key]: next });
                                                            }}
                                                            className="h-8 w-20 text-sm"
                                                        />
                                                        <span className="text-xs text-muted-foreground">{f.suffix}</span>
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                    {active && (
                                        <p className="text-xs text-muted-foreground">
                                            {explainLate(s.id, num(s.fields[0]?.key ?? ""), num(s.fields[1]?.key ?? ""))}
                                        </p>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                </section>
            </div>
        </ScrollArea>
    );
}
