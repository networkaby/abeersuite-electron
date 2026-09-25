"use client";

// A staff member's friends = the joined customers (implicit model). Cards link to
// the office customer profile (the portal profile is customer-gated).

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Users } from "lucide-react";
import UserAvatar from "@/shared/components/UserAvatar";
import { userProfileHref } from "./profileTypes";

interface SocialFriend {
    kind: "USER" | "PERSON"; id: number; name: string; avatarUrl: string | null;
    role: string | null; roleBadge: { label: string; color: string } | null; isCustomer: boolean;
}

export default function FriendsTab({ userId }: { userId: number }) {
    const [friends, setFriends] = useState<SocialFriend[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<SocialFriend[]>(`/api/users/${userId}/friends`)
            .then((r) => setFriends(r.data))
            .catch(() => toast.error("Failed to load friends"))
            .finally(() => setLoading(false));
    }, [userId]);

    if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading friends…</p>;
    if (friends.length === 0) {
        return (
            <div className="border-2 border-dashed border-border bg-card/50 py-12 text-center">
                <Users size={28} className="mx-auto text-muted-foreground/65" />
                <p className="mt-1 text-sm text-muted-foreground">No friends yet.</p>
            </div>
        );
    }
    return (
        <div className="max-w-3xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{friends.length} friend{friends.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {friends.map((f) => (
                    <Link
                        key={`${f.kind}-${f.id}`}
                        href={f.kind === "USER" ? userProfileHref(f.id) : `/office/customers/all?personId=${f.id}`}
                        className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
                    >
                        <UserAvatar avatarUrl={f.avatarUrl} name={f.name} role={f.role} sizePx={36} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{f.name}</p>
                            <p className="text-[11px] text-muted-foreground">{f.isCustomer ? "Customer" : (f.roleBadge?.label ?? "Staff")}</p>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
