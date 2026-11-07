"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import {
    INCOMING_APIS,
    googlePostMode,
    googlePostRules,
    googleReplyMode,
    googleRules,
    type GooglePostMode,
    type GoogleReplyMode,
    type IncomingId,
} from "@/modules/incoming/lib/incomingCatalog";

type Row = {
    id: IncomingId;
    enabled: boolean;
    source: "page" | "env" | "none";
    hint: string | null;
    settings: Record<string, unknown>;
    lastUsedAt: string | null;
    updatedByName: string | null;
};
type Status = { canLock: boolean; rows: Row[] };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");

const SOURCE_TEXT: Record<Row["source"], string> = {
    page: "Secret saved on this page",
    env: "Secret from the Vercel env var",
    none: "No secret set",
};

/**
 * Settings → Incoming API: one card per outside caller (incomingCatalog.ts).
 * Secrets never come back from the server — only the last 4 characters; a key
 * made here is shown once, right after making it.
 */
export function IncomingApiPanel() {
    const [status, setStatus] = useState<Status | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [shownKey, setShownKey] = useState<{ id: IncomingId; key: string } | null>(null);
    const [pasted, setPasted] = useState<Partial<Record<IncomingId, string>>>({});
    const [mode, setMode] = useState<GoogleReplyMode>("DRAFT");
    const [rules, setRules] = useState("");
    const [postMode, setPostMode] = useState<GooglePostMode>("DRAFT");
    const [postRules, setPostRules] = useState("");

    useEffect(() => {
        axios
            .get<Status>("/api/settings/incoming-api")
            .then(({ data }) => {
                setStatus(data);
                const google = data.rows.find((r) => r.id === "COWORK")?.settings ?? {};
                setMode(googleReplyMode(google));
                setRules(googleRules(google));
                setPostMode(googlePostMode(google));
                setPostRules(googlePostRules(google));
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load Incoming API")));
    }, []);

    async function save(id: IncomingId, body: Record<string, unknown>, done: string) {
        setBusy(id);
        try {
            const { data } = await axios.put<Status & { key?: string }>(`/api/settings/incoming-api/${id}`, body);
            setStatus(data);
            if (data.key) setShownKey({ id, key: data.key });
            toast.success(done);
            return true;
        } catch (e) {
            toast.error(extractApiError(e, "Not saved"));
            return false;
        } finally {
            setBusy(null);
        }
    }

    if (!status) return <p className="text-sm text-muted-foreground">Loading…</p>;
    const origin = typeof window === "undefined" ? "" : window.location.origin;

    return (
        <div className="flex w-full flex-col gap-4">
            {!status.canLock && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    AI_KEY_SECRET is not set on this server, so secrets cannot be saved here. Env vars still work.
                </p>
            )}

            {status.rows.map((r) => {
                const def = INCOMING_APIS[r.id];
                return (
                    <section key={r.id} className="rounded-lg border bg-card p-4">
                        <div className="flex flex-wrap items-start gap-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="font-semibold">{def.label}</h2>
                                <p className="mt-1 text-sm text-muted-foreground">{def.about}</p>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                                <Switch
                                    checked={r.enabled}
                                    disabled={busy === r.id}
                                    onCheckedChange={(on) => void save(r.id, { enabled: on }, on ? "Switched on" : "Switched off — every call is refused")}
                                />
                                {r.enabled ? "On" : "Off"}
                            </label>
                        </div>

                        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[9rem_1fr]">
                            <dt className="text-muted-foreground">Address</dt>
                            <dd className="break-all whitespace-pre-line font-mono text-xs">{def.paths.map((p) => p.replace(" /", ` ${origin}/`)).join("\n")}</dd>
                            <dt className="text-muted-foreground">How it is sent</dt>
                            <dd className="font-mono text-xs">{def.howSent}</dd>
                            <dt className="text-muted-foreground">Secret</dt>
                            <dd>
                                {SOURCE_TEXT[r.source]}
                                {r.hint ? <span className="font-mono"> · ends …{r.hint}</span> : null}
                                {r.source === "none" && def.closedWhenUnset ? <span className="text-red-600"> — every call is refused until one is set</span> : null}
                                {r.source === "none" && !def.closedWhenUnset ? <span className="text-amber-600"> — open to anyone who knows the address</span> : null}
                            </dd>
                            <dt className="text-muted-foreground">Last used</dt>
                            <dd>{when(r.lastUsedAt)}{r.updatedByName ? <span className="text-muted-foreground"> · last changed by {r.updatedByName}</span> : null}</dd>
                        </dl>

                        {shownKey?.id === r.id && (
                            <div className="mt-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
                                <p className="font-medium">New key — copy it now, it is not shown again:</p>
                                <div className="mt-2 flex items-center gap-2">
                                    <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">{shownKey.key}</code>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void navigator.clipboard.writeText(shownKey.key).then(() => toast.success("Copied"))}
                                    >
                                        <Copy className="size-4" /> Copy
                                    </Button>
                                </div>
                            </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {def.canGenerate && (
                                <Button
                                    size="sm"
                                    disabled={busy === r.id || !status.canLock}
                                    onClick={() => {
                                        if (r.source !== "none" && !window.confirm("Make a new key? The old page key stops working at once; update the other program.")) return;
                                        void save(r.id, { generate: true }, "New key made");
                                    }}
                                >
                                    <KeyRound className="size-4" /> {r.source === "page" ? "Make new key" : "Make key"}
                                </Button>
                            )}
                            <Input
                                type="password"
                                autoComplete="off"
                                className="h-8 w-56"
                                placeholder={def.canGenerate ? "…or paste your own" : "Paste the secret"}
                                value={pasted[r.id] ?? ""}
                                onChange={(e) => setPasted((p) => ({ ...p, [r.id]: e.target.value }))}
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy === r.id || !status.canLock || (pasted[r.id] ?? "").trim().length < 8}
                                onClick={async () => {
                                    if (await save(r.id, { secret: pasted[r.id] }, "Secret saved")) setPasted((p) => ({ ...p, [r.id]: "" }));
                                }}
                            >
                                Save pasted
                            </Button>
                            {r.source === "page" && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy === r.id}
                                    onClick={() => {
                                        if (!window.confirm(def.envVar ? `Remove the page secret? ${def.envVar} from Vercel counts again, if set.` : "Remove the key? Every call is refused until a new one is made.")) return;
                                        void save(r.id, { secret: "" }, "Page secret removed");
                                    }}
                                >
                                    Remove page secret
                                </Button>
                            )}
                        </div>

                        {r.id === "COWORK" && (
                            <div className="mt-4 border-t pt-4">
                                <h3 className="text-sm font-semibold">Review replies</h3>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {(
                                        [
                                            ["DRAFT", "Draft — staff check every reply on CRM → Reviews"],
                                            ["POST", "Post — goes live on Google at once"],
                                        ] as const
                                    ).map(([v, label]) => (
                                        <Button key={v} size="sm" variant={mode === v ? "default" : "outline"} onClick={() => setMode(v)}>
                                            {label}
                                        </Button>
                                    ))}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">1–2 star reviews are always kept as a draft, whatever this says.</p>
                                <label className="mt-3 block text-sm font-medium" htmlFor="google-rules">
                                    Reply rules (the caller reads these with the reviews)
                                </label>
                                <Textarea
                                    id="google-rules"
                                    className="mt-1"
                                    rows={8}
                                    maxLength={20_000}
                                    value={rules}
                                    onChange={(e) => setRules(e.target.value)}
                                    placeholder="Shop name: Network Service, Abhayapuri. How to address people, tone, length, sign-off…"
                                />
                                <Button
                                    size="sm"
                                    className="mt-2"
                                    disabled={busy === r.id}
                                    onClick={() => void save(r.id, { settings: { replyMode: mode, rules, postMode, postRules } }, "Review reply settings saved")}
                                >
                                    Save reply settings
                                </Button>

                                <h3 className="mt-6 text-sm font-semibold">Social posts</h3>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {(
                                        [
                                            ["DRAFT", "Draft — staff check and schedule every post"],
                                            ["SCHEDULE", "Schedule — its times stand; posts go out by themselves"],
                                        ] as const
                                    ).map(([v, label]) => (
                                        <Button key={v} size="sm" variant={postMode === v ? "default" : "outline"} onClick={() => setPostMode(v)}>
                                            {label}
                                        </Button>
                                    ))}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Draft posts keep the agent&apos;s planned time; open one on Campaigns → Queue and save it to schedule. The agent can change or delete only its own posts, and only before any channel has them.
                                </p>
                                <label className="mt-3 block text-sm font-medium" htmlFor="google-post-rules">
                                    Post rules (the caller reads these with the queue)
                                </label>
                                <Textarea
                                    id="google-post-rules"
                                    className="mt-1"
                                    rows={6}
                                    maxLength={20_000}
                                    value={postRules}
                                    onChange={(e) => setPostRules(e.target.value)}
                                    placeholder="Shop name, tone, how many posts a week, best times, what never to post…"
                                />
                                <Button
                                    size="sm"
                                    className="mt-2"
                                    disabled={busy === r.id}
                                    onClick={() => void save(r.id, { settings: { replyMode: mode, rules, postMode, postRules } }, "Post settings saved")}
                                >
                                    Save post settings
                                </Button>
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}
