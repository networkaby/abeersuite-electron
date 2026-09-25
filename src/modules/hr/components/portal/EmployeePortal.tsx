"use client";

// The Employee Portal — /office/me. One page for the signed-in person's whole
// working life: overview, work, leave, pay, then the person themselves, and the
// social wall last where it cannot distract from the career information.
//
// Owner, 2026-09-26: "users own tool/utilise are not one place — keep them as
// united so user can see his leave application, remaining leave, attendance /
// activity, targets, penalty, i card, payslip etc. … social also somewhere but
// it should not distract user from official career information."
//
// Everything here is about the signed-in person and nobody else: `/api/hr/me`
// never takes a userId, and the two routes that do (`/api/hr/staff/{id}`,
// `/api/users/{id}`) are given the session's own id by the server page.

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModuleTabs } from "@/shared/components/ModuleTabs";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { todayIso } from "@/shared/lib/format/formatDate";
import ProfileHeader from "@/modules/social/components/ProfileHeader";
import ProfileSidebar from "@/modules/social/components/ProfileSidebar";
import type { UserProfile } from "@/modules/social/components/profileTypes";
import type { MyHrPayload } from "../../lib/myHrTypes";
import type { StaffDetail } from "../../lib/staffTypes";
import { LeaveDialog } from "../LeaveBoard";
import PortalOverview from "./PortalOverview";
import PortalWork from "./PortalWork";
import PortalLeave from "./PortalLeave";
import PortalPay from "./PortalPay";
import PortalMe from "./PortalMe";
import PortalSocial from "./PortalSocial";
import { GROUPS, VIEWS, type Group, type PortalNav } from "./portalNav";

export default function EmployeePortal({ userId, canPaySalary, canOpenHr }: {
    userId: number;
    /** hr:payroll:run — whether the Money view may offer "Pay salary / advance". */
    canPaySalary: boolean;
    /** Any HR sidebar tick — whether Personal & Bank may link into the HR profile. */
    canOpenHr: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();

    // The open group and view live in the URL, so "Request leave" or "See your
    // payslip" links elsewhere can open the right place, and Back works.
    const group: Group = (GROUPS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Group) : "overview";
    const views = VIEWS[group];
    const view = views.includes(params.get("view") ?? "") ? (params.get("view") as string) : views[0] ?? null;
    const go = useCallback((g: Group, v?: string) => {
        const qs = new URLSearchParams();
        if (g !== "overview") qs.set("tab", g);
        const first = VIEWS[g][0];
        if (v && v !== first) qs.set("view", v);
        const s = qs.toString();
        router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    }, [router, pathname]);
    const nav: PortalNav = useMemo(() => ({ group, view, go }), [group, view, go]);

    const [month, setMonth] = useState(() => todayIso().slice(0, 7));
    const [filing, setFiling] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const profileRes = useApiResource<UserProfile>(`/api/users/${userId}`);
    const staffRes = useApiResource<StaffDetail>(`/api/hr/staff/${userId}`);
    const meRes = useApiResource<MyHrPayload>(`/api/hr/me?month=${month}`);
    const reloadAll = () => { profileRes.reload(); staffRes.reload(); meRes.reload(); };
    useRealtimeTopics(["settings"], meRes.reload);

    const profile = profileRes.data;
    const loading = profileRes.loading || staffRes.loading;
    const error = profileRes.error ?? staffRes.error;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="p-4">
                <QueryStateBlock loading={loading} error={error} hasData={!!profile} onRetry={reloadAll} />

                {profile && (
                    <>
                        <ProfileHeader
                            profile={profile}
                            isSelf
                            subtitle={meRes.data?.staffCode ?? staffRes.data?.profile?.staffCode ?? null}
                            primaryAction={
                                <Button size="sm" onClick={() => setFiling(true)}>
                                    <Plus size={14} /> Request leave
                                </Button>
                            }
                        />

                        <div className="mb-4 flex items-start print:hidden">
                            <ModuleTabs module="hr" tabs={GROUPS} active={group} onChange={(g) => go(g)} className="flex-1 border-b-0 bg-transparent px-0" />
                            <Button onClick={() => setSidebarOpen(prev => !prev)} variant="ghost"
                                className="h-auto rounded-none px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground"
                                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
                                {sidebarOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                                <span className="hidden sm:inline">{sidebarOpen ? "Hide" : "Info"}</span>
                            </Button>
                        </div>

                        <div className="flex gap-5 items-start">
                            <div className="flex-1 min-w-0">
                                {group === "overview" && (
                                    <PortalOverview userId={userId} me={meRes} staff={staffRes.data ?? null} nav={nav} onRequestLeave={() => setFiling(true)} />
                                )}
                                {group === "work" && (
                                    <PortalWork userId={userId} me={meRes} month={month} onMonth={setMonth} nav={nav} />
                                )}
                                {group === "leave" && (
                                    <PortalLeave me={meRes} onRequestLeave={() => setFiling(true)} />
                                )}
                                {group === "pay" && (
                                    <PortalPay userId={userId} me={meRes} staff={staffRes} month={month} onMonth={setMonth} nav={nav} canPaySalary={canPaySalary} />
                                )}
                                {group === "me" && (
                                    <PortalMe userId={userId} profile={profile} staff={staffRes} nav={nav} canOpenHr={canOpenHr}
                                        onProfileSaved={() => profileRes.reload()} />
                                )}
                                {group === "social" && (
                                    <PortalSocial profile={profile} nav={nav} />
                                )}
                            </div>
                            {sidebarOpen && (
                                <div className="hidden lg:block">
                                    <ProfileSidebar profile={profile} />
                                </div>
                            )}
                        </div>
                    </>
                )}

                {filing && (
                    <LeaveDialog
                        canPickPerson={false}
                        heldToNotice
                        onClose={() => setFiling(false)}
                        onSaved={() => { setFiling(false); meRes.reload(); go("leave"); }}
                    />
                )}
            </div>
        </ScrollArea>
    );
}
