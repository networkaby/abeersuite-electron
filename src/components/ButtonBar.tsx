"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Search, UserPlus, ArrowRight, ShieldCheck, Wrench, Building2, User, LucidePlus } from "lucide-react";
type ActionItem =
    | {
        label: string;
        type: "link";
        href: string;
    }
    | {
        label: string;
        type: "action";
        onClick: () => void;
    };


type UserType = {
    name?: string | null;
    role?: string;
    roles?: string[];
    permissions?: string[];
};

export default function ButtonBar({ user }: { user?: UserType }) {



    // 👉 SAMPLE DATA (edit this freely)
    const ACTIONS: ActionItem[] = [
        {
            label: " Repair",
            type: "action",
            icon: LucidePlus,
            variant: "default",
            onClick: () => console.log("Create Ticket"),
        },



    ];

    return (
        <div className="w-36 bg-white border-l flex flex-col">
            {/* Header */}
            <div className="p-4 border-b">
                <h2 className="text-sm font-semibold text-gray-600">Actions</h2>
                <p className="text-xs text-gray-400">{user?.name}</p>
            </div>

            {/* Buttons */}
            <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                {ACTIONS.map((item, index) => {
                    const Icon = item.icon;

                    if (item.type === "link") {
                        return (
                            <Button
                                key={index}
                                asChild
                                variant={item.variant || "Primary"}
                                className="w-full justify-start gap-2"
                            >
                                <Link href={item.href}>
                                    <Icon size={16} />
                                    {item.label}
                                </Link>
                            </Button>
                        );
                    }

                    return (
                        <Button
                            key={index}
                            onClick={item.onClick}
                            variant={item.variant || "default"}
                            className="w-full justify-start gap-2"
                        >
                            <Icon size={16} />
                            {item.label}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}