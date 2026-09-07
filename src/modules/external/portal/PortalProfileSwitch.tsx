"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Building2, Check, ChevronDown, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { extractApiError } from "@/shared/lib/api";
import { usePortalAccountStore, type PortalAccountOption } from "@/store/external/portalAccountStore";

/**
 * "Using: Rahul (Personal) ▾" — the one place a customer switches between their
 * personal profile and a linked company. Lives in the portal header and on
 * checkout so the profile in use is never a mystery. Orders, wallet, coupons
 * and bills follow whichever one is selected here.
 */

export function profileLabel(option: PortalAccountOption): string {
    return option.accountType === "personal" ? option.label.replace(/ \(Personal\)$/, "") : option.label;
}

export default function PortalProfileSwitch({ className = "" }: { className?: string }) {
    const { options, activeAccountId, loading, load, switchAccount } = usePortalAccountStore();

    useEffect(() => {
        load().catch(() => toast.error("Failed to load your profiles"));
    }, [load]);

    const active = options.find((o) => o.accountId === activeAccountId) ?? null;
    if (!active) return null;

    const onPick = async (option: PortalAccountOption) => {
        try {
            await switchAccount(option.accountId);
            toast.success(`Now using ${profileLabel(option)}`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not switch profile"));
        }
    };

    const Icon = active.accountType === "personal" ? UserRound : Building2;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={`gap-1.5 ${className}`} disabled={loading}>
                    <Icon className="size-3.5 text-primary" />
                    <span className="hidden text-muted-foreground sm:inline">Using</span>
                    <span className="max-w-[9rem] truncate font-medium">{profileLabel(active)}</span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Orders, wallet and bills go to the profile you pick
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {options.map((option) => {
                    const OptIcon = option.accountType === "personal" ? UserRound : Building2;
                    const selected = option.accountId === activeAccountId;
                    return (
                        <DropdownMenuItem key={option.accountId} onClick={() => void onPick(option)} className="gap-2">
                            <OptIcon className="size-4 shrink-0" />
                            <span className="flex-1 truncate">
                                {profileLabel(option)}
                                <span className="ml-1 text-xs text-muted-foreground">
                                    {option.accountType === "personal" ? "Personal" : "Company"}
                                </span>
                            </span>
                            {selected ? <Check className="size-4 text-primary" /> : null}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
