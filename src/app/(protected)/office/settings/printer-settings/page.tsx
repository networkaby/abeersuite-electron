"use client";

import { useEffect, useState, useCallback } from "react";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { GatedLink } from "@/shared/components/GatedLink";
import { Loader2, Wifi, Usb, Monitor, CheckCircle, XCircle, RefreshCw, Printer, Download, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BridgeNotRunningNotice } from "@/modules/settings/components/BridgeNotRunningNotice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { resolveMachineIdentity, matchesThisMachine, type MachineIdentity } from "@/shared/lib/counter/identity";

import { bridgeRequest } from "@/shared/lib/bridge/hardwareBridge";
import { mergeTemplateWithOrg } from "@/shared/lib/print/mergeTemplateWithOrg";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { resolveTemplateForFormat, rowToVoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { buildSampleForKind } from "@/modules/settings/lib/voucherTemplateSamples";
import { isElectronEnvironment } from "@/shared/lib/bridge";
import { HardwareStatusCard, useHardwareProbe, type HardwareProbe } from "@/modules/settings/components/HardwareStatusCard";

// Latest shipped bridge version is read from this static manifest in /public.
// Bump combined-bridge.version.json (+ package.json) whenever you re-ship the
// bridge so counters on an older build get the "update available" prompt.
const VERSION_MANIFEST = "/combined-bridge.version.json";

type ConnectionType = "network" | "com" | "windows";

interface RelayConfig {
    connectionType: ConnectionType;
    printerIp: string;
    printerPort: number;
    comPort: string;
    windowsPrinterName: string;
    /** A cash drawer is plugged into this printer: a fresh bill that took or paid
     *  out cash opens it (hardware-bridge/thermal.js `withDrawerKick`). */
    cashDrawer: boolean;
    /**
     * Not editable here and never printed: the slip header comes from the print
     * template (headerLine1, filled from the Organisation). Kept in the saved
     * config for the QR welcome screen and the counter's device label.
     */
    companyName: string;
    relayPort: number;
    // Stable per-PC id minted on first POS shift open. The counter lock itself now
    // lives server-side keyed by this id; Forget below releases it.
    deviceId?: string | null;
}

const DEFAULT: RelayConfig = {
    connectionType: "network",
    printerIp: "",
    printerPort: 9100,
    comPort: "",
    windowsPrinterName: "",
    cashDrawer: false,
    companyName: "",
    relayPort: 9191,
    deviceId: null,
};

const TYPE_LABELS: { type: ConnectionType; label: string; icon: React.ReactNode; desc: string }[] = [
    { type: "network", icon: <Wifi size={16} />, label: "Network (LAN)", desc: "Printer connected via IP address on your local network" },
    { type: "com", icon: <Usb size={16} />, label: "COM Port (USB)", desc: "USB printer that shows as a serial COM port in Device Manager" },
    { type: "windows", icon: <Monitor size={16} />, label: "Windows Printer", desc: "USB printer installed via Windows driver (shows in Printers & Scanners)" },
];

export default function PrinterSettingsPage() {
    const [relayUp, setRelayUp] = useState<boolean | null>(null);
    const [bridgeVersion, setBridgeVersion] = useState<string | null>(null);
    // Desktop app: the bridge is bundled and updates with the app, so the standalone
    // bridge update prompt must never show here. Resolved once on mount rather than
    // during render, so server and first client render agree.
    const [isElectron, setIsElectron] = useState(false);
    const [latestVersion, setLatestVersion] = useState<string | null>(null);
    const [config, setConfig] = useState<RelayConfig>(DEFAULT);
    // The counter this PC is bound to (server-side, keyed by this PC's identity).
    // Read only inside the parked "Counter lock" card below (currently commented out).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [boundCounter, setBoundCounter] = useState<{ id: number; name: string } | null>(null);
    // Electron installation id (or bridge id off-Electron) — resolved independently
    // rather than piggybacking on `config.deviceId`, which is only there once the
    // bridge config has loaded.
    const [identity, setIdentity] = useState<MachineIdentity | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [kicking, setKicking] = useState(false);
    const [winPrinters, setWinPrinters] = useState<string[]>([]);
    const [comPorts, setComPorts] = useState<string[]>([]);
    const [portsLoading, setPortsLoading] = useState(false);

    const checkRelay = useCallback(async () => {
        // Electron reaches the bundled bridge over IPC, so the config read below works
        // here exactly as it does in a browser — only the version prompt differs, since
        // the desktop app updates itself and has no standalone bridge to update.
        const onElectron = isElectronEnvironment();
        setIsElectron(onElectron);
        try {
            const data = await bridgeRequest<RelayConfig>("thermal", "config:get", undefined, 3000);
            setConfig({ ...DEFAULT, ...data });
            setRelayUp(true);
            if (onElectron) return;
            // Bridge version drives the "update available" prompt. Best-effort —
            // an older bridge with no version in health just reports null.
            try {
                const h = await bridgeRequest<{ version?: string }>("thermal", "health", undefined, 3000);
                setBridgeVersion(h.version ?? null);
            } catch { /* version optional */ }
        } catch {
            setRelayUp(false);
        } finally {
            setLoading(false);
        }
    }, []);

    // Is the configured printer actually reachable? Answered by the bridge's
    // "printer:probe", which never prints — see hardware-bridge/thermal.js.
    const doProbe = useCallback(
        () => bridgeRequest<HardwareProbe>("thermal", "printer:probe", undefined, 5000),
        [],
    );
    const { result: printer, probing, checking: probeChecking, refresh: probePrinter } =
        useHardwareProbe(doProbe, loading);

    useEffect(() => { void checkRelay(); }, [checkRelay]);

    // Latest shipped bridge version (from the static manifest in /public).
    useEffect(() => {
        fetch(VERSION_MANIFEST, { cache: "no-store" })
            .then((r) => r.ok ? r.json() : null)
            .then((j: { version?: string } | null) => { if (j?.version) setLatestVersion(j.version); })
            .catch(() => { /* manifest optional — no warning if unavailable */ });
    }, []);

    useEffect(() => {
        resolveMachineIdentity().then(setIdentity);
    }, []);

    // Which counter is this PC bound to? Match this PC's identity against the
    // server's counter locks so the Forget card knows what it's releasing.
    const loadBoundCounter = useCallback(() => {
        if (!identity?.machineId) { setBoundCounter(null); return () => {}; }
        let cancelled = false;
        fetch(`/api/pos/counters`)
            .then((r) => r.ok ? r.json() : [])
            .then((list: { id: number; name: string; boundDeviceId: string | null }[]) => {
                if (cancelled) return;
                const mine = Array.isArray(list) ? list.find((c) => matchesThisMachine(c.boundDeviceId, identity)) : null;
                setBoundCounter(mine ? { id: mine.id, name: mine.name } : null);
            })
            .catch(() => { /* ignore — card just won't show */ });
        return () => { cancelled = true; };
    }, [identity]);

    useEffect(() => loadBoundCounter(), [loadBoundCounter]);

    // An admin releasing this PC's counter lock from /office/admin/counters
    // announces `settings`. Without this the Forget card kept offering to
    // release a binding that was already gone.
    useRealtimeTopics(["settings"], () => { loadBoundCounter(); });

    const fetchWinPrinters = async () => {
        setPortsLoading(true);
        try {
            if (typeof window !== "undefined" && window.electronAPI?.getPrinters) {
                const list = await window.electronAPI.getPrinters();
                setWinPrinters(list.map((p) => p.name));
                return;
            }
            setWinPrinters(await bridgeRequest<string[]>("thermal", "printers"));
        } catch {
            toast.error("Could not fetch printer list");
        } finally {
            setPortsLoading(false);
        }
    };

    const fetchComPorts = async () => {
        setPortsLoading(true);
        try {
            setComPorts(await bridgeRequest<string[]>("thermal", "ports"));
        } catch {
            toast.error("Could not fetch COM ports from the bridge");
        } finally {
            setPortsLoading(false);
        }
    };

    const handleTypeChange = (type: ConnectionType) => {
        setConfig((c) => ({ ...c, connectionType: type }));
        if (type === "windows" && winPrinters.length === 0) fetchWinPrinters();
        if (type === "com" && comPorts.length === 0) fetchComPorts();
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await bridgeRequest("thermal", "config:set", config);
            toast.success("Printer settings saved");
            void probePrinter(); // New IP or printer name — re-check straight away.
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    // Bound to the parked "Counter lock" card below (currently commented out).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const forgetCounter = async () => {
        const releaseId = identity?.machineId;
        if (!releaseId) return;
        try {
            const r = await fetch(`/api/pos/counters/release-mine`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceId: releaseId }),
            });
            if (!r.ok) throw new Error();
            toast.success("Counter lock cleared for this PC");
            setBoundCounter(null);
        } catch {
            toast.error("Could not clear counter lock");
        }
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            // The test print is the JOURNAL sample rendered through the real
            // print/voucher path with the shop's own JOURNAL template (thermal
            // toggles), so what comes out is exactly what a real slip looks like.
            const res = await fetch("/api/settings/voucher-templates/JOURNAL");
            if (!res.ok) throw new Error("Could not load the Journal print template");
            const row = await res.json();
            const template = resolveTemplateForFormat(
                mergeTemplateWithOrg(rowToVoucherTemplateDefaults(row), getOrganisation()),
                "THERMAL_80MM",
            );
            await bridgeRequest("thermal", "print/voucher", {
                kind:     "JOURNAL",
                title:    template.headerLine2,
                sample:   { ...buildSampleForKind("JOURNAL"), reference: "TEST-001", notes: "Printer test — if you can read this, it works!" },
                template,
            });
            toast.success("Test sent — check the printer");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Test failed");
        } finally {
            setTesting(false);
        }
    };

    // Kick alone, to the SAVED printer — works before the tick is on, so the wiring
    // can be checked first.
    const handleDrawerTest = async () => {
        setKicking(true);
        try {
            await bridgeRequest("thermal", "drawer:open");
            toast.success("Drawer signal sent — it should pop open");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not reach the drawer");
        } finally {
            setKicking(false);
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-xl mx-auto space-y-6 py-6">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Printer size={20} />
                        <h1 className="text-xl font-bold">Thermal Printer</h1>
                    </div>
                    <GatedLink
                        href="/office/settings/downloads"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <Download size={13} />
                        Downloads
                    </GatedLink>
                </div>

                {/* Printer status — the one thing the cashier actually needs: is the
                    printer this counter is pointed at reachable right now, and which one
                    is it. Shown in both app and browser. */}
                <HardwareStatusCard
                    noun="Printer"
                    probe={printer}
                    probing={probing}
                    checking={probeChecking}
                    onRefresh={probePrinter}
                    emptyHint="Choose a printer below, then Save."
                />

                {/* Relay status — browser only. In the desktop app the bridge is a bundled
                    child process reached over IPC, not an HTTP service that can be up or
                    down, so a permanent "Bridge connected" line says nothing. A genuine
                    failure still surfaces through BridgeNotRunningNotice below. */}
                {!isElectron && (
                <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                        {loading ? (
                            <Loader2 size={16} className="animate-spin text-muted-foreground" />
                        ) : relayUp ? (
                            <CheckCircle size={16} className="text-green-600" />
                        ) : (
                            <XCircle size={16} className="text-destructive" />
                        )}
                        <span className={relayUp ? "text-green-700 font-medium" : "text-destructive font-medium"}>
                            {loading ? "Checking bridge…" : relayUp ? "Bridge connected" : "Bridge not running"}
                        </span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setLoading(true); checkRelay(); }}>
                        <RefreshCw size={14} />
                    </Button>
                </div>
                )}

                {!isElectron && relayUp && bridgeVersion && latestVersion && bridgeVersion !== latestVersion && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-2">
                        <p className="font-medium">Bridge update available</p>
                        <p className="text-xs text-amber-700">
                            This counter is running bridge <span className="font-mono">v{bridgeVersion}</span>; the latest is{" "}
                            <span className="font-mono">v{latestVersion}</span>. Update from the Downloads page (or double-click
                            <code className="bg-amber-100 rounded px-1 font-mono">update.bat</code> in the install folder).
                        </p>
                        <Button asChild size="sm" variant="outline" className="mt-1 border-amber-300 bg-white">
                            <GatedLink href="/office/settings/downloads">
                                <Download size={14} />
                                Go to Downloads
                            </GatedLink>
                        </Button>
                    </div>
                )}

                {/* {relayUp && boundCounter && (
                <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-3 text-sm">
                    <div>
                        <p className="font-medium">Counter lock</p>
                        <p className="text-xs text-muted-foreground">
                            This PC opens POS shifts as{" "}
                            <span className="font-medium text-foreground">{boundCounter.name}</span>.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={forgetCounter}>Forget</Button>
                </div>
            )} */}

                {!relayUp && !loading && <BridgeNotRunningNotice device="printer" />}

                <fieldset disabled={!relayUp || loading} className="space-y-5 disabled:opacity-50">
                    {/* Connection type */}
                    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                        <p className="text-sm font-medium">Connection Type</p>
                        <div className="grid gap-2">
                            {TYPE_LABELS.map(({ type, label, icon, desc }) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => handleTypeChange(type)}
                                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${config.connectionType === type
                                            ? "border-primary bg-primary/5"
                                            : "border-border hover:bg-muted/40"
                                        }`}
                                >
                                    <span className={`mt-0.5 ${config.connectionType === type ? "text-primary" : "text-muted-foreground"}`}>
                                        {icon}
                                    </span>
                                    <div>
                                        <p className="text-sm font-medium">{label}</p>
                                        <p className="text-xs text-muted-foreground">{desc}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Network */}
                    {config.connectionType === "network" && (
                        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Network Settings</p>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2 space-y-1.5">
                                    <Label>Printer IP Address</Label>
                                    <Input
                                        value={config.printerIp}
                                        onChange={(e) => setConfig((c) => ({ ...c, printerIp: e.target.value }))}
                                        placeholder="192.168.1.x"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Port</Label>
                                    <Input
                                        value={config.printerPort}
                                        onChange={(e) => setConfig((c) => ({ ...c, printerPort: Number(e.target.value) }))}
                                        placeholder="9100"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Find the printer IP on its configuration print (hold Feed button on power-up).
                            </p>
                        </div>
                    )}

                    {/* COM Port */}
                    {config.connectionType === "com" && (
                        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">COM Port Settings</p>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label>COM Port</Label>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={fetchComPorts} disabled={portsLoading}>
                                        {portsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                        Detect
                                    </Button>
                                </div>
                                <Input
                                    value={config.comPort}
                                    onChange={(e) => setConfig((c) => ({ ...c, comPort: e.target.value }))}
                                    placeholder="COM3"
                                />
                                {comPorts.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {comPorts.map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setConfig((c) => ({ ...c, comPort: p }))}
                                                className={`px-2 py-0.5 rounded text-xs border transition-colors ${config.comPort === p
                                                        ? "border-primary bg-primary/10 text-primary"
                                                        : "border-border hover:bg-muted"
                                                    }`}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    Check Device Manager → Ports (COM &amp; LPT) for the correct port number.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Windows Printer */}
                    {config.connectionType === "windows" && (
                        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Windows Printer Settings</p>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label>Printer Name</Label>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={fetchWinPrinters} disabled={portsLoading}>
                                        {portsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                        Refresh List
                                    </Button>
                                </div>
                                <Input
                                    value={config.windowsPrinterName}
                                    onChange={(e) => setConfig((c) => ({ ...c, windowsPrinterName: e.target.value }))}
                                    placeholder="EPSON TM-T20"
                                />
                                {winPrinters.length > 0 && (
                                    <div className="flex flex-col gap-1 mt-1 max-h-40 overflow-y-auto">
                                        {winPrinters.map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setConfig((c) => ({ ...c, windowsPrinterName: p }))}
                                                className={`px-2 py-1 rounded text-xs border text-left transition-colors ${config.windowsPrinterName === p
                                                        ? "border-primary bg-primary/10 text-primary"
                                                        : "border-border hover:bg-muted"
                                                    }`}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    Must match exactly as shown in Windows → Settings → Printers &amp; Scanners.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Cash drawer — hangs off the printer's drawer socket, so it is set
                        per PC, beside the printer it is plugged into. */}
                    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cash Drawer</p>
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="cash-drawer">Open the cash drawer when a bill prints</Label>
                                <p className="text-xs text-muted-foreground">
                                    For a drawer plugged into this printer. Opens on a new Sale, Rcv or order advance
                                    that takes cash, on every Exp, and on a cash refund — never on a UPI- or card-only
                                    bill, and never on a reprint. Without a thermal printer set here the bill prints
                                    from the browser, which cannot open the drawer; turn on the drawer option in the
                                    Windows printer driver instead.
                                </p>
                            </div>
                            <Switch
                                id="cash-drawer"
                                checked={config.cashDrawer}
                                onCheckedChange={(v) => setConfig((c) => ({ ...c, cashDrawer: v }))}
                            />
                        </div>
                        <Button variant="outline" size="sm" onClick={handleDrawerTest} disabled={kicking || !relayUp}>
                            {kicking ? <Loader2 size={14} className="animate-spin" /> : <Inbox size={14} />}
                            Open Drawer
                        </Button>
                        <p className="text-xs text-muted-foreground">Uses the saved printer — Save first if you just changed it.</p>
                    </div>

                    <div className="flex gap-3">
                        <Button variant="outline" onClick={handleTest} disabled={testing || !relayUp}>
                            {testing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                            Test Print
                        </Button>
                        <Button onClick={handleSave} disabled={saving || !relayUp}>
                            {saving && <Loader2 size={14} className="animate-spin" />}
                            Save Settings
                        </Button>
                    </div>
                </fieldset>
            </div>
        </ScrollArea>
    );
}
