"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Camera, Check, MapPin, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import UserAvatar from "@/shared/components/UserAvatar";
import { extractApiError } from "@/shared/lib/api";
import { uploadImageToCloudinary } from "@/shared/lib/uploadToCloudinary";
import type { PortalProfile } from "@/shared/lib/portal/portalProfileTypes";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

/**
 * Who you are — photo, name, address. The photo is the customer's one profile
 * picture: it is also their Social DP. Edits are optimistic and roll back on
 * failure, so the page never blanks while saving.
 */
export default function ProfileIdentityCard({ profile }: { profile: PortalProfile }) {
    const setProfile = usePortalAccountStore((s) => s.setProfile);
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(profile.name);
    const [address, setAddress] = useState(profile.address ?? "");
    const [saving, setSaving] = useState(false);

    async function patch(body: Partial<Pick<PortalProfile, "name" | "address" | "avatarUrl">>, okMessage: string) {
        const before = profile;
        setProfile({ ...profile, ...body });
        try {
            const res = await axios.patch<PortalProfile>("/api/portal/me", body);
            setProfile(res.data);
            toast.success(okMessage);
            return true;
        } catch (e) {
            setProfile(before);
            toast.error(extractApiError(e, "Could not save"));
            return false;
        }
    }

    async function onPickPhoto(file: File | undefined) {
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error("Photo must be under 5 MB"); return; }
        setUploading(true);
        try {
            const url = await uploadImageToCloudinary(file, "/api/portal/upload-signature");
            await patch({ avatarUrl: url }, "Photo updated");
        } catch {
            toast.error("Upload failed — please try again");
        } finally {
            setUploading(false);
        }
    }

    async function saveDetails() {
        if (name.trim().length < 2) { toast.error("Enter your name"); return; }
        setSaving(true);
        const ok = await patch({ name: name.trim(), address: address.trim() || null }, "Details saved");
        setSaving(false);
        if (ok) setEditing(false);
    }

    function cancelEdit() {
        setName(profile.name);
        setAddress(profile.address ?? "");
        setEditing(false);
    }

    return (
        <Card className="overflow-hidden border-border/70 shadow-sm">
            <div className="h-24 bg-linear-to-r from-primary/20 via-indigo-500/15 to-violet-500/20" />
            <CardContent className="-mt-12 pb-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                    {/* Photo */}
                    <div className="relative w-fit">
                        <div className="rounded-full border-4 border-card bg-card shadow-md">
                            <UserAvatar avatarUrl={profile.avatarUrl} name={profile.name} role={null} sizePx={96} />
                        </div>
                        {uploading ? (
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                                <div className="size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            </div>
                        ) : null}
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onPickPhoto(f); }}
                        />
                        <button
                            type="button"
                            aria-label="Change photo"
                            disabled={uploading}
                            onClick={() => fileRef.current?.click()}
                            className="absolute bottom-1 right-1 flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow transition hover:bg-muted disabled:opacity-50"
                        >
                            <Camera className="size-4" />
                        </button>
                    </div>

                    {/* Name / address */}
                    <div className="min-w-0 flex-1 sm:pb-1">
                        {editing ? (
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="profile-name">Your name</Label>
                                    <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="profile-address">Address</Label>
                                    <Textarea id="profile-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={500} placeholder="House / street, area, city, PIN" />
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => void saveDetails()} disabled={saving}>
                                        <Check className="size-3.5" /> {saving ? "Saving…" : "Save"}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                                        <X className="size-3.5" /> Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="truncate text-xl font-semibold tracking-tight">{profile.name}</h2>
                                    <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                                        <MapPin className="mt-0.5 size-3.5 shrink-0" />
                                        {profile.address ? (
                                            <span className="whitespace-pre-line">{profile.address}</span>
                                        ) : (
                                            <span className="italic">No address yet — add one for faster checkout.</span>
                                        )}
                                    </p>
                                    {profile.social ? (
                                        <p className="mt-1 text-xs text-muted-foreground">Social: @{profile.social.handle}</p>
                                    ) : null}
                                </div>
                                <div className="flex gap-2">
                                    {profile.avatarUrl ? (
                                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void patch({ avatarUrl: null }, "Photo removed")} disabled={uploading}>
                                            <Trash2 className="size-3.5" /> Remove photo
                                        </Button>
                                    ) : null}
                                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                                        <Pencil className="size-3.5" /> Edit
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
