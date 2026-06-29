"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

// Paper formats offered by the print page's selector. `value` encodes
// "<paper>|<width>" so the 72mm thermal variant (same PaperFormat, narrower
// width) is distinguishable from the standard 80mm.
const FORMAT_OPTIONS = [
    { value: "A4|",              label: "A4" },
    { value: "THERMAL_80MM|",    label: "Thermal 80mm" },
    { value: "THERMAL_80MM|72",  label: "Thermal 72mm" },
] as const;

export default function ReceiptButtons({
    autoPrint = true,
    showFormatPicker = false,
    currentPaper,
    currentWidth = "",
}: {
    /** Fire the browser print dialog on mount. Default true (register/3-dot
     *  flow). The "Print after save" flow passes false so the user can pick a
     *  format first. */
    autoPrint?: boolean;
    /** Render the A4 / thermal format dropdown. */
    showFormatPicker?: boolean;
    /** Server-resolved current paper ("A4" | "THERMAL_80MM"), for the selector. */
    currentPaper?: string;
    /** Server-resolved current width override ("" | "72"), for the selector. */
    currentWidth?: string;
}) {
    useEffect(() => {
        if (autoPrint) window.print();
    }, [autoPrint]);

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const currentValue = `${currentPaper ?? ""}|${currentWidth}`;

    const onFormatChange = (value: string) => {
        const [paper, width] = value.split("|");
        const params = new URLSearchParams(searchParams.toString());
        if (paper) params.set("paper", paper); else params.delete("paper");
        if (width) params.set("width", width); else params.delete("width");
        // Switching format shouldn't re-fire the dialog — the user prints when
        // ready via the Print button.
        params.set("autoprint", "0");
        router.replace(`${pathname}?${params.toString()}`);
    };

    return (
        <div className="no-print mb-3 flex items-center gap-2">
            {showFormatPicker && (
                <select
                    value={currentValue}
                    onChange={(e) => onFormatChange(e.target.value)}
                    aria-label="Paper format"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                    {FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            )}
            <Button onClick={() => window.print()} size="sm">
                🖨️ Print
            </Button>
            <Button onClick={() => window.close()} size="sm" variant="outline">
                ✕ Close
            </Button>
        </div>
    );
}
