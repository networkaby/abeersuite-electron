"use client";

// Settings → AI Setup — register AI keys and choose, for every AI use, which
// keys each step tries and in what order. PREVIEW ONLY (2026-10-19): the rows
// below live in screen state and are lost on reload. Tables, the key lookup
// (db / .env / counter .ini) and the Test call come in the next step.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
    AI_KEY_SOURCES, AI_PROVIDERS, AI_STEPS, AI_USES,
    type AiKeySource, type AiProvider, type AiStep,
} from "@/shared/lib/constants/ai";

type AiKeyRow = {
    id: number;
    name: string;
    provider: AiProvider;
    model: string;
    source: AiKeySource;
    /** db: last 4 of the pasted key. env / ini: the variable name. */
    keyHint: string;
    canSearch: boolean;
    canPhoto: boolean;
    paid: boolean;
    active: boolean;
    /** yyyy-mm-dd, or "" for none. */
    validTill: string;
};

/** chains[useKey][step] = ordered key ids. */
type Chains = Record<string, Partial<Record<AiStep, number[]>>>;

// Example rows standing in for today's .env chain until the tables exist.
const SAMPLE_KEYS: AiKeyRow[] = [
    { id: 1, name: "Gemini free 1", provider: "gemini", model: "gemini-3.8-flash", source: "env", keyHint: "GOOGLE_GENERATIVE_AI_API_KEY", canSearch: false, canPhoto: true, paid: false, active: true, validTill: "" },
    { id: 2, name: "Gemini free 2", provider: "gemini", model: "gemini-3.8-flash", source: "env", keyHint: "GOOGLE_GENERATIVE_AI_API_KEY1", canSearch: false, canPhoto: true, paid: false, active: true, validTill: "" },
    { id: 3, name: "Gemini paid", provider: "gemini", model: "gemini-3.8-flash", source: "env", keyHint: "GOOGLE_AI_SEARCH_API_KEY", canSearch: true, canPhoto: true, paid: true, active: true, validTill: "" },
];
const SAMPLE_CHAINS: Chains = { product_copy: { draft: [1, 2, 3], search: [3], polish: [1, 2, 3] } };

const EMPTY_FORM: Omit<AiKeyRow, "id"> = {
    name: "", provider: "gemini", model: "", source: "db", keyHint: "",
    canSearch: false, canPhoto: false, paid: false, active: true, validTill: "",
};

