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
import { APP_SETTING_DEFS, type AppSettingKey, type AppSettingValues } from "@/shared/lib/constants/appSettings";

type Loaded = { values: AppSettingValues; env: Record<string, string> };
type WaNumber = { id: string; display: string; name: string; status: string; nameStatus: string; quality: string };

const GROUPS = [...new Set(APP_SETTING_DEFS.map((d) => d.group))];
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

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await axios.put<{ values: AppSettingValues }>("/api/settings/app-settings", values);
            setValues(data.values);
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

    return (
        <div className="max-w-3xl space-y-6">
            {GROUPS.map((g) => (
                <section key={g} className="rounded-lg border border-border bg-card p-4 space-y-4">
                    <h2 className="font-medium">{g}</h2>

                    {g === "WhatsApp" && (
                        <div className="space-y-2">
                            <Button size="sm" variant="outline" onClick={loadNumbers} disabled={numbersBusy}>
                                {numbersBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
                                Show numbers from Meta
                            </Button>
                            {numbers && (
                                <div className="rounded border text-sm divide-y">
                                    {numbers.length === 0 && <div className="p-2 text-muted-foreground">No numbers in this account.</div>}
                                    {numbers.map((n) => {
                                        const connected = n.status === "CONNECTED";
                                        return (
                                            <div key={n.id} className="flex flex-wrap items-center gap-2 p-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium">{n.display} · {n.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">
                                                        {n.id} · {n.status || "?"} · name {n.nameStatus || "?"}{n.quality ? ` · quality ${n.quality}` : ""}
                                                    </div>
                                                </div>
                                                {PICKABLE.map((k) => (
                                                    <Button
                                                        key={k}
                                                        size="sm"
                                                        variant={values[k] === n.id ? "default" : "outline"}
                                                        disabled={!connected}
                                                        title={connected ? undefined : "Only a Connected number can send"}
                                                        onClick={() => set(k, n.id)}
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
                    )}

                    {APP_SETTING_DEFS.filter((d) => d.group === g).map((d) => {
                        const v = values[d.key] ?? "";
                        const envV = env[d.key] ?? "";
                        const source = v ? "Saved here" : envV ? `Using .env: ${envV}` : "Not set";
                        const id = `as-${d.key}`;
                        return (
                            <div key={d.key} className="space-y-1">
                                <Label htmlFor={id}>{d.label}</Label>
                                {"options" in d ? (
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
                    })}
                </section>
            ))}

            <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
                Save
            </Button>
        </div>
    );
}
