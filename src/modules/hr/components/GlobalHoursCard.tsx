"use client";

// The shop's own office hours — two openings, one per solstice, and a closing
// that does not move. Everything between is worked out on a cosine; see
// src/shared/lib/hr/seasonalHours.ts for why the curve rather than seasonal slabs.
//
// A person's own hours on the staff record still override all of this. What is set
// here is the shop's, and it is what a blank staff record falls back to.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Clock, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/shared/components/Field";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { getOrgDefaults, invalidateOrgDefaultsCache } from "@/shared/lib/orgDefaults";
import {
    SHOP_SEASONAL_FALLBACK,
    seasonalExtremes,
    type SeasonalHours,
} from "@/shared/lib/hr/seasonalHours";
import { formatHhMmFriendly } from "@/shared/lib/format/formatDate";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function GlobalHoursCard({ canEdit }: { canEdit: boolean }) {
    const [hours, setHours] = useState<SeasonalHours>(SHOP_SEASONAL_FALLBACK);
    const [weeklyOff, setWeeklyOff] = useState<number[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const d = await getOrgDefaults();
                if (!alive) return;
                setHours({
                    summerStart: d.dutySummerStart || SHOP_SEASONAL_FALLBACK.summerStart,
                    winterStart: d.dutyWinterStart || SHOP_SEASONAL_FALLBACK.winterStart,
                    end:         d.dutyEnd         || SHOP_SEASONAL_FALLBACK.end,
                });
                setWeeklyOff(d.weeklyOff ?? []);
            } catch {
                /* the fallback is already on screen */
            } finally {
                if (alive) setLoaded(true);
            }
        })();
        return () => { alive = false; };
    }, []);

    const save = async (patch: Partial<SeasonalHours> & { weeklyOff?: number[] }) => {
        setSaving(true);
        try {
            await axios.patch("/api/settings/org-defaults", {
                dutySummerStart: patch.summerStart ?? hours.summerStart,
                dutyWinterStart: patch.winterStart ?? hours.winterStart,
                dutyEnd:         patch.end         ?? hours.end,
                weeklyOff:       patch.weeklyOff   ?? weeklyOff,
            });
            // The cache is a module-level singleton shared with every other screen
            // in this tab — the staff editor reads it for its hint. Leaving it stale
            // is how one screen starts disagreeing with another.
            invalidateOrgDefaultsCache();
            toast.success("Office hours saved");
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the office hours"));
        } finally { setSaving(false); }
    };

    const setHour = (key: keyof SeasonalHours) => (value: string) => {
        setHours((h) => ({ ...h, [key]: value }));
    };

    const toggleDay = (d: number) => {
        const next = weeklyOff.includes(d) ? weeklyOff.filter((x) => x !== d) : [...weeklyOff, d].sort();
        setWeeklyOff(next);
        void save({ weeklyOff: next });
    };

    // Preview from the values ON SCREEN, not the saved ones — the whole point is to
    // see what a change does before committing to it.
    const preview = seasonalExtremes(hours);
    const moves = preview.summer !== preview.winter;

    return (
        <div className="mb-4 rounded-lg border border-border p-3">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <Clock size={15} /> Office hours
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
                The shop&apos;s own hours. Opening follows the season between the two times below;
                closing stays put. A staff member with their own office hours is not affected.
            </p>

            <div className="flex flex-wrap items-end gap-2">
                <Field label="Opens in summer" className="w-36">
                    {(id) => (
                        <Input id={id} type="time" value={hours.summerStart} disabled={!canEdit || !loaded}
                            onChange={(e) => setHour("summerStart")(e.target.value)}
                            onBlur={() => void save({})} className="h-9 text-sm" />
                    )}
                </Field>
                <Field label="Opens in winter" className="w-36">
                    {(id) => (
                        <Input id={id} type="time" value={hours.winterStart} disabled={!canEdit || !loaded}
                            onChange={(e) => setHour("winterStart")(e.target.value)}
                            onBlur={() => void save({})} className="h-9 text-sm" />
                    )}
                </Field>
                <Field label="Closes" className="w-36">
                    {(id) => (
                        <Input id={id} type="time" value={hours.end} disabled={!canEdit || !loaded}
                            onChange={(e) => setHour("end")(e.target.value)}
                            onBlur={() => void save({})} className="h-9 text-sm" />
                    )}
                </Field>
            </div>

            {/* The curve, in words. Without this the exact-to-the-minute opening is a
                mystery — somebody sets 11:15 for winter and has no way to tell what
                that means for a Tuesday in October until the Tuesday arrives. */}
            <p className="mt-3 flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                <Sunrise size={14} className="mt-0.5 shrink-0" />
                <span>
                    {moves ? (
                        <>
                            Opens <strong>{formatHhMmFriendly(preview.today)}</strong> today, moving to{" "}
                            <strong>{formatHhMmFriendly(preview.summer)}</strong> by 21 June and{" "}
                            <strong>{formatHhMmFriendly(preview.winter)}</strong> by 21 December — a few minutes
                            every week, never a jump. Closing stays {formatHhMmFriendly(hours.end)} all year.
                        </>
                    ) : (
                        <>
                            Opens <strong>{formatHhMmFriendly(preview.today)}</strong> every day of the year.
                            Set a different winter time to make the opening follow the season.
                        </>
                    )}
                </span>
            </p>

            <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium">Shop closed on</p>
                <div className="flex flex-wrap gap-1">
                    {DAYS.map((label, d) => (
                        <Button
                            key={label} type="button" size="sm"
                            variant={weeklyOff.includes(d) ? "default" : "outline"}
                            disabled={!canEdit || !loaded || saving}
                            onClick={() => toggleDay(d)}
                        >
                            {label}
                        </Button>
                    ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                    Days the whole shop is shut. The sign-in screen counts these when it says when
                    the shop opens next. A person&apos;s own weekly off is set on their staff record.
                </p>
            </div>
        </div>
    );
}
