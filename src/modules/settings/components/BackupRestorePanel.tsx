"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Upload, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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

    const [backups, setBackups] = useState<DropboxBackup[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [selectedPath, setSelectedPath] = useState("");
    const [confirmText, setConfirmText] = useState("");
    const [restoring, setRestoring] = useState(false);

    const loadBackups = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await fetch("/api/settings/restore/list");
            const json = (await res.json().catch(() => null)) as
                | { backups?: DropboxBackup[]; error?: string }
                | null;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            setBackups(json?.backups ?? []);
        } catch (err) {
            toast.error(err instanceof Error ? `Couldn't load Dropbox backups: ${err.message}` : "Couldn't load backups");
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        void loadBackups();
    }, [loadBackups]);

    async function handleBackup() {
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
        if (!selectedPath || confirmText !== "RESTORE") return;
        if (
            !window.confirm(
                "Last chance: this will REPLACE the entire current database with the selected Dropbox backup. Continue?",
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
                body: JSON.stringify({ path: selectedPath, confirm: "RESTORE" }),
            });
            const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);

            toast.success(
                "Restore started — it runs in the background, so you can close this page. Sign out and back in once it finishes.",
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
            {/* Backup */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Back up to Dropbox</h2>
                    <p className="text-xs text-muted-foreground">
                        Runs a full Postgres dump and saves it to your Dropbox. Runs in the background — you can close
                        this page; the file appears in Dropbox in a few minutes. Safe anytime, does not change live data.
                    </p>
                </div>
                <Button onClick={handleBackup} disabled={backingUp} size="sm">
                    <Download className="mr-1.5 size-3.5" />
                    {backingUp ? "Starting…" : "Back up now"}
                </Button>
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
                            disabled={loadingList}
                        >
                            <RefreshCw className={`mr-1 size-3 ${loadingList ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>
                    <Select value={selectedPath} onValueChange={setSelectedPath} disabled={loadingList || backups.length === 0}>
                        <SelectTrigger className="h-9 w-full">
                            <SelectValue
                                placeholder={
                                    loadingList
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
                    />
                </div>

                <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRestore}
                    disabled={restoring || !selectedPath || confirmText !== "RESTORE"}
                >
                    <Upload className="mr-1.5 size-3.5" />
                    {restoring ? "Starting…" : "Restore database"}
                </Button>
            </section>
        </div>
    );
}
