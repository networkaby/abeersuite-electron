"use client";

// Settings → AI Setup — a Keys tab (the one place keys are added, tested and
// limited) and one tab per AI use: which keys each of its steps tries, in order. Saved in ai_keys / ai_chain_steps; run time in
// src/shared/lib/ai/aiKeys.ts. Where a key lives:
//   db  — pasted here, saved locked in the database (every counter + website)
//   env — only the .env variable NAME; the key is already in that .env
// "Usable here" and the counts are this server's — on a counter, that counter's.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { ArrowDown, ArrowUp, Copy, FlaskConical, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NumericInput } from "@/shared/components/NumericInput";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { extractApiError } from "@/shared/lib/api";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import {
    AI_COPY_FLOWS, AI_DEFAULT_COPY_FLOW, AI_KEY_DEFAULTS, AI_KEY_SOURCES, AI_PROVIDER_MODELS, AI_PROVIDERS, AI_STEPS, AI_USES, aiProviderInfo, isWebProvider, type AiNeed,
    type AiCopyFlow, type AiKeySource, type AiProvider, type AiStep,
} from "@/shared/lib/constants/ai";

const API = "/api/settings/ai-keys";
/** Uses with a tab of their own; a hidden use's lists show inside the jobs that use them,
 *  and a use with `tab` is a section of that tab. */
const TAB_USES = AI_USES.filter((u) => !u.hidden && !u.tab);
const sectionsOf = (tabKey: string) => AI_USES.filter((u) => !u.hidden && (u.tab ?? u.key) === tabKey);
/** The tab a use lives on — an old ?tab= link to a section opens its tab. */
const tabOf = (useKey: string) => AI_USES.find((u) => u.key === useKey && !u.hidden)?.tab ?? useKey;
/** The Keys tab; every other tab is a TAB_USES key. */
const KEYS_TAB = "keys";

type AiKeyRow = {
    id: number;
    name: string;
    provider: AiProvider;
    model: string;
    source: AiKeySource;
    envName: string | null;
    /** db: last 4 of the key. env: the variable name. */
    keyHint: string;
    canPhoto: boolean;
    canSearch: boolean;
    paid: boolean;
    active: boolean;
    validTill: string | null;
    gapSeconds: number;
    dailyLimit: number | null;
    monthlyLimit: number | null;
    limitRestSeconds: number;
    failRestSeconds: number;
    timeoutSeconds: number;
    retries: number;
    /** Why it cannot run on this server (null = it can). */
    notUsableHere: string | null;
    usage: {
        callsToday: number;
        callsMonth: number;
        lastUsedAt: number | null;
        restingUntil: number | null;
        lastOkAt: number | null;
        lastError: string | null;
        lastErrorAt: number | null;
    };
};

/** chains[useKey][step] = ordered key ids. */
type Chains = Record<string, Partial<Record<AiStep, number[]>>>;
type Setup = { keys: AiKeyRow[]; chains: Chains; copyFlow: AiCopyFlow; photoCheck: boolean; here: { sharedSecret: boolean } };

/** The dialog's fields — numbers as typed text (NumericInput). */
type Form = {
    name: string; provider: AiProvider; model: string; source: AiKeySource; envName: string;
    canPhoto: boolean; canSearch: boolean; paid: boolean; active: boolean; validTill: string;
    gapSeconds: string; dailyLimit: string; monthlyLimit: string; limitRestSeconds: string; failRestSeconds: string;
    timeoutSeconds: string; retries: string;
};

const EMPTY_FORM: Form = {
    name: "", provider: "gemini", model: "", source: "db", envName: "",
    canPhoto: true, canSearch: false, paid: false, active: true, validTill: "",
    gapSeconds: String(AI_KEY_DEFAULTS.gapSeconds.free), dailyLimit: "", monthlyLimit: "",
    limitRestSeconds: String(AI_KEY_DEFAULTS.limitRestSeconds), failRestSeconds: String(AI_KEY_DEFAULTS.failRestSeconds),
    timeoutSeconds: String(AI_KEY_DEFAULTS.timeoutSeconds), retries: String(AI_KEY_DEFAULTS.retries),
};

