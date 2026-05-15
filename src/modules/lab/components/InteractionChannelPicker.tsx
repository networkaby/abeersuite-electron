"use client";

import {
    Footprints,
    Phone,
    MessageCircle,
    Instagram,
    Facebook,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/shared/lib/format/utils";

/**
 * Channels through which a customer can be reaching the desk staff.
 * Picked at the top of the Front Office search so the next ticket / lead
 * created in this session can be tagged with its source.
 *
 * UI-only for now — selection lives in local state and is NOT yet persisted
 * onto the created tickets/leads. Wire-up will land in the next iteration
 * when those creators learn to read this value.
 */
export type InteractionChannel =
    | "walk_in"
    | "call"
    | "whatsapp"
    | "instagram"
    | "facebook";

interface ChannelDef {
    id: InteractionChannel;
    label: string;
    icon: LucideIcon;
    /** Background colour when active (Tailwind classes). */
    activeBg: string;
    activeText: string;
}

const CHANNELS: ChannelDef[] = [
    {
        id: "walk_in",
        label: "Walk-in",
        icon: Footprints,
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-700 dark:text-emerald-400",
    },
    {
        id: "call",
        label: "Call",
        icon: Phone,
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-700 dark:text-blue-400",
    },
    {
        id: "whatsapp",
        label: "WhatsApp",
        icon: MessageCircle,
        activeBg: "bg-green-500/15",
        activeText: "text-green-700 dark:text-green-400",
    },
    {
        id: "instagram",
        label: "Instagram",
        icon: Instagram,
        activeBg: "bg-pink-500/15",
        activeText: "text-pink-700 dark:text-pink-400",
    },
    {
        id: "facebook",
        label: "Facebook",
        icon: Facebook,
        activeBg: "bg-indigo-500/15",
        activeText: "text-indigo-700 dark:text-indigo-400",
    },
];

interface InteractionChannelPickerProps {
    channel: InteractionChannel | null;
    onChange: (channel: InteractionChannel | null) => void;
}

export default function InteractionChannelPicker({
    channel,
    onChange,
}: InteractionChannelPickerProps) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Channel:
            </span>
            {CHANNELS.map((c) => {
                const Icon = c.icon;
                const active = channel === c.id;
                return (
                    <button
                        key={c.id}
                        type="button"
                        onClick={() => onChange(active ? null : c.id)}
                        className={cn(
                            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                            active
                                ? cn(
                                      c.activeBg,
                                      c.activeText,
                                      "border-transparent shadow-sm"
                                  )
                                : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                        title={
                            active
                                ? `${c.label} — click to clear`
                                : `Mark this interaction as ${c.label}`
                        }
                    >
                        <Icon size={12} />
                        {c.label}
                    </button>
                );
            })}
        </div>
    );
}
