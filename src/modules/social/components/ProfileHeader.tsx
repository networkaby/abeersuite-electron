"use client";

// The cover-and-avatar banner at the top of a person's page. Used by the
// Employee Portal (yourself) and a colleague's profile alike; the caller says
// which through `isSelf` and hands in the primary action.

import Image from "next/image";
import { Building2, MessageSquare, Pencil, Printer, Users } from "lucide-react";
import { imageLoaderFor } from "@/shared/lib/cloudinaryImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import UserAvatar from "@/shared/components/UserAvatar";
import { formatDate } from "@/shared/lib/format/formatDate";
import { coverBg, jobTitleOf, type UserProfile } from "./profileTypes";

export default function ProfileHeader({
    profile, isSelf, subtitle, onWriteOnWall, onEditProfile, primaryAction,
}: {
    profile: UserProfile; isSelf: boolean;
    /** A line under the name — the portal puts the staff code here. */
    subtitle?: string | null;
    onWriteOnWall?: () => void; onEditProfile?: () => void;
    /** Replaces the default "Edit Profile" button — the portal's "Request leave". */
    primaryAction?: React.ReactNode;
}) {
    return (
        <div className="relative border border-border/50 rounded-xl overflow-hidden mb-2 shadow-sm hover:shadow-md transition print:border-0">

            {/* Cover */}
            <div className="absolute inset-0 overflow-hidden print:hidden">
                {profile.coverUrl ? (
                    <Image src={profile.coverUrl} alt="Cover" fill className="object-cover" loader={imageLoaderFor(profile.coverUrl)} />
                ) : (
                    <div className="absolute inset-0" style={{ background: coverBg(profile.role) }} />
                )}
                <div className="absolute inset-0 bg-linear-to-b from-black/30 via-black/20 to-black/60" />
            </div>

            <div className="relative z-10 pt-20 sm:pt-28">
                <div className="bg-white/10 dark:bg-black/20 backdrop-blur-md px-4 sm:px-5 pb-4 rounded-b-xl border border-white/10">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4 -mt-10 sm:-mt-12">
                        <div className="shrink-0 rounded-full border-4 border-white shadow-lg ring-2 ring-black/10 self-start">
                            <UserAvatar avatarUrl={profile.avatarUrl} name={profile.name} role={profile.role} sizePx={88} />
                        </div>

                        <div className="flex-1 flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 min-w-0 sm:pb-1 pt-2 sm:pt-8">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h1 className="text-xl font-bold text-white leading-tight">{profile.name}</h1>
                                    {profile.userRole ? (
                                        <Badge className={`${profile.userRole.color} text-xs`}>{profile.userRole.label}</Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-xs text-white/70 border-white/30">No role assigned</Badge>
                                    )}
                                    {isSelf && (
                                        <span className="text-[10px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 font-medium rounded">You</span>
                                    )}
                                </div>
                                {(subtitle || jobTitleOf(profile)) && (
                                    <p className="text-sm text-white/80 mt-0.5">{[jobTitleOf(profile), subtitle].filter(Boolean).join(" · ")}</p>
                                )}
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                    {profile.departments.map(d => (
                                        <span key={d.id} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-200 border border-blue-500/20">{d.name}</span>
                                    ))}
                                    {profile.branches.map(b => (
                                        <span key={b.id} className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-200 border border-orange-500/20">{b.name}</span>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 print:hidden">
                                {primaryAction ?? (isSelf ? (
                                    <Button variant="secondary" size="sm" onClick={onEditProfile}>
                                        <Pencil size={13} /> Edit Profile
                                    </Button>
                                ) : (
                                    <Button size="sm" onClick={onWriteOnWall}>
                                        <MessageSquare size={13} /> Write on Wall
                                    </Button>
                                ))}
                                <Button variant="secondary" size="sm" onClick={() => window.print()} title="Print">
                                    <Printer size={13} />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white/10 dark:bg-black/20 backdrop-blur-md border-t border-white/10 px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/80 print:hidden">
                    <span className="flex items-center gap-1.5"><Building2 size={11} /> Joined {formatDate(profile.createdAt)}</span>
                    <span className="hidden sm:inline text-white/40">·</span>
                    <span className="flex items-center gap-1.5">
                        <Users size={11} /> {profile.reports.length} direct report{profile.reports.length !== 1 ? "s" : ""}
                    </span>
                    {profile.userRole && (
                        <>
                            <span className="hidden sm:inline text-white/40">·</span>
                            <span>Rank {profile.userRole.rank}</span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
