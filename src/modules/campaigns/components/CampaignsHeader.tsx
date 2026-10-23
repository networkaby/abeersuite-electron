import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** The top of every Campaigns page: module-hued icon, title, one line, actions. */
export default function CampaignsHeader({
    icon: Icon,
    title,
    description,
    planned,
    actions,
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    /** Shows "Planned — sample data": the page is drawn, not wired yet. */
    planned?: boolean;
    actions?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
                <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: "color-mix(in oklab, var(--m-campaigns) 18%, var(--background))", color: "var(--m-campaigns)" }}
                >
                    <Icon size={22} />
                </div>
                <div>
                    <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold leading-tight">
                        {title}
                        {planned && (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                Planned — sample data
                            </Badge>
                        )}
                    </h1>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
    );
}
