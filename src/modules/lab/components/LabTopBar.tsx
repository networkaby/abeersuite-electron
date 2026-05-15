"use client";

import { useRouter, usePathname } from "next/navigation";
import { FlaskConical, LayoutDashboard, Briefcase } from "lucide-react";
import { BranchSwitcher } from "@/shared/components/BranchSwitcher";
import { cn } from "@/shared/lib/format/utils";

interface LabTopBarProps {
    userName: string | null;
    roleLabel: string | null;
}

/**
 * Lab top bar — three slots:
 *   left:   LAB badge + app name
 *   center: Front | Back segmented toggle (writes to URL)
 *   right:  branch switcher + signed-in user
 *
 * The toggle is the only navigation in the lab — no sidebar, no menus.
 */
export default function LabTopBar({ userName, roleLabel }: LabTopBarProps) {
    const router = useRouter();
    const pathname = usePathname();
    const isBack = pathname?.startsWith("/lab/back") ?? false;

    return (
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4">
            {/* LEFT — lab badge + app name */}
            <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    <FlaskConical size={11} />
                    Lab
                </span>
                <span className="text-sm font-semibold text-foreground">
                    Service Mgmt
                </span>
                <span className="hidden text-xs text-muted-foreground md:inline">
                    · prototype workspace
                </span>
            </div>

            {/* CENTER — Front | Back toggle */}
            <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5">
                <button
                    type="button"
                    onClick={() => router.push("/lab/front")}
                    className={cn(
                        "flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
                        !isBack
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <LayoutDashboard size={13} />
                    Front Office
                </button>
                <button
                    type="button"
                    onClick={() => router.push("/lab/back")}
                    className={cn(
                        "flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
                        isBack
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Briefcase size={13} />
                    Back Office
                </button>
            </div>

            {/* RIGHT — branch + user */}
            <div className="flex items-center gap-3">
                <BranchSwitcher />
                <div className="flex items-center gap-2 text-xs">
                    <span className="hidden text-muted-foreground md:inline">
                        {roleLabel ?? "staff"}
                    </span>
                    <span className="font-medium text-foreground">
                        {userName ?? "—"}
                    </span>
                </div>
            </div>
        </header>
    );
}
