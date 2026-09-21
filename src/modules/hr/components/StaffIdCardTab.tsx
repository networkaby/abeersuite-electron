"use client";

// "ID Card" — the staff identity card, shown the same way on the person's own
// profile and on the HR staff profile. What is on screen is exactly what the
// printer puts on the card (both render StaffIdCard), so there is no template
// to configure and nothing to preview twice.
//
// Three ways out of this tab, and they are for three different jobs:
//
//   Enlarge  — the card at a readable size in a dialog, for checking the
//              details before anyone spends a card blank. Click the card.
//   Print    — the A4 sheet at /receipt/staff-id/[userId], front and back with
//              a cut line. One button: it opens the sheet AND raises the print
//              dialog, so "open the sheet" was never a second thing to want.
//   Download — press artwork. Two PNGs at the real card size and 600 dpi with
//              bleed, for whoever prints the PVC cards.

import { useState } from "react";
import { Printer, IdCard, Download, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import StaffIdCard from "@/shared/components/print/StaffIdCard";
import { toStaffIdCardData } from "../lib/staffIdCard";
import type { StaffDetail } from "../lib/staffTypes";

// How much bigger the card is in the dialog, and how wide one card is at that
// size. Side by side the pair is too wide for any ordinary screen, so the
// dialog is held to ONE card's width and the card component's own flex-wrap
// puts the back underneath the front. Nothing is re-laid-out: it is the same
// artwork, magnified, so the enlarged card cannot drift from the printed one.
const ZOOM = 2.6;
const ONE_CARD = "85.6mm";

export default function StaffIdCardTab({ userId }: { userId: number }) {
    const { data, loading, error, reload } = useApiResource<StaffDetail>(`/api/hr/staff/${userId}`);
    const [big, setBig] = useState(false);
    const [saving, setSaving] = useState(false);

    // Both sides, one click. A card press needs the pair, and asking for them
    // one at a time is two chances to hand over half the job.
    async function downloadArtwork() {
        setSaving(true);
        try {
            for (const side of ["front", "back"] as const) {
                const res = await fetch(`/api/hr/staff/${userId}/id-card-image?side=${side}`);
                if (!res.ok) throw new Error(side);
                const blob = await res.blob();
                // The server names the file — size, resolution and bleed are in it,
                // which is what the press needs to know.
                const name = res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1]
                    ?? `staff-id-${userId}-${side}.png`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = name; a.click();
                URL.revokeObjectURL(url);
            }
            toast.success("Front and back saved — 85.6 × 54 mm at 600 dpi, with 2 mm bleed");
        } catch {
            toast.error("Couldn't build the card artwork");
        } finally {
            setSaving(false);
        }
    }

    const card = data && <StaffIdCard data={toStaffIdCardData(data)} />;

    return (
        <div className="space-y-4">
            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

            {data && (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            onClick={() => window.open(`/receipt/staff-id/${userId}?autoprint=1`, "_blank", "noopener,width=1000,height=800")}
                        >
                            <Printer size={14} /> Print
                        </Button>
                        <Button variant="outline" disabled={saving} onClick={() => void downloadArtwork()}>
                            <Download size={14} /> {saving ? "Building…" : "Download for card printer"}
                        </Button>
                    </div>

                    {/* Real size — 85.6 × 54 mm, the same as a PAN or bank card.
                        Click it for the readable version. */}
                    <button
                        type="button"
                        onClick={() => setBig(true)}
                        aria-label="Enlarge the ID card"
                        className="group relative block w-full overflow-x-auto rounded-lg border border-border bg-white p-4 text-left dark:bg-slate-100"
                    >
                        {card}
                        <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-md bg-slate-900/70 px-1.5 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <Maximize2 size={11} /> Enlarge
                        </span>
                    </button>

                    <Dialog open={big} onOpenChange={setBig}>
                        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[min(96vw,980px)]">
                            <DialogTitle>ID card — {data.user.name}</DialogTitle>
                            <div className="max-h-[72vh] overflow-auto rounded-lg bg-white p-4 dark:bg-slate-100">
                                {/* `zoom` rather than a transform because it grows the
                                    layout box too, so the dialog scrolls to the real
                                    size instead of clipping the card. */}
                                <div style={{ zoom: ZOOM, width: ONE_CARD }}>{card}</div>
                            </div>
                        </DialogContent>
                    </Dialog>

                    <p className="flex items-start gap-2 text-xs text-muted-foreground">
                        <IdCard size={14} className="mt-0.5 shrink-0" />
                        <span>
                            Shown at the real card size — click it to enlarge. The photo, phone, blood group,
                            emergency contact and address come from the profile — fill them under{" "}
                            <strong>Personal &amp; Bank</strong> and they appear here at once.
                        </span>
                    </p>
                </>
            )}
        </div>
    );
}
