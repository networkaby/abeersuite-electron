"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMessageTemplateOptions, type TemplateChannel, type TemplateOption } from "@/modules/settings/hooks/useMessageTemplateOptions";

const NONE = "__none__";

/**
 * Pick one WhatsApp or email template, built-in or custom. "" means none.
 * Offers only templates that are ready to send (on, and approved for
 * WhatsApp) and never a sign-in code email (owner, 2026-11-08). A saved
 * choice that has since gone off still shows, with the reason, so staff see
 * why nothing goes. A screen that wants fewer still passes `filter`.
 */
export function MessageTemplatePicker({
    channel,
    value,
    onChange,
    className,
    noneLabel = "— none —",
    filter,
}: {
    channel: TemplateChannel;
    value: string;
    onChange: (kind: string) => void;
    className?: string;
    noneLabel?: string;
    /** Optional: keep only some templates. */
    filter?: (t: TemplateOption) => boolean;
}) {
    const all = useMessageTemplateOptions(channel);
    const options = all.filter((t) => t.ready && !t.sensitive && (!filter || filter(t)));
    // The saved choice, when it is no longer offered (gone off, or not loaded yet).
    const saved = value && !options.some((o) => o.kind === value) ? all.find((o) => o.kind === value) : undefined;
    const missing = value && !options.some((o) => o.kind === value);
    return (
        <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
            <SelectTrigger className={className ?? "w-full"}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NONE}>{noneLabel}</SelectItem>
                {missing && <SelectItem value={value}>{saved ? `${saved.name} (${saved.why})` : value}</SelectItem>}
                {options.map((t) => (
                    <SelectItem key={t.kind} value={t.kind}>
                        {t.name}
                        {t.ready ? "" : ` (${t.why})`}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
