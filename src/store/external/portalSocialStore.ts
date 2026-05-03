import { create } from "zustand";
import { persist } from "zustand/middleware";

type PortalSocialState = {
    joined: boolean;
    nickname: string;
    join: (nickname: string) => void;
    reset: () => void;
};

export const usePortalSocialStore = create<PortalSocialState>()(
    persist(
        (set) => ({
            joined: false,
            nickname: "",
            join: (nickname) => set({ joined: true, nickname }),
            reset: () => set({ joined: false, nickname: "" }),
        }),
        { name: "portal-social-onboarding-v1" }
    )
);

