"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, GitBranch, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";

const WORKFLOW_TABS = [
    { href: "/office/settings/workflow/statuses", label: "Statuses", icon: Settings },
    { href: "/office/settings/workflow/sub-statuses", label: "Sub-Statuses", icon: Settings },
    { href: "/office/settings/workflow/pipelines", label: "Pipelines", icon: GitBranch },
    { href: "/office/settings/workflow/works", label: "Works", icon: Briefcase },
];

function isActive(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkflowTabsNav() {
    const pathname = usePathname();
    return (
        <nav className="border-b border-border pb-2" aria-label="Workflow sections">
            <div className="-mx-1 flex flex-wrap items-center gap-0.5 px-1 py-0.5">
                {WORKFLOW_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = isActive(pathname, tab.href);
                    return (
                        <Button
                            key={tab.href}
                            asChild
                            variant={active ? "secondary" : "ghost"}
                            size="xs"
                            className={cn("shrink-0 px-2 font-normal", active && "font-medium")}
                        >
                            <Link href={tab.href}>
                                <Icon className="size-3" aria-hidden />
                                {tab.label}
                            </Link>
                        </Button>
                    );
                })}
            </div>
        </nav>
    );
}
