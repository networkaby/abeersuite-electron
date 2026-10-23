"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, CheckCircle, XCircle, RefreshCw, QrCode, Play, Smile, ScanLine, Eraser, ImageIcon, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BridgeNotRunningNotice } from "@/modules/settings/components/BridgeNotRunningNotice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumericInput } from "@/shared/components/NumericInput";
import { QR_SLIDE_PRODUCTS_DEFAULT, QR_SLIDE_PRODUCTS_MAX } from "@/modules/pos/lib/qrSlides";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { qrRequest } from "@/modules/pos/lib/qrDisplay";
import { useIsDesktopApp } from "@/shared/lib/bridge";
import { HardwareStatusCard, useHardwareProbe, type HardwareProbe } from "@/modules/settings/components/HardwareStatusCard";

interface RelayConfig {
    comPort:            string;
    baudRate:           number;
    /** Unused since the display moved to IPC; kept so saved configs round-trip. */
    relayPort:          number;
    companyName:        string;
    idleFolder:         string;
    idleIntervalMs:     number;
    thankyouDurationMs: number;
    /** Offer products in the slideshow — on unless false. */
    idleProducts:       boolean;
    idleProductsMax:    number;
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
    idleFolder:         "",
    idleIntervalMs:     5000,
    thankyouDurationMs: 4000,
    idleProducts:       true,
    idleProductsMax:    QR_SLIDE_PRODUCTS_DEFAULT,
};

/** A NumericInput string → the number to save; blank goes back to the default. */
const num = (v: string, fallback: number) => (v === "" ? fallback : Number(v));

