"use client";

import { toast } from "sonner";
import { Building2, CheckCircle2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { extractApiError } from "@/shared/lib/api";
import { profileLabel } from "@/modules/external/portal/PortalProfileSwitch";
import { usePortalAccountStore, type PortalAccountOption } from "@/store/external/portalAccountStore";

/**
 * Your profiles — the personal one plus every company the shop has linked you
 * to, as cards. The one in use is marked; the others get a "Use this profile"
 * button. Same switch as the header chip, laid out so nobody has to guess.
 */
export default function ProfileAccountsCard() {
    const { options, activeAccountId, loading, switchAccount } = usePortalAccountStore();

    const onUse = async (option: PortalAccountOption) => {
        try {
            await switchAccount(option.accountId);
            toast.success(`Now using ${profileLabel(option)}`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not switch profile"));
        }
    };

    return (
        <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Your profiles</CardTitle>
                <CardDescription>
                    Orders, wallet, coupons and checkout bills go to the profile you are using.
                    {options.length === 1 ? " Ask the shop to link a company if you buy for one." : ""}
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
                {options.map((option) => {
                    const active = option.accountId === activeAccountId;
                    const Icon = option.accountType === "personal" ? UserRound : Building2;
                    return (
                        <div
                            key={option.accountId}
                            className={[
                                "flex items-center gap-3 rounded-lg border p-3 transition",
                                active ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "border-border/70 bg-card",
                            ].join(" ")}
                        >
                            <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                                <Icon className="size-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{profileLabel(option)}</p>
                                <p className="text-xs text-muted-foreground">
                                    {option.accountType === "personal" ? "Personal" : "Company"}
                                </p>
                            </div>
                            {active ? (
                                <Badge variant="secondary" className="gap-1 text-primary">
                                    <CheckCircle2 className="size-3" /> In use
                                </Badge>
                            ) : (
                                <Button size="sm" variant="outline" disabled={loading} onClick={() => void onUse(option)}>
                                    Use this
                                </Button>
                            )}
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
