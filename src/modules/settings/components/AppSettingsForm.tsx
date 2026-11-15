"use client";

import { useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CircleHelp, Info, Loader2, Lock, Save, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { extractApiError } from "@/shared/lib/api";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import { parseDigitsInput } from "@/shared/lib/format";
import { cn } from "@/shared/lib/format/utils";
import { APP_SETTING_DEFS, APP_SETTING_SECTIONS, SECRET_APP_SETTING_KEYS, type AppSettingKey, type AppSettingValues } from "@/shared/lib/constants/appSettings";
import { ENV_ONLY_PROVIDERS, type EnvOnlyProvider } from "@/shared/lib/constants/appSettingsHelp";
import { WhatsAppNumbersPanel } from "./WhatsAppNumbersPanel";

type Loaded = { values: AppSettingValues; env: Record<string, string>; envOnly: Record<string, boolean> };

type Def = (typeof APP_SETTING_DEFS)[number];

const WA_PROVIDER = "WhatsApp (Meta Cloud API)";

/** The old Number 1 / Number 2 boxes (group n1 / n2) are read once to fill
 *  WhatsApp numbers (waNumbers.ts) and no longer shown. */
const groupOf = (d: Def) => ("group" in d ? d.group : undefined);
const isLegacyWa = (d: Def) => groupOf(d) === "n1" || groupOf(d) === "n2";

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

export function AppSettingsForm() {
    const [values, setValues] = useState<AppSettingValues>({});
    const [savedValues, setSavedValues] = useState<AppSettingValues>({});
    const [env, setEnv] = useState<Record<string, string>>({});
    const [envOnly, setEnvOnly] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showEnvNames, setShowEnvNames] = useState(false);
    useEffect(() => {
        getWithRetry<Loaded>("/api/settings/app-settings")
            .then((d) => {
                setValues(d.values);
                setSavedValues(d.values);
                setEnv(d.env);
                setEnvOnly(d.envOnly ?? {});
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load app settings")))
            .finally(() => setLoading(false));
    }, []);

    const set = (k: AppSettingKey, v: string) => setValues((c) => ({ ...c, [k]: v }));
    // Secrets come back masked; only the ones typed (or cleared) here are sent.
    const [secretEdits, setSecretEdits] = useState<Partial<Record<AppSettingKey, string>>>({});
    const setSecret = (k: AppSettingKey, v: string) => setSecretEdits((c) => ({ ...c, [k]: v }));

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
            if (values[d.key]) return <SourceTag tone="saved">Saved here {values[d.key]}{envV ? " · also in .env" : ""}</SourceTag>;
            return envV ? <SourceTag tone="env"><Server size={10} /> from .env {envV}</SourceTag> : <SourceTag tone="empty">Not set</SourceTag>;
        }
        const v = values[d.key] ?? "";
        if (v !== (savedValues[d.key] ?? "")) return <SourceTag tone="unsaved">{v ? "Changed — not saved" : envV ? "Back to .env on Save" : "Clears on Save"}</SourceTag>;
        if (v) return <SourceTag tone="saved">{envV ? "Saved here · also in .env" : "Saved here"}</SourceTag>;
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
    const missing = (defs: readonly Def[]) =>
        defs.filter((d) => !isLegacyWa(d) && !("optional" in d && d.optional) && !has(d.key)).map((d) => d.label);

    const readyBadge = (gaps: string[]) =>
        gaps.length === 0 ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Ready</span>
        ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Missing: {gaps.join(", ")}</span>
        );

    /** A service whose keys live only in the server's .env — names and set / missing, no boxes. */
    /** Read-only rows for .env-only keys: name, .env key, set / not set. */
    const envRows = (p: EnvOnlyProvider) => {
        // Keys sharing a `group` sit together under that purpose heading, in first-seen order.
        const groups = [...new Set(p.keys.map((k) => k.group ?? ""))];
        return (
            <div className="space-y-3">
                {groups.map((g) => (
                    <div key={g || "all"} className="space-y-1.5">
                        {g && <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>}
                        <div className="divide-y rounded-lg border bg-card text-sm">
                            {p.keys.filter((k) => (k.group ?? "") === g).map((k) => (
                                <div key={k.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 font-medium"><Lock size={12} className="text-muted-foreground" /> {k.label}</div>
                                        <code className="break-all text-[11px] text-muted-foreground">{k.key}</code>
                                    </div>
                                    {envOnly[k.key] ? <SourceTag tone="env"><Server size={10} /> set in .env</SourceTag> : <SourceTag tone="empty">Not set</SourceTag>}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const envOnlyCard = (p: EnvOnlyProvider) => {
        const gaps = p.keys.filter((k) => !envOnly[k.key]).length;
        return (
            <div key={p.provider} className="min-w-0 space-y-4 rounded-2xl border border-dashed bg-muted/20 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-base font-semibold"><Lock size={15} className="text-muted-foreground" /> {p.provider}</h3>
                    <div className="flex items-center gap-3">
                        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">.env only</span>
                        {gaps === 0 ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">All set</span>
                        ) : (
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{gaps} missing</span>
                        )}
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">{p.why}</p>
                {envRows(p)}
            </div>
        );
    };

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
                <span className="text-xs text-muted-foreground">Tip: once a value works, you may move it to .env / Vercel and clear it here — your choice.</span>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch checked={showEnvNames} onCheckedChange={setShowEnvNames} />
                    Show .env names
                </label>
            </div>

            {APP_SETTING_SECTIONS.map((section) => {
                const providers = [...new Set(APP_SETTING_DEFS.filter((d) => d.section === section).map((d) => d.provider))];
                const envCards = ENV_ONLY_PROVIDERS.filter((p) => p.section === section && !p.attachTo);
                if (!providers.length && !envCards.length) return null;
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
                                // .env-only keys of the same service, shown inside this card.
                                const attached = ENV_ONLY_PROVIDERS.filter((p) => p.attachTo === provider);
                                const attachedGaps = attached.flatMap((p) => p.keys.filter((k) => !envOnly[k.key]).map((k) => `${k.label} (.env)`));
                                return (
                                    <div key={provider} className={cn("min-w-0 space-y-5 rounded-2xl border bg-card p-5 shadow-sm", isWa && "xl:col-span-2")}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="text-base font-semibold">{provider}</h3>
                                            <div className="flex items-center gap-3">
                                                {readyBadge([...missing(defs), ...attachedGaps])}
                                            </div>
                                        </div>
                                        {isWa ? (
                                            <>
                                                <div className="grid gap-5 md:grid-cols-2">{defs.filter((d) => !isLegacyWa(d)).map(renderField)}</div>
                                                <WhatsAppNumbersPanel />
                                            </>
                                        ) : (
                                            <div className="grid gap-5 md:grid-cols-2">{defs.map(renderField)}</div>
                                        )}
                                        {attached.map((p) => (
                                            <div key={p.provider} className="space-y-2">
                                                <p className="text-xs text-muted-foreground">Set in .env only — {p.why.charAt(0).toLowerCase() + p.why.slice(1)}</p>
                                                {envRows(p)}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                            {envCards.map((p) => envOnlyCard(p))}
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
                <Button asChild variant="outline" className="ml-auto">
                    <a href="/office/settings/app-settings/help" target="_blank" rel="noreferrer">
                        <CircleHelp size={14} className="mr-1" /> Help — where to get each key
                    </a>
                </Button>
            </div>
        </div>
    );
}
