"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, CheckCircle, XCircle, RefreshCw, QrCode, Play, Smile, ScanLine, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

const RELAY = "http://localhost:9192";

interface RelayConfig {
    comPort:            string;
    baudRate:           number;
    relayPort:          number;
    companyName:        string;
    upiPayeeVpa:        string;
    upiPayeeName:       string;
    idleFolder:         string;
    idleIntervalMs:     number;
    thankyouDurationMs: number;
}

interface PortInfo {
    path:        string;
    description: string;
}

const DEFAULT: RelayConfig = {
    comPort:            "",
    baudRate:           921600,
    relayPort:          9192,
    companyName:        "",
    upiPayeeVpa:        "",
    upiPayeeName:       "",
    idleFolder:         "",
    idleIntervalMs:     5000,
    thankyouDurationMs: 4000,
};

export default function QrDisplaySettingsPage() {
    const [relayUp,      setRelayUp]      = useState<boolean | null>(null);
    const [config,       setConfig]       = useState<RelayConfig>(DEFAULT);
    const [loading,      setLoading]      = useState(true);
    const [saving,       setSaving]       = useState(false);
    const [ports,        setPorts]        = useState<PortInfo[]>([]);
    const [portsLoading, setPortsLoading] = useState(false);
    const [testing,      setTesting]      = useState<string | null>(null);

    const checkRelay = useCallback(async () => {
        try {
            const r = await fetch(`${RELAY}/config`, { signal: AbortSignal.timeout(3000) });
            if (!r.ok) throw new Error();
            const data: RelayConfig = await r.json();
            setConfig({ ...DEFAULT, ...data });
            setRelayUp(true);
        } catch {
            setRelayUp(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { checkRelay(); }, [checkRelay]);

    const fetchPorts = async () => {
        setPortsLoading(true);
        try {
            const list: PortInfo[] = await (await fetch(`${RELAY}/ports`)).json();
            setPorts(list);
        } catch {
            toast.error("Could not fetch COM ports from relay");
        } finally {
            setPortsLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const r = await fetch(`${RELAY}/config`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(config),
            });
            if (!r.ok) throw new Error((await r.json()).error);
            toast.success("QR display settings saved");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const runTest = async (label: string, path: string, body: unknown) => {
        setTesting(label);
        try {
            const r = await fetch(`${RELAY}${path}`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(body ?? {}),
            });
            if (!r.ok) throw new Error((await r.json()).error);
            toast.success(`Sent: ${label}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `${label} failed`);
        } finally {
            setTesting(null);
        }
    };

    const testCart = () => runTest("Test cart", "/pos/cart", {
        items: [
            { name: "USB Cable",     qty: 2, price: 150 },
            { name: "HDMI 4K 2m",    qty: 1, price: 499 },
            { name: "Mouse Wireless", qty: 1, price: 599 },
        ],
        subtotal: 1397,
        discount: 97,
        total:    1300,
    });

    const testUpi = () => {
        if (!config.upiPayeeVpa) {
            toast.error("Set the UPI VPA first");
            return;
        }
        return runTest("Test UPI QR", "/pos/upi", { amount: 100, caption: "Test ₹100" });
    };

    const testThankyou = () => runTest("Test thank-you", "/pos/thankyou", { amount: 1300 });
    const testIdle     = () => runTest("Start slideshow", "/idle/start", {});
    const testClear    = () => runTest("Clear screen",   "/clear",       {});

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-xl mx-auto space-y-6 py-6">
            <div className="flex items-center gap-2">
                <QrCode size={20} />
                <h1 className="text-xl font-bold">QR Display (DQ11)</h1>
            </div>

            {/* Relay status */}
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
                        {loading ? "Checking relay…" : relayUp ? "Relay running — localhost:9192" : "Relay not running"}
                    </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setLoading(true); checkRelay(); }}>
                    <RefreshCw size={14} />
                </Button>
            </div>

            {!relayUp && !loading && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
                    <p className="font-medium">Start the relay on the shop PC first:</p>
                    <code className="block bg-amber-100 rounded px-2 py-1 font-mono text-xs">
                        cd tools/qr-display &amp;&amp; node relay.js
                    </code>
                    <p className="text-xs text-amber-700">Then refresh this page.</p>
                </div>
            )}

            <fieldset disabled={!relayUp || loading} className="space-y-5 disabled:opacity-50">
                {/* COM port */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Device Connection</p>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label>COM Port</Label>
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={fetchPorts} disabled={portsLoading}>
                                {portsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                Detect
                            </Button>
                        </div>
                        <Input
                            value={config.comPort}
                            onChange={(e) => setConfig((c) => ({ ...c, comPort: e.target.value }))}
                            placeholder="COM6"
                        />
                        {ports.length > 0 && (
                            <div className="flex flex-col gap-1 mt-1 max-h-40 overflow-y-auto">
                                {ports.map((p) => (
                                    <button
                                        key={p.path}
                                        type="button"
                                        onClick={() => setConfig((c) => ({ ...c, comPort: p.path }))}
                                        className={`px-2 py-1 rounded text-xs border text-left transition-colors ${
                                            config.comPort === p.path
                                                ? "border-primary bg-primary/10 text-primary"
                                                : "border-border hover:bg-muted"
                                        }`}
                                    >
                                        <span className="font-mono">{p.path}</span>
                                        {p.description && <span className="text-muted-foreground"> — {p.description}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Check Device Manager → Ports (COM &amp; LPT). The DQ11 shows as <span className="font-mono">USB Serial Device (COMx)</span>.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Baud Rate</Label>
                        <Input
                            value={config.baudRate}
                            onChange={(e) => setConfig((c) => ({ ...c, baudRate: Number(e.target.value) || 921600 }))}
                        />
                        <p className="text-xs text-muted-foreground">DQ11 expects 921600. Don&apos;t change unless you have a different display.</p>
                    </div>
                </div>

                {/* UPI defaults */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">UPI Defaults</p>
                    <div className="space-y-1.5">
                        <Label>UPI VPA (Payee Address)</Label>
                        <Input
                            value={config.upiPayeeVpa}
                            onChange={(e) => setConfig((c) => ({ ...c, upiPayeeVpa: e.target.value }))}
                            placeholder="shop@hdfc"
                        />
                        <p className="text-xs text-muted-foreground">Used when POS doesn&apos;t specify one per-call.</p>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Payee Name</Label>
                        <Input
                            value={config.upiPayeeName}
                            onChange={(e) => setConfig((c) => ({ ...c, upiPayeeName: e.target.value }))}
                            placeholder="Network Service"
                        />
                        <p className="text-xs text-muted-foreground">Shown above the QR.</p>
                    </div>
                </div>

                {/* Idle slideshow */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Idle Slideshow</p>
                    <div className="space-y-1.5">
                        <Label>Photos Folder</Label>
                        <Input
                            value={config.idleFolder}
                            onChange={(e) => setConfig((c) => ({ ...c, idleFolder: e.target.value }))}
                            placeholder="D:\shop-ads"
                        />
                        <p className="text-xs text-muted-foreground">
                            Absolute path on the shop PC. Leave empty to use the relay&apos;s bundled <span className="font-mono">assets/idle/</span> folder.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Slide Interval (ms)</Label>
                            <Input
                                value={config.idleIntervalMs}
                                onChange={(e) => setConfig((c) => ({ ...c, idleIntervalMs: Number(e.target.value) || 5000 }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Thank-You Hold (ms)</Label>
                            <Input
                                value={config.thankyouDurationMs}
                                onChange={(e) => setConfig((c) => ({ ...c, thankyouDurationMs: Number(e.target.value) || 4000 }))}
                            />
                        </div>
                    </div>
                </div>

                {/* Test actions */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test on Display</p>
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" onClick={testCart} disabled={!!testing}>
                            {testing === "Test cart" ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                            Test Cart
                        </Button>
                        <Button variant="outline" size="sm" onClick={testUpi} disabled={!!testing}>
                            {testing === "Test UPI QR" ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                            Test UPI QR
                        </Button>
                        <Button variant="outline" size="sm" onClick={testThankyou} disabled={!!testing}>
                            {testing === "Test thank-you" ? <Loader2 size={14} className="animate-spin" /> : <Smile size={14} />}
                            Test Thank-You
                        </Button>
                        <Button variant="outline" size="sm" onClick={testIdle} disabled={!!testing}>
                            {testing === "Start slideshow" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            Start Slideshow
                        </Button>
                        <Button variant="outline" size="sm" onClick={testClear} disabled={!!testing} className="col-span-2">
                            {testing === "Clear screen" ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
                            Clear Screen
                        </Button>
                    </div>
                </div>

                <div className="flex gap-3">
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
