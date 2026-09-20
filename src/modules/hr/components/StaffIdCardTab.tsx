"use client";

// "ID Card" — the staff identity card, shown the same way on the person's own
// profile and on the HR staff profile. What is on screen is exactly what the
// printer puts on the card (both render StaffIdCard), so there is no template
// to configure and nothing to preview twice.
//
// Print opens the sheet at /receipt/staff-id/[userId], which lays the two
// sides out on A4 with cut marks.

import Link from "next/link";
import { Printer, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import StaffIdCard from "@/shared/components/print/StaffIdCard";
import { toStaffIdCardData } from "../lib/staffIdCard";
import type { StaffDetail } from "../lib/staffTypes";

export default function StaffIdCardTab({ userId }: { userId: number }) {
    const { data, loading, error, reload } = useApiResource<StaffDetail>(`/api/hr/staff/${userId}`);

    return (
        <div className="space-y-4">
            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

            {data && (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            onClick={() => window.open(`/receipt/staff-id/${userId}?autoprint=1`, "_blank", "noopener,width=1000,height=800")}
                        >
                            <Printer size={14} /> Print ID card
                        </Button>
                        <Button asChild variant="outline">
                            <Link href={`/receipt/staff-id/${userId}`} target="_blank">Open print sheet</Link>
                        </Button>
                    </div>

                    {/* Real size — 85.6 × 54 mm, the same as a PAN or bank card. */}
                    <div className="overflow-x-auto rounded-lg border border-border bg-white p-4 dark:bg-slate-100">
                        <StaffIdCard data={toStaffIdCardData(data)} />
                    </div>

                    <p className="flex items-start gap-2 text-xs text-muted-foreground">
                        <IdCard size={14} className="mt-0.5 shrink-0" />
                        <span>
                            Shown at the real card size. The photo, phone, blood group, emergency contact and
                            address come from the profile — fill them under <strong>Personal &amp; Bank</strong>
                            {" "}and they appear here at once.
                        </span>
                    </p>
                </>
            )}
        </div>
    );
}