const formOf = (k: AiKeyRow): Form => ({
    name: k.name, provider: k.provider, model: k.model, source: k.source, envName: k.envName ?? "",
    canPhoto: k.canPhoto, canSearch: k.canSearch, paid: k.paid, active: k.active, validTill: k.validTill ?? "",
    gapSeconds: String(k.gapSeconds), dailyLimit: k.dailyLimit == null ? "" : String(k.dailyLimit), monthlyLimit: k.monthlyLimit == null ? "" : String(k.monthlyLimit),
    limitRestSeconds: String(k.limitRestSeconds), failRestSeconds: String(k.failRestSeconds),
    timeoutSeconds: String(k.timeoutSeconds), retries: String(k.retries),
});

const num = (s: string, fallback: number) => (s.trim() === "" ? fallback : Number(s));

/** The API body for this form; `secret` only for db. */
function bodyOf(f: Form, secret: string) {
    return {
        name: f.name.trim(), provider: f.provider, model: f.model.trim(), source: f.source,
        envName: f.source === "env" ? f.envName.trim() : null,
        ...(f.source === "db" && secret.trim() ? { secret: secret.trim() } : {}),
        canPhoto: f.canPhoto, canSearch: f.canSearch, paid: f.paid, active: f.active,
        validTill: f.validTill || null,
        gapSeconds: num(f.gapSeconds, 0),
        dailyLimit: f.dailyLimit.trim() === "" ? null : Number(f.dailyLimit),
        monthlyLimit: f.monthlyLimit.trim() === "" ? null : Number(f.monthlyLimit),
        limitRestSeconds: num(f.limitRestSeconds, AI_KEY_DEFAULTS.limitRestSeconds),
        failRestSeconds: num(f.failRestSeconds, AI_KEY_DEFAULTS.failRestSeconds),
        timeoutSeconds: num(f.timeoutSeconds, AI_KEY_DEFAULTS.timeoutSeconds),
        retries: num(f.retries, 0),
    };
}

