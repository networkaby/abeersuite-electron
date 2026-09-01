"use client";

/**
 * Scheduled-backup settings card for Settings → Backup & Restore.
 *
 * NOT MOUNTED YET. Nothing renders this component, and the cron route still
 * ignores the row it edits — so the whole feature is inert until the checklist in
 * docs/backup-schedule-activation.md is worked through. It is written now so the
 * production-start commit is a small, reviewed switch-on rather than a new build.
 *
 * Times are stored UTC and shown IST. A shop admin thinks in "2:30 in the night",
 * not in UTC, and the stored value must not move when a server's timezone does.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface BackupConfig {
    id: number;
    enabled: boolean;
    frequency: "daily" | "weekly";
    hourUtc: number;
    minuteUtc: number;
    weekday: number | null;
    lastRunAt: string | null;
}

/** IST is a fixed +5:30 from UTC — no daylight saving, so plain arithmetic is safe. */
const IST_OFFSET_MINUTES = 330;

function utcToIst(hourUtc: number, minuteUtc: number): { hour: number; minute: number } {
    const total = (hourUtc * 60 + minuteUtc + IST_OFFSET_MINUTES + 1440) % 1440;
    return { hour: Math.floor(total / 60), minute: total % 60 };
}

function istToUtc(hour: number, minute: number): { hourUtc: number; minuteUtc: number } {
    const total = (hour * 60 + minute - IST_OFFSET_MINUTES + 1440) % 1440;
    return { hourUtc: Math.floor(total / 60), minuteUtc: total % 60 };
}

const pad = (n: number) => String(n).padStart(2, "0");

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function BackupScheduleCard() {
    const [config, setConfig] = useState<BackupConfig | null>(null);
    const [timeIst, setTimeIst] = useState("02:30");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios
            .get<BackupConfig>("/api/settings/backup/schedule")
            .then(({ data }) => {
                setConfig(data);
                const { hour, minute } = utcToIst(data.hourUtc, data.minuteUtc);
                setTimeIst(`${pad(hour)}:${pad(minute)}`);
            })
            .catch(() => toast.error("Could not load the backup schedule."));
    }, []);

    if (!config) return null;

    const patch = (changes: Partial<BackupConfig>) => setConfig({ ...config, ...changes });

    const save = async () => {
        const [h, m] = timeIst.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) {
            toast.error("Enter a time as HH:MM.");
            return;
        }
        // Guarded here as well as in the API: a weekly schedule with no day chosen
        // matches no tick, which would read as "backups just stopped".
        if (config.frequency === "weekly" && config.weekday == null) {
            toast.error("Pick a day of the week.");
            return;
        }

        setSaving(true);
        try {
            const { data } = await axios.patch<BackupConfig>("/api/settings/backup/schedule", {
                enabled: config.enabled,
                frequency: config.frequency,
                weekday: config.frequency === "weekly" ? config.weekday : null,
                ...istToUtc(h, m),
            });
            setConfig(data);
            toast.success("Backup schedule saved.");
        } catch {
            toast.error("Could not save the backup schedule.");
        } finally {
            setSaving(false);
        }
    };

    const lastRun = config.lastRunAt
        ? new Date(config.lastRunAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "Never";

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarClock className="h-4 w-4" />
                    Automatic backup
                </CardTitle>
                <CardDescription>
                    Runs on its own and saves to Dropbox. Last run: {lastRun}.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                        <Label className="text-sm font-medium">Automatic backup is on</Label>
                        <p className="text-[11px] text-muted-foreground">
                            Turn this off to stop scheduled backups. You can still back up by hand above.
                        </p>
                    </div>
                    <Switch
                        checked={config.enabled}
                        onCheckedChange={(enabled) => patch({ enabled })}
                        aria-label="Automatic backup"
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">How often</Label>
                        <Select
                            value={config.frequency}
                            onValueChange={(v) => patch({ frequency: v as BackupConfig["frequency"] })}
                            disabled={!config.enabled}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="daily">Every day</SelectItem>
                                <SelectItem value="weekly">Once a week</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {config.frequency === "weekly" && (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-muted-foreground">Day</Label>
                            <Select
                                value={config.weekday == null ? "" : String(config.weekday)}
                                onValueChange={(v) => patch({ weekday: Number(v) })}
                                disabled={!config.enabled}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Pick a day" />
                                </SelectTrigger>
                                <SelectContent>
                                    {WEEKDAYS.map((day, i) => (
                                        <SelectItem key={day} value={String(i)}>
                                            {day}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">Time (IST)</Label>
                        <Input
                            type="time"
                            value={timeIst}
                            onChange={(e) => setTimeIst(e.target.value)}
                            disabled={!config.enabled}
                        />
                        <p className="text-[11px] leading-snug text-muted-foreground">
                            Runs at about this time. A busy shop hour is a poor choice — pick the night.
                        </p>
                    </div>
                </div>

                <div className="flex justify-end">
                    <Button onClick={save} disabled={saving} size="sm">
                        <Save className="mr-1.5 h-4 w-4" />
                        {saving ? "Saving…" : "Save schedule"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
