"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Loader2, Plus, X } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOM_NAME_MAX } from "@/shared/lib/whatsapp/billTemplates";

/**
 * Staff's own templates on Settings → WhatsApp / Email Templates: the "Add
 * template" box under the list, and the name row on top of a custom
 * template's editor. No delete (owner, 2026-11-08) — workflow stages may
 * point at a custom template. Both pages share this; `apiBase` picks the channel.
 */

type Named = { kind: string; name: string | null };

export function AddTemplateButton<T extends Named>({ apiBase, onCreated }: { apiBase: string; onCreated: (t: T) => void }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);

    async function add() {
        setBusy(true);
        try {
            const { data } = await axios.post(apiBase, { name: name.trim() });
            onCreated(data.template);
            setName("");
            setOpen(false);
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the template"));
        } finally {
            setBusy(false);
        }
    }

    if (!open) {
        return (
            <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                Add template
            </Button>
        );
    }
    return (
        <div className="space-y-1.5 rounded-md border p-2">
            <Input
                autoFocus
                placeholder="Template name"
                maxLength={CUSTOM_NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) add();
                    if (e.key === "Escape") setOpen(false);
                }}
            />
            <div className="flex gap-1.5">
                <Button size="sm" onClick={add} disabled={!name.trim() || busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                    <X className="size-3.5" />
                    Cancel
                </Button>
            </div>
        </div>
    );
}

export function CustomTemplateHeader<T extends Named>({
    apiBase,
    template,
    onRenamed,
}: {
    apiBase: string;
    template: T;
    onRenamed: (t: T) => void;
}) {
    const [name, setName] = useState(template.name ?? "");
    const [shownKind, setShownKind] = useState(template.kind);
    const [busy, setBusy] = useState(false);

    // Another template picked — show its name.
    if (shownKind !== template.kind) {
        setShownKind(template.kind);
        setName(template.name ?? "");
    }
    const changed = name.trim() !== "" && name.trim() !== (template.name ?? "");

    async function rename() {
        setBusy(true);
        try {
            const { data } = await axios.patch(`${apiBase}/${template.kind}`, { name: name.trim() });
            onRenamed(data.template);
        } catch (e) {
            toast.error(extractApiError(e, "Rename failed"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Input
                aria-label="Template name"
                className="max-w-64"
                maxLength={CUSTOM_NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && changed && rename()}
            />
            {changed && (
                <Button size="sm" variant="secondary" onClick={rename} disabled={busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Rename
                </Button>
            )}
        </div>
    );
}
