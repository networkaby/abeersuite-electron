"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BackupRestorePanel() {
    const [downloading, setDownloading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [confirmText, setConfirmText] = useState("");
    const [restoring, setRestoring] = useState(false);

    async function handleDownload() {
        setDownloading(true);
        try {
            const res = await fetch("/api/settings/backup", { method: "POST" });
            if (!res.ok) {
                const json = (await res.json().catch(() => null)) as { error?: string; stderr?: string } | null;
                throw new Error(json?.stderr || json?.error || `HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const disposition = res.headers.get("content-disposition") ?? "";
            const match = /filename="?([^"]+)"?/i.exec(disposition);
            const filename = match?.[1] ?? `smx-backup-${Date.now()}.dump`;

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(`Downloaded ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Backup failed");
        } finally {
            setDownloading(false);
        }
    }

    async function handleRestore() {
        if (!file || confirmText !== "RESTORE") return;
        if (!window.confirm("Last chance: this will REPLACE the entire current database with the uploaded file. Continue?")) {
            return;
        }
        setRestoring(true);
        try {
            const fd = new FormData();
            fd.append("dump", file);
            fd.append("confirm", "RESTORE");
            const res = await fetch("/api/settings/restore", { method: "POST", body: fd });
            const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; stderr?: string };
            if (!res.ok) {
                throw new Error(json.error || `HTTP ${res.status}`);
            }
            toast.success("Restore complete — sign out and back in to refresh your session.");
            setFile(null);
            setConfirmText("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Restore failed");
        } finally {
            setRestoring(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* Backup */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Download backup</h2>
                    <p className="text-xs text-muted-foreground">
                        Generates a Postgres custom-format dump of the entire database and downloads it to your
                        computer. Safe to run anytime — does not change the live data.
                    </p>
                </div>
                <Button onClick={handleDownload} disabled={downloading} size="sm">
                    <Download className="mr-1.5 size-3.5" />
                    {downloading ? "Preparing…" : "Download backup"}
                </Button>
            </section>

            {/* Restore */}
            <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-sm font-semibold text-destructive">Restore from backup</h2>
                        <p className="text-xs text-muted-foreground">
                            Wipes the entire current database and replaces it with the uploaded file. This cannot be
                            undone. Sign out and back in afterwards so your session is fresh.
                        </p>
                    </div>
                </div>

                <div className="space-y-1">
                    <Label className="text-xs">Backup file (.dump)</Label>
                    <Input
                        type="file"
                        accept=".dump,application/octet-stream"
                        className="h-9"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    {file && (
                        <p className="text-[10px] text-muted-foreground">
                            {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                    )}
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
                    disabled={restoring || !file || confirmText !== "RESTORE"}
                >
                    <Upload className="mr-1.5 size-3.5" />
                    {restoring ? "Restoring…" : "Restore database"}
                </Button>
            </section>
        </div>
    );
}
