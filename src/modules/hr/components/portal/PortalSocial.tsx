"use client";

// Social — the wall, friends, activity timeline and about card, kept together
// at the end of the portal. Each tab reads for itself only when opened.

import AboutTab from "@/modules/social/components/AboutTab";
import ActivityTimelineTab from "@/modules/social/components/ActivityTimelineTab";
import FriendsTab from "@/modules/social/components/FriendsTab";
import WallTab from "@/modules/social/components/WallTab";
import type { UserProfile } from "@/modules/social/components/profileTypes";
import SubTabs from "./SubTabs";
import { VIEWS, type PortalNav } from "./portalNav";

export default function PortalSocial({ profile, nav }: { profile: UserProfile; nav: PortalNav }) {
    const view = nav.view ?? "wall";
    return (
        <div>
            <SubTabs tabs={VIEWS.social} active={view} onChange={(v) => nav.go("social", v)} />
            {view === "wall" && <WallTab profile={profile} sessionUserId={profile.id} focusInput={false} />}
            {view === "friends" && <FriendsTab userId={profile.id} />}
            {view === "activity" && <ActivityTimelineTab profileId={profile.id} />}
            {view === "about" && <AboutTab profile={profile} />}
        </div>
    );
}
