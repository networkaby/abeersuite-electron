"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, Save, Send, SendHorizontal } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { parseDigitsInput } from "@/shared/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    WA_TEMPLATE_LABEL,
    WA_TEMPLATE_WHEN,
    fieldsFor,
    sampleValuesFor,
    checkBody,
    fillBody,
    isDueKind,
    type WaTemplateDraft,
    type WaTemplateKind,
} from "@/shared/lib/whatsapp/billTemplates";
import type { WaTemplateView } from "@/shared/lib/whatsapp/waTemplateStore";

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
    DRAFT: { text: "Draft — not sent", className: "bg-muted text-muted-foreground" },
    PENDING: { text: "With Meta — waiting", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
    APPROVED: { text: "Approved", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
    REJECTED: { text: "Rejected", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

type Props = {
    initialTemplates: WaTemplateView[];
    templateApiReady: boolean;
    sendReady: boolean;
};

export function WhatsAppTemplatesPanel({ initialTemplates, templateApiReady, sendReady }: Props) {
    const [templates, setTemplates] = useState(initialTemplates);
    const [kind, setKind] = useState<WaTemplateKind>(initialTemplates[0]?.kind ?? "SALE");
    const current = templates.find((t) => t.kind === kind)!;

    const [enabled, setEnabled] = useState(current.enabled);
    const [autoSend, setAutoSend] = useState(current.autoSend);
    const [draft, setDraft] = useState<WaTemplateDraft>(current.draft);
    const [busy, setBusy] = useState<null | "save" | "submit" | "refresh" | "test">(null);
    const [testMobile, setTestMobile] = useState("");
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    // Switching kind (or a server answer) resets the editor to the saved copy.
    useEffect(() => {
        setEnabled(current.enabled);
        setAutoSend(current.autoSend);
        setDraft(current.draft);
    }, [current]);

    const viewBtn = draft.viewButton?.trim() || null;
    const appBtn = draft.appButton?.trim() || null;
    const dirty =
        enabled !== current.enabled ||
        autoSend !== current.autoSend ||
        draft.body !== current.draft.body ||
        viewBtn !== current.draft.viewButton ||
        appBtn !== current.draft.appButton;
    const errors = useMemo(() => checkBody(draft, kind), [draft, kind]);
    const status = STATUS_LABEL[current.status] ?? STATUS_LABEL.DRAFT;
    const locked = current.status === "PENDING";

    function replace(t: WaTemplateView) {
        setTemplates((list) => list.map((x) => (x.kind === t.kind ? t : x)));
    }

    function insertField(key: string) {
        const el = bodyRef.current;
        const token = `{${key}}`;
        const at = el?.selectionStart ?? draft.body.length;
        const end = el?.selectionEnd ?? at;
        setDraft({ ...draft, body: draft.body.slice(0, at) + token + draft.body.slice(end) });
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(at + token.length, at + token.length);
        });
    }

    async function save(): Promise<boolean> {
        setBusy("save");
        try {
            const { data } = await axios.put(`/api/settings/whatsapp-templates/${kind}`, {
                enabled,
                autoSend,
                body: draft.body,
                viewButton: viewBtn,
                appButton: appBtn,
            });
            replace(data.template);
            toast.success(`Saved ${WA_TEMPLATE_LABEL[kind]} template`);
            return true;
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
            return false;
        } finally {
            setBusy(null);
        }
    }

    async function submit() {
        if (dirty && !(await save())) return;
        setBusy("submit");
        try {
            const { data } = await axios.post(`/api/settings/whatsapp-templates/${kind}/submit`);
            replace(data.template);
            toast.success(data.template.status === "APPROVED" ? "Approved by Meta" : "Sent to Meta — approval usually takes minutes, sometimes a day");
        } catch (e) {
            toast.error(extractApiError(e, "Could not send to Meta"));
        } finally {
            setBusy(null);
        }
    }

    async function refresh() {
        setBusy("refresh");
        try {
            const { data } = await axios.get(`/api/settings/whatsapp-templates`);
            setTemplates(data.templates);
        } catch (e) {
            toast.error(extractApiError(e, "Could not check with Meta"));
        } finally {
            setBusy(null);
        }
    }

    async function sendTest() {
        setBusy("test");
        try {
            await axios.post(`/api/settings/whatsapp-templates/${kind}/test`, { mobile: testMobile });
            toast.success(`Test sent to ${testMobile}`);
        } catch (e) {
            toast.error(extractApiError(e, "Test failed"));
        } finally {
            setBusy(null);
        }
    }

    // Nothing new to approve: the saved wording IS the approved wording.
    const alreadyApproved =
        !dirty &&
        current.approved != null &&
        current.approved.body === current.draft.body &&
        current.approved.viewButton === current.draft.viewButton &&
        current.approved.appButton === current.draft.appButton;

    return (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr_320px]">
            {/* Kinds */}
            <div className="space-y-1">
                {templates.map((t) => (
                    <button
                        key={t.kind}
                        type="button"
                        onClick={() => setKind(t.kind)}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                            t.kind === kind ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted"
                        }`}
                    >
                        <span>{WA_TEMPLATE_LABEL[t.kind]}</span>
                        <span className={`text-xs ${t.enabled && t.approved ? "text-emerald-600" : "text-muted-foreground"}`}>
                            {t.enabled && t.approved ? "On" : "Off"}
                        </span>
                    </button>
                ))}
            </div>

            {/* Editor */}
            <div className="min-w-0 space-y-4 rounded-lg border p-4">
                {!templateApiReady && (
                    <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Sending for approval is not set up on this server — <code>META_WA_BUSINESS_ACCOUNT_ID</code> is missing.
                    </p>
                )}
                <p className="text-xs text-muted-foreground">
                    <b>Sent when:</b> {WA_TEMPLATE_WHEN[kind]}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}>{status.text}</span>
                    {current.metaName && <span className="font-mono text-xs text-muted-foreground">{current.metaName}</span>}
                    {locked && (
                        <Button size="sm" variant="ghost" onClick={refresh} disabled={busy !== null}>
                            {busy === "refresh" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                            Check now
                        </Button>
                    )}
                    <label className="ml-auto flex items-center gap-2 text-sm">
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                        Send on WhatsApp
                    </label>
                    {/* Due reminders go by Settings → Due Reminders' rules, not on a save. */}
                    {!isDueKind(current.kind) && (
                        <label
                            className="flex items-center gap-2 text-sm"
                            title="On: goes by itself when the document is saved. Off: only from the 3-dot menu's Send on WhatsApp."
                        >
                            <Switch checked={autoSend} onCheckedChange={setAutoSend} />
                            Auto send
                        </label>
                    )}
                </div>
                {current.status === "REJECTED" && current.rejectReason && (
                    <p className="text-sm text-red-600">Meta&apos;s reason: {current.rejectReason}</p>
                )}
                {enabled && !current.approved && (
                    <p className="text-xs text-muted-foreground">
                        Switched on, but nothing is approved yet — no WhatsApp goes out until Meta approves.
                    </p>
                )}

                <div className="space-y-1.5">
                    <Label htmlFor="wa-body">Message</Label>
                    <div className="flex flex-wrap gap-1.5">
                        {fieldsFor(kind).map((f) => (
                            <Button
                                key={f.key}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => insertField(f.key)}
                                disabled={locked}
                            >
                                + {f.label}
                            </Button>
                        ))}
                    </div>
                    <Textarea
                        id="wa-body"
                        ref={bodyRef}
                        rows={9}
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        disabled={locked}
                    />
                    <p className="text-right text-xs text-muted-foreground">{draft.body.length} / 1024</p>
                    {errors.map((e) => (
                        <p key={e} className="text-xs text-red-600">{e}</p>
                    ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="wa-view">&ldquo;View&rdquo; button (opens the document)</Label>
                        <Input
                            id="wa-view"
                            maxLength={25}
                            placeholder="Blank = no button"
                            value={draft.viewButton ?? ""}
                            onChange={(e) => setDraft({ ...draft, viewButton: e.target.value })}
                            disabled={locked}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="wa-app">&ldquo;Get the app&rdquo; button</Label>
                        <Input
                            id="wa-app"
                            maxLength={25}
                            placeholder="Blank = no button"
                            value={draft.appButton ?? ""}
                            onChange={(e) => setDraft({ ...draft, appButton: e.target.value })}
                            disabled={locked}
                        />
                    </div>
                </div>
                {locked && <p className="text-xs text-muted-foreground">Wording is locked while Meta checks it.</p>}

                <div className="flex flex-wrap gap-2">
                    <Button onClick={save} disabled={!dirty || busy !== null}>
                        {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Save
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={submit}
                        disabled={!templateApiReady || errors.length > 0 || busy !== null || locked || alreadyApproved}
                    >
                        {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                        Send for approval
                    </Button>
                </div>

                <div className="space-y-1.5 border-t pt-3">
                    <Label htmlFor="wa-test">Send a test of the approved wording</Label>
                    <div className="flex gap-2">
                        <Input
                            id="wa-test"
                            type="text"
                            inputMode="numeric"
                            placeholder="10-digit mobile"
                            className="max-w-48"
                            value={testMobile}
                            onChange={(e) => setTestMobile(parseDigitsInput(e.target.value).slice(0, 10))}
                        />
                        <Button
                            variant="outline"
                            onClick={sendTest}
                            disabled={!sendReady || !current.approved || testMobile.length !== 10 || busy !== null}
                        >
                            {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                            Send test
                        </Button>
                    </div>
                </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
                <p className="text-sm font-medium">Preview</p>
                <div className="rounded-lg bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
                    <div className="max-w-[300px] rounded-lg rounded-tl-none bg-white p-2.5 text-sm text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
                        <p className="whitespace-pre-wrap break-words">{fillBody(draft.body, sampleValuesFor(kind))}</p>
                        <p className="mt-1 text-right text-[10px] opacity-60">10:42</p>
                    </div>
                    {[viewBtn, appBtn].filter(Boolean).map((b) => (
                        <div
                            key={b}
                            className="mt-1 max-w-[300px] rounded-lg bg-white py-2 text-center text-sm text-sky-600 shadow-sm dark:bg-[#202c33] dark:text-sky-400"
                        >
                            ↗ {b}
                        </div>
                    ))}
                </div>
                {current.approved && !alreadyApproved && (
                    <div className="space-y-1">
                        <p className="text-xs font-medium">Bills go out with the approved wording until then:</p>
                        <p className="whitespace-pre-wrap rounded-md border p-2 text-xs text-muted-foreground">{current.approved.body}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
