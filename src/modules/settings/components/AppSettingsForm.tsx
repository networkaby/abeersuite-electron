"use client";

import { useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Info, KeyRound, Loader2, RefreshCw, Save, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { extractApiError } from "@/shared/lib/api";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import { parseDigitsInput } from "@/shared/lib/format";
import { cn } from "@/shared/lib/format/utils";
import { APP_SETTING_DEFS, APP_SETTING_SECTIONS, SECRET_APP_SETTING_KEYS, type AppSettingKey, type AppSettingValues } from "@/shared/lib/constants/appSettings";

type Loaded = { values: AppSettingValues; env: Record<string, string> };
type WaNumber = { id: string; display: string; name: string; status: string; nameStatus: string; quality: string; wabaId: string };
type Def = (typeof APP_SETTING_DEFS)[number];

const WA_PROVIDER = "WhatsApp (Meta Cloud API)";
const BILLS_WABA: AppSettingKey = "WA_CONVERSATION_BUSINESS_ACCOUNT_ID";

/** The three blocks of the WhatsApp card, in screen order. */
const WA_GROUPS = [
    { id: "n1", step: "1", title: "Number 1 — Login codes (OTP)", blurb: "Sign-in codes go from this number." },
    { id: "n2", step: "2", title: "Number 2 — Bills & replies", blurb: "Bills, reminders and staff replies. Blank = Number 1." },
    { id: "conn", step: "", title: "Connection", blurb: "Shared by both numbers." },
] as const;

const groupOf = (d: Def) => ("group" in d ? d.group : undefined);

/** Small coloured tag under a box — where its value comes from. */
function SourceTag({ tone, children }: { tone: "saved" | "env" | "unsaved" | "empty" | "clear"; children: ReactNode }) {
    const tones = {
        saved: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900",
        env: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900",
        unsaved: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900",
        clear: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900",
        empty: "bg-muted text-muted-foreground ring-border",
    } as const;
    return <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone])}>{children}</span>;
}

function StepBadge({ step }: { step: string }) {
    return step ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{step}</span>
    ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><KeyRound size={14} /></span>
    );
}

