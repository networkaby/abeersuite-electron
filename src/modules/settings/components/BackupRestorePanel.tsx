"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Upload, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BackupScheduleCard } from "@/modules/settings/components/BackupScheduleCard";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface DropboxBackup {
    name: string;
    path: string;
    size: number;
    modified: string;
}

/**
 * Mirrors `BackupAvailability` from shared/lib/backup/availability.ts, declared locally so
 * this client component never imports the server module (same reason `DropboxBackup` is
 * repeated here). `missing` holds KEY names only — no values ever cross the wire.
 */
interface Availability {
    canBackup: boolean;
    canRestore: boolean;
    missing: string[];
}

function formatSize(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatWhen(iso: string) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

export function BackupRestorePanel() {
    const [backingUp, setBackingUp] = useState(false);

    // null until the first answer from GitHub — the switch stays out of the way
    // rather than guessing a position and flipping under the user a moment later.
    const [scheduleOn, setScheduleOn] = useState<boolean | null>(null);
    const [scheduleState, setScheduleState] = useState("");
    const [savingSchedule, setSavingSchedule] = useState(false);

    const [backups, setBackups] = useState<DropboxBackup[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [selectedPath, setSelectedPath] = useState("");
    const [targetDbUrl, setTargetDbUrl] = useState("");
    const [confirmText, setConfirmText] = useState("");
    const [restoring, setRestoring] = useState(false);
    const [availability, setAvailability] = useState<Availability | null>(null);

    const loadSchedule = useCallback(async () => {
        try {
            const res = await fetch("/api/settings/backup/workflow");
            if (!res.ok) return; // counter build, or GitHub unreachable — leave it hidden
            const json = (await res.json()) as { enabled: boolean; state: string };
            setScheduleOn(json.enabled);
            setScheduleState(json.state);
        } catch {
            // Same: a switch we cannot trust is not shown at all.
        }
    }, []);

    async function toggleSchedule(next: boolean) {
        setSavingSchedule(true);
        const previous = scheduleOn;
        setScheduleOn(next); // optimistic, rolled back below if GitHub refuses
        try {
            const res = await fetch("/api/settings/backup/workflow", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: next }),
            });
            const json = (await res.json().catch(() => null)) as
                | { enabled?: boolean; state?: string; error?: string }
                | null;
            if (!res.ok || typeof json?.enabled !== "boolean") throw new Error(json?.error || `HTTP ${res.status}`);

            setScheduleOn(json.enabled);
            setScheduleState(json.state ?? "");
            toast.success(json.enabled ? "Automatic backup turned on." : "Automatic backup turned off.");
        } catch (err) {
            setScheduleOn(previous);
            toast.error(err instanceof Error ? err.message : "Could not change the automatic backup setting");
        } finally {
            setSavingSchedule(false);
        }
    }

    const loadBackups = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await fetch("/api/settings/restore/list");
            const json = (await res.json().catch(() => null)) as
                | { backups?: DropboxBackup[]; canBackup?: boolean; canRestore?: boolean; missing?: string[]; error?: string }
                | null;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            setBackups(json?.backups ?? []);
            if (typeof json?.canBackup === "boolean" && typeof json?.canRestore === "boolean") {
                setAvailability({
                    canBackup: json.canBackup,
                    canRestore: json.canRestore,
                    missing: json.missing ?? [],
                });
            }
        } catch (err) {
            toast.error(err instanceof Error ? `Couldn't load Dropbox backups: ${err.message}` : "Couldn't load backups");
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        void loadBackups();
        void loadSchedule();
    }, [loadBackups, loadSchedule]);

    // Optimistic until the status arrives: a transient network error must not label a
    // properly configured machine "counter-only". If it really is one, the routes still
    // refuse with 503 and the same message.
    const canBackup = availability?.canBackup ?? true;
    const canRestore = availability?.canRestore ?? true;
    const counterOnly = availability != null && (!canBackup || !canRestore);
    const missing = availability?.missing ?? [];

    const isTargetDbValid =
        targetDbUrl.trim().startsWith("postgres://") || targetDbUrl.trim().startsWith("postgresql://");

    async function handleBackup() {
        if (!canBackup) return;
        setBackingUp(true);
        const progress = toast.loading("Starting backup…");
        try {
            const res = await fetch("/api/settings/backup", { method: "POST" });
            const json = (await res.json().catch(() => null)) as { fileName?: string; error?: string } | null;
            if (!res.ok || !json?.fileName) throw new Error(json?.error || `HTTP ${res.status}`);

            toast.success(
                `Backup started. In a few minutes "${json.fileName}" will appear in your Dropbox. You can close this page.`,
                { id: progress, duration: 10_000 },
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Backup failed to start", { id: progress });
        } finally {
            setBackingUp(false);
        }
    }

    async function handleRestore() {
        if (!canRestore || !selectedPath || !isTargetDbValid || confirmText !== "RESTORE") return;
        if (
            !window.confirm(
                "Last chance: this will REPLACE the entire target database with the selected Dropbox backup. Continue?",
            )
        ) {
            return;
        }
        setRestoring(true);
        const progress = toast.loading("Starting restore…");
        try {
            const res = await fetch("/api/settings/restore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: selectedPath,
                    targetDbUrl: targetDbUrl.trim(),
                    confirm: "RESTORE",
                }),
            });
            const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);

            toast.success(
                "Restore started — it runs in the background, so you can close this page. Once it finishes, the target database is ready.",
                { id: progress, duration: 12_000 },
            );
            setConfirmText("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Restore failed to start", { id: progress });
        } finally {
            setRestoring(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* Counter-only build — the keys this needs were not shipped in the installer */}
            {counterOnly && (
                <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                    <div className="flex items-start gap-2">
                        <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
                        <div className="space-y-1">
                            <h2 className="text-sm font-semibold">Counter-only machine</h2>
                            <p className="text-xs text-muted-foreground">
                                {canBackup
                                    ? "Restore is not available on this machine — it has no Dropbox keys, so it cannot list the backups to pick from."
                                    : "Backup and restore are not available on this machine. It was installed without the Dropbox and GitHub keys."}{" "}
                                Use the office app instead.
                            </p>
                            {missing.length > 0 && (
                                <p className="text-[11px] text-muted-foreground/80">
                                    Not configured here: <span className="font-mono">{missing.join(", ")}</span>
                                </p>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {/* Backup */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Back up to Dropbox</h2>
                    <p className="text-xs text-muted-foreground">
                        Runs a full Postgres dump and saves it to your Dropbox. Runs in the background — you can close
                        this page; the file appears in Dropbox in a few minutes. Safe anytime, does not change live data.
                    </p>
                </div>
                <Button onClick={handleBackup} disabled={backingUp || !canBackup} size="sm">
                    <Download className="mr-1.5 size-3.5" />
                    {!canBackup ? "Not available here" : backingUp ? "Starting…" : "Back up now"}
                </Button>

                {/* Hidden entirely when GitHub could not be asked — a switch showing a
                    position it has not confirmed would be worse than no switch. */}
                {scheduleOn !== null && (
                    <div className="flex items-start justify-between gap-4 rounded-md border bg-background p-3">
                        <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Automatic backup</Label>
                            <p className="text-[11px] leading-snug text-muted-foreground">
                                {scheduleOn
                                    ? "On — runs on the days and times set below."
                                    : "Off — nothing backs up on its own. The button above still works."}
                            </p>
                            {scheduleState === "disabled_inactivity" && (
                                <p className="text-[11px] leading-snug text-amber-600">
                                    GitHub switched this off after 60 days without any change to the code. Turning it
                                    back on here fixes it.
                                </p>
                            )}
                        </div>
                        <Switch
                            checked={scheduleOn}
                            disabled={savingSchedule || !canBackup}
                            onCheckedChange={(next) => void toggleSchedule(next)}
                            aria-label="Automatic backup"
                        />
                    </div>
                )}

                {/* Only worth showing when something is going to run. */}
                {scheduleOn === true && <BackupScheduleCard />}
            </section>

            {/* Restore */}
            <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-sm font-semibold text-destructive">Restore from Dropbox</h2>
                        <p className="text-xs text-muted-foreground">
                            Wipes the entire current database and replaces it with the selected Dropbox backup. This
                            cannot be undone. Runs in the background. Sign out and back in afterwards so your session is
                            fresh.
                        </p>
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Backup to restore</Label>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => void loadBackups()}
                            disabled={loadingList || !canRestore}
                        >
                            <RefreshCw className={`mr-1 size-3 ${loadingList ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>
                    <Select value={selectedPath} onValueChange={setSelectedPath} disabled={loadingList || !canRestore || backups.length === 0}>
                        <SelectTrigger className="h-9 w-full">
                            <SelectValue
                                placeholder={
                                    !canRestore
                                        ? "Not available on this machine"
                                        : loadingList
                                          ? "Loading backups…"
                                          : backups.length === 0
                                            ? "No backups found in Dropbox yet"
                                            : "Select a backup"
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {backups.map((b) => (
                                <SelectItem key={b.path} value={b.path}>
                                    {b.name} — {formatSize(b.size)}
                                    {b.modified ? ` · ${formatWhen(b.modified)}` : ""}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1">
                    <Label className="text-xs">
                        Target Database URL <span className="text-destructive font-semibold">*</span>
                    </Label>
                    <Input
                        className="h-9 font-mono text-xs"
                        value={targetDbUrl}
                        onChange={(e) => setTargetDbUrl(e.target.value)}
                        placeholder="postgresql://postgres:[password]@[host]:5432/postgres"
                        autoComplete="off"
                        disabled={!canRestore}
                    />
                    <p className="text-[11px] text-muted-foreground">
                        Mandatory: restore will strictly overwrite this database.
                    </p>
                </div>

                <div className="space-y-1 max-w-[240px]">
                    <Label className="text-xs">
                        Type <span className="font-mono font-semibold">RESTORE</span> to enable the button
                    </Label>
                    <Input
                        className="h-9"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="RESTORE"
                        autoComplete="off"
                        disabled={!canRestore}
                    />
                </div>

                <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRestore}
                    disabled={restoring || !canRestore || !selectedPath || !isTargetDbValid || confirmText !== "RESTORE"}
                >
                    <Upload className="mr-1.5 size-3.5" />
                    {!canRestore ? "Not available here" : restoring ? "Starting…" : "Restore database"}
                </Button>
            </section>
        </div>
    );
}
