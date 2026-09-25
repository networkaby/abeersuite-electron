"use client";

import Link from "next/link";
import { Building2, Cake, ExternalLink, Mail, Phone, Users } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { formatDate } from "@/shared/lib/format/formatDate";
import { SCOPE_LABELS, ensureUrl, formatBirthday, userProfileHref, type UserProfile } from "./profileTypes";

export default function AboutTab({ profile }: { profile: UserProfile }) {
    const socials = [
        { key: "linkedIn", label: "LinkedIn", color: "bg-blue-600", href: profile.linkedIn },
        { key: "twitter", label: "Twitter/X", color: "bg-black", href: profile.twitter },
        { key: "instagram", label: "Instagram", color: "bg-pink-600", href: profile.instagram },
        { key: "facebook", label: "Facebook", color: "bg-blue-700", href: profile.facebook },
    ].filter(s => s.href);

    return (
        <div className="space-y-4 max-w-xl">
            {profile.bio && (
                <div className="rounded-lg border border-border bg-card px-5 py-4">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">About</h3>
                    <p className="text-sm text-foreground leading-relaxed">{profile.bio}</p>
                </div>
            )}
            <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Contact</h3>
                <div className="flex items-center gap-2 text-sm">
                    <Mail size={14} className="shrink-0 text-muted-foreground" />
                    <a href={`mailto:${profile.email}`} className="text-foreground hover:text-primary transition-colors">{profile.email}</a>
                </div>
                {profile.phone && (
                    <div className="flex items-center gap-2 text-sm">
                        <Phone size={14} className="shrink-0 text-muted-foreground" />
                        <a href={`tel:${profile.phone}`} className="text-foreground hover:text-primary transition-colors">{profile.phone}</a>
                    </div>
                )}
                {profile.birthday && (
                    <div className="flex items-center gap-2 text-sm">
                        <Cake size={14} className="shrink-0 text-muted-foreground" />
                        <span>{formatBirthday(profile.birthday)}</span>
                    </div>
                )}
            </div>
            <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Organisation</h3>
                {profile.manager && (
                    <div className="flex items-center gap-2 text-sm">
                        <Users size={14} className="shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">Reports to</span>
                        <Link href={userProfileHref(profile.manager.id)} className="font-medium hover:text-primary transition-colors flex items-center gap-1">
                            <UserAvatar avatarUrl={profile.manager.avatarUrl} name={profile.manager.name} role={profile.manager.role} sizePx={18} />
                            {profile.manager.name} <ExternalLink size={10} />
                        </Link>
                    </div>
                )}
                {profile.departments.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                            {profile.departments.map(d => (
                                <span key={d.id} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5">{d.name}</span>
                            ))}
                        </div>
                    </div>
                )}
                {profile.branches.length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                        <div className="flex flex-wrap gap-1">
                            {profile.branches.map(b => (
                                <span key={b.id} className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5">{b.name}</span>
                            ))}
                        </div>
                    </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                    <Building2 size={14} className="shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Scope:</span>
                    <span className="font-medium">{SCOPE_LABELS[profile.scope] ?? profile.scope}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <Building2 size={14} className="shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Member since</span>
                    <span className="font-medium">{formatDate(profile.createdAt)}</span>
                </div>
            </div>
            {socials.length > 0 && (
                <div className="rounded-lg border border-border bg-card px-5 py-4">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Social</h3>
                    <div className="flex flex-wrap gap-2">
                        {socials.map(({ key, label, color, href }) => (
                            <a key={key} href={ensureUrl(href!)} target="_blank" rel="noopener noreferrer"
                                className={`flex items-center gap-1.5 text-xs text-white px-3 py-1.5 ${color} hover:opacity-90 transition-opacity`}>
                                <ExternalLink size={11} /> {label}
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