export function AppSettingsForm() {
    const [values, setValues] = useState<AppSettingValues>({});
    const [savedValues, setSavedValues] = useState<AppSettingValues>({});
    const [env, setEnv] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showEnvNames, setShowEnvNames] = useState(false);
    const [numbers, setNumbers] = useState<WaNumber[] | null>(null);
    const [numbersBusy, setNumbersBusy] = useState(false);
    // Number 2 in another business's WhatsApp account? Starts from what is saved.
    const [n2Different, setN2Different] = useState(false);

    useEffect(() => {
        getWithRetry<Loaded>("/api/settings/app-settings")
            .then((d) => {
                setValues(d.values);
                setSavedValues(d.values);
                setEnv(d.env);
                setN2Different(Boolean(d.values[BILLS_WABA] || d.env[BILLS_WABA]));
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load app settings")))
            .finally(() => setLoading(false));
    }, []);

    const set = (k: AppSettingKey, v: string) => setValues((c) => ({ ...c, [k]: v }));
    // Secrets come back masked; only the ones typed (or cleared) here are sent.
    const [secretEdits, setSecretEdits] = useState<Partial<Record<AppSettingKey, string>>>({});
    const setSecret = (k: AppSettingKey, v: string) => setSecretEdits((c) => ({ ...c, [k]: v }));

    const mainWaba = values.META_WA_BUSINESS_ACCOUNT_ID || env.META_WA_BUSINESS_ACCOUNT_ID || "";

    const chooseN2Account = (different: boolean) => {
        setN2Different(different);
        if (!different) set(BILLS_WABA, "");
    };

    /** "Use as ① / ②": the number and the WhatsApp account it sits in go together —
     *  a bill template only sends from a number in its own account. */
    const pickNumber = (slot: "n1" | "n2", n: WaNumber) => {
        if (slot === "n2") {
            const other = n.wabaId !== mainWaba;
            setValues((c) => ({ ...c, WA_CONVERSATION_NUMBER_ID: n.id, [BILLS_WABA]: other ? n.wabaId : "" }));
            setN2Different(other);
            return;
        }
        // Number 1 moves account: pin Number 2's account first if it was following the old one.
        const keepN2 = Boolean(!values[BILLS_WABA] && mainWaba && mainWaba !== n.wabaId && values.WA_CONVERSATION_NUMBER_ID);
        if (keepN2) setN2Different(true);
        setValues((c) => ({ ...c, META_WA_PHONE_NUMBER_ID: n.id, META_WA_BUSINESS_ACCOUNT_ID: n.wabaId, ...(keepN2 ? { [BILLS_WABA]: mainWaba } : {}) }));
    };

    const loadNumbers = async () => {
        setNumbersBusy(true);
        try {
            const { data } = await axios.get<{ numbers: WaNumber[] }>("/api/settings/app-settings?numbers=1");
            setNumbers(data.numbers);
        } catch (e) {
            toast.error(extractApiError(e, "Could not read numbers from Meta"));
        } finally {
            setNumbersBusy(false);
        }
    };

    // PIN box for one number: register a Pending one, or change a Connected one's PIN.
    const [regFor, setRegFor] = useState<string | null>(null);
    const [pin, setPin] = useState("");
    const register = async (id: string, action: "register" | "pin") => {
        setNumbersBusy(true);
        try {
            await axios.post("/api/settings/app-settings", { phoneNumberId: id, pin, action });
            toast.success(action === "pin" ? "PIN changed — save it in .env / Vercel as META_WA_2FA_PIN_<last 5 digits>" : "Registered — refreshing the list");
            setRegFor(null);
            setPin("");
            await loadNumbers();
        } catch (e) {
            toast.error(extractApiError(e, action === "pin" ? "PIN change failed" : "Register failed"));
        } finally {
            setNumbersBusy(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const plain = Object.fromEntries(Object.entries(values).filter(([k]) => !SECRET_APP_SETTING_KEYS.has(k)));
            const { data } = await axios.put<{ values: AppSettingValues }>("/api/settings/app-settings", { ...plain, ...secretEdits });
            setValues(data.values);
            setSavedValues(data.values);
            setSecretEdits({});
            toast.success("App settings saved — counters pick them up within a few minutes");
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
    }

    const isSecretDef = (d: Def) => "secret" in d && Boolean(d.secret);
    const dirtyCount =
        Object.keys(secretEdits).length +
        APP_SETTING_DEFS.filter((d) => !isSecretDef(d) && (values[d.key] ?? "") !== (savedValues[d.key] ?? "")).length;

    /** Where a box's value comes from, as a tag. */
    const sourceTag = (d: Def) => {
        const envV = env[d.key] ?? "";
        if (isSecretDef(d)) {
            const edit = secretEdits[d.key];
            if (edit !== undefined) return edit ? <SourceTag tone="unsaved">New — not saved</SourceTag> : <SourceTag tone="clear">Clears on Save</SourceTag>;
            if (values[d.key]) return <SourceTag tone="saved">Saved here {values[d.key]}</SourceTag>;
            return envV ? <SourceTag tone="env"><Server size={10} /> from .env {envV}</SourceTag> : <SourceTag tone="empty">Not set</SourceTag>;
        }
        const v = values[d.key] ?? "";
        if (v !== (savedValues[d.key] ?? "")) return <SourceTag tone="unsaved">{v ? "Changed — not saved" : envV ? "Back to .env on Save" : "Clears on Save"}</SourceTag>;
        if (v) return <SourceTag tone="saved">Saved here</SourceTag>;
        return envV ? <SourceTag tone="env"><Server size={10} /> from .env · {envV}</SourceTag> : <SourceTag tone="empty">Not set</SourceTag>;
    };

    /** One box: label (+ ⓘ help), the input and its source tag. */
    const renderField = (d: Def) => {
        const id = `as-${d.key}`;
        const edit = secretEdits[d.key];
        return (
            <div key={d.key} className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-1.5">
                    <Label htmlFor={id} className="text-sm font-medium">{d.label}</Label>
                    <span title={d.hint} className="cursor-help text-muted-foreground hover:text-foreground"><Info size={13} /><span className="sr-only">{d.hint}</span></span>
                    {"optional" in d && d.optional && <span className="text-[11px] text-muted-foreground">optional</span>}
                </div>
                {isSecretDef(d) ? (
                    <div className="flex gap-2">
                        <Input id={id} type="password" autoComplete="new-password" value={edit ?? ""} onChange={(e) => setSecret(d.key, e.target.value)} className="font-mono" />
                        {values[d.key] && edit === undefined && (
                            <Button type="button" size="sm" variant="outline" onClick={() => setSecret(d.key, "")}>Clear</Button>
                        )}
                    </div>
                ) : "options" in d ? (
                    <select
                        id={id}
                        value={values[d.key] ?? ""}
                        onChange={(e) => set(d.key, e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                        <option value="">Use .env</option>
                        {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                ) : (
                    <Input
                        id={id}
                        type="text"
                        inputMode={"numeric" in d ? "numeric" : undefined}
                        value={values[d.key] ?? ""}
                        onChange={(e) => set(d.key, "numeric" in d ? parseDigitsInput(e.target.value) : e.target.value)}
                        className="font-mono font-medium"
                    />
                )}
                <div className="flex flex-wrap items-center gap-2">
                    {sourceTag(d)}
                    {showEnvNames && <code className="text-[11px] text-muted-foreground">{d.key}</code>}
                </div>
            </div>
        );
    };

    const has = (k: AppSettingKey) => Boolean(secretEdits[k] ?? values[k] ?? env[k]);
    /** A card is Ready when every required key has a value; Number 2 in another
     *  business also needs that account's id, or its bills cannot send. */
    const missing = (defs: readonly Def[]) => {
        const gaps = defs.filter((d) => !("optional" in d && d.optional) && !has(d.key)).map((d) => {
            const g = WA_GROUPS.find((x) => x.id === groupOf(d));
            return g?.step ? `Number ${g.step} ${d.label}` : d.label;
        });
        if (defs.some((d) => d.key === BILLS_WABA) && n2Different && !has(BILLS_WABA)) gaps.push("Number 2 WhatsApp account ID");
        return gaps;
    };

    const readyBadge = (gaps: string[]) =>
        gaps.length === 0 ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Ready</span>
        ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Missing: {gaps.join(", ")}</span>
        );

    const n2AccountChoice = (
        <div className="space-y-2">
            <div className="text-sm font-medium">Number 2 sits in</div>
            <div className="grid grid-cols-2 gap-2">
                {[
                    { v: false, title: "Same account", sub: "as Number 1" },
                    { v: true, title: "Another business", sub: "its own WhatsApp account" },
                ].map((o) => (
                    <button
                        key={String(o.v)}
                        type="button"
                        onClick={() => chooseN2Account(o.v)}
                        className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            n2Different === o.v ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/60",
                        )}
                    >
                        <div className="text-sm font-medium">{o.title}</div>
                        <div className="text-xs text-muted-foreground">{o.sub}</div>
                    </button>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                {n2Different
                    ? "Bill templates are sent for approval to Number 2's account. In Meta, give the AbeerSuite system user full control of that account."
                    : "Bill templates live in Number 1's account, next to the OTP template."}
            </p>
        </div>
    );

    const waBlocks = (defs: readonly Def[]) => (
        <div className="grid gap-4 lg:grid-cols-3">
            {WA_GROUPS.map((g) => {
                const fields = defs.filter((d) => groupOf(d) === g.id && !(d.key === BILLS_WABA && !n2Different));
                return (
                    <div key={g.id} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-muted/30 p-4">
                        <div className="flex items-start gap-3">
                            <StepBadge step={g.step} />
                            <div className="min-w-0">
                                <div className="font-semibold leading-tight">{g.title}</div>
                                <div className="text-xs text-muted-foreground">{g.blurb}</div>
                            </div>
                        </div>
                        {fields.filter((d) => d.key !== BILLS_WABA).map(renderField)}
                        {g.id === "n2" && n2AccountChoice}
                        {g.id === "n2" && n2Different && fields.filter((d) => d.key === BILLS_WABA).map(renderField)}
                        {g.id === "n2" && n2Different && !has(BILLS_WABA) && (
                            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle size={13} /> Enter Number 2&apos;s account ID, or bills will fail.</p>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const numbersBlock = (
        <div className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-semibold">Numbers at Meta</div>
                    <div className="text-xs text-muted-foreground">Read live from both accounts. Pick one for each slot — its account fills in too.</div>
                </div>
                <Button size="sm" variant="outline" onClick={loadNumbers} disabled={numbersBusy}>
                    {numbersBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
                    {numbers ? "Refresh" : "Show numbers from Meta"}
                </Button>
            </div>
            {numbers && (
                <div className="divide-y rounded-lg border text-sm">
                    {numbers.length === 0 && <div className="p-3 text-muted-foreground">No numbers in these accounts.</div>}
                    {numbers.map((n) => {
                        const connected = n.status === "CONNECTED";
                        const isN1 = values.META_WA_PHONE_NUMBER_ID === n.id;
                        const isN2 = values.WA_CONVERSATION_NUMBER_ID === n.id;
                        return (
                            <div key={n.id} className="flex flex-wrap items-center gap-3 p-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 font-medium">
                                        {n.display} <span className="text-muted-foreground">· {n.name}</span>
                                        <SourceTag tone={connected ? "saved" : "unsaved"}>{n.status || "?"}</SourceTag>
                                    </div>
                                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                                        id {n.id} · account {n.wabaId}{n.wabaId !== mainWaba ? " (another business)" : ""} · name {n.nameStatus || "?"}{n.quality ? ` · quality ${n.quality}` : ""}
                                    </div>
                                </div>
                                {regFor !== n.id && (
                                    <Button size="sm" variant="ghost" onClick={() => { setRegFor(n.id); setPin(""); }}>
                                        {connected ? "Change PIN" : "Register"}
                                    </Button>
                                )}
                                {(["n1", "n2"] as const).map((slot) => {
                                    const active = slot === "n1" ? isN1 : isN2;
                                    return (
                                        <Button
                                            key={slot}
                                            size="sm"
                                            variant={active ? "default" : "outline"}
                                            disabled={!connected}
                                            title={connected ? undefined : "Only a Connected number can send"}
                                            onClick={() => pickNumber(slot, n)}
                                        >
                                            {active ? "✓ " : ""}Number {slot === "n1" ? "1 (OTP)" : "2 (bills)"}
                                        </Button>
                                    );
                                })}
                                {regFor === n.id && (
                                    <div className="flex basis-full flex-wrap items-center gap-2">
                                        <Input
                                            type="password"
                                            inputMode="numeric"
                                            autoComplete="off"
                                            placeholder="6-digit 2-step PIN"
                                            value={pin}
                                            onChange={(e) => setPin(parseDigitsInput(e.target.value).slice(0, 6))}
                                            className="w-44 font-mono"
                                        />
                                        <Button size="sm" disabled={pin.length !== 6 || numbersBusy} onClick={() => register(n.id, connected ? "pin" : "register")}>
                                            {connected ? "Set PIN at Meta" : "Register with Meta"}
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => setRegFor(null)}>Cancel</Button>
                                        <span className="text-xs text-muted-foreground">Keep this PIN safe — Meta asks for it again.</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div className="w-full space-y-10 pb-24">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Value source:</span>
                    <SourceTag tone="saved">Saved here</SourceTag>
                    <SourceTag tone="env"><Server size={10} /> from .env</SourceTag>
                    <SourceTag tone="unsaved">Not saved yet</SourceTag>
                    <SourceTag tone="empty">Not set</SourceTag>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch checked={showEnvNames} onCheckedChange={setShowEnvNames} />
                    Show .env names
                </label>
            </div>

            {APP_SETTING_SECTIONS.map((section) => {
                const providers = [...new Set(APP_SETTING_DEFS.filter((d) => d.section === section).map((d) => d.provider))];
                return (
                    <section key={section} className="space-y-4">
                        <h2 className="flex items-center gap-3 text-lg font-semibold">
                            {section}
                            <span className="h-px flex-1 bg-border" />
                        </h2>
                        <div className="grid gap-5 xl:grid-cols-2">
                            {providers.map((provider) => {
                                const defs = APP_SETTING_DEFS.filter((d) => d.provider === provider);
                                const isWa = provider === WA_PROVIDER;
                                return (
                                    <div key={provider} className={cn("min-w-0 space-y-5 rounded-2xl border bg-card p-5 shadow-sm", isWa && "xl:col-span-2")}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="text-base font-semibold">{provider}</h3>
                                            {readyBadge(missing(defs))}
                                        </div>
                                        {isWa ? (
                                            <>
                                                {waBlocks(defs)}
                                                {numbersBlock}
                                            </>
                                        ) : (
                                            <div className="grid gap-5 md:grid-cols-2">{defs.map(renderField)}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })}

            <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
                <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
                    Save
                </Button>
                <span className={cn("text-sm", dirtyCount ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    {dirtyCount ? `${dirtyCount} change${dirtyCount > 1 ? "s" : ""} not saved` : "All saved"}
                </span>
            </div>
        </div>
    );
}
