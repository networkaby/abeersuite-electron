"use client";

// Your own public profile — photo, cover, name, contact, social links. Self only.

import { useRef, useState } from "react";
import Image from "next/image";
import axios from "axios";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import UserAvatar from "@/shared/components/UserAvatar";
import { imageLoaderFor } from "@/shared/lib/cloudinaryImage";
import { uploadImageToCloudinary as uploadToCloudinary } from "@/shared/lib/uploadToCloudinary";
import type { UserProfile } from "./profileTypes";
import { STAFF_PHONE_HINT } from "@/shared/lib/schemas/commonSchemas";

const editSchema = z.object({
    name: z.string().min(1, "Name is required"),
    bio: z.string().max(500, "Max 500 characters").optional(),
    phone: z.string().optional(),
    birthday: z.string().optional(),
    linkedIn: z.string().optional(),
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    facebook: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

export default function EditProfileTab({ profile, onSaved }: { profile: UserProfile; onSaved: (p: UserProfile) => void }) {
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatarUrl);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
    const [coverPreview, setCoverPreview] = useState<string | null>(profile.coverUrl);
    const [coverUrl, setCoverUrl] = useState<string | null>(profile.coverUrl);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);

    const { register, handleSubmit, control, setValue, formState: { errors } } = useForm<EditForm>({
        resolver: zodResolver(editSchema),
        defaultValues: {
            name: profile.name,
            bio: profile.bio ?? "",
            phone: profile.phone ?? "",
            birthday: profile.birthday ? profile.birthday.slice(0, 10) : "",
            linkedIn: profile.linkedIn ?? "",
            twitter: profile.twitter ?? "",
            instagram: profile.instagram ?? "",
            facebook: profile.facebook ?? "",
        },
    });

    const bioValue = useWatch({ control, name: "bio" }) ?? "";
    const birthday = useWatch({ control, name: "birthday" });

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, type: "avatar" | "cover") {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
        if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
        const localUrl = URL.createObjectURL(file);
        if (type === "avatar") { setAvatarPreview(localUrl); setUploading(true); }
        else { setCoverPreview(localUrl); setCoverUploading(true); }
        try {
            const cloudUrl = await uploadToCloudinary(file);
            if (type === "avatar") { setAvatarUrl(cloudUrl); setAvatarPreview(cloudUrl); toast.success("Photo uploaded"); }
            else { setCoverUrl(cloudUrl); setCoverPreview(cloudUrl); toast.success("Cover uploaded"); }
        } catch {
            toast.error("Upload failed — check Cloudinary settings");
            if (type === "avatar") setAvatarPreview(profile.avatarUrl);
            else setCoverPreview(profile.coverUrl);
        } finally {
            if (type === "avatar") setUploading(false);
            else setCoverUploading(false);
        }
    }

    const onSubmit = async (data: EditForm) => {
        setSaving(true);
        try {
            const res = await axios.put<UserProfile>(`/api/users/${profile.id}`, {
                // No email (Security owns it) and no job title (the HR seat owns it).
                name: data.name,
                bio: data.bio || null, phone: data.phone || null, birthday: data.birthday || null,
                linkedIn: data.linkedIn || null, twitter: data.twitter || null,
                instagram: data.instagram || null, facebook: data.facebook || null,
                avatarUrl, coverUrl,
            });
            toast.success("Profile saved");
            onSaved(res.data);
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save");
        } finally { setSaving(false); }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-xl">
            {/* Cover photo */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cover Photo</h3>
                <div className="relative h-28 overflow-hidden rounded-sm border border-border">
                    {coverPreview
                        ? <Image src={coverPreview} alt="Cover" fill className="object-cover" loader={imageLoaderFor(coverPreview)} />
                        : <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#334155,#64748b)" }} />
                    }
                    {coverUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        </div>
                    )}
                    <div className="absolute bottom-2 right-2 flex gap-2">
                        <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, "cover")} />
                        <Button type="button" size="sm" variant="outline" className="bg-white/90 text-xs h-7 px-2" disabled={coverUploading}
                            onClick={() => coverInputRef.current?.click()}>
                            <Upload size={12} /> {coverUploading ? "Uploading…" : "Change Cover"}
                        </Button>
                        {coverUrl && (
                            <Button type="button" size="sm" variant="outline" className="bg-white/90 text-destructive text-xs h-7 px-2"
                                onClick={() => { setCoverUrl(null); setCoverPreview(null); }}>
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Profile photo */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Profile Photo</h3>
                <div className="flex items-center gap-5">
                    <div className="relative shrink-0">
                        <UserAvatar avatarUrl={avatarPreview} name={profile.name} role={profile.role} sizePx={80} />
                        {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, "avatar")} />
                        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                            <Upload size={13} /> {uploading ? "Uploading…" : "Upload Photo"}
                        </Button>
                        {avatarUrl && (
                            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive text-xs"
                                onClick={() => { setAvatarUrl(null); setAvatarPreview(null); }}>
                                Remove photo
                            </Button>
                        )}
                        <p className="text-[11px] text-muted-foreground">JPG, PNG or WebP · max 5 MB</p>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5"><Link2 size={12} /> Or paste a photo URL</Label>
                    <Input placeholder="https://example.com/photo.jpg" value={avatarUrl ?? ""}
                        onChange={e => { setAvatarUrl(e.target.value || null); setAvatarPreview(e.target.value || null); }} />
                </div>
            </div>

            {/* Identity */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Identity</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2 space-y-1.5">
                        <Label>Full Name</Label>
                        <Input {...register("name")} />
                        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                    </div>
                    <div className="sm:col-span-2 space-y-1.5">
                        <Label>Bio <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea {...register("bio")} placeholder="A short intro about yourself…" rows={3} />
                        <p className="text-[11px] text-muted-foreground text-right">{bioValue.length}/500</p>
                        {errors.bio && <p className="text-xs text-destructive">{errors.bio.message}</p>}
                    </div>
                </div>
            </div>

            {/* Contact */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Contact</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label>Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input {...register("phone")} inputMode="tel" placeholder={STAFF_PHONE_HINT} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Birthday <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <TallyDateInput value={birthday ?? ""} onValueChange={(iso) => setValue("birthday", iso, { shouldValidate: true })} />
                    </div>
                </div>
            </div>

            {/* Social */}
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Social Media</h3>
                <div className="space-y-3">
                    {([
                        { name: "linkedIn" as const, label: "LinkedIn", placeholder: "linkedin.com/in/yourname" },
                        { name: "twitter" as const, label: "Twitter/X", placeholder: "twitter.com/yourhandle" },
                        { name: "instagram" as const, label: "Instagram", placeholder: "instagram.com/yourhandle" },
                        { name: "facebook" as const, label: "Facebook", placeholder: "facebook.com/yourprofile" },
                    ]).map(({ name, label, placeholder }) => (
                        <div key={name} className="flex items-center gap-2">
                            <span className="w-20 shrink-0 text-xs text-muted-foreground font-medium">{label}</span>
                            <Input {...register(name)} placeholder={placeholder} className="flex-1" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={saving || uploading || coverUploading}>{saving ? "Saving…" : "Save Profile"}</Button>
            </div>
        </form>
    );
}
