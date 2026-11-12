"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import { parseDigitsInput } from "@/shared/lib/format";
import { APP_SETTING_DEFS, APP_SETTING_SECTIONS, SECRET_APP_SETTING_KEYS, type AppSettingKey, type AppSettingValues } from "@/shared/lib/constants/appSettings";

type Loaded = { values: AppSettingValues; env: Record<string, string> };
type WaNumber = { id: string; display: string; name: string; status: string; nameStatus: string; quality: string; wabaId: string };

const PICKABLE: AppSettingKey[] = ["META_WA_PHONE_NUMBER_ID", "WA_CONVERSATION_NUMBER_ID"];

export function AppSettingsForm() {
    const [values, setValues] = useState<AppSettingValues>({});
    const [env, setEnv] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [numbers, setNumbers] = useState<WaNumber[] | null>(null);
    const [numbersBusy, setNumbersBusy] = useState(false);

    useEffect(() => {
        getWithRetry<Loaded>("/api/settings/app-settings")
            .then((d) => { setValues(d.values); setEnv(d.env); })
            .catch((e) => toast.error(extractApiError(e, "Could not load app settings")))
            .finally(() => setLoading(false));
    }, []);

    const set = (k: AppSettingKey, v: string) => setValues((c) => ({ ...c, [k]: v }));

    /** "Use for OTP / bills": the number and the WhatsApp account it sits in go
     *  together — a bill template only sends from a number in its own account. */
    const pickNumber = (k: AppSettingKey, n: WaNumber) =>
        setValues((c) => {
            const mainWaba = c.META_WA_BUSINESS_ACCOUNT_ID || env.META_WA_BUSINESS_ACCOUNT_ID || "";
            if (k === "WA_CONVERSATION_NUMBER_ID") {
                // Blank when it is the main account, so a later OTP move cannot drag it along.
                return { ...c, WA_CONVERSATION_NUMBER_ID: n.id, WA_CONVERSATION_BUSINESS_ACCOUNT_ID: n.wabaId === mainWaba ? "" : n.wabaId };
            }
            // OTP moves account: pin the bills account first if it was following the old main.
            const keepBills = !c.WA_CONVERSATION_BUSINESS_ACCOUNT_ID && mainWaba && mainWaba !== n.wabaId && c.WA_CONVERSATION_NUMBER_ID;
            return {
                ...c,
                META_WA_PHONE_NUMBER_ID: n.id,
                META_WA_BUSINESS_ACCOUNT_ID: n.wabaId,
                ...(keepBills ? { WA_CONVERSATION_BUSINESS_ACCOUNT_ID: mainWaba } : {}),
            };
        });
    // Secrets come back masked; only the ones typed (or cleared) here are sent.
    const [secretEdits, setSecretEdits] = useState<Partial<Record<AppSettingKey, string>>>({});
    const setSecret = (k: AppSettingKey, v: string) => setSecretEdits((c) => ({ ...c, [k]: v }));

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

    /** One box: label + .env key, the input, hint and where the value comes from. */
    const renderField = (d: (typeof APP_SETTING_DEFS)[number]) => {
        const isSecret = "secret" in d && d.secret;
        const edit = secretEdits[d.key];
        const v = isSecret ? (edit ?? values[d.key] ?? "") : (values[d.key] ?? "");
        const envV = env[d.key] ?? "";
        const source = isSecret && edit !== undefined
            ? (edit ? "New value — Save to keep" : "Will be cleared on Save")
            : v ? `Saved here${isSecret ? ` ${v}` : ""}` : envV ? "From .env" : "Not set";
        const id = `as-${d.key}`;
        return (
            <div key={d.key} className="space-y-1">
                <Label htmlFor={id}>
                    {d.label} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">.env: {d.key}</span>
                </Label>
                {isSecret ? (
                    <div className="flex gap-2">
                        <Input
                            id={id}
                            type="password"
                            autoComplete="new-password"
                            value={edit ?? ""}
                            placeholder={values[d.key] ? `Saved ${values[d.key]} — type to replace` : envV ? `Using .env ${envV}` : ""}
                            onChange={(e) => setSecret(d.key, e.target.value)}
                            className="font-mono"
                        />
                        {values[d.key] && (
                            <Button type="button" size="sm" variant="outline" onClick={() => setSecret(d.key, "")}>Clear</Button>
                        )}
                    </div>
                ) : "options" in d ? (
                    <select
                        id={id}
                        value={v}
                        onChange={(e) => set(d.key, e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                        <option value="">— use .env —</option>
                        {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                ) : (
                    <Input
                        id={id}
                        type="text"
                        inputMode={"numeric" in d ? "numeric" : undefined}
                        value={v}
                        placeholder={envV}
                        onChange={(e) => set(d.key, "numeric" in d ? parseDigitsInput(e.target.value) : e.target.value)}
                        className="font-mono"
                    />
                )}
                <p className="text-xs text-muted-foreground">
                    {d.hint} <span className={v ? "text-emerald-600" : ""}>({source})</span>
                </p>
            </div>
        );
    };

    /** A provider is Ready when every non-optional key has a value (saved or .env). */
    const missing = (defs: readonly (typeof APP_SETTING_DEFS)[number][]) =>
        defs.filter((d) => !("optional" in d && d.optional) && !(secretEdits[d.key] ?? values[d.key] ?? env[d.key])).map((d) => d.label);

    const numbersBlock = (
                        <div className="space-y-2">
                            <Button size="sm" variant="outline" onClick={loadNumbers} disabled={numbersBusy}>
                                {numbersBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
                                Show numbers from Meta
                            </Button>
                            {numbers && (
                                <div className="rounded border text-sm divide-y">
                                    {numbers.length === 0 && <div className="p-2 text-muted-foreground">No numbers in these accounts.</div>}
                                    {numbers.map((n) => {
                                        const connected = n.status === "CONNECTED";
                                        return (
                                            <div key={n.id} className="flex flex-wrap items-center gap-2 p-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium">{n.display} · {n.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">
                                                        {n.id} · {n.status || "?"} · name {n.nameStatus || "?"}{n.quality ? ` · quality ${n.quality}` : ""} · account {n.wabaId}
                                                    </div>
                                                </div>
                                                {regFor !== n.id && (
                                                    <Button size="sm" variant="outline" onClick={() => { setRegFor(n.id); setPin(""); }}>
                                                        {connected ? "Change PIN" : "Register"}
                                                    </Button>
                                                )}
                                                {regFor === n.id && (
                                                    <div className="flex basis-full items-center gap-2">
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
                                                {PICKABLE.map((k) => (
                                                    <Button
                                                        key={k}
                                                        size="sm"
                                                        variant={values[k] === n.id ? "default" : "outline"}
                                                        disabled={!connected}
                                                        title={connected ? undefined : "Only a Connected number can send"}
                                                        onClick={() => pickNumber(k, n)}
                                                    >
                                                        {k === "META_WA_PHONE_NUMBER_ID" ? "Use for OTP" : "Use for bills"}
                                                    </Button>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
    );

    return (
        <div className="max-w-5xl space-y-8 pb-20">
            {APP_SETTING_SECTIONS.map((section) => {
                const providers = [...new Set(APP_SETTING_DEFS.filter((d) => d.section === section).map((d) => d.provider))];
                return (
                    <section key={section} className="space-y-3">
                        <h2 className="text-base font-semibold">{section}</h2>
                        {providers.map((provider) => {
                            const defs = APP_SETTING_DEFS.filter((d) => d.provider === provider);
                            const gaps = missing(defs);
                            return (
                                <div key={provider} className="rounded-lg border border-border bg-card p-4 space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h3 className="font-medium">{provider}</h3>
                                        {gaps.length === 0 ? (
                                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Ready</span>
                                        ) : (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Missing: {gaps.join(", ")}</span>
                                        )}
                                    </div>
                                    {defs.some((d) => d.key === "META_WA_PHONE_NUMBER_ID") && numbersBlock}
                                    <div className="grid gap-4 md:grid-cols-2">{defs.map(renderField)}</div>
                                </div>
                            );
                        })}
                    </section>
                );
            })}

            <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
                <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
                    Save
                </Button>
            </div>
        </div>
    );
}
