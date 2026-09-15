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
import { confirmAction } from "@/shared/lib/ui/confirmStore";

/**
 * Mirrors `RestoreReadiness` from electron/backupManager.ts, declared here so this
 * client component does not import out of `electron/` — the same reason BackupRestorePanel
 * repeats its own server types.
 */
interface Availability {
    available: boolean;
    projectRef: string;
    reason: string;
    /** Local writes this till has not synced yet. The restore discards them. */
    pendingWrites: number;
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
                if (!cancelled) setAvailability({ available: false, projectRef: "", reason: "", pendingWrites: 0 });
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

        // The unsynced count is named here, not just in the panel above, because this is
        // the last screen before the work is gone: the restore ends with a replica wipe,
        // and that wipe empties `_outbox`. Leaving those rows would be worse — the
        // flusher would push pre-restore data straight back over the restore — but it is
        // still real work, so it is spelt out with a number rather than a warning.
        const unsynced = availability?.pendingWrites ?? 0;
        const ok = await confirmAction({
            title: "Replace the whole live database with the backup file you pick next?",
            body: (
                <>
                    <p>Last chance — every counter sees the change.</p>
                    {unsynced > 0 && (
                        <p>
                            This till has {unsynced} write{unsynced === 1 ? "" : "s"} that Supabase has not
                            accepted yet. They will be <strong>discarded</strong>.
                        </p>
                    )}
                    <p>This PC restarts by itself when it finishes, and re-downloads everything.</p>
                </>
            ),
            confirmLabel: "Restore backup",
        });
        if (!ok) return;

        setBusy("restore");
        setProgress("Opening…");
        try {
            const result = await window.electronAPI!.backup.restoreFromDisk("RESTORE");
            if (!result.ok && !result.error) return;
            if (!result.ok) throw new Error(result.error);

            setConfirmText("");
            // No "sign out and back in" any more: main relaunches the app the moment the
            // restore succeeds, so this toast is only ever seen for the second or two
            // before the window goes.
            toast.success("Restore finished. Restarting the app…", { duration: 15_000 });
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
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                            <li>
                                <span className="font-medium text-foreground">This PC restarts by itself</span> when the
                                restore finishes, then re-downloads the whole database. Everything it had stored locally
                                is cleared first — otherwise it would keep showing the old figures and push them back up.
                            </li>
                            <li>
                                {availability.pendingWrites > 0 ? (
                                    <>
                                        <span className="font-medium text-destructive">
                                            {availability.pendingWrites} write
                                            {availability.pendingWrites === 1 ? "" : "s"} on this till
                                        </span>{" "}
                                        {availability.pendingWrites === 1 ? "has" : "have"} not reached the server yet and{" "}
                                        {availability.pendingWrites === 1 ? "will" : "will"} be discarded. Wait for the sync
                                        badge to go clear first if you want to keep {availability.pendingWrites === 1 ? "it" : "them"}.
                                    </>
                                ) : (
                                    <>Everything on this till has reached the server, so nothing local is lost.</>
                                )}
                            </li>
                            <li>
                                <span className="font-medium text-foreground">Every other counter must be re-set-up</span>{" "}
                                afterwards — release it from Admin → Counters and onboard it again. Their stored copies
                                are newer than the backup, so they will never pull the restored figures on their own.
                            </li>
                        </ul>
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
