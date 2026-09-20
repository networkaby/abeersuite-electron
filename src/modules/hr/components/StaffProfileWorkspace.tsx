"use client";

// One staff member's HR profile — Job / Pay / Money. Personal and bank details
// stay on the person's own profile page (they keep those current themselves);
// this workspace is the HR side: the job, what they are paid, and what the
// books say is owed to them.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, IdCard, KeyRound, UserCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import UserAvatar from "@/shared/components/UserAvatar";
import { ModuleTabs } from "@/shared/components/ModuleTabs";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { positionScopeLabel } from "@/shared/lib/org/positionScope";
import type { StaffDetail } from "../lib/staffTypes";
import StaffJobTab from "./StaffJobTab";
import StaffPayTab from "./StaffPayTab";
import StaffMoneyTab from "./StaffMoneyTab";

const TABS = ["job", "pay", "money"] as const;
type Tab = (typeof TABS)[number];

export default function StaffProfileWorkspace({ userId, canEdit }: { userId: number; canEdit: boolean }) {
    const url = `/api/hr/staff/${userId}`;
    const { data, loading, error, reload } = useApiResource<StaffDetail>(url);
    useRealtimeTopics(["settings"], reload);
    const [tab, setTab] = useState<Tab>("job");

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-8">
                <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
                    <Link href="/office/hr/staff"><ArrowLeft size={14} /> Staff Directory</Link>
                </Button>

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <>
                        <Header detail={data} />
                        <ModuleTabs module="hr" tabs={TABS} active={tab} onChange={setTab} className="mt-4 rounded-t-lg border border-b-0" />
                        <div className="rounded-b-lg border border-border bg-card p-5">
                            {tab === "job" && <StaffJobTab url={url} detail={data} canEdit={canEdit} onChanged={reload} />}
                            {tab === "pay" && <StaffPayTab url={url} detail={data} canEdit={canEdit} onChanged={reload} />}
                            {tab === "money" && <StaffMoneyTab detail={data} />}
                        </div>
                    </>
                )}
            </div>
        </ScrollArea>
    );
}

function Header({ detail }: { detail: StaffDetail }) {
    const { user, profile } = detail;
    const left = staffHasLeft(profile);
    return (
        <div className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-card p-5">
            <UserAvatar avatarUrl={user.avatarUrl} name={user.name} role={user.role} sizePx={64} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold tracking-tight">{user.name}</h1>
                    {left ? (
                        <Badge variant="outline" className="text-muted-foreground">Left {profile?.leftOn ? formatDate(profile.leftOn) : ""}</Badge>
                    ) : profile ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">Active</Badge>
                    ) : (
                        <Badge variant="outline" className="text-muted-foreground">No HR record yet</Badge>
                    )}
                </div>
                <p className="text-sm text-muted-foreground">
                    {[profile?.staffCode, user.email, user.phone].filter(Boolean).join(" · ")}
                </p>
                {/* Every seat under the name, with where it sits — the counter card's line. */}
                {user.positions.length > 0 && (
                    <ul className="mt-1 text-sm">
                        {user.positions.map((p) => (
                            <li key={p.id}>
                                <span className="font-medium">{p.title}</span>
                                <span className="text-muted-foreground"> · {positionScopeLabel(p, { withDepartment: true })}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {profile?.joinedOn && (
                    <p className="mt-1 text-xs text-muted-foreground">Joined {formatDate(profile.joinedOn)}</p>
                )}
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
                <Button asChild variant="outline" size="sm">
                    <Link href={`/office/social/users/${user.id}`}><UserCircle size={14} /> Personal &amp; bank <ExternalLink size={12} className="text-muted-foreground" /></Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                    <Link href="/office/admin/users"><KeyRound size={14} /> Login &amp; permissions</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                    <Link href="/office/admin/positions"><IdCard size={14} /> Seats</Link>
                </Button>
            </div>
        </div>
    );
}
