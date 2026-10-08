"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import PortalPasswordCard from "@/modules/external/portal/PortalPasswordCard";
import PortalPushCard from "@/modules/external/pwa/PortalPushCard";
import ProfileIdentityCard from "@/modules/external/portal/profile/ProfileIdentityCard";
import ProfileAccountsCard from "@/modules/external/portal/profile/ProfileAccountsCard";
import ProfileContactsCard from "@/modules/external/portal/profile/ProfileContactsCard";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

/** My Profile — who you are, your profiles, your contacts, your password.
 *  `bare`: inside the customer app, which has its own header; the website's
 *  notification card is left out there (the app gets its own notifications). */
export default function PortalProfileView({ bare = false }: { bare?: boolean }) {
    const { profile, loaded, load } = usePortalAccountStore();

    useEffect(() => {
        load().catch(() => toast.error("Failed to load your profile"));
    }, [load]);

    return (
        <main className={bare ? "px-3 py-3" : "px-4 py-6 md:px-6 md:py-8"}>
            <div className="mx-auto max-w-5xl space-y-5">
                {!bare && (
                    <PortalSectionHeader
                        title="My Profile"
                        description="Your photo, details, contacts and the profile you shop with."
                        icon={UserRound}
                    />
                )}
                {!loaded || !profile ? (
                    <div className="space-y-5">
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <div className="grid gap-5 lg:grid-cols-2">
                            <Skeleton className="h-40 rounded-xl" />
                            <Skeleton className="h-40 rounded-xl" />
                        </div>
                    </div>
                ) : (
                    <>
                        <ProfileIdentityCard profile={profile} />
                        <ProfileAccountsCard />
                        {!bare && <PortalPushCard />}
                        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
                            <ProfileContactsCard profile={profile} />
                            <PortalPasswordCard />
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
