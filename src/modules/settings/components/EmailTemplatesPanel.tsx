"use client";

import { useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Save, SendHorizontal } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fillBody } from "@/shared/lib/whatsapp/billTemplates";
import {
    EMAIL_BODY_MAX,
    EMAIL_SUBJECT_MAX,
    EMAIL_TEMPLATE_DEFAULTS,
    EMAIL_TEMPLATE_LABEL,
    EMAIL_TEMPLATE_WHEN,
    checkEmailDraft,
    emailFieldsFor,
    emailSampleValues,
    type EmailTemplateDraft,
    type EmailTemplateKind,
} from "@/shared/lib/email/emailTemplates";
import type { EmailTemplateView } from "@/shared/lib/email/emailTemplateStore";
import { useValueChange } from "@/shared/hooks/useValueChange";

type Props = { initialTemplates: EmailTemplateView[]; sendReady: boolean };

export function EmailTemplatesPanel({ initialTemplates, sendReady }: Props) {
    const [templates, setTemplates] = useState(initialTemplates);
    const [kind, setKind] = useState<EmailTemplateKind>(initialTemplates[0]?.kind ?? "SALE");
    const current = templates.find((t) => t.kind === kind)!;

    const [enabled, setEnabled] = useState(current.enabled);
    const [autoSend, setAutoSend] = useState(current.autoSend);
    const [draft, setDraft] = useState<EmailTemplateDraft>(current.draft);
    const [busy, setBusy] = useState<null | "save" | "test">(null);
    const [testEmail, setTestEmail] = useState("");
    // Where a field button inserts: the last box the cursor was in.
    const [target, setTarget] = useState<"subject" | "body">("body");
    const subjectRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    // Switching kind (or a save) resets the editor to the saved copy.
    if (useValueChange(current)) {
        setEnabled(current.enabled);
        setAutoSend(current.autoSend);
        setDraft(current.draft);
    }

    const dirty =
        enabled !== current.enabled ||
        autoSend !== current.autoSend ||
        draft.subject !== current.draft.subject ||
        draft.body !== current.draft.body;
    const errors = useMemo(() => checkEmailDraft(draft, kind), [draft, kind]);
    const samples = emailSampleValues(kind);

    function insertField(key: string) {
        const el = target === "subject" ? subjectRef.current : bodyRef.current;
        const text = draft[target];
        const token = `{${key}}`;
        const at = el?.selectionStart ?? text.length;
        const end = el?.selectionEnd ?? at;
        setDraft({ ...draft, [target]: text.slice(0, at) + token + text.slice(end) });
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(at + token.length, at + token.length);
        });
    }

    async function save() {
        setBusy("save");
        try {
            const { data } = await axios.put(`/api/settings/email-templates/${kind}`, { enabled, autoSend, ...draft });
            setTemplates((list) => list.map((x) => (x.kind === kind ? data.template : x)));
            toast.success(`Saved ${EMAIL_TEMPLATE_LABEL[kind]} email`);
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setBusy(null);
        }
    }

    async function sendTest() {
        setBusy("test");
        try {
            await axios.post(`/api/settings/email-templates/${kind}/test`, { email: testEmail.trim() });
            toast.success(`Test sent to ${testEmail.trim()}`);
        } catch (e) {
            toast.error(extractApiError(e, "Test failed"));
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr_360px]">
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
                        <span>{EMAIL_TEMPLATE_LABEL[t.kind]}</span>
                        <span className={`text-xs ${t.enabled ? "text-emerald-600" : "text-muted-foreground"}`}>{t.enabled ? "On" : "Off"}</span>
                    </button>
                ))}
            </div>

            {/* Editor */}
            <div className="min-w-0 space-y-4 rounded-lg border p-4">
                {!sendReady && (
                    <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Email sending is not set up on this server — <code>RESEND_API_KEY</code> or <code>EMAIL_FROM</code> is missing.
                    </p>
                )}
                <p className="text-xs text-muted-foreground">
                    <b>Sent when:</b> {EMAIL_TEMPLATE_WHEN[kind]}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                        Send by email
                    </label>
                    <label className="flex items-center gap-2 text-sm" title="On: goes by itself when the document is posted. Off: only from the 3-dot menu's Send email.">
                        <Switch checked={autoSend} onCheckedChange={setAutoSend} disabled={!enabled} />
                        Auto send
                    </label>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {emailFieldsFor(kind).map((f) => (
                        <Button key={f.key} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => insertField(f.key)}>
                            + {f.label}
                        </Button>
                    ))}
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="em-subject">Subject</Label>
                    <Input
                        id="em-subject"
                        ref={subjectRef}
                        maxLength={EMAIL_SUBJECT_MAX}
                        value={draft.subject}
                        onFocus={() => setTarget("subject")}
                        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="em-body">Message</Label>
                    <Textarea
                        id="em-body"
                        ref={bodyRef}
                        rows={14}
                        value={draft.body}
                        onFocus={() => setTarget("body")}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    />
                    <p className="text-right text-xs text-muted-foreground">{draft.body.length} / {EMAIL_BODY_MAX}</p>
                    {errors.map((e) => (
                        <p key={e} className="text-xs text-red-600">{e}</p>
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={save} disabled={!dirty || errors.length > 0 || busy !== null}>
                        {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Save
                    </Button>
                    <Button variant="ghost" onClick={() => setDraft(EMAIL_TEMPLATE_DEFAULTS[kind])} disabled={busy !== null}>
                        Reset to default wording
                    </Button>
                </div>

                <div className="space-y-1.5 border-t pt-3">
                    <Label htmlFor="em-test">Send a test of the saved wording</Label>
                    <div className="flex gap-2">
                        <Input
                            id="em-test"
                            type="email"
                            placeholder="name@example.com"
                            className="max-w-64"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                        />
                        <Button variant="outline" onClick={sendTest} disabled={!sendReady || dirty || !testEmail.includes("@") || busy !== null}>
                            {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                            Send test
                        </Button>
                    </div>
                    {dirty && <p className="text-xs text-muted-foreground">Save first — the test uses the saved wording.</p>}
                </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
                <p className="text-sm font-medium">Preview</p>
                <div className="rounded-lg border bg-background">
                    <div className="border-b px-3 py-2 text-sm">
                        <span className="text-muted-foreground">Subject: </span>
                        <b className="break-words">{fillBody(draft.subject, samples)}</b>
                    </div>
                    <p className="whitespace-pre-wrap break-words p-3 text-sm">{fillBody(draft.body, samples)}</p>
                </div>
            </div>
        </div>
    );
}
