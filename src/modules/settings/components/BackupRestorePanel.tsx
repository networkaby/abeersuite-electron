"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Polls `check` every intervalMs until it returns a non-null value or the
// timeout elapses (then returns null).
async function pollUntil<T>(
    check: () => Promise<T | null>,
    { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await check();
        if (result !== null) return result;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

function stamp() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function BackupRestorePanel() {
    const [downloading, setDownloading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [confirmText, setConfirmText] = useState("");
    const [restoring, setRestoring] = useState(false);

    async function handleDownload() {
        setDownloading(true);
        const progress = toast.loading("Preparing backup… this can take up to a minute.");
        try {
            const res = await fetch("/api/settings/backup", { method: "POST" });
            const json = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
            if (!res.ok || !json?.jobId) {
                throw new Error(json?.error || `HTTP ${res.status}`);
            }

            const url = await pollUntil(
                async () => {
                    const r = await fetch(`/api/settings/backup/status?jobId=${json.jobId}`);
                    const j = (await r.json().catch(() => null)) as { ready?: boolean; url?: string; error?: string } | null;
                    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
                    return j?.ready ? j.url ?? null : null;
                },
                { timeoutMs: 300_000, intervalMs: 3_000 },
            );
            if (!url) throw new Error("Timed out waiting for the backup. Check the GitHub Actions run.");

            const fileRes = await fetch(url);
            if (!fileRes.ok) throw new Error(`Could not download the dump (HTTP ${fileRes.status}).`);
            const blob = await fileRes.blob();
            const filename = `smx-backup-${stamp()}.dump`;

            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objUrl);
            toast.success(`Downloaded ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`, { id: progress });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Backup failed", { id: progress });
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
        const progress = toast.loading("Uploading backup…");
        try {
            // 1. Get a signed URL and upload the dump straight to Storage.
            const urlRes = await fetch("/api/settings/restore/upload-url", { method: "POST" });
            const urlJson = (await urlRes.json().catch(() => null)) as { jobId?: string; uploadUrl?: string; error?: string } | null;
            if (!urlRes.ok || !urlJson?.jobId || !urlJson.uploadUrl) {
                throw new Error(urlJson?.error || `HTTP ${urlRes.status}`);
            }
            const putRes = await fetch(urlJson.uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": "application/octet-stream" },
            });
            if (!putRes.ok) throw new Error(`Upload failed (HTTP ${putRes.status}).`);

            // 2. Trigger the restore run.
            toast.loading("Restoring… this can take a minute.", { id: progress });
            const res = await fetch("/api/settings/restore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId: urlJson.jobId, confirm: "RESTORE" }),
            });
            const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);

            // 3. Poll for the result the workflow writes back to Storage.
            const result = await pollUntil(
                async () => {
                    const r = await fetch(`/api/settings/restore/status?jobId=${urlJson.jobId}`);
                    const j = (await r.json().catch(() => null)) as { done?: boolean; ok?: boolean; log?: string; error?: string } | null;
                    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
                    return j?.done ? j : null;
                },
                { timeoutMs: 300_000, intervalMs: 4_000 },
            );
            if (!result) throw new Error("Timed out waiting for the restore. Check the GitHub Actions run.");
            if (!result.ok) throw new Error(result.log?.slice(-500) || "Restore failed on the runner.");

            toast.success("Restore complete — sign out and back in to refresh your session.", { id: progress });
            setFile(null);
            setConfirmText("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Restore failed", { id: progress });
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
