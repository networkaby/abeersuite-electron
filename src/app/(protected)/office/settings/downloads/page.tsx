"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, FlaskConical, MonitorDown, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

// Shared Downloads hub. The Counter Bridge powers both the thermal printer and
// the QR display (and may carry other tools later), so its downloads live here
// rather than on each hardware page. Add new items to the arrays below.
type DownloadItem = { name: string; desc: string; href: string; primary?: boolean };

const BRIDGE_DOWNLOADS: DownloadItem[] = [
    {
        name: "Counter Bridge — Installer",
        desc: "Recommended. One-click, self-contained setup: bundles Node + all dependencies, installs with no internet, starts the bridge, and auto-starts on every logon. Pen-drive shareable across counters.",
        href: "/combined-bridge-setup-offline.exe",
        primary: true,
    },
    {
        name: "Counter Bridge — Zip (advanced)",
        desc: "Code only. Unzip, run npm install, then setup-autostart.bat as administrator. For manual setups and in-place updates.",
        href: "/combined-bridge.zip",
    },
];

const APP_DOWNLOADS: DownloadItem[] = [
    {
        name: "AbeerSuite — Web Setup",
        desc: "Small downloader (37 KB). Run it on a counter PC and it fetches the latest AbeerSuite installer, checks the VC++ runtime, and starts the setup. Always installs the newest version — no need to re-share this file.",
        href: "/AbeerSuite-WebSetup.exe",
        primary: true,
    },
];

// ── Test builds ─────────────────────────────────────────────────────────────
// Published to the second release repo only, which the counters never poll (see
// scripts/release-electron.ts). So a test build can only be taken deliberately —
// this section is that deliberate act, instead of a trip to GitHub.
type PrereleaseAsset = { id: number; name: string; size: number };
type PrereleaseInfo = {
    tag: string;
    name: string;
    publishedAt: string | null;
    notes: string;
    prerelease: boolean;
    assets: PrereleaseAsset[];
};

function megabytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TestBuildCard({ release }: { release: PrereleaseInfo }) {
    // The first line of RELEASE_NOTES.md, which is what the release body opens with.
    const headline = release.notes.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
    return (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{release.name}</p>
                        {release.prerelease && (
                            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                Test
                            </span>
                        )}
                    </div>
                    {release.publishedAt && (
                        <p className="text-xs text-muted-foreground">
                            {new Date(release.publishedAt).toLocaleString(undefined, {
                                day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
                            })}
                        </p>
                    )}
                    {headline && <p className="text-xs text-muted-foreground line-clamp-2">{headline}</p>}
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                {release.assets.length === 0 && (
                    <p className="text-xs text-muted-foreground">No installer on this release.</p>
                )}
                {release.assets.map((a) => (
                    <Button key={a.id} asChild size="sm" variant="outline">
                        {/* Server-side redirect to a signed GitHub URL — the repo is private,
                            so a direct link would 404. See the API route. */}
                        <a href={`/api/settings/downloads/prereleases/${a.id}`}>
                            <Download size={14} /> {a.name} <span className="text-muted-foreground">· {megabytes(a.size)}</span>
                        </a>
                    </Button>
                ))}
            </div>
        </div>
    );
}

function DownloadCard({ item }: { item: DownloadItem }) {
    return (
        <div className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
                <p className="font-medium text-sm">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
            <Button asChild size="sm" variant={item.primary ? "default" : "outline"} className="shrink-0">
                <a href={item.href} download>
                    <Download size={14} /> Download
                </a>
            </Button>
        </div>
    );
}

