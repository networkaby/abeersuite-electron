"use client";

// Gives every office page a colour identity: a soft wash of the active
// module's hue at the top of the content area, fading into the plain page
// background within ~220px. Pair it with the sidebar — you land on a page and
// the colour already tells you which module you are in, before you read a word.
//
// Deliberately restrained: the wash sits UNDER the content, tops out at 9% of
// the hue, and is gone by the time the first table row starts. Data keeps its
// own colour vocabulary (see gridRow.ts) and is never tinted by the module.
//
// Pages outside any module (login-adjacent shells, one-off tools) get the plain
// background — no hue is more honest than a wrong hue.

import { usePathname } from "next/navigation";
import { getActiveModuleKey } from "@/utils/active-module";
import { moduleColor } from "@/shared/lib/format/moduleTheme";

export default function ModuleSurface({ children }: { children: React.ReactNode }) {
    const moduleKey = getActiveModuleKey(usePathname());

    return (
        <div
            className="h-full w-full"
            style={
                moduleKey
                    ? {
                        backgroundImage: `linear-gradient(to bottom, color-mix(in oklab, ${moduleColor(
                            moduleKey,
                        )} 9%, var(--background)) 0px, var(--background) 220px)`,
                    }
                    : undefined
            }
        >
            {children}
        </div>
    );
}
