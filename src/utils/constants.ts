import type { LucideIcon } from "lucide-react";
import {
    ClipboardList,
    Users,
    Building2,
    UserCog,
    Settings,
    ShieldCheck,
    GitBranch,
    Wrench,
    Plus,
    FileText,
    Calculator,
    Bell,
} from "lucide-react";

// Keys match the Priority enum: LOW | MEDIUM | HIGH | URGENT
export const PRIORITY_META: Record<string, { label: string; color: string }> = {
    LOW:    { label: "Low",    color: "bg-gray-100 text-gray-500" },
    MEDIUM: { label: "Normal", color: "bg-blue-50 text-blue-500" },
    HIGH:   { label: "High",   color: "bg-orange-100 text-orange-500" },
    URGENT: { label: "Urgent", color: "bg-red-100 text-red-600" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type NavItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    permission?: string | null;
};

export type ModuleChild = {
    label: string;
    icon: LucideIcon;
    href?: string;
    action?: "new-ticket";
    // "default" resolves to the pipeline where isDefault === true from /api/pipelines
    pipelineRef?: "default";
    permission?: string;
    disabled?: boolean;
};

export type ModuleSection = {
    label: string;
    icon: LucideIcon;
    key: string;
    disabled?: boolean;
    children: ModuleChild[];
};

export type SettingsNavItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    permission: string;
};

export type ButtonBarAction = {
    label: string;
    subtitle: string;
    icon: LucideIcon;
    variant: "default" | "outline";
    action: "new-ticket";
    pipelineRef?: "default";
    disabled?: boolean;
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export const WORKSPACE_NAV: NavItem[] = [
    { label: "Inbox",          href: "/inbox",       icon: Bell,          permission: null },
    { label: "My Assignments", href: "/assignments", icon: ClipboardList, permission: null },
    { label: "Customers",      href: "/customers",   icon: Users,         permission: "customers:view" },
    { label: "Companies",      href: "/companies",   icon: Building2,     permission: "customers:view" },
];

export const MODULE_SECTIONS: ModuleSection[] = [
    {
        label: "Repair & Warranty",
        icon: Wrench,
        key: "repair",
        children: [
            { label: "New Repair +",    icon: Plus,          action: "new-ticket", pipelineRef: "default" },
            { label: "All Repair",      icon: ClipboardList, href: "/tickets",     pipelineRef: "default" },
            { label: "Service Centers", icon: Building2,     href: "/service-centers", permission: "service-centers:view" },
        ],
    },
    {
        label: "Tally",
        icon: Calculator,
        key: "tally",
        disabled: true,
        children: [
            { label: "Dummy1", icon: FileText, href: "/tally/dummy1", disabled: true },
            { label: "Dummy2", icon: FileText, href: "/tally/dummy2", disabled: true },
        ],
    },
];

export const SETTINGS_NAV: SettingsNavItem[] = [
    { label: "Users",        href: "/settings/users",        icon: UserCog,     permission: "users:manage" },
    { label: "Statuses",     href: "/settings/statuses",     icon: Settings,    permission: "settings:statuses" },
    { label: "Sub-Statuses", href: "/settings/sub-statuses", icon: Settings,    permission: "settings:statuses" },
    { label: "Pipelines",    href: "/settings/pipelines",    icon: GitBranch,   permission: "settings:pipelines" },
    { label: "Roles",        href: "/settings/roles",        icon: ShieldCheck, permission: "roles:manage" },
];

// ─── ButtonBar ────────────────────────────────────────────────────────────────

export const BUTTON_BAR_ACTIONS: ButtonBarAction[] = [
    {
        label:        "Repair +",
        subtitle:     "Open repair intake",
        icon:         Wrench,
        variant:      "default",
        action:       "new-ticket",
        pipelineRef:  "default",
    },
    {
        label:    "Dummy Create +",
        subtitle: "Coming soon",
        icon:     Plus,
        variant:  "outline",
        action:   "new-ticket",
        disabled: true,
    },
    {
        label:    "Dummy Create2 +",
        subtitle: "Coming soon",
        icon:     Plus,
        variant:  "outline",
        action:   "new-ticket",
        disabled: true,
    },
];
