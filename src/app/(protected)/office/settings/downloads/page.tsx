"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Printer, QrCode } from "lucide-react";
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
