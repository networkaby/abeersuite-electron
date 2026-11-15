"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Cloud, KeyRound, Loader2, Pencil, Plus, Smartphone, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractApiError } from "@/shared/lib/api";
import { parseDigitsInput } from "@/shared/lib/format";
import type { WaNumberView } from "@/shared/lib/whatsapp/waNumbers";
import { useCoexistSignup } from "./useCoexistSignup";

/**
 * App Settings → WhatsApp numbers: one record per number, each on its own
 * (owner, 2026-11-15).
 *   Cloud only   staff type its ids and, if needed, its own token; editable.
 *   Coexistence  Meta's wizard fills it in; only its name can be changed.
 * Numbers that share a WhatsApp account share template approvals — the
 * Templates page groups them (groupWaAccounts).
 */

const API = "/api/settings/whatsapp-numbers";

/** One option per WhatsApp account — numbers with the same account id share approvals. */
export type WaAccountGroup = { wabaId: string; label: string; numbers: WaNumberView[]; billsHere: boolean };

export function groupWaAccounts(numbers: WaNumberView[]): WaAccountGroup[] {
    const map = new Map<string, WaAccountGroup>();
    for (const n of numbers) {
        const g = map.get(n.wabaId) ?? { wabaId: n.wabaId, label: n.accountLabel, numbers: [], billsHere: false };
        g.numbers.push(n);
        if (n.useForBills) g.billsHere = true;
        map.set(n.wabaId, g);
    }
    // Bills account first, then in the order numbers were added.
    return [...map.values()].sort((a, b) => Number(b.billsHere) - Number(a.billsHere));
}

const fmtPhone = (p: string) => (p ? p.replace(/^(91)?(\d{5})(\d{5})$/, "+91 $2 $3") : "Phone not known yet — Test fills it");

type Draft = { label: string; phone: string; phoneNumberId: string; wabaId: string; token: string };
const EMPTY: Draft = { label: "", phone: "", phoneNumberId: "", wabaId: "", token: "" };

