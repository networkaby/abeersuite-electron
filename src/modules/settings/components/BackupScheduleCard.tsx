"use client";

/**
 * When automatic backups run — the days and hours, on Settings → Backup & Restore.
 *
 * Edits take effect on the next hourly tick from GitHub; nothing is committed and
 * nothing is redeployed. The on/off switch lives in BackupRestorePanel next to the
 * backup button, because it belongs with "does this happen at all", not with "when".
 *
 * Days and hours are IST throughout, matching what is stored. The shop thinks in
 * "Sunday night", and a UTC picker would make Sunday sometimes mean Saturday.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface BackupConfig {
    weekdays: number[];
    hours: number[];
    lastRunAt: string | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "10 AM", "1 PM" — how a shop says an hour, not "13:00". */
function hourLabel(h: number): string {
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return `${twelve} ${h < 12 ? "AM" : "PM"}`;
}

function summarise(weekdays: number[], hours: number[]): string {
    if (!weekdays.length || !hours.length) return "Nothing selected — pick at least one day and one time.";
    const when =
        weekdays.length === 7
            ? "every day"
            : weekdays.length === 1
              ? `every ${DAYS[weekdays[0]]}`
              : weekdays.map((d) => DAYS[d]).join(", ");
    return `${hours.map(hourLabel).join(", ")} — ${when}.`;
}

function toggle(list: number[], value: number): number[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);
}

export function BackupScheduleCard() {
    const [config, setConfig] = useState<BackupConfig | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void (async () => {
            try {
                const res = await fetch("/api/settings/backup/schedule");
                if (!res.ok) return; // counter build or no permission — stay hidden
                setConfig((await res.json()) as BackupConfig);
            } catch {
                // A schedule we cannot read is not one we should let anyone edit.
            }
        })();
    }, []);

    if (!config) return null;

    async function save() {
        if (!config) return;
        // Guarded here as well as in the API: an empty list would stop backups while
        // looking like a successful save.
        if (!config.weekdays.length || !config.hours.length) {
            toast.error("Pick at least one day and one time.");
            return;
        }

        setSaving(true);
        try {
            const res = await fetch("/api/settings/backup/schedule", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weekdays: config.weekdays, hours: config.hours }),
            });
            const json = (await res.json().catch(() => null)) as (BackupConfig & { error?: string }) | null;
            if (!res.ok || !json) throw new Error(json?.error || `HTTP ${res.status}`);

            setConfig(json);
            toast.success("Backup schedule saved.");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not save the backup schedule");
        } finally {
            setSaving(false);
        }
    }

    const runsPerMonth = Math.round(config.hours.length * config.weekdays.length * 4.3);

    return (
        <div className="space-y-3 rounded-md border bg-background p-3">
            <div>
                <Label className="text-xs font-medium">When it runs</Label>
                <p className="text-[11px] text-muted-foreground">{summarise(config.weekdays, config.hours)}</p>
            </div>

            <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Days</Label>
                <div className="grid grid-cols-7 gap-1">
                    {DAYS.map((day, i) => (
                        <Button
                            key={day}
                            type="button"
                            size="sm"
                            variant={config.weekdays.includes(i) ? "default" : "outline"}
                            className="h-7 px-0 text-[11px]"
                            onClick={() => setConfig({ ...config, weekdays: toggle(config.weekdays, i) })}
                        >
                            {day}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Times (IST)</Label>
                <div className="grid grid-cols-12 gap-1">
                    {Array.from({ length: 24 }, (_, h) => (
                        <Button
                            key={h}
                            type="button"
                            size="sm"
                            variant={config.hours.includes(h) ? "default" : "outline"}
                            className="h-7 px-0 text-[10px]"
                            onClick={() => setConfig({ ...config, hours: toggle(config.hours, h) })}
                        >
                            {h % 12 === 0 ? 12 : h % 12}
                            {h < 12 ? "a" : "p"}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
                <p className="text-[11px] leading-snug text-muted-foreground">
                    About {runsPerMonth} backups a month. Every run is a full copy, and old ones are never deleted.
                </p>
                <Button onClick={() => void save()} disabled={saving} size="sm" className="shrink-0">
                    <Save className="mr-1.5 size-3.5" />
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>
        </div>
    );
}
