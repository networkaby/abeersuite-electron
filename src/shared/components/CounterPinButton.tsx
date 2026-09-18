"use client";

/**
 * "Set a PIN for this counter" — the quiet line in the sidebar, and the panel behind it.
 *
 * Never a popup and never a nag. The offer sits with Sign out and waits to be noticed;
 * a cashier who does not want one simply never clicks it, and nothing asks again.
 *
 * Shown only on the desktop app, because that is the only place a PIN means anything —
 * six digits are a counter credential, refused outright on the website. The panel says
 * plainly which counter it is for, since a PIN set here is refused on every other one.
 *
 * Everything it does goes through `/api/me/counter-pin`, which acts on the signed-in
 * person and nobody else. There is no admin version of this screen on purpose: an owner
 * disables a departing cashier's account, which stops their PIN with everything else.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useIsDesktopApp } from "@/shared/lib/bridge";
import { getLocalCounterSetup } from "@/shared/lib/counter/setupGate";

export default function CounterPinButton({ collapsed }: { collapsed: boolean }) {
    const isDesktop = useIsDesktopApp();
    const { data: session } = useSession();
    const email = session?.user?.email ?? "";

    const [open, setOpen] = useState(false);
    const [counterNumber, setCounterNumber] = useState<number | null>(null);
    const [hasPin, setHasPin] = useState(false);

    const [pin, setPin] = useState("");
    const [again, setAgain] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    /** Which counter this PC holds, and whether there is already a PIN on it. */
    const refresh = useCallback(async () => {
        const setup = await getLocalCounterSetup();
        setCounterNumber(setup?.counterNumber ?? null);
        if (!email) return;
        try {
            const res = await fetch("/api/counter-pin/status", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const out = res.ok ? await res.json() as { state?: string } : null;
            setHasPin(out?.state === "ready" || out?.state === "password-due");
        } catch {
            setHasPin(false);   // Cannot tell — offer to set one; the API is the judge.
        }
    }, [email]);

    useEffect(() => { if (isDesktop) void refresh(); }, [isDesktop, refresh]);

    if (!isDesktop) return null;

    const reset = () => { setPin(""); setAgain(""); setPassword(""); setError(""); };

    async function save() {
        if (pin !== again) { setError("The two PINs are not the same."); return; }
        setBusy(true);
        setError("");
        try {
            const res = await fetch("/api/me/counter-pin", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pin, password }),
            });
            const out = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) { setError(out.error || "Could not save your PIN."); return; }
            toast.success(`PIN saved for counter ${counterNumber ?? ""}`.trim());
            setHasPin(true);
            reset();
            setOpen(false);
        } catch {
            // The office books have to take this write — see the route's header.
            setError("Could not reach the office. A PIN can only be saved with the line up.");
        } finally {
            setBusy(false);
        }
    }

    async function remove(scope: "counter" | "all") {
        setBusy(true);
        setError("");
        try {
            const res = await fetch(`/api/me/counter-pin?scope=${scope}`, { method: "DELETE" });
            const out = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) { setError(out.error || "Could not remove your PIN."); return; }
            toast.success(scope === "all" ? "PIN removed from every counter" : "PIN removed from this counter");
            setHasPin(false);
            reset();
            setOpen(false);
        } catch {
            setError("Could not reach the office. A PIN can only be removed with the line up.");
        } finally {
            setBusy(false);
        }
    }

    const onCounter = counterNumber !== null;
    const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                onClick={() => { reset(); setOpen(true); void refresh(); }}
                title={collapsed ? "Counter PIN" : ""}
                className={[
                    "h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground",
                    collapsed ? "justify-center px-2" : "",
                ].join(" ")}
            >
                <KeyRound size={17} className="shrink-0" />
                {!collapsed && (
                    <span className="truncate">
                        {hasPin ? "Counter PIN" : "Set a PIN for this counter"}
                    </span>
                )}
            </Button>

            <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {hasPin ? "Your counter PIN" : "Set your PIN"}
                            {onCounter ? ` for counter ${counterNumber}` : ""}
                        </DialogTitle>
                        <DialogDescription>
                            {onCounter
                                ? "Tap your photo on the sign-in screen and type these six digits. This PIN works on this counter only — on another counter you set a separate one, and your password is still asked for every few days."
                                : "This PC does not hold a counter yet, so there is no PIN to set here."}
                        </DialogDescription>
                    </DialogHeader>

                    {onCounter && (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-sm" htmlFor="cp-pin">{hasPin ? "New PIN" : "PIN"}</label>
                                <Input
                                    id="cp-pin" inputMode="numeric" autoComplete="off" type="password"
                                    placeholder="6 digits" value={pin}
                                    onChange={(e) => setPin(digits(e.target.value))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-sm" htmlFor="cp-again">Type it again</label>
                                <Input
                                    id="cp-again" inputMode="numeric" autoComplete="off" type="password"
                                    placeholder="6 digits" value={again}
                                    onChange={(e) => setAgain(digits(e.target.value))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                {/* A second key to this account must cost the first one. An
                                    unattended till with a session open is not enough. */}
                                <label className="text-sm" htmlFor="cp-pass">Your password</label>
                                <Input
                                    id="cp-pass" type="password" autoComplete="current-password"
                                    placeholder="To prove it is you" value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Six digits, and not a run or one repeated digit. The line must be up to save
                                a PIN — using one later works offline.
                            </p>
                            {error && <p className="text-xs text-destructive">{error}</p>}
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:justify-between">
                        {hasPin ? (
                            <div className="flex gap-2">
                                <Button type="button" variant="ghost" disabled={busy}
                                    className="text-destructive hover:bg-destructive/10"
                                    onClick={() => void remove("counter")}>
                                    Reset on this counter
                                </Button>
                                <Button type="button" variant="ghost" disabled={busy}
                                    className="text-destructive hover:bg-destructive/10"
                                    onClick={() => void remove("all")}>
                                    Reset on all counters
                                </Button>
                            </div>
                        ) : <span />}
                        {onCounter && (
                            <Button type="button" disabled={busy || pin.length !== 6 || !password}
                                onClick={() => void save()}>
                                {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}
                                {hasPin ? "Change PIN" : "Save PIN"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
