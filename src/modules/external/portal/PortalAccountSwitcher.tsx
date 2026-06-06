"use client";

import { useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Building2, UserRound } from "lucide-react";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

type AccountContextResponse = {
    options: {
        accountId: number;
        accountType: "personal" | "company";
        label: string;
        companyId: number | null;
        companyName: string | null;
    }[];
    active: {
        accountId: number;
    };
};

export default function PortalAccountSwitcher() {
    const { options, activeAccountId, loading, setContext, setLoading } = usePortalAccountStore();

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        axios
            .get<AccountContextResponse>("/api/portal/account-context")
            .then((response) => {
                if (cancelled) return;
                setContext({
                    options: response.data.options,
                    activeAccountId: response.data.active.accountId,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                // 401/403 just means the visitor isn't signed in to the customer
                // portal — not an error. The checkout shows a sign-in prompt and the
                // profile list stays empty. Only surface genuine failures.
                const status = axios.isAxiosError(error) ? error.response?.status : undefined;
                if (status !== 401 && status !== 403) {
                    toast.error("Failed to load account profiles");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [setContext, setLoading]);

    const onSwitch = async (value: string) => {
        const accountId = Number(value);
        if (!Number.isFinite(accountId)) return;
        setLoading(true);
        try {
            const response = await axios.patch<AccountContextResponse>("/api/portal/account-context", { accountId });
            setContext({
                options: response.data.options,
                activeAccountId: response.data.active.accountId,
            });
            toast.success("Switched account profile");
        } catch (error) {
            toast.error(axios.isAxiosError(error) ? error.response?.data?.error ?? "Switch failed" : "Switch failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Active profile</Label>
                    <p className="text-sm text-muted-foreground">Switch between personal and linked company profiles.</p>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                    {options.length} profile{options.length === 1 ? "" : "s"}
                </Badge>
            </div>
            <Select
                value={activeAccountId ? String(activeAccountId) : undefined}
                onValueChange={(value) => void onSwitch(value)}
                disabled={loading || options.length === 0}
            >
                <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.accountId} value={String(option.accountId)}>
                            <span className="inline-flex items-center gap-2">
                                {option.accountType === "personal" ? <UserRound className="size-3.5" /> : <Building2 className="size-3.5" />}
                                {option.accountType === "personal" ? option.label : `${option.label} (Company)`}
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {loading ? <p className="text-xs text-muted-foreground">Updating profile context...</p> : null}
        </div>
    );
}