export function WhatsAppNumbersPanel() {
    const [numbers, setNumbers] = useState<WaNumberView[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [dialog, setDialog] = useState<null | "choose" | "cloud" | "rename">(null);
    const [editing, setEditing] = useState<WaNumberView | null>(null);
    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [removing, setRemoving] = useState<WaNumberView | null>(null);
    const [pinFor, setPinFor] = useState<WaNumberView | null>(null);
    const [pin, setPin] = useState("");

    const load = useCallback(() => {
        axios.get<{ numbers: WaNumberView[] }>(API)
            .then(({ data }) => setNumbers(data.numbers))
            .catch((e) => toast.error(extractApiError(e, "Could not load WhatsApp numbers")));
    }, []);
    useEffect(load, [load]);

    const coexist = useCoexistSignup(() => load());
    const groups = useMemo(() => groupWaAccounts(numbers ?? []), [numbers]);

    /** Run one call; the API answers with the fresh list. */
    async function act(key: string, call: () => Promise<{ data: { numbers: WaNumberView[] } }>, ok?: string) {
        setBusy(key);
        try {
            const { data } = await call();
            setNumbers(data.numbers);
            if (ok) toast.success(ok);
            return true;
        } catch (e) {
            toast.error(extractApiError(e, "Could not save"));
            return false;
        } finally {
            setBusy(null);
        }
    }

    const openCloud = (n?: WaNumberView) => {
        setEditing(n ?? null);
        setDraft(n ? { label: n.label, phone: n.phone, phoneNumberId: n.phoneNumberId, wabaId: n.wabaId, token: "" } : EMPTY);
        setDialog(n?.type === "COEXIST" ? "rename" : "cloud");
    };

    async function saveCloud() {
        // A blank token box keeps the saved one (or none); only a typed one is sent.
        const body = { label: draft.label, phone: draft.phone, phoneNumberId: draft.phoneNumberId, wabaId: draft.wabaId, ...(draft.token ? { token: draft.token } : {}) };
        const ok = await act("save", () => (editing ? axios.put(`${API}/${editing.id}`, body) : axios.post(API, body)), editing ? "Saved" : "Number added");
        if (ok) setDialog(null);
    }

    async function clearToken(n: WaNumberView) {
        await act(`tok${n.id}`, () => axios.put(`${API}/${n.id}`, { label: n.label, phone: n.phone, phoneNumberId: n.phoneNumberId, wabaId: n.wabaId, token: "" }), "Uses the main token now");
    }

    async function test(n: WaNumberView) {
        setBusy(`test${n.id}`);
        try {
            const { data } = await axios.post<{ ok: boolean; status: string; numbers: WaNumberView[] }>(`${API}/${n.id}/test`);
            setNumbers(data.numbers);
            if (data.ok) toast.success(`Meta says ${data.status}`);
            else toast.error(`Meta refused: ${data.status}`);
        } catch (e) {
            toast.error(extractApiError(e, "Test failed"));
        } finally {
            setBusy(null);
        }
    }

    async function register(n: WaNumberView) {
        setBusy(`pin${n.id}`);
        const connected = n.status === "CONNECTED";
        try {
            await axios.post("/api/settings/app-settings", { phoneNumberId: n.phoneNumberId, pin, action: connected ? "pin" : "register" });
            toast.success(connected ? "PIN changed at Meta — keep it safe" : "Registered with Meta");
            setPinFor(null);
            setPin("");
            await test(n);
        } catch (e) {
            toast.error(extractApiError(e, connected ? "PIN change failed" : "Register failed"));
        } finally {
            setBusy(null);
        }
    }

    const cloudValid = /^\d{10,15}$/.test(draft.phone) && /^\d{5,25}$/.test(draft.phoneNumberId) && /^\d{5,25}$/.test(draft.wabaId) && draft.label.trim();
    const billsSet = (numbers ?? []).some((n) => n.useForBills);
    const otpSet = (numbers ?? []).some((n) => n.useForOtp);

    return (
        <div className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-semibold">WhatsApp numbers</div>
                    <div className="text-xs text-muted-foreground">
                        Each number is its own record. Numbers in the same WhatsApp account share template approvals.
                    </div>
                </div>
                <Button size="sm" onClick={() => setDialog("choose")} disabled={coexist.busy}>
                    {coexist.busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />} Add number
                </Button>
            </div>

            {numbers && (!billsSet || !otpSet) && (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {!billsSet && "No number is switched to “Use for bills” — bills, reminders and new chats cannot go out. "}
                    {!otpSet && "No number is switched to “Use for OTP” — WhatsApp login codes cannot go out."}
                </p>
            )}

            <div className="divide-y rounded-lg border">
                {!numbers && <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
                {numbers?.length === 0 && <div className="p-3 text-sm text-muted-foreground">No numbers yet — Add number.</div>}
                {numbers?.map((n, i) => {
                    const ok = n.status === "CONNECTED";
                    return (
                        <div key={n.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">{i + 1}</div>
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">{fmtPhone(n.phone)}</span>
                                    <span className="text-muted-foreground">· {n.label}</span>
                                    {n.type === "CLOUD" ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                                            <Cloud size={11} /> Cloud only
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-900 dark:bg-violet-950 dark:text-violet-200">
                                            <Smartphone size={11} /> Coexistence
                                        </span>
                                    )}
                                    <span
                                        title={n.checkedAt ? `Checked ${new Date(n.checkedAt).toLocaleString()}` : undefined}
                                        className={`max-w-full break-words rounded-full px-2 py-0.5 text-xs ${ok ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}
                                    >
                                        {n.status}
                                    </span>
                                </div>
                                <div className="break-all font-mono text-xs text-muted-foreground">
                                    number id {n.phoneNumberId} · account {n.accountLabel} ({n.wabaId}) · token {n.tokenTail ? `own …${n.tokenTail}` : "main"}
                                    {n.tokenTail && n.type === "CLOUD" && (
                                        <button type="button" className="ml-2 underline" disabled={busy !== null} onClick={() => void clearToken(n)}>use main</button>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={n.useForOtp}
                                            disabled={busy !== null}
                                            onCheckedChange={(v) => void act(`job${n.id}`, () => axios.patch(`${API}/${n.id}`, { useForOtp: v }))}
                                        />
                                        Use for OTP
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={n.useForBills}
                                            disabled={busy !== null}
                                            onCheckedChange={(v) => void act(`job${n.id}`, () => axios.patch(`${API}/${n.id}`, { useForBills: v }))}
                                        />
                                        Use for bills &amp; new chats
                                    </label>
                                    <span className="text-muted-foreground">Replies always go from the number the customer wrote to.</span>
                                </div>
                                {pinFor?.id === n.id && (
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <Input
                                            type="password"
                                            inputMode="numeric"
                                            autoComplete="new-password"
                                            data-1p-ignore
                                            data-lpignore="true"
                                            placeholder="6-digit 2-step PIN"
                                            value={pin}
                                            onChange={(e) => setPin(parseDigitsInput(e.target.value).slice(0, 6))}
                                            className="h-8 w-44 font-mono"
                                        />
                                        <Button size="sm" disabled={pin.length !== 6 || busy !== null} onClick={() => void register(n)}>
                                            {ok ? "Set PIN at Meta" : "Register with Meta"}
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => setPinFor(null)}>Cancel</Button>
                                        <span className="text-xs text-muted-foreground">Keep this PIN safe — Meta asks for it again.</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void test(n)}>
                                    {busy === `test${n.id}` ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Wifi size={13} className="mr-1" />} Test
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => openCloud(n)}>
                                    <Pencil size={13} className="mr-1" /> {n.type === "CLOUD" ? "Edit" : "Rename"}
                                </Button>
                                {n.type === "CLOUD" && (
                                    <Button size="sm" variant="ghost" onClick={() => { setPinFor(n); setPin(""); }}>
                                        <KeyRound size={13} className="mr-1" /> {ok ? "PIN" : "Register"}
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRemoving(n)}>
                                    <Trash2 size={13} className="mr-1" /> Remove
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {groups.length > 0 && (
                <div className="text-xs text-muted-foreground">
                    Template approval options (worked out from the account ids):{" "}
                    {groups.map((g, i) => (
                        <span key={g.wabaId}>
                            {i > 0 && " · "}
                            <b>{g.label}</b> ({g.numbers.map((n) => n.phone.slice(-5) || n.phoneNumberId.slice(-5)).join(", ")})
                        </span>
                    ))}
                </div>
            )}

            {/* Add number: Cloud only (form) or Coexistence (Meta's wizard) */}
            <Dialog open={dialog === "choose"} onOpenChange={(o) => !o && setDialog(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Add a WhatsApp number</DialogTitle>
                        <DialogDescription>How will this number work?</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <button type="button" onClick={() => openCloud()} className="rounded-lg border p-4 text-left hover:border-primary hover:bg-primary/5">
                            <Cloud className="mb-2 text-sky-600" />
                            <div className="font-medium">Cloud only</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                The number is on the API only — no phone app. You type its number id, account id and (if needed) token from WhatsApp Manager.
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setDialog(null);
                                void coexist.start();
                            }}
                            className="rounded-lg border p-4 text-left hover:border-primary hover:bg-primary/5"
                        >
                            <Smartphone className="mb-2 text-violet-600" />
                            <div className="font-medium">Coexistence</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                The number keeps working in the WhatsApp Business app on its phone. Meta&apos;s wizard fills everything in — then scan the QR
                                from WhatsApp Business → Settings → Business platform.
                                {coexist.isCounter && " Opens the office website — Meta sign-in works only there."}
                            </div>
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog === "cloud"} onOpenChange={(o) => !o && setDialog(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit Cloud number" : "Add a Cloud only number"}</DialogTitle>
                        <DialogDescription>From WhatsApp Manager → Phone numbers, and System users for a token.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div className="grid gap-1">
                            <Label>Name</Label>
                            <Input value={draft.label} autoComplete="off" placeholder="e.g. Network Service — bills" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                        </div>
                        <div className="grid gap-1">
                            <Label>Phone (with 91)</Label>
                            <Input inputMode="numeric" autoComplete="off" value={draft.phone} placeholder="918876996977" onChange={(e) => setDraft({ ...draft, phone: parseDigitsInput(e.target.value) })} className="font-mono" />
                        </div>
                        <div className="grid gap-1">
                            <Label>Phone number ID</Label>
                            <Input inputMode="numeric" autoComplete="off" value={draft.phoneNumberId} onChange={(e) => setDraft({ ...draft, phoneNumberId: parseDigitsInput(e.target.value) })} className="font-mono" />
                        </div>
                        <div className="grid gap-1">
                            <Label>WhatsApp account ID</Label>
                            <Input inputMode="numeric" autoComplete="off" value={draft.wabaId} onChange={(e) => setDraft({ ...draft, wabaId: parseDigitsInput(e.target.value) })} className="font-mono" />
                            {draft.wabaId && (numbers ?? []).some((x) => x.wabaId === draft.wabaId && x.id !== editing?.id) && (
                                <span className="text-xs text-emerald-700 dark:text-emerald-300">Same account as another number — shares its template approvals.</span>
                            )}
                        </div>
                        <div className="grid gap-1">
                            <Label>Access token <span className="font-normal text-muted-foreground">(optional — blank uses the main token)</span></Label>
                            <Input
                                type="password"
                                autoComplete="new-password"
                                data-1p-ignore
                                data-lpignore="true"
                                value={draft.token}
                                placeholder={editing?.tokenTail ? `own token …${editing.tokenTail} kept — type to replace` : ""}
                                onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                        <Button disabled={!cloudValid || busy !== null} onClick={() => void saveCloud()}>
                            {busy === "save" && <Loader2 size={14} className="mr-1 animate-spin" />}
                            {editing ? "Save" : "Add number"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog === "rename"} onOpenChange={(o) => !o && setDialog(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename coexistence number</DialogTitle>
                        <DialogDescription>Its ids and token come from Meta&apos;s wizard. To change them, remove it and connect again.</DialogDescription>
                    </DialogHeader>
                    <Input value={draft.label} autoComplete="off" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                        <Button
                            disabled={!draft.label.trim() || busy !== null}
                            onClick={async () => {
                                if (editing && (await act("save", () => axios.put(`${API}/${editing.id}`, { label: draft.label }), "Saved"))) setDialog(null);
                            }}
                        >
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={removing != null} onOpenChange={(o) => !o && setRemoving(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Remove {removing && fmtPhone(removing.phone)}?</DialogTitle>
                        <DialogDescription>
                            Our app stops sending from it. Its chats stay in the inbox, and its account&apos;s template approvals are kept — a number added
                            to the same account later uses them straight away. Nothing changes at Meta.
                            {(removing?.useForBills || removing?.useForOtp) && " It carries bills or OTP now — switch that job to another number first, or it stops."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={busy !== null}
                            onClick={async () => {
                                if (removing && (await act("remove", () => axios.delete(`${API}/${removing.id}`), "Removed"))) setRemoving(null);
                            }}
                        >
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** Template page strip: one button per WhatsApp account (numbers sharing an account share one). */
export function WaAccountOptions({
    numbers,
    selected,
    onSelect,
    disabled,
}: {
    numbers: WaNumberView[];
    selected: string;
    onSelect: (wabaId: string) => void;
    disabled?: boolean;
}) {
    const groups = groupWaAccounts(numbers);
    if (groups.length < 2) return null;
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Approval for:</span>
            {groups.map((g) => (
                <Button
                    key={g.wabaId}
                    size="sm"
                    disabled={disabled}
                    variant={g.wabaId === selected ? "default" : "outline"}
                    onClick={() => onSelect(g.wabaId)}
                    className="h-auto py-1.5"
                    title={`WhatsApp account ${g.wabaId}`}
                >
                    <span className="text-left leading-tight">
                        <span className="block">{g.label}{g.billsHere ? " · bills" : ""}</span>
                        <span className="block font-mono text-[11px] opacity-80">
                            {g.numbers.map((n) => `${n.phone ? `${n.phone.slice(-10, -5)} ${n.phone.slice(-5)}` : n.label}${n.type === "COEXIST" ? " (coexist)" : ""}`).join(" · ")}
                        </span>
                    </span>
                </Button>
            ))}
            <span className="basis-full text-xs text-muted-foreground">
                The wording is shared; Meta approves it separately at each account. Bills send from the number switched to &quot;Use for bills&quot; (App Settings).
            </span>
        </div>
    );
}
