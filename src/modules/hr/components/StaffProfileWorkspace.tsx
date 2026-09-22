"use client";

// One staff member's HR profile — Job / Access / Personal / Pay / Money.
//
// Owner, 2026-09-20: HR does not send you to Administration. The seat, the role
// and the initial personal / bank details are all filled in here; Administration
// remains where roles, permissions and positions are DEFINED, and this workspace
// is where a person is given them. The person keeps their own personal and bank
// details current on their profile page — the same form is shown here so HR can
// put the first copy on file at hiring.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
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
import StaffSeatsCard from "./StaffSeatsCard";
import StaffAccessTab from "./StaffAccessTab";
import StaffPersonalForm from "./StaffPersonalForm";
import StaffPayTab from "./StaffPayTab";
import StaffMoneyTab from "./StaffMoneyTab";
import StaffIdCardTab from "./StaffIdCardTab";
import AppointStaffDialog from "./AppointStaffDialog";

const TABS = ["job", "access", "personal", "pay", "money", "identity"] as const;
type Tab = (typeof TABS)[number];

export default function StaffProfileWorkspace({ userId, canEdit, canEditUsers, canEditPositions, embedded = false }: {
    userId: number;
    /** hr:staff:edit — the HR record itself. */
    canEdit: boolean;
    /** users:edit — the role, scope, manager and password on the Access tab. */
    canEditUsers: boolean;
    /** positions:edit — appointing to and vacating a seat. */
    canEditPositions: boolean;
    /** Inside StaffExplorer's right pane: the list is already on screen, so the
     *  "back to the directory" button goes, and the pane does its own scrolling
     *  rather than this being a second ScrollArea inside one. */
    embedded?: boolean;
}) {
    const url = `/api/hr/staff/${userId}`;
    const { data, loading, error, reload } = useApiResource<StaffDetail>(url);
    useRealtimeTopics(["settings"], reload);
    const [tab, setTab] = useState<Tab>("job");
    const [appointing, setAppointing] = useState(false);

    const body = (
            <div className="px-6 pt-3 pb-8">
                {!embedded && (
                    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
                        <Link href="/office/hr/staff"><ArrowLeft size={14} /> Staff Directory</Link>
                    </Button>
                )}

                <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

                {data && (
                    <>
                        <Header
                            detail={data}
                            canAppoint={canEdit}
                            onAppoint={() => setAppointing(true)}
                        />

                        {appointing && (
                            <AppointStaffDialog
                                detail={data}
                                canAppointSeat={canEditPositions}
                                onClose={() => setAppointing(false)}
                                onDone={() => { setAppointing(false); reload(); }}
                            />
                        )}
                        <ModuleTabs module="hr" tabs={TABS} active={tab} onChange={setTab} className="mt-4 rounded-t-lg border border-b-0" />
                        <div className="rounded-b-lg border border-border bg-card p-5">
                            {tab === "job" && (
                                <div className="space-y-6">
                                    <StaffJobTab url={url} detail={data} canEdit={canEdit} onChanged={reload} />
                                    <StaffSeatsCard detail={data} canEdit={canEditPositions} onChanged={reload} />
                                </div>
                            )}
                            {tab === "access" && <StaffAccessTab detail={data} canEdit={canEditUsers} onChanged={reload} />}
                            {/* The same form the person sees on their own profile page —
                                HR puts the first copy on file, they keep it current. */}
                            {tab === "personal" && <StaffPersonalForm userId={userId} canEdit={canEdit} />}
                            {tab === "pay" && <StaffPayTab url={url} detail={data} canEdit={canEdit} onChanged={reload} />}
                            {tab === "money" && <StaffMoneyTab detail={data} />}
                            {/* The printable staff ID card — same card the person sees on their own profile. */}
                            {tab === "identity" && <StaffIdCardTab userId={userId} />}
                        </div>
                    </>
                )}
            </div>
    );

    if (embedded) return body;
    return <ScrollArea className="h-full" type="always">{body}</ScrollArea>;
}

function Header({ detail, canAppoint, onAppoint }: {
    detail: StaffDetail;
    canAppoint: boolean;
    onAppoint: () => void;
}) {
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
            {/* One action only. Everything that used to link out to Administration
                now lives on the tabs below. Hidden once an active staff member is
                already appointed — Job/Pay tabs cover edits from there. Only a new
                hire (no joinedOn) or a rejoin (left) needs this dialog. */}
            {canAppoint && (left || !profile?.joinedOn) && (
                <Button type="button" variant="outline" size="sm" onClick={onAppoint}>
                    <UserPlus size={14} /> {left ? "Re-appoint" : "Appoint"}
                </Button>
            )}
        </div>
    );
}
