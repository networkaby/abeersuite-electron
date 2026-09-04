"use client";

/**
 * Backup and restore straight between Supabase and this PC — desktop app only.
 *
 * The Dropbox cards below this one need the `DROPBOX_*`/`GITHUB_*` keys, which counter
 * builds have not shipped since Phase 6, so on a shop PC they can only say "not available
 * here". This card is what actually works there: the installer already carries pg_dump and
 * pg_restore for the local replica, and `electron/backupManager.ts` runs them against
 * Supabase directly. Nothing is uploaded anywhere and nothing waits on a GitHub runner.
 *
 * Renders only inside Electron — a browser has no `electronAPI`, and the whole card would
 * be a set of buttons that cannot do anything.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, HardDrive, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Mirrors `BackupAvailability` from electron/backupManager.ts, declared here so this
 * client component does not import out of `electron/` — the same reason BackupRestorePanel
 * repeats its own server types.
 */
interface Availability {
    available: boolean;
    projectRef: string;
    reason: string;
}

function formatSize(bytes: number) {
    return bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LocalBackupCard() {
    const [availability, setAvailability] = useState<Availability | null>(null);
    const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
    const [progress, setProgress] = useState("");
    const [confirmText, setConfirmText] = useState("");

    useEffect(() => {
        let cancelled = false;
        void window.electronAPI?.backup
            .availability()
            .then((result) => {
                if (!cancelled) setAvailability(result);
            })
            .catch(() => {
                // An older shell without these handlers: leave the card hidden rather
                // than showing controls whose failure the operator cannot act on.
                if (!cancelled) setAvailability({ available: false, projectRef: "", reason: "" });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        // pg_dump is chatty with --verbose, so the latest line gets its own row under the
        // button rather than being pushed through a toast that re-renders on every table.
        const off = window.electronAPI?.backup.onProgress((line) => setProgress(line));
        return off;
    }, []);

    const finish = useCallback(() => {
        setBusy(null);
        setProgress("");
    }, []);

    async function handleBackup() {
        setBusy("backup");
        setProgress("Opening…");
        try {
            const result = await window.electronAPI!.backup.dumpToDisk();
            // Cancelled dialog: no error, nothing to say.
            if (!result.ok && !result.error) return;
            if (!result.ok) throw new Error(result.error);

            toast.success(
                `Backup saved to ${result.filePath} (${formatSize(result.bytes ?? 0)}). Keep it somewhere off this PC too.`,
                { duration: 12_000 },
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Backup failed", { duration: 15_000 });
        } finally {
            finish();
        }
    }

    async function handleRestore() {
        if (confirmText !== "RESTORE") return;
        if (
            !window.confirm(
                "Last chance: this REPLACES the whole live database with the backup file you pick next. " +
                    "Every counter sees the change. Continue?",
            )
        ) {
            return;
        }

        setBusy("restore");
        setProgress("Opening…");
        try {
            const result = await window.electronAPI!.backup.restoreFromDisk("RESTORE");
            if (!result.ok && !result.error) return;
            if (!result.ok) throw new Error(result.error);

            setConfirmText("");
            toast.success(
                "Restore finished. Sign out and back in so your session is fresh, and check the other counters.",
                { duration: 15_000 },
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Restore failed", { duration: 20_000 });
        } finally {
            finish();
        }
    }

    // Not in the desktop app, or a shell too old to answer: the Dropbox cards below are
    // the whole page, exactly as before.
    if (!availability) return null;

    if (!availability.available) {
        // Only worth a line when there is something to say — an old shell answers "".
        if (!availability.reason) return null;
        return (
            <section className="rounded-lg border bg-card p-4">
                <div className="flex items-start gap-2">
                    <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                        <h2 className="text-sm font-semibold">Backup to this computer</h2>
                        <p className="text-xs text-muted-foreground">{availability.reason}</p>
                    </div>
                </div>
            </section>
        );
    }

    const running = busy !== null;

    return (
        <section className="space-y-6">
            {/* Backup */}
            <div className="rounded-lg border bg-card p-4 space-y-4">
                <div className="flex items-start gap-2">
                    <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                        <h2 className="text-sm font-semibold">Back up to this computer</h2>
                        <p className="text-xs text-muted-foreground">
                            Saves the whole database as one file on this PC — you choose where. Takes a minute or two
                            and does not change any data. Keep a copy on a pen drive or in Drive as well; a backup that
                            only exists on this PC is gone with this PC.
                            {availability.projectRef && (
                                <>
                                    {" "}
                                    Database: <span className="font-mono">{availability.projectRef}</span>.
                                </>
                            )}
                        </p>
                    </div>
                </div>
                <Button onClick={() => void handleBackup()} disabled={running} size="sm">
                    <Download className="mr-1.5 size-3.5" />
                    {busy === "backup" ? "Backing up…" : "Back up to this PC"}
                </Button>
                {busy === "backup" && progress && (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{progress}</p>
                )}
            </div>

            {/* Restore */}
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div>
                        <h2 className="text-sm font-semibold text-destructive">Restore from a file on this computer</h2>
                        <p className="text-xs text-muted-foreground">
                            Wipes the live database
                            {availability.projectRef && (
                                <>
                                    {" "}
                                    (<span className="font-mono">{availability.projectRef}</span>)
                                </>
                            )}{" "}
                            and puts the chosen backup file in its place, for every counter at once. This cannot be
                            undone. Use a backup taken with this version of the app — an older one may not have the
                            columns the app now reads; for those, restore from the office instead.
                        </p>
                    </div>
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
                        disabled={running}
                    />
                </div>

                <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleRestore()}
                    disabled={running || confirmText !== "RESTORE"}
                >
                    <Upload className="mr-1.5 size-3.5" />
                    {busy === "restore" ? "Restoring…" : "Choose a file and restore"}
                </Button>
                {busy === "restore" && progress && (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{progress}</p>
                )}
            </div>
        </section>
    );
}
