"use client";

// /office/user/[id] — a colleague's profile: the wall, who they are, where
// they sit, and (for an admin) the security, personal and pay tabs HR keeps.
//
// Your OWN id does not belong here: it sends you to the Employee Portal at
// /office/me, where the same profile sits under your career information.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    Activity, ArrowLeft, CreditCard, GitBranch, Home, IdCard, Info, Lock, MessageSquare,
    PanelRightClose, PanelRightOpen, Receipt, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffPersonalForm from "@/modules/hr/components/StaffPersonalForm";
import StaffPayslips from "@/modules/hr/components/StaffPayslips";
import StaffIdCardTab from "@/modules/hr/components/StaffIdCardTab";
import ProfileHeader from "@/modules/social/components/ProfileHeader";
import ProfileSidebar from "@/modules/social/components/ProfileSidebar";
import WallTab from "@/modules/social/components/WallTab";
import AboutTab from "@/modules/social/components/AboutTab";
import ActivityTimelineTab from "@/modules/social/components/ActivityTimelineTab";
import SecurityTab from "@/modules/social/components/SecurityTab";
import OrgPositionTab from "@/modules/social/components/OrgPositionTab";
import FriendsTab from "@/modules/social/components/FriendsTab";
import { MY_PORTAL_HREF, type UserProfile } from "@/modules/social/components/profileTypes";

const TABS = [
    { id: "wall", label: "Wall", icon: MessageSquare, access: "all" },
    { id: "about", label: "About", icon: Info, access: "all" },
    { id: "activity", label: "Activity Timeline", icon: Activity, access: "all" },
    { id: "org", label: "Org Position", icon: GitBranch, access: "all" },
    { id: "friends", label: "Friends", icon: Users, access: "all" },
    // The printable staff identity card carries nothing About does not show.
    { id: "id-card", label: "ID Card", icon: CreditCard, access: "all" },
    // What an admin (users:edit) may keep for a colleague.
    { id: "security", label: "Security", icon: Lock, access: "admin" },
    { id: "personal", label: "Personal & Bank", icon: IdCard, access: "admin" },
    { id: "payslips", label: "Salary Slips", icon: Receipt, access: "admin" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function UserProfilePage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { data: session } = useSession();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabId>("wall");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [focusWall, setFocusWall] = useState(false);

    const sessionUserId = session?.user ? Number((session.user as { id?: string }).id) : undefined;
    const isSelf = sessionUserId !== undefined && sessionUserId === Number(id);
    const sessionPermissions = (session?.user as { permissions?: string[] })?.permissions ?? [];
    const isAdmin = sessionPermissions.includes("users:edit") || sessionPermissions.includes("admin:bypass");
    const canEditHr = hasPermissionWithScope(sessionPermissions, PERMISSIONS.HR_STAFF_EDIT);
    const canOpenHr = hasModuleNavAccess(sessionPermissions, "hr");

    useEffect(() => { if (isSelf) router.replace(MY_PORTAL_HREF); }, [isSelf, router]);

    useEffect(() => {
        let alive = true;
        Promise.resolve().then(() => { if (alive) { setLoading(true); setActiveTab("wall"); } });
        axios.get<UserProfile>(`/api/users/${id}`)
            .then(r => { if (alive) setProfile(r.data); })
            .catch(e => { if (!axios.isAxiosError(e) || e.response?.status !== 404) toast.error("Failed to load profile"); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [id]);

    function handleWriteOnWall() {
        setActiveTab("wall");
        setFocusWall(true); setTimeout(() => setFocusWall(false), 300);
    }

    const visibleTabs = TABS.filter(t => t.access === "all" || isAdmin);

    if (loading || isSelf) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading profile…</div>;
    if (!profile) return (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-muted-foreground">User not found.</p>
            <Button asChild variant="outline" size="sm">
                <Link href="/office/admin/users"><ArrowLeft size={14} /> Back to Users</Link>
            </Button>
        </div>
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="p-4">
            <div className="flex items-center gap-2 mb-4 print:hidden">
                <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    <Link href="/office/admin/users"><ArrowLeft size={14} /> All Users</Link>
                </Button>
            </div>

            <ProfileHeader profile={profile} isSelf={false} onWriteOnWall={handleWriteOnWall} />

            <div className="print:hidden">
                <div className="mb-5 flex items-start border-b border-border">
                    <div className="flex flex-1 flex-wrap">
                        {sessionUserId !== undefined && (
                            <Button asChild variant="ghost"
                                className="h-auto flex items-center gap-1.5 rounded-none px-2.5 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border whitespace-nowrap shrink-0"
                                title="My portal">
                                <Link href={MY_PORTAL_HREF}><Home size={13} /><span>My Portal</span></Link>
                            </Button>
                        )}
                        {visibleTabs.map(tab => {
                            const Icon = tab.icon;
                            const active = activeTab === tab.id;
                            return (
                                <Button key={tab.id} onClick={() => setActiveTab(tab.id)} variant="ghost"
                                    className={[
                                        "h-auto flex items-center gap-1.5 rounded-none px-2.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0",
                                        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                                    ].join(" ")}>
                                    <Icon size={13} />
                                    <span>{tab.label}</span>
                                </Button>
                            );
                        })}
                    </div>
                    <div className="flex items-stretch shrink-0 self-start border-l border-border">
                        <Button onClick={() => setSidebarOpen(prev => !prev)} variant="ghost"
                            className="h-auto rounded-none px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground"
                            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
                            {sidebarOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                            <span className="hidden sm:inline">{sidebarOpen ? "Hide" : "Info"}</span>
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex gap-5 items-start">
                <div className="flex-1 min-w-0">
                    {activeTab === "wall" && <WallTab profile={profile} sessionUserId={sessionUserId} focusInput={focusWall} />}
                    {activeTab === "about" && <AboutTab profile={profile} />}
                    {activeTab === "activity" && <ActivityTimelineTab profileId={profile.id} />}
                    {activeTab === "org" && <OrgPositionTab />}
                    {activeTab === "friends" && <FriendsTab userId={profile.id} />}
                    {activeTab === "id-card" && <StaffIdCardTab userId={profile.id} />}
                    {activeTab === "security" && isAdmin && <SecurityTab profileId={profile.id} isSelf={false} />}
                    {activeTab === "personal" && isAdmin && (
                        <StaffPersonalForm userId={profile.id} canEdit={canEditHr} hrHref={canOpenHr ? `/office/hr/staff?user=${profile.id}` : null} />
                    )}
                    {activeTab === "payslips" && isAdmin && <StaffPayslips userId={profile.id} />}
                </div>
                {sidebarOpen && (
                    <div className="hidden lg:block">
                        <ProfileSidebar profile={profile} />
                    </div>
                )}
            </div>
        </div>
        </ScrollArea>
    );
}
