"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMessageTemplateOptions, type TemplateChannel, type TemplateOption } from "@/modules/settings/hooks/useMessageTemplateOptions";

const NONE = "__none__";

/**
 * Pick one WhatsApp or email template — every built-in and custom one, each
 * marked when it would not go yet. "" means none. Impartial: it lists all;
 * a screen that wants fewer passes `filter`.
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
    const options = filter ? all.filter(filter) : all;
    // A saved kind not in the list (deleted, or not loaded yet) still shows.
    const missing = value && !options.some((o) => o.kind === value);
    return (
        <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
            <SelectTrigger className={className ?? "w-full"}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NONE}>{noneLabel}</SelectItem>
                {missing && <SelectItem value={value}>{value}</SelectItem>}
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