export default function DownloadsPage() {
    const [version, setVersion] = useState<string | null>(null);

    const [testBuilds, setTestBuilds] = useState<PrereleaseInfo[] | null>(null);
    const [testError, setTestError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/combined-bridge.version.json", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j: { version?: string } | null) => { if (j?.version) setVersion(j.version); })
            .catch(() => { /* manifest optional */ });
    }, []);

    useEffect(() => {
        fetch("/api/settings/downloads/prereleases")
            .then((r) => r.json())
            .then((j: { configured?: boolean; error?: string; releases?: PrereleaseInfo[] }) => {
                if (j.configured === false) {
                    setTestError("not-configured");
                    setTestBuilds([]);
                    return;
                }
                if (j.error) setTestError(j.error);
                setTestBuilds(j.releases ?? []);
            })
            .catch(() => { setTestError("Could not reach the test release list."); setTestBuilds([]); });
    }, []);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-2xl mx-auto space-y-6 py-6">
                <div className="flex items-center gap-2">
                    <Download size={20} />
                    <h1 className="text-xl font-bold">Downloads</h1>
                </div>

                <section className="space-y-3">
                    <div>
                        <h2 className="font-semibold flex items-center gap-2">
                            <MonitorDown size={16} /> AbeerSuite App
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            Install the desktop app on a counter PC.
                        </p>
                    </div>

                    <div className="space-y-2">
                        {APP_DOWNLOADS.map((d) => <DownloadCard key={d.href} item={d} />)}
                    </div>
                </section>

                <section className="space-y-3">
                    <div className="flex items-end justify-between gap-3">
                        <div>
                            <h2 className="font-semibold">Counter Bridge</h2>
                            <p className="text-xs text-muted-foreground">
                                Connects this app to shop hardware on a counter PC —{" "}
                                <Printer size={12} className="inline align-text-bottom" /> thermal printer +{" "}
                                <QrCode size={12} className="inline align-text-bottom" /> QR display.
                            </p>
                        </div>
                        {version && <span className="text-xs text-muted-foreground font-mono shrink-0">v{version}</span>}
                    </div>

                    <div className="space-y-2">
                        {BRIDGE_DOWNLOADS.map((d) => <DownloadCard key={d.href} item={d} />)}
                    </div>
                </section>

                <section className="space-y-3">
                    <div>
                        <h2 className="font-semibold flex items-center gap-2">
                            <FlaskConical size={16} /> Test builds
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            Not for the counters. These are published for trying on one spare PC before a
                            version goes out — a till will never offer one of these as an update.
                        </p>
                    </div>

                    {testBuilds === null && (
                        <p className="text-xs text-muted-foreground">Looking for test builds…</p>
                    )}
                    {testError === "not-configured" && (
                        <p className="text-xs text-muted-foreground">
                            Not set up on this server. Add <code>GITHUB_TEST_DOWNLOAD_REPO</code> and{" "}
                            <code>GITHUB_TEST_DOWNLOAD_PAT_TOKEN</code> to <code>.env</code> to list them here.
                        </p>
                    )}
                    {testError && testError !== "not-configured" && (
                        <p className="text-xs text-destructive">{testError}</p>
                    )}
                    {testBuilds?.length === 0 && !testError && (
                        <p className="text-xs text-muted-foreground">No test builds published yet.</p>
                    )}

                    <div className="space-y-2">
                        {testBuilds?.map((r) => <TestBuildCard key={r.tag} release={r} />)}
                    </div>
                </section>

                <section className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
                    <p className="font-medium">Set up a counter PC</p>
                    <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
                        <li>Download an installer above and run it on the counter PC.</li>
                        <li>It installs to <code>D:\CombinedBridge</code>, sets up Node, and starts automatically (and on every logon).</li>
                        <li>Configure the hardware in{" "}
                            <Link href="/office/settings/printer-settings" className="underline">Thermal Printer</Link> and{" "}
                            <Link href="/office/settings/qr-display-settings" className="underline">QR Display</Link>.
                        </li>
                        <li>To update later: double-click <code>update.bat</code> in the install folder, or download &amp; run the installer again.</li>
                    </ol>
                </section>
            </div>
        </ScrollArea>
    );
}
