"use client";

import Link from "next/link";
import { ExternalLink, MapPin, Phone } from "lucide-react";
import { formatDate } from "@/shared/lib/format/formatDate";
import { initials } from "@/shared/lib/format/initials";
import { moduleColor, moduleInk, moduleTint } from "@/shared/lib/format/moduleTheme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** One count chip — "3 devices", "2 companies", "0 tickets". */
export type PartyHeaderChip = { key: string; icon?: React.ReactNode; text: string };

/** The identity strip at the top of a party's detail pane: avatar, name, the
 *  contact line, and the count chips.
 *
 *  The Persons page, the Companies page and both panes of All Customers each
 *  carried their own copy of this block; they now share one. What differs
 *  between them is only the chips and the odd extra field (a company's
 *  registration number), so those are props.
 *
 *  The module wash fades out inside the strip itself, so the colour introduces
 *  the party and is gone before the tabs start — chrome is coloured, data is
 *  not. */
export function PartyDetailHeader({
    module = "customers",
    name,
    phone,
    address,
    email,
    extra,
    createdAt,
    socialHref,
    chips,
}: {
    /** Module key from utils/constants.ts — decides the hue. */
    module?: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    email?: string | null;
    /** Anything else for the contact line, e.g. a company's "Reg: …". */
    extra?: React.ReactNode;
    createdAt: string;
    socialHref: string;
    chips: PartyHeaderChip[];
}) {
    const hue = moduleColor(module);

    return (
        <div
            className="border-b px-6 py-4"
            style={{ backgroundImage: `linear-gradient(to bottom, ${moduleTint(module, 16)}, var(--card))` }}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none text-sm font-bold text-primary-foreground"
                        style={{ backgroundColor: hue }}
                    >
                        {initials(name)}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">{name}</h2>
                        <div className="mt-1 flex flex-wrap items-center gap-3">
                            {phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone size={11} style={{ color: hue }} />{phone}</span>}
                            {address && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} style={{ color: hue }} />{address}</span>}
                            {email && <span className="text-xs text-muted-foreground">{email}</span>}
                            {extra}
                            <span className="text-xs text-muted-foreground">Since {formatDate(createdAt)}</span>
                        </div>
                    </div>
                </div>
                <Button asChild type="button" variant="outline" size="icon-sm">
                    <Link href={socialHref} title="Social profile">
                        <ExternalLink size={14} />
                    </Link>
                </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {chips.map((chip) => (
                    <Badge
                        key={chip.key}
                        variant="outline"
                        className="bg-card/70"
                        // Border carries the raw hue; the label has to be the deepened
                        // ink, or 12px text on this chip lands under the AA floor.
                        style={{ borderColor: `color-mix(in oklab, ${hue} 38%, transparent)`, color: moduleInk(module) }}
                    >
                        {chip.icon} {chip.text}
                    </Badge>
                ))}
            </div>
        </div>
    );
}