// The key box is type="password", so Chrome treats the form as a sign-in and
// fills the saved login into it (email into Model, password into the key).
// "new-password" on the key box + off elsewhere stops that; the data-* tags
// ask password managers to stay out too.
const NO_AUTOFILL = { autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true" } as const;

const todayIso = () => new Date().toISOString().slice(0, 10);
const isExpired = (k: AiKeyRow) => !!k.validTill && k.validTill < todayIso();
const providerLabel = (p: AiProvider) => AI_PROVIDERS.find((x) => x.value === p)?.label ?? p;
const sourceShort: Record<AiKeySource, string> = { db: "Saved here", env: ".env", ini: "Counter .ini" };

export function AiSetupPanel() {
    const [keys, setKeys] = useState<AiKeyRow[]>(SAMPLE_KEYS);
    const [chains, setChains] = useState<Chains>(SAMPLE_CHAINS);
    const [editing, setEditing] = useState<AiKeyRow | "new" | null>(null);

    const byId = useMemo(() => new Map(keys.map((k) => [k.id, k])), [keys]);

    const saveKey = (row: AiKeyRow) => {
        setKeys((prev) => (prev.some((k) => k.id === row.id) ? prev.map((k) => (k.id === row.id ? row : k)) : [...prev, row]));
        setEditing(null);
    };

    const deleteKey = (id: number) => {
        setKeys((prev) => prev.filter((k) => k.id !== id));
        setChains((prev) => {
            const next: Chains = {};
            for (const [use, steps] of Object.entries(prev)) {
                next[use] = Object.fromEntries(Object.entries(steps).map(([s, ids]) => [s, (ids ?? []).filter((x) => x !== id)]));
            }
            return next;
        });
    };

    const setChain = (use: string, step: AiStep, ids: number[]) =>
        setChains((prev) => ({ ...prev, [use]: { ...prev[use], [step]: ids } }));

    return (
        <div className="space-y-6">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                Preview — not saved yet. Changes here are lost when the page reloads; product descriptions still use the .env keys.
            </div>

            {/* ── Keys ── */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold">AI keys</h2>
                        <p className="text-sm text-muted-foreground">Every key has the same settings; only where the actual key is kept differs.</p>
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
                                <th className="px-3 py-2">Plan</th>
                                <th className="px-3 py-2">Valid till</th>
                                <th className="px-3 py-2">Active</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {keys.length === 0 && (
                                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No keys yet — add one.</td></tr>
                            )}
                            {keys.map((k) => (
                                <tr key={k.id} className="border-t">
                                    <td className="px-3 py-2 font-medium">{k.name}</td>
                                    <td className="px-3 py-2">{providerLabel(k.provider)} · <span className="font-mono text-xs">{k.model}</span></td>
                                    <td className="px-3 py-2">
                                        <div>{sourceShort[k.source]}</div>
                                        <div className="font-mono text-xs text-muted-foreground">{k.source === "db" ? `•••• ${k.keyHint}` : k.keyHint}</div>
                                    </td>
                                    <td className="space-x-1 px-3 py-2">
                                        {k.canPhoto && <Badge variant="secondary">Photo</Badge>}
                                        {k.canSearch && <Badge variant="secondary">Search</Badge>}
                                        {!k.canPhoto && !k.canSearch && <span className="text-muted-foreground">Text only</span>}
                                    </td>
                                    <td className="px-3 py-2">{k.paid ? <Badge>Paid</Badge> : <Badge variant="outline">Free</Badge>}</td>
                                    <td className={`px-3 py-2 ${isExpired(k) ? "font-medium text-destructive" : ""}`}>
                                        {k.validTill || "—"}{isExpired(k) && " (expired)"}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Switch checked={k.active} onCheckedChange={(v) => saveKey({ ...k, active: v })} />
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right">
                                        <Button variant="ghost" size="sm" onClick={() => toast.info("Test comes with the next step — the page is a preview.")}>
                                            <FlaskConical className="mr-1 h-4 w-4" />Test
                                        </Button>
                                        <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(k)}><Pencil className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => deleteKey(k.id)}><Trash2 className="h-4 w-4" /></Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── Uses ── */}
            <section className="space-y-3">
                <div>
                    <h2 className="text-base font-semibold">AI uses</h2>
                    <p className="text-sm text-muted-foreground">
                        Each step tries its keys top to bottom. Free keys take turns; a paid key is used only when no free key is ready.
                    </p>
                </div>
                {AI_USES.map((use) => (
                    <div key={use.key} className="rounded-md border p-4">
                        <div className="font-medium">{use.label}</div>
                        <div className="mb-3 text-sm text-muted-foreground">{use.description}</div>
                        <div className="grid gap-4 md:grid-cols-3">
                            {use.steps.map(({ step, needs }) => (
                                <StepChain
                                    key={step}
                                    label={AI_STEPS.find((s) => s.value === step)?.label ?? step}
                                    needs={needs}
                                    ids={chains[use.key]?.[step] ?? []}
                                    keys={keys}
                                    byId={byId}
                                    onChange={(ids) => setChain(use.key, step, ids)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </section>

            {editing && (
                <KeyDialog
                    initial={editing === "new" ? null : editing}
                    nextId={Math.max(0, ...keys.map((k) => k.id)) + 1}
                    onClose={() => setEditing(null)}
                    onSave={saveKey}
                />
            )}
        </div>
    );
}

function StepChain({ label, needs, ids, keys, byId, onChange }: {
    label: string;
    needs?: "search" | "photo";
    ids: number[];
    keys: AiKeyRow[];
    byId: Map<number, AiKeyRow>;
    onChange: (ids: number[]) => void;
}) {
    const fits = (k: AiKeyRow) => (needs === "search" ? k.canSearch : needs === "photo" ? k.canPhoto : true);
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
                {needs && <span className="ml-1 text-xs font-normal text-muted-foreground">(needs {needs} tick)</span>}
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
                            <span className={`flex-1 truncate ${off ? "text-muted-foreground line-through" : ""}`}>{k.name}</span>
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

function KeyDialog({ initial, nextId, onClose, onSave }: {
    initial: AiKeyRow | null;
    nextId: number;
    onClose: () => void;
    onSave: (row: AiKeyRow) => void;
}) {
    const [form, setForm] = useState<Omit<AiKeyRow, "id">>(initial ?? EMPTY_FORM);
    // A pasted key is write-only: the box starts empty, and empty on edit keeps the old key.
    const [secret, setSecret] = useState("");
    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    const sourceChanged = initial && initial.source !== form.source;
    const submit = () => {
        if (!form.name.trim() || !form.model.trim()) return toast.error("Name and model are required.");
        let keyHint = form.keyHint.trim();
        if (form.source === "db") {
            if (secret.trim()) keyHint = secret.trim().slice(-4);
            else if (!initial || sourceChanged) return toast.error("Paste the key.");
        } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyHint)) {
            return toast.error("Variable name: letters, digits and _ only.");
        }
        onSave({ ...form, name: form.name.trim(), model: form.model.trim(), keyHint, id: initial?.id ?? nextId });
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{initial ? "Edit AI key" : "Add AI key"}</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                    <div className="grid gap-1">
                        <Label>Name</Label>
                        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Gemini free 1" {...NO_AUTOFILL} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1">
                            <Label>Provider</Label>
                            <Select value={form.provider} onValueChange={(v) => set("provider", v as AiProvider)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{AI_PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1">
                            <Label>Model</Label>
                            <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="gemini-3.8-flash" className="font-mono" {...NO_AUTOFILL} />
                        </div>
                    </div>
                    <div className="grid gap-1">
                        <Label>Key kept in</Label>
                        <Select value={form.source} onValueChange={(v) => set("source", v as AiKeySource)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{AI_KEY_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    {form.source === "db" ? (
                        <div className="grid gap-1">
                            <Label>API key</Label>
                            <Input
                                type="password"
                                {...NO_AUTOFILL}
                                autoComplete="new-password"
                                value={secret}
                                onChange={(e) => setSecret(e.target.value)}
                                placeholder={initial?.source === "db" ? `•••• ${initial.keyHint} — leave empty to keep` : "Paste the key"}
                            />
                            <p className="text-xs text-muted-foreground">Saved locked; never shown again — only the last 4 characters.</p>
                        </div>
                    ) : (
                        <div className="grid gap-1">
                            <Label>Variable name</Label>
                            <Input
                                value={form.keyHint}
                                onChange={(e) => set("keyHint", e.target.value)}
                                placeholder="GOOGLE_GENERATIVE_AI_API_KEY"
                                {...NO_AUTOFILL}
                                className="font-mono"
                            />
                            <p className="text-xs text-muted-foreground">
                                {form.source === "env"
                                    ? "Works where that .env carries it — counters on that release, and the website once it is set in Vercel."
                                    : "Works only on counters whose .ini has this name."}
                            </p>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={form.canPhoto} onCheckedChange={(v) => set("canPhoto", v === true)} />Can read photo
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={form.canSearch} onCheckedChange={(v) => set("canSearch", v === true)} />Can search online
                        </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1">
                            <Label>Plan</Label>
                            <Select value={form.paid ? "paid" : "free"} onValueChange={(v) => set("paid", v === "paid")}>
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
                    <label className="flex items-center gap-2 text-sm">
                        <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />Active
                    </label>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={submit}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
