"use client";

import Link from "next/link";
import { Info, Users } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { formatDate } from "@/shared/lib/format/formatDate";
import { SCOPE_LABELS, userProfileHref, type UserProfile } from "./profileTypes";

export default function ProfileSidebar({ profile }: { profile: UserProfile }) {
    return (
        <aside className="w-56 shrink-0 space-y-4">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="border-b border-border bg-muted/40 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <Info size={11} /> Info
                    </span>
                </div>
                <div className="px-3 py-3 space-y-2.5 text-xs">
                    {profile.manager && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Reports to</p>
                            <Link href={userProfileHref(profile.manager.id)}
                                className="font-medium text-foreground hover:text-primary flex items-center gap-1.5 transition-colors">
                                <UserAvatar avatarUrl={profile.manager.avatarUrl} name={profile.manager.name} role={profile.manager.role} sizePx={18} />
                                {profile.manager.name}
                            </Link>
                        </div>
                    )}
                    {profile.departments.length > 0 && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Department</p>
                            <p className="font-medium text-foreground">{profile.departments.map(d => d.name).join(", ")}</p>
                        </div>
                    )}
                    {profile.branches.length > 0 && (
                        <div>
                            <p className="text-muted-foreground mb-0.5">Branch</p>
                            <p className="font-medium text-foreground">{profile.branches.map(b => b.name).join(", ")}</p>
                        </div>
                    )}
                    <div>
                        <p className="text-muted-foreground mb-0.5">Member since</p>
                        <p className="font-medium text-foreground">{formatDate(profile.createdAt)}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Scope</p>
                        <p className="font-medium text-foreground">{SCOPE_LABELS[profile.scope] ?? profile.scope}</p>
                    </div>
                </div>
            </div>

            {profile.reports.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="border-b border-border bg-muted/40 px-3 py-2">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                            <Users size={11} /> Team ({profile.reports.length})
                        </span>
                    </div>
                    <div className="p-3 grid grid-cols-3 gap-2">
                        {profile.reports.slice(0, 9).map(r => (
                            <Link key={r.id} href={userProfileHref(r.id)} className="flex flex-col items-center gap-1 text-center group">
                                <UserAvatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={40}
                                    className="group-hover:ring-2 group-hover:ring-primary transition-all" />
                                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors leading-tight truncate w-full text-center">
                                    {r.name.split(" ")[0]}
                                </span>
                            </Link>
                        ))}
                    </div>
                    {profile.reports.length > 9 && (
                        <div className="border-t border-border px-3 py-2 text-center">
                            <span className="text-[11px] text-muted-foreground">+{profile.reports.length - 9} more</span>
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}
