"use client";

// Me — the job as HR keeps it (read-only), the personal and bank details the
// person keeps current, the ID card, the public profile, and security.

import { GitBranch } from "lucide-react";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { Section } from "@/shared/components/StatCard";
import { useApiResource } from "@/shared/hooks";
import EditProfileTab from "@/modules/social/components/EditProfileTab";
import OrgPositionTab from "@/modules/social/components/OrgPositionTab";
import SecurityTab from "@/modules/social/components/SecurityTab";
import type { UserProfile } from "@/modules/social/components/profileTypes";
import type { StaffDetail } from "../../lib/staffTypes";
import StaffIdCardTab from "../StaffIdCardTab";
import StaffJobTab from "../StaffJobTab";
import StaffPersonalForm from "../StaffPersonalForm";
import StaffSeatsCard from "../StaffSeatsCard";
import SubTabs from "./SubTabs";
import { VIEWS, type PortalNav } from "./portalNav";

export default function PortalMe({ userId, profile, staff, nav, canOpenHr, onProfileSaved }: {
    userId: number; profile: UserProfile;
    staff: ReturnType<typeof useApiResource<StaffDetail>>;
    nav: PortalNav; canOpenHr: boolean; onProfileSaved: () => void;
}) {
    const view = nav.view ?? "job";
    const url = `/api/hr/staff/${userId}`;

    return (
        <div>
            <SubTabs tabs={VIEWS.me} active={view} onChange={(v) => nav.go("me", v)} />

            {view === "job" && (
                <div className="space-y-6">
                    <QueryStateBlock loading={staff.loading} error={staff.error} hasData={!!staff.data} onRetry={staff.reload} />
                    {staff.data && (
                        <>
                            <StaffJobTab url={url} detail={staff.data} canEdit={false} onChanged={staff.reload} />
                            <StaffSeatsCard detail={staff.data} canEdit={false} onChanged={staff.reload} />
                            <Section title="Where I sit in the organisation" icon={<GitBranch size={15} />}>
                                <OrgPositionTab />
                            </Section>
                        </>
                    )}
                </div>
            )}

            {view === "personal" && (
                <StaffPersonalForm userId={userId} canEdit hrHref={canOpenHr ? `/office/hr/staff?user=${userId}` : null} />
            )}

            {view === "id card" && <StaffIdCardTab userId={userId} />}

            {view === "profile" && <EditProfileTab profile={profile} onSaved={onProfileSaved} />}

            {view === "security" && <SecurityTab profileId={userId} isSelf />}
        </div>
    );
}
