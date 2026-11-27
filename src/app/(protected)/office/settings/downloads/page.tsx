"use client";

import { useEffect, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import { Download, MonitorDown, Printer, QrCode, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QrSvg } from "@/shared/components/print/QrSvg";
import { PHONE_APP_PLAY_URL, PHONE_APP_TEST_URL } from "@/shared/lib/device/phone";

// The staff app comes from Google Play only (owner, 2026-11-27): the QR opens the
// internal test's join page — the first time it asks "Become a tester", then it
// links to the Play listing; Play installs and auto-updates from there. Every
// staff Google account must be on the "NS staff" testers list in Play Console.

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

    useEffect(() => {
        fetch("/combined-bridge.version.json", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j: { version?: string } | null) => { if (j?.version) setVersion(j.version); })
            .catch(() => { /* manifest optional */ });
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
                    <div>
                        <h2 className="font-semibold flex items-center gap-2">
                            <Smartphone size={16} /> Staff Phone App
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            Scan with the Android phone camera, signed in to Google Play with the staff member&apos;s Gmail (it must be on the testers list). First time: tap <b>Become a tester</b>, then <b>Download it on Google Play</b> → Install. Play updates it by itself after that. Had the app from our website before? Uninstall that one first.
                        </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-4">
                        <QrSvg value={PHONE_APP_TEST_URL} size={160} className="shrink-0 rounded bg-white" />
                        <div className="space-y-2 text-xs text-muted-foreground">
                            <p className="break-all">{PHONE_APP_TEST_URL}</p>
                            <p>
                                Already a tester? Straight to the app:{" "}
                                <a href={PHONE_APP_PLAY_URL} target="_blank" rel="noopener" className="font-medium text-primary underline">Google Play listing</a>
                            </p>
                        </div>
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

                <section className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
                    <p className="font-medium">Set up a counter PC</p>
                    <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
                        <li>Download an installer above and run it on the counter PC.</li>
                        <li>It installs to <code>D:\CombinedBridge</code>, sets up Node, and starts automatically (and on every logon).</li>
                        <li>Configure the hardware in{" "}
                            <GatedLink whenLocked="text" href="/office/settings/printer-settings" className="underline">Thermal Printer</GatedLink> and{" "}
                            <GatedLink whenLocked="text" href="/office/settings/qr-display-settings" className="underline">QR Display</GatedLink>.
                        </li>
                        <li>To update later: double-click <code>update.bat</code> in the install folder, or download &amp; run the installer again.</li>
                    </ol>
                </section>
            </div>
        </ScrollArea>
    );
}
