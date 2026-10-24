"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { extractApiError } from "@/shared/lib/api";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { PHOTO_CLEANUP_MIN_AGE_DAYS } from "@/shared/lib/constants/inventory";

type Plan = {
    total: number;
    totalBytes: number;
    garbageCount: number;
    garbageBytes: number;
    youngUnused: number;
    samples: { url: string; publicId: string; createdAt: string }[];
};

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Settings → E-Commerce → Photo cleanup. Check = a dry run (deletes nothing);
 * Clean = the server works the list out again and deletes it from Cloudinary.
 * The rules live in modules/ecommerce/lib/photoCleanup.ts.
 */
export default function PhotoCleanupCard() {
    const [plan, setPlan] = useState<Plan | null>(null);
    const [busy, setBusy] = useState<"check" | "clean" | null>(null);

    const check = async () => {
        setBusy("check");
        try {
            setPlan((await axios.get<Plan>("/api/ecommerce/photo-cleanup")).data);
        } catch (e) {
            toast.error(extractApiError(e, "Could not check Cloudinary"));
        } finally {
            setBusy(null);
        }
    };

    const clean = async () => {
        if (!plan) return;
        const ok = await confirmAction({
            title: `Delete ${plan.garbageCount} unused photos from Cloudinary?`,
            body: `Frees about ${mb(plan.garbageBytes)}. They are gone for good — no product, master, ad or page uses them, and every one is older than ${PHOTO_CLEANUP_MIN_AGE_DAYS} days. The list is checked again at the moment of deleting.`,
            confirmLabel: "Delete photos",
        });
        if (!ok) return;
        setBusy("clean");
        try {
            const { data } = await axios.post<{ deleted: number; freedBytes: number }>("/api/ecommerce/photo-cleanup");
            toast.success(`Deleted ${data.deleted} photos — about ${mb(data.freedBytes)} freed.`);
            setPlan(null);
        } catch (e) {
            toast.error(extractApiError(e, "Cleanup failed"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <Card className="max-w-xl">
            <CardHeader>
                <CardTitle>Photo cleanup</CardTitle>
                <CardDescription>
                    Removing a photo in the app leaves the file in Cloudinary. This finds shop photos that nothing uses any
                    more — older than {PHOTO_CLEANUP_MIN_AGE_DAYS} days — and deletes them to free space. Check first; it
                    deletes nothing.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {plan && (
                    <div className="space-y-2 text-sm">
                        <p>
                            Shop photos in Cloudinary: <b>{plan.total}</b> ({mb(plan.totalBytes)})
                        </p>
                        <p>
                            Unused and old enough to delete: <b>{plan.garbageCount}</b> ({mb(plan.garbageBytes)})
                        </p>
                        {plan.youngUnused > 0 && (
                            <p className="text-muted-foreground">
                                {plan.youngUnused} more unused but newer than {PHOTO_CLEANUP_MIN_AGE_DAYS} days — kept for now.
                            </p>
                        )}
                        {plan.samples.length > 0 && (
                            <ul className="grid grid-cols-6 gap-1.5">
                                {plan.samples.map((s) => (
                                    <li key={s.publicId} title={`${s.publicId} · ${s.createdAt.slice(0, 10)}`}>
                                        {/* eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary thumb */}
                                        <img src={cloudinaryThumb(s.url, 120, "card")} alt="" className="aspect-square w-full rounded border object-cover" />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => void check()} disabled={busy !== null}>
                        {busy === "check" ? "Checking…" : plan ? "Check again" : "Check"}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void clean()}
                        disabled={busy !== null || !plan || plan.garbageCount === 0}
                    >
                        {busy === "clean" ? "Deleting…" : "Clean"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