// The key box is type="password", so Chrome treats the form as a sign-in and
// fills the saved login into it (email into Model, password into the key).
// "new-password" on the key box + off elsewhere stops that; the data-* tags
// ask password managers to stay out too.
const NO_AUTOFILL = { autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true" } as const;

const todayIso = () => new Date().toISOString().slice(0, 10);
const isExpired = (k: AiKeyRow) => !!k.validTill && k.validTill < todayIso();
const providerLabel = (p: AiProvider) => aiProviderInfo(p)?.label ?? p;
const NEED_LABEL: Record<AiNeed, string> = { search: "search tick", photo: "photo tick", webSearch: "a web search tool", webRead: "a page-reading tool" };
const sourceShort: Record<AiKeySource, string> = { db: "Saved here", env: ".env" };
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const secs = (n: number) => (n >= 3600 && n % 3600 === 0 ? `${n / 3600} h` : n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`);

export function AiSetupPanel() {
    const { data, loading, error, reload } = useApiResource<Setup>(API, { topics: ["settings"] });
    // Local copy for optimistic edits; the server's answer replaces it on every read.
    const [keys, setKeys] = useState<AiKeyRow[]>([]);
    const [chains, setChains] = useState<Chains>({});
    const [copyFlow, setCopyFlow] = useState<AiCopyFlow>(AI_DEFAULT_COPY_FLOW);
    const [photoCheck, setPhotoCheck] = useState(false);
    // copyOf = Duplicate: a new key starting from that row's settings (never its key).
    const [editing, setEditing] = useState<AiKeyRow | "new" | { copyOf: AiKeyRow } | null>(null);
    const [testing, setTesting] = useState<number | null>(null);
    // ?tab= keeps a link or reload on the same tab.
    const searchParams = useSearchParams();
    const [tab, setTab] = useState(() => {
        const t = searchParams.get("tab");
        const owner = t ? tabOf(t) : "";
        return TAB_USES.some((u) => u.key === owner) ? owner : KEYS_TAB;
    });
    const pickTab = (t: string) => {
        setTab(t);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", t);
        window.history.replaceState(null, "", url);
    };

    // Saves still on the wire. A refresh that lands meanwhile may predate them, so
    // it is held back and read again once they settle — the screen never jumps back.
    const inFlight = useRef(0);
    const heldRefresh = useRef(false);
    const write = async <T,>(run: () => Promise<T>) => {
        inFlight.current++;
        try {
            return await run();
        } finally {
            if (--inFlight.current === 0 && heldRefresh.current) {
                heldRefresh.current = false;
                void reload();
            }
        }
    };

    useEffect(() => {
        if (!data) return;
        if (inFlight.current > 0) { heldRefresh.current = true; return; }
        setKeys(data.keys);
        setChains(data.chains);
        setCopyFlow(data.copyFlow);
        setPhotoCheck(data.photoCheck);
    }, [data]);

    const byId = useMemo(() => new Map(keys.map((k) => [k.id, k])), [keys]);
    const here = data?.here ?? { sharedSecret: false };

    const toggleActive = async (k: AiKeyRow, active: boolean) => {
        setKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, active } : x)));
        await write(async () => {
            try {
                await axios.patch(`${API}/${k.id}`, bodyOf({ ...formOf(k), active }, ""));
            } catch (e) {
                setKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, active: k.active } : x)));
                toast.error(extractApiError(e, "Could not save"));
            }
        });
    };

    /** The dialog's saved row, put in place without re-reading the page. */
    const keySaved = (row: AiKeyRow) => {
        setKeys((prev) => (prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : [...prev, row]));
        setEditing(null);
    };

    const deleteKey = async (k: AiKeyRow) => {
        if (!(await confirmAction({ title: `Delete key "${k.name}"?`, body: "It is taken out of every AI step too.", confirmLabel: "Delete" }))) return;
        const before = { keys, chains };
        setKeys((prev) => prev.filter((x) => x.id !== k.id));
        setChains((prev) => Object.fromEntries(Object.entries(prev).map(([use, steps]) => [
            use, Object.fromEntries(Object.entries(steps).map(([s, ids]) => [s, (ids ?? []).filter((x) => x !== k.id)])),
        ])));
        await write(async () => {
            try {
                await axios.delete(`${API}/${k.id}`);
            } catch (e) {
                setKeys(before.keys);
                setChains(before.chains);
                toast.error(extractApiError(e, "Could not delete"));
            }
        });
    };

    const testKey = async (k: AiKeyRow) => {
        setTesting(k.id);
        try {
            const { data: r } = await axios.post<{ ok: boolean; message: string }>(`${API}/${k.id}/test`);
            (r.ok ? toast.success : toast.error)(`${k.name}: ${r.message}`);
        } catch (e) {
            toast.error(extractApiError(e, "Test failed"));
        } finally {
            setTesting(null);
        }
    };

    // One save at a time per step, always the latest order: quick up/down clicks can
    // never land out of turn. A failure goes back to the last order the server took.
    const chainQueue = useRef(new Map<string, { saved: number[]; next: number[] | null; sending: boolean }>());
    const putChain = (use: string, step: AiStep, ids: number[]) =>
        setChains((prev) => ({ ...prev, [use]: { ...prev[use], [step]: ids } }));
    const setChain = (use: string, step: AiStep, ids: number[]) => {
        const id = `${use}:${step}`;
        let q = chainQueue.current.get(id);
        if (!q) chainQueue.current.set(id, (q = { saved: chains[use]?.[step] ?? [], next: null, sending: false }));
        putChain(use, step, ids);
        q.next = ids;
        if (q.sending) return;
        q.sending = true;
        const entry = q;
        void write(async () => {
            while (entry.next) {
                const send = entry.next;
                entry.next = null;
                try {
                    await axios.put(`${API}/chains`, { use, step, keyIds: send });
                    entry.saved = send;
                } catch (e) {
                    if (!entry.next) putChain(use, step, entry.saved);
                    toast.error(extractApiError(e, "Could not save the order"));
                }
            }
            entry.sending = false;
        });
    };

    const saveCopyFlow = async (f: AiCopyFlow) => {
        const before = copyFlow;
        setCopyFlow(f);
        await write(async () => {
            try {
                await axios.put(`${API}/copy-flow`, { copyFlow: f });
            } catch (e) {
                setCopyFlow(before);
                toast.error(extractApiError(e, "Could not save the default"));
            }
        });
    };

    const savePhotoCheck = async (on: boolean) => {
        setPhotoCheck(on);
        await write(async () => {
            try {
                await axios.put(`${API}/copy-flow`, { photoCheck: on });
            } catch (e) {
                setPhotoCheck(!on);
                toast.error(extractApiError(e, "Could not save Photo AI"));
            }
        });
    };

    if (loading && !data) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
    if (error && !data) return <div className="text-sm text-destructive">{error}</div>;

    return (
        <Tabs value={tab} onValueChange={pickTab} className="space-y-4">
            <TabsList className="h-auto flex-wrap">
                <TabsTrigger value={KEYS_TAB}>Keys ({keys.length})</TabsTrigger>
                {TAB_USES.map((use) => (
                    <TabsTrigger key={use.key} value={use.key}>
                        {use.label}
                        {sectionsOf(use.key).every((u) => u.steps.every(({ step, chain }) => !(chains[chain ?? u.key]?.[step]?.length))) && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">· no keys</span>}
                    </TabsTrigger>
                ))}
            </TabsList>

            {/* ── Keys: the one place keys are added, tested and limited ── */}
            <TabsContent value={KEYS_TAB} className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold">AI keys</h2>
                        <p className="text-sm text-muted-foreground">
                            Every key has the same settings; only where the actual key is kept differs. &quot;Usable&quot; is for this machine; the counts are every counter and the website together.
                        </p>
                    </div>
                    <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" />Add key</Button>
                </div>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2">Name</th>
                                <th className="px-3 py-2">Provider · model</th>
                                <th className="px-3 py-2">Key kept in</th>
                                <th className="px-3 py-2">Can do</th>
                                <th className="px-3 py-2">Plan · gap</th>
                                <th className="px-3 py-2">Today</th>
                                <th className="px-3 py-2">Active</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {keys.length === 0 && (
                                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No keys yet — add one.</td></tr>
                            )}
                            {keys.map((k) => (
                                <tr key={k.id} className="border-t align-top">
                                    <td className="px-3 py-2">
                                        <div className="font-medium">{k.name}</div>
                                        {k.notUsableHere && k.active && <div className="text-xs text-amber-700 dark:text-amber-400">Not here: {k.notUsableHere}</div>}
                                        {isExpired(k) && <div className="text-xs font-medium text-destructive">Offer ended {k.validTill}</div>}
                                        {!isExpired(k) && k.validTill && <div className="text-xs text-muted-foreground">Valid till {k.validTill}</div>}
                                    </td>
                                    <td className="px-3 py-2">{providerLabel(k.provider)} · <span className="font-mono text-xs">{k.model}</span></td>
                                    <td className="px-3 py-2">
                                        <div>{sourceShort[k.source]}</div>
                                        <div className="font-mono text-xs text-muted-foreground">{k.source === "env" ? k.keyHint : k.keyHint ? `•••• ${k.keyHint}` : "—"}</div>
                                    </td>
                                    <td className="space-x-1 px-3 py-2">
                                        {k.canPhoto && <Badge variant="secondary">Photo</Badge>}
                                        {k.canSearch && <Badge variant="secondary">Search</Badge>}
                                        {isWebProvider(k.provider) ? <span className="text-muted-foreground">Web tool</span> : !k.canPhoto && !k.canSearch && <span className="text-muted-foreground">Text only</span>}
                                    </td>
                                    <td className="px-3 py-2">
                                        {k.paid ? <Badge>Paid</Badge> : <Badge variant="outline">Free</Badge>}
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            gap {secs(k.gapSeconds)}{k.dailyLimit != null && ` · ${k.dailyLimit}/day`}{k.monthlyLimit != null && ` · ${k.monthlyLimit}/month`}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        <div>{k.usage.callsToday} call{k.usage.callsToday === 1 ? "" : "s"}{k.dailyLimit != null && ` of ${k.dailyLimit}`}</div>
                                        <div className="text-xs text-muted-foreground">month: {k.usage.callsMonth}{k.monthlyLimit != null && ` of ${k.monthlyLimit}`}</div>
                                        {k.usage.restingUntil && <div className="text-amber-700 dark:text-amber-400">Resting till {clock(k.usage.restingUntil)}</div>}
                                        {k.usage.lastError && k.usage.lastErrorAt && (!k.usage.lastOkAt || k.usage.lastErrorAt > k.usage.lastOkAt) && (
                                            <div className="max-w-56 truncate text-destructive" title={k.usage.lastError}>{clock(k.usage.lastErrorAt)}: {k.usage.lastError}</div>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Switch checked={k.active} onCheckedChange={(v) => toggleActive(k, v)} />
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right">
                                        <Button variant="ghost" size="sm" disabled={testing !== null} onClick={() => testKey(k)} title="One tiny call on this key, from here">
                                            {testing === k.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1 h-4 w-4" />}Test
                                        </Button>
                                        <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(k)}><Pencil className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" aria-label="Duplicate" title="New key with these settings" onClick={() => setEditing({ copyOf: k })}><Copy className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => deleteKey(k)}><Trash2 className="h-4 w-4" /></Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </TabsContent>

            {/* ── One tab per AI job: which keys each step tries; a job with options shows one section each ── */}
            {TAB_USES.map((tabUse) => {
                const sections = sectionsOf(tabUse.key);
                return (
                    <TabsContent key={tabUse.key} value={tabUse.key} className="space-y-4">
                        <div>
                            <h2 className="text-base font-semibold">{tabUse.label}</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Each step tries its keys in order. Free keys take turns, each after its own gap; a paid key is used only with Premium on and no free key ready. A failing key rests and the next one is tried. Keys are added on the Keys tab.
                            </p>
                        </div>
                        {tabUse.key === "product_copy" && (
                            <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                                <span className="text-sm font-medium">Active on load:</span>
                                <div role="radiogroup" aria-label="Active on load" className="inline-flex rounded-md border border-border p-0.5">
                                    {AI_COPY_FLOWS.map((f) => (
                                        <button
                                            key={f.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={copyFlow === f.value}
                                            title={f.hint}
                                            onClick={() => copyFlow !== f.value && saveCopyFlow(f.value)}
                                            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                                                copyFlow === f.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-xs text-muted-foreground">Every product page opens on this; staff can pick the other option for any one write.</span>
                            </div>
                        )}
                        {sections.map((use) => (
                            <div key={use.key} className="space-y-2">
                                <div>
                                    {sections.length > 1 && <h3 className="text-sm font-semibold">{use.section ?? use.label}</h3>}
                                    <p className="text-sm text-muted-foreground">{use.description}</p>
                                </div>
                                {use.key === "product_copy_verified" && (
                                    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                                        <Switch id="ai-photo-check" checked={photoCheck} onCheckedChange={(on) => void savePhotoCheck(on)} />
                                        <Label htmlFor="ai-photo-check" className="text-sm font-medium">Photo AI: {photoCheck ? "On" : "Off"}</Label>
                                        <span className="text-xs text-muted-foreground">
                                            {photoCheck
                                                ? "One extra AI call per Verified run: photo checklist, which photos to remove, labelled suggestions."
                                                : "No photo AI cost — staff still get the web photos as suggestions, unlabelled."}
                                        </span>
                                    </div>
                                )}
                                <div className="rounded-md border p-4">
                                    <div className={`grid gap-4 ${use.steps.length > 3 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
                                        {use.steps.map(({ step, needs, chain }, i) => {
                                            const owner = chain ?? use.key;
                                            const label = AI_STEPS.find((s) => s.value === step)?.label ?? step;
                                            return (
                                                <StepChain
                                                    key={`${owner}-${step}`}
                                                    label={`${i + 1}. ${label}${chain ? " · shared with other AI jobs" : ""}`}
                                                    needs={needs}
                                                    ids={chains[owner]?.[step] ?? []}
                                                    keys={keys}
                                                    byId={byId}
                                                    onChange={(ids) => setChain(owner, step, ids)}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </TabsContent>
                );
            })}

            {editing && (
                <KeyDialog
                    initial={editing === "new" || "copyOf" in editing ? null : editing}
                    copyOf={editing !== "new" && "copyOf" in editing ? editing.copyOf : undefined}
                    here={here}
                    onClose={() => setEditing(null)}
                    onSaved={keySaved}
                    write={write}
                />
            )}
        </Tabs>
    );
}

function StepChain({ label, needs, ids, keys, byId, onChange }: {
    label: string;
    needs?: AiNeed;
    ids: number[];
    keys: AiKeyRow[];
    byId: Map<number, AiKeyRow>;
    onChange: (ids: number[]) => void;
}) {
    const fits = (k: AiKeyRow) => {
        const info = aiProviderInfo(k.provider);
        if (needs === "webSearch") return !!info?.searchable;
        if (needs === "webRead") return !!info?.readable;
        if (info?.kind === "web") return false;
        return needs === "search" ? k.canSearch : needs === "photo" ? k.canPhoto : true;
    };
    const addable = keys.filter((k) => fits(k) && !ids.includes(k.id));
    const move = (i: number, d: -1 | 1) => {
        const next = [...ids];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        onChange(next);
    };

    return (
        <div className="space-y-2">
            <div className="text-sm font-medium">
                {label}
                {needs && <span className="ml-1 text-xs font-normal text-muted-foreground">(needs {NEED_LABEL[needs]})</span>}
            </div>
            {ids.length === 0 && <div className="text-sm text-muted-foreground">No keys — this step is skipped.</div>}
            <ol className="space-y-1">
                {ids.map((id, i) => {
                    const k = byId.get(id);
                    if (!k) return null;
                    const off = !k.active || isExpired(k);
                    return (
                        <li key={id} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
                            <span className="w-4 text-xs text-muted-foreground">{i + 1}.</span>
                            <span className={`flex-1 truncate ${off ? "text-muted-foreground line-through" : k.notUsableHere ? "text-muted-foreground" : ""}`} title={k.notUsableHere ?? undefined}>{k.name}</span>
                            {k.paid && <Badge className="h-5 px-1 text-[10px]">Paid</Badge>}
                            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Remove" onClick={() => onChange(ids.filter((x) => x !== id))}><X className="h-3 w-3" /></Button>
                        </li>
                    );
                })}
            </ol>
            {addable.length > 0 && (
                <Select value="" onValueChange={(v) => onChange([...ids, Number(v)])}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="+ Add key" /></SelectTrigger>
                    <SelectContent>
                        {addable.map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}

function KeyDialog({ initial, copyOf, here, onClose, onSaved, write }: {
    initial: AiKeyRow | null;
    copyOf?: AiKeyRow;
    here: Setup["here"];
    onClose: () => void;
    onSaved: (row: AiKeyRow) => void;
    write: <T>(run: () => Promise<T>) => Promise<T>;
}) {
    const [form, setForm] = useState<Form>(
        initial ? formOf(initial) : copyOf ? { ...formOf(copyOf), name: `${copyOf.name} (copy)` } : EMPTY_FORM,
    );
    // A pasted key is write-only: the box starts empty, and empty on edit keeps the old key.
    const [secret, setSecret] = useState("");
    const [saving, setSaving] = useState(false);
    const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
    // Models the provider itself listed for this key (Load); null = the built-in suggestions.
    const [liveModels, setLiveModels] = useState<string[] | null>(null);
    const [loadingModels, setLoadingModels] = useState(false);
    const loadModels = async () => {
        setLoadingModels(true);
        try {
            const { data } = await axios.post<{ models: string[] }>(`${API}/models`, {
                provider: form.provider, source: form.source, apiKey: secret.trim() || undefined,
                envName: form.envName.trim() || undefined, keyId: initial?.id,
            });
            setLiveModels(data.models);
            toast.success(data.models.length ? `${data.models.length} models — open the Model list` : "The provider listed no models for this key");
        } catch (e) {
            toast.error(extractApiError(e, "Could not load models"));
        } finally {
            setLoadingModels(false);
        }
    };

    // Plan swaps the gap between the two defaults, unless staff typed their own.
    const setPaid = (paid: boolean) => setForm((f) => ({
        ...f, paid,
        gapSeconds: f.gapSeconds === String(AI_KEY_DEFAULTS.gapSeconds[paid ? "free" : "paid"])
            ? String(AI_KEY_DEFAULTS.gapSeconds[paid ? "paid" : "free"]) : f.gapSeconds,
    }));

    const sameSource = initial?.source === form.source;
    const hasSaved = sameSource && form.source === "db";
    const sourceOff = (s: AiKeySource) => (s === "db" && !here.sharedSecret ? "AI_KEY_SECRET is not set here" : null);

    const web = isWebProvider(form.provider);
    const submit = async () => {
        if (!form.name.trim() || (!web && !form.model.trim())) return toast.error(web ? "Name is required." : "Name and model are required.");
        if (form.source === "env" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.envName.trim())) return toast.error("Variable name: letters, digits and _ only.");
        if (form.source !== "env" && !secret.trim() && !hasSaved) return toast.error("Paste the key.");
        setSaving(true);
        await write(async () => {
            try {
                const body = bodyOf(form, secret);
                const { data: row } = initial
                    ? await axios.patch<AiKeyRow>(`${API}/${initial.id}`, body)
                    : await axios.post<AiKeyRow>(API, body);
                toast.success("Saved");
                onSaved(row);
            } catch (e) {
                toast.error(extractApiError(e, "Could not save"));
                setSaving(false);
            }
        });
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto md:max-w-4xl">
                <DialogHeader><DialogTitle>{initial ? "Edit AI key" : "Add AI key"}</DialogTitle></DialogHeader>
                {/* A real form: Enter in any box saves. */}
                <form onSubmit={(e) => { e.preventDefault(); if (!saving) void submit(); }} className="contents">
                <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <div className="grid content-start gap-3">
                    <div className="grid gap-1">
                        <Label>Name</Label>
                        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Gemini free 1" {...NO_AUTOFILL} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1">
                            <Label>Provider</Label>
                            <Select value={form.provider} onValueChange={(v) => {
                                set("provider", v as AiProvider);
                                setLiveModels(null);
                                if (isWebProvider(v)) { set("model", ""); set("canPhoto", false); set("canSearch", false); }
                            }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {AI_PROVIDERS.map((p) => (
                                        <SelectItem key={p.value} value={p.value} disabled={!p.ready}>{p.label}{!p.ready && " (later)"}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {!web && (
                            <div className="grid gap-1">
                                <div className="flex items-center justify-between">
                                    <Label>Model</Label>
                                    <button type="button" onClick={loadModels} disabled={loadingModels} title="Ask the provider which models this key can use"
                                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50">
                                        {loadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                        {liveModels ? `${liveModels.length} from provider` : "Load from provider"}
                                    </button>
                                </div>
                                <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder={aiProviderInfo(form.provider)?.hint ?? ""} className="font-mono" list="ai-model-options" {...NO_AUTOFILL} />
                                <datalist id="ai-model-options">
                                    {(liveModels ?? AI_PROVIDER_MODELS[form.provider] ?? []).map((m) => <option key={m} value={m} />)}
                                </datalist>
                            </div>
                        )}
                    </div>
                    <div className="grid gap-1">
                        <Label>Key kept in</Label>
                        <Select value={form.source} onValueChange={(v) => { set("source", v as AiKeySource); setSecret(""); }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {AI_KEY_SOURCES.map((s) => {
                                    const off = sourceOff(s.value);
                                    return <SelectItem key={s.value} value={s.value} disabled={!!off && initial?.source !== s.value}>{s.label}{off && ` — ${off}`}</SelectItem>;
                                })}
                            </SelectContent>
                        </Select>
                    </div>
                    {form.source === "env" ? (
                        <div className="grid gap-1">
                            <Label>Variable name</Label>
                            <Input value={form.envName} onChange={(e) => set("envName", e.target.value)} placeholder="GOOGLE_GENERATIVE_AI_API_KEY" className="font-mono" {...NO_AUTOFILL} />
                            <p className="text-xs text-muted-foreground">The key is already in that .env — counters on a release that carries it, and the website once it is set in Vercel.</p>
                        </div>
                    ) : (
                        <div className="grid gap-1">
                            <Label>API key</Label>
                            <Input
                                type="password"
                                {...NO_AUTOFILL}
                                autoComplete="new-password"
                                value={secret}
                                onChange={(e) => setSecret(e.target.value)}
                                placeholder={hasSaved && initial?.keyHint ? `•••• ${initial.keyHint} — leave empty to keep` : "Paste the key"}
                            />
                            <p className="text-xs text-muted-foreground">
                                Saved locked in the database — every counter and the website can use it. Never shown again, only the last 4 characters.
                            </p>
                        </div>
                    )}
                    {web ? (
                        <p className="text-xs text-muted-foreground">
                            A web tool — add it under &quot;Web search &amp; page reading&quot; below. An AI model whose provider has no search of its own uses these keys when it needs the web.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={form.canPhoto} onCheckedChange={(v) => set("canPhoto", v === true)} />Can read photo
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={form.canSearch} onCheckedChange={(v) => set("canSearch", v === true)} />Can search online
                            </label>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1">
                            <Label>Plan</Label>
                            <Select value={form.paid ? "paid" : "free"} onValueChange={(v) => setPaid(v === "paid")}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="free">Free</SelectItem>
                                    <SelectItem value="paid">Paid</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1">
                            <Label>Offer valid till (optional)</Label>
                            <Input type="date" value={form.validTill} onChange={(e) => set("validTill", e.target.value)} />
                        </div>
                    </div>
                </div>

                <div className="grid content-start gap-3">
                    <div className="rounded-md border p-3">
                        <div className="mb-2 text-sm font-medium">Limits &amp; safety</div>
                        <div className="grid grid-cols-2 gap-3">
                            <SecondsField label="Wait between calls (s)" hint="Paid: 0" value={form.gapSeconds} onChange={(v) => set("gapSeconds", v)} max={3600} />
                            <SecondsField label="Calls per day" hint="Empty = no limit" value={form.dailyLimit} onChange={(v) => set("dailyLimit", v)} min={1} max={1_000_000} />
                            <SecondsField label="Calls per month" hint="Empty = no limit; resets on the 1st" value={form.monthlyLimit} onChange={(v) => set("monthlyLimit", v)} min={1} max={100_000_000} />
                            <SecondsField label="Rest after limit hit (s)" hint='Provider said "too many"' value={form.limitRestSeconds} onChange={(v) => set("limitRestSeconds", v)} max={86_400} />
                            <SecondsField label="Rest after failure (s)" hint="Refused, busy, too slow" value={form.failRestSeconds} onChange={(v) => set("failRestSeconds", v)} max={86_400} />
                            <SecondsField label="Give up after (s)" hint="One call, 5–600" value={form.timeoutSeconds} onChange={(v) => set("timeoutSeconds", v)} min={5} max={600} />
                            <SecondsField label="Retries on this key" hint="0–3, then the next key" value={form.retries} onChange={(v) => set("retries", v)} max={3} />
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                        <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />Active
                    </label>
                    <p className="text-xs text-muted-foreground">Day and month counts, the gap and the rest are shared by every counter and the website, and survive a restart. Days and months run on shop time (India).</p>
                </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button>
                </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function SecondsField({ label, hint, value, onChange, min = 0, max }: {
    label: string; hint: string; value: string; onChange: (v: string) => void; min?: number; max: number;
}) {
    return (
        <div className="grid gap-1">
            <Label className="text-xs">{label}</Label>
            <NumericInput value={value} onValueChange={onChange} min={min} max={max} inputMode="numeric" />
            <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
    );
}
