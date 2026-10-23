import type { LucideIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import CampaignsHeader from "./CampaignsHeader";

export type PlannedRow = { title: string; sub?: string; right?: string };
export type PlannedSection = { heading: string; note?: string; rows: PlannedRow[] };

/**
 * A Campaigns page that is drawn but not wired yet (owner, 2026-10-23: "do the
 * UI first … wiring later"). Sample rows show what the page will hold, so the
 * plan can be read and changed before any table exists. Static: no data calls.
 */
export default function PlannedPage({
    icon,
    title,
    description,
    sections,
    footnote,
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    sections: PlannedSection[];
    footnote?: string;
}) {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-6 px-6 pt-4 pb-10">
                <CampaignsHeader icon={icon} title={title} description={description} planned />
                <div className="grid gap-4 md:grid-cols-2">
                    {sections.map((s) => (
                        <section key={s.heading} className="rounded-xl border">
                            <div className="border-b px-4 py-3">
                                <h2 className="text-sm font-semibold">{s.heading}</h2>
                                {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                            </div>
                            <div className="divide-y">
                                {s.rows.map((r) => (
                                    <div key={r.title} className="flex items-start justify-between gap-3 px-4 py-2.5">
                                        <div className="min-w-0">
                                            <p className="text-sm">{r.title}</p>
                                            {r.sub && <p className="text-xs text-muted-foreground">{r.sub}</p>}
                                        </div>
                                        {r.right && <span className="shrink-0 text-xs font-medium text-muted-foreground">{r.right}</span>}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
                {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
            </div>
        </ScrollArea>
    );
}