export default function QrDisplaySettingsPage() {
    const [relayUp,      setRelayUp]      = useState<boolean | null>(null);
    const [config,       setConfig]       = useState<RelayConfig>(DEFAULT);
    const [loading,      setLoading]      = useState(true);
    const [saving,       setSaving]       = useState(false);
    const [ports,        setPorts]        = useState<PortInfo[]>([]);
    const [portsLoading, setPortsLoading] = useState(false);
    const [testing,      setTesting]      = useState<string | null>(null);
    // Desktop app: the bridge is bundled and reached over IPC, never an HTTP service that
    // can be up or down, so its status line says nothing there — see the card below.
    const isElectron = useIsDesktopApp();

    const checkRelay = useCallback(async () => {
        try {
            const data = await qrRequest<RelayConfig>("config:get");
            setConfig({ ...DEFAULT, ...data });
            setRelayUp(true);
        } catch {
            setRelayUp(false);
        } finally {
            setLoading(false);
        }
    }, []);

    /** Native folder picker — opens at the current folder, or Pictures\shop-ads. */
    const browseFolder = async () => {
        const picked = await window.electronAPI?.selectFolder?.(config.idleFolder || undefined);
        if (picked) setConfig((c) => ({ ...c, idleFolder: picked }));
    };

    // Is the display itself there? Answered by the bridge's "display:probe".
    const doProbe = useCallback(() => qrRequest<HardwareProbe>("display:probe"), []);
    const { result: display, probing, checking, refresh: probeDisplay } =
        useHardwareProbe(doProbe, loading);

    useEffect(() => { void checkRelay(); }, [checkRelay]);

    const fetchPorts = async () => {
        setPortsLoading(true);
        try {
            setPorts(await qrRequest<PortInfo[]>("ports"));
        } catch {
            toast.error("Could not fetch COM ports from the display bridge");
        } finally {
            setPortsLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await qrRequest("config:set", config);
            toast.success("QR display settings saved");
            void probeDisplay(); // New COM port — re-check straight away.
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    // Test screens use qrRequest, not the fire-and-forget qrDisplay facade: here a
    // failure must reach the person configuring the display, not be swallowed.
    const runTest = async (label: string, cmd: string, body: unknown) => {
        setTesting(label);
        try {
            await qrRequest(cmd, body ?? {});
            toast.success(`Sent: ${label}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `${label} failed`);
        } finally {
            setTesting(null);
        }
    };

    // Mirrors the ladder payload a real sale pushes (see PosScreen `qrDisplay.cart`):
    // per-item mrp/barcode, a named "Counter discount" pool, and a "You saved" hero.
    // Legacy subtotal/discount/total are kept so an un-updated relay still renders.
    const testCart = () => runTest("Test cart", "pos/cart", {
        // Gross-at-tag (barcode) = 150×2 + 499 + 599 = 1398; discounts sum 280 →
        // goods 1118; + Shipping 50 = total 1168; MRP total = 199×2 + 699 + 599 =
        // 1696; saved = 1696 − 1168 = 528 (31%). Kept consistent so the demo reconciles.
        items: [
            { name: "USB Cable",      qty: 2, price: 120, mrp: 199, barcode: 150 },
            { name: "HDMI 4K 2m",     qty: 1, price: 420, mrp: 699, barcode: 499 },
            { name: "Mouse Wireless", qty: 1, price: 520, mrp: 899, barcode: 599 },
        ],
        subtotal: 1398,
        discount: 280,
        total:    1168,
        discounts: [
            { label: "Counter discount",      amount: 169 },
            { label: "Level Discount (Silver)", amount: 31 },
            { label: "Loyalty (100 pts)",     amount: 50 },
            { label: "Coupon SAVE10",         amount: 30 },
        ],
        charges: [
            { label: "Shipping", amount: 50 },
        ],
        gst: 170.54, // CGST+SGST embedded in the 1118 goods @18%
        savings: { amount: 528, pct: 31 },
    });

    // Real UPI VPAs are per-counter (Settings → Counters) and travel with each
    // POS call. This diagnostic only checks the DQ11 renders a UPI QR frame, so it
    // sends a throwaway sample payee — never a live one.
    const testUpi = () =>
        runTest("Test UPI QR", "pos/upi", {
            amount: 100,
            vpa: "test@upi",
            payeeName: "Test Payee",
            caption: "Test ₹100",
        });

    // Product Explorer hover preview — a real, small, publicly reachable photo
    // so the button also proves the relay's fetch-and-composite path works,
    // not just its text layout.
    const testProduct = () => runTest("Test product photo", "pos/product", {
        name: "Wireless Mouse Pro",
        price: 799,
        mrp: 999,
        image: "https://picsum.photos/seed/dq11-test/320/300",
    });
    const testThankyou = () => runTest("Test thank-you", "pos/thankyou", { amount: 1300 });
    const testIdle     = () => runTest("Start slideshow", "idle/start", {});
    const testClear    = () => runTest("Clear screen",   "clear",       {});

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-xl mx-auto space-y-6 py-6">
            <div className="flex items-center gap-2">
                <QrCode size={20} />
                <h1 className="text-xl font-bold">QR Display (DQ11)</h1>
            </div>

            {/* Display status — is the DQ11 this counter is pointed at actually there,
                and which port is it on. Shown in both app and browser. */}
            <HardwareStatusCard
                noun="Display"
                probe={display}
                probing={probing}
                checking={checking}
                onRefresh={probeDisplay}
                emptyHint="Choose a COM port below, then Save."
            />

            {/* Relay status — browser only, where the bridge really is an HTTP service
                on :9192 that can be missing. */}
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
                        {loading ? "Checking display bridge…" : relayUp ? "Display bridge connected" : "Display bridge not running"}
                    </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setLoading(true); checkRelay(); }}>
                    <RefreshCw size={14} />
                </Button>
            </div>
            )}

            {!relayUp && !loading && <BridgeNotRunningNotice device="QR display" />}

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
                        <NumericInput
                            value={String(config.baudRate)}
                            min={1200}
                            max={4000000}
                            onValueChange={(v) => setConfig((c) => ({ ...c, baudRate: num(v, DEFAULT.baudRate) }))}
                        />
                        <p className="text-xs text-muted-foreground">DQ11 expects 921600. Don&apos;t change unless you have a different display.</p>
                    </div>
                </div>

                {/* Idle slideshow */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Idle Slideshow</p>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label>Photos Folder</Label>
                            {/* Desktop app only — a browser cannot open a native folder picker. */}
                            {isElectron && (
                                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={browseFolder}>
                                    <FolderOpen size={13} />
                                    Browse
                                </Button>
                            )}
                        </div>
                        <Input
                            value={config.idleFolder}
                            onChange={(e) => setConfig((c) => ({ ...c, idleFolder: e.target.value }))}
                            placeholder="Pictures\shop-ads"
                        />
                        <p className="text-xs text-muted-foreground">
                            <span className="font-mono">Pictures\shop-ads</span> is made on this PC automatically —
                            just put the advert photos in it. Use Browse to pick a different folder anywhere on the PC.
                        </p>
                    </div>
                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="qr-idle-products">Show offer products</Label>
                            <p className="text-xs text-muted-foreground">
                                Shop products priced below MRP or with a shop badge, biggest saving first — photo, price
                                and saving, taking turns with the photos above. Refreshed from the shop every few hours
                                while the POS is open.
                            </p>
                        </div>
                        <Switch
                            id="qr-idle-products"
                            checked={config.idleProducts !== false}
                            onCheckedChange={(on) => setConfig((c) => ({ ...c, idleProducts: on }))}
                        />
                    </div>
                    {config.idleProducts !== false && (
                        <div className="space-y-1.5">
                            <Label>Most products to show</Label>
                            <NumericInput
                                value={String(config.idleProductsMax ?? QR_SLIDE_PRODUCTS_DEFAULT)}
                                min={1}
                                max={QR_SLIDE_PRODUCTS_MAX}
                                onValueChange={(v) => setConfig((c) => ({ ...c, idleProductsMax: num(v, QR_SLIDE_PRODUCTS_DEFAULT) }))}
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Each slide (seconds)</Label>
                            <NumericInput
                                mode="decimal"
                                value={String(config.idleIntervalMs / 1000)}
                                min={1}
                                max={120}
                                onValueChange={(v) => setConfig((c) => ({ ...c, idleIntervalMs: Math.round(num(v, DEFAULT.idleIntervalMs / 1000) * 1000) }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Thank-you stays (seconds)</Label>
                            <NumericInput
                                mode="decimal"
                                value={String(config.thankyouDurationMs / 1000)}
                                min={1}
                                max={60}
                                onValueChange={(v) => setConfig((c) => ({ ...c, thankyouDurationMs: Math.round(num(v, DEFAULT.thankyouDurationMs / 1000) * 1000) }))}
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
                        <Button variant="outline" size="sm" onClick={testProduct} disabled={!!testing}>
                            {testing === "Test product photo" ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                            Test Product Photo
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
