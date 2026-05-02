"use client";

import { useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
            .catch(() => {
                if (!cancelled) {
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
        <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Active profile</Label>
            <Select
                value={activeAccountId ? String(activeAccountId) : undefined}
                onValueChange={(value) => void onSwitch(value)}
                disabled={loading || options.length === 0}
            >
                <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.accountId} value={String(option.accountId)}>
                            {option.accountType === "personal" ? `${option.label}` : `${option.label} (Company)`}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

