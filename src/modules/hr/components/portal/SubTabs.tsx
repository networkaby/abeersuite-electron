"use client";

// The inner tab row of a portal group — the same underline style the profile
// page has always used, so the two levels read as one page.

import { Button } from "@/components/ui/button";

export default function SubTabs({ tabs, active, onChange }: {
    tabs: readonly string[]; active: string | null; onChange: (tab: string) => void;
}) {
    return (
        <div className="mb-4 flex flex-wrap border-b border-border print:hidden">
            {tabs.map((tab) => (
                <Button key={tab} type="button" variant="ghost" onClick={() => onChange(tab)}
                    className={[
                        "h-auto rounded-none px-2.5 py-2 text-sm font-medium capitalize border-b-2 transition-colors whitespace-nowrap",
                        active === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                    ].join(" ")}>
                    {tab}
                </Button>
            ))}
        </div>
    );
}
