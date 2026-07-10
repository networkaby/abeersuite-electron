"use client";

// Per-row Convert control for the Orders & Estimates register. Reads the allowed
// targets from the generic CONVERT_MAP: a single target renders a direct button,
// several render a small dropdown. Selecting a target calls the convert API, which
// creates the target document, posts it, and links it back. The register stays put
// and reloads (via onConverted) so the source flips to "Converted".

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { extractApiError } from "@/shared/lib/api";
import { convertTargets } from "@/modules/accountancy/lib/convertMap";

export function ConvertVoucherButton({ rawId, kind, onConverted }: { rawId: number; kind: string; onConverted?: () => void }) {
    const [busy, setBusy] = useState(false);
    const targets = convertTargets(kind);
    if (targets.length === 0) return null;

    const run = async (targetKind: string) => {
        setBusy(true);
        try {
            const { data } = await axios.post<{ editUrl: string | null; posted?: boolean; warning?: string | null }>(
                `/api/inventory/vouchers/${rawId}/convert`,
                { targetKind },
            );
            if (data.warning) toast.warning(data.warning);
            else toast.success(data.posted ? "Converted & posted" : "Converted");
            // Stay on the register and reload so the source flips to "Converted".
            onConverted?.();
        } catch (e) {
            toast.error(extractApiError(e, "Convert failed"));
        } finally {
            setBusy(false);
        }
    };

    const Icon = busy
        ? <Loader2 className="size-3.5 animate-spin" />
        : <ArrowRightLeft className="size-3.5" />;

    if (targets.length === 1) {
        return (
            <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); void run(targets[0].kind); }}
            >
                {Icon} Convert
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={busy}
                    onClick={(e) => e.stopPropagation()}
                >
                    {Icon} Convert
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {targets.map((t) => (
                    <DropdownMenuItem key={t.kind} onSelect={() => void run(t.kind)}>
                        To {t.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
