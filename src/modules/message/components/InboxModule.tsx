"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Users2, Monitor, User, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import TeamRoomPane, { dmPartnerId, type Room, type RoomType } from "./TeamRoomPane";

// ── Types ──────────────────────────────────────────────────────────────────────

type TeamUser = {
    id: number;
    name: string;
    role: string;
    userRole: { label: string; color: string };
};

/** Derive a display name for a DM room from the room key + current user id. */
function dmPartnerName(room: Room, currentUserId: number, teamUsers: TeamUser[]): string {
    const partnerId = dmPartnerId(room, currentUserId);
    if (partnerId === currentUserId) return "You (notes to self)";
    return teamUsers.find((u) => u.id === partnerId)?.name ?? room.name;
}

// ── Component ──────────────────────────────────────────────────────────────────

function SectionLabel({
    icon: Icon,
    label,
    unread,
}: { icon: React.ElementType; label: string; unread: number }) {
    return (
        <div className="flex items-center gap-2 px-3 pt-4 pb-1">
            <Icon size={11} className="text-muted-foreground/60" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {label}
            </span>
            {unread > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                    {unread}
                </span>
            )}
        </div>
    );
}

function RoomRow({ room, displayName, active, onPick }: {
    room: Room; displayName: string; active: boolean; onPick: (id: string) => void;
}) {
    const prefix =
        room.type === "DIRECT_MESSAGE" ? "@" :
        room.type === "SYSTEM_INBOX"   ? "" : "#";
    return (
        <Button
            type="button"
            variant="ghost"
            onClick={() => onPick(room.id)}
            className={[
                "h-auto w-full items-center gap-2 justify-start px-3 py-1.5 text-sm transition-colors",
                active
                    ? "bg-primary/15 text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ].join(" ")}
        >
            <span className="truncate">
                {prefix}{displayName}
            </span>
            {room.unreadCount > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                    {room.unreadCount}
                </span>
            )}
        </Button>
    );
}

export default function InboxModule({
    currentUserId,
    currentUserName,
    embedded = false,
}: {
    currentUserId?: number;
    currentUserName?: string;
    /** Mounted inside a panel/drawer (e.g. the POS counter) rather than as the
     *  full /office/message/inbox page — hides the page breadcrumb, which would
     *  otherwise duplicate the panel's own header/close control. */
    embedded?: boolean;
}) {
    const searchParams  = useSearchParams();
    const initialSection = searchParams.get("section") ?? "groups";

    const [rooms, setRooms]               = useState<Room[]>([]);
    const [teamUsers, setTeamUsers]       = useState<TeamUser[]>([]);
    const [activeRoomId, setActiveRoomId] = useState<string>("");
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [openingDm, setOpeningDm]       = useState<number | null>(null);
    const activeRoom     = rooms.find((r) => r.id === activeRoomId) ?? null;

    // ── Loaders ─────────────────────────────────────────────────────────────────

    const loadRooms = useCallback(() => axios.get<Room[]>("/api/inbox/rooms").then((res) => {
            setRooms(res.data);
            // This is the authoritative unread count — the sidebar's own figure
            // is a separately-fetched, separately-cached number (`/api/nav/counts`)
            // that only recounts on its own triggers (focus, a live "tickets"
            // signal, its now-24h fallback poll). None of those fire just because
            // this page navigated in, so a badge stale from before this session
            // — say, messages that arrived while nobody was here to hear the
            // broadcast — would sit wrong until one of them happened to. Telling
            // it to recount against what THIS load just found closes that gap.
            window.dispatchEvent(new CustomEvent("nav-counts:changed"));
        })
        .catch(() => { toast.error("Failed to load inbox"); })
        .finally(() => setLoadingRooms(false)), []);

    const loadTeamUsers = useCallback(() => axios.get<TeamUser[]>("/api/users")
        .then((res) => setTeamUsers(res.data.filter((u) => u.id !== currentUserId)))
        .catch(() => { /* non-critical */ }), [currentUserId]);

    // ── Bootstrap ────────────────────────────────────────────────────────────────

    // Request browser notification permission once on mount
    useEffect(() => {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => { loadRooms(); loadTeamUsers(); }, [loadRooms, loadTeamUsers]);

    // A new DM room, or being added to a group, announces `chat`. Individual
    // messages do NOT come this way — they ride their own room broadcast — so
    // this is a cheap, rare re-read of the room list and the team roster.
    useRealtimeTopics(["chat", "settings"], () => { loadRooms(); loadTeamUsers(); });

    // No room open yet → the first one of the asked-for section (while rendering;
    // opening one ends it).
    if (rooms.length > 0 && !activeRoomId) {
        const sectionTypes: Record<string, RoomType[]> = {
            groups: ["ORG_GROUP"],
            users:  ["DIRECT_MESSAGE"],
            system: ["SYSTEM_INBOX"],
        };
        const types = sectionTypes[initialSection] ?? sectionTypes.groups;
        const first = rooms.find((r) => types.includes(r.type)) ?? rooms[0];
        if (first) setActiveRoomId(first.id);
    }

    // When GlobalInboxListener signals a new message on a background room, refresh
    // the rooms list so the left-panel unread badges stay accurate
    useEffect(() => {
        const handler = () => { void loadRooms(); };
        window.addEventListener("inbox:unread", handler);
        return () => window.removeEventListener("inbox:unread", handler);
    }, [loadRooms]);

    // ── Actions ─────────────────────────────────────────────────────────────────

    const openDm = async (targetUserId: number) => {
        setOpeningDm(targetUserId);
        try {
            const res = await axios.post<{ id: string }>(`/api/inbox/direct/${targetUserId}`);
            await loadRooms();
            setActiveRoomId(res.data.id);
        } catch {
            toast.error("Failed to open direct message");
        } finally {
            setOpeningDm(null);
        }
    };

    // ── Derived ──────────────────────────────────────────────────────────────────

    const groupRooms  = rooms.filter((r) => r.type === "ORG_GROUP");
    const dmRooms     = rooms.filter((r) => r.type === "DIRECT_MESSAGE");
    const systemRooms = rooms.filter((r) => r.type === "SYSTEM_INBOX");

    const dmOpenIds = new Set(
        dmRooms.map((r) => {
            if (!currentUserId) return -1;
            const [, a, b] = r.key.split(":");
            const ai = parseInt(a, 10), bi = parseInt(b, 10);
            return currentUserId === ai ? bi : ai;
        })
    );

    const totalUnread = (list: Room[]) => list.reduce((s, r) => s + r.unreadCount, 0);

    // ── Sub-components ───────────────────────────────────────────────────────────

    // ── Render ───────────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            {!embedded && <PathBreadcrumb root={{ href: "/office/message/inbox", label: "Inbox" }} escapeBack />}

            <div className="flex flex-1 overflow-hidden">

            {/* ══ Left sidebar ═══════════════════════════════════════════════════ */}
            <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
                    <div className="flex items-center gap-2">
                        <MessageSquare size={15} className="text-primary" />
                        <span className="text-sm font-bold">Inbox</span>
                    </div>
                    {totalUnread([...groupRooms, ...dmRooms, ...systemRooms]) > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground leading-none">
                            {totalUnread([...groupRooms, ...dmRooms, ...systemRooms])}
                        </span>
                    )}
                </div>

                {loadingRooms ? (
                    <div className="flex flex-1 items-center justify-center">
                        <Loader2 size={18} className="animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <nav className="flex-1 overflow-y-auto px-2 pb-4">

                        {/* Groups */}
                        <SectionLabel icon={Users2} label="Groups" unread={totalUnread(groupRooms)} />
                        {groupRooms.length === 0
                            ? <p className="px-3 py-1 text-xs text-muted-foreground/65 italic">No groups</p>
                            : groupRooms.map((r) => (
                                <RoomRow key={r.id} room={r} displayName={r.name} active={activeRoomId === r.id} onPick={setActiveRoomId} />
                            ))
                        }

                        {/* Users */}
                        <SectionLabel icon={User} label="Users" unread={totalUnread(dmRooms)} />
                        {dmRooms.map((r) => (
                            <RoomRow
                                key={r.id}
                                room={r}
                                active={activeRoomId === r.id}
                                onPick={setActiveRoomId}
                                displayName={currentUserId ? dmPartnerName(r, currentUserId, teamUsers) : r.name}
                            />
                        ))}
                        {teamUsers
                            .filter((u) => !dmOpenIds.has(u.id))
                            .map((u) => (
                                <Button
                                    key={u.id}
                                    type="button"
                                    variant="ghost"
                                    onClick={() => openDm(u.id)}
                                    disabled={openingDm === u.id}
                                    className="h-auto w-full justify-start gap-2 px-3 py-1.5 text-sm text-muted-foreground/60 hover:bg-muted/60 hover:text-muted-foreground disabled:opacity-40"
                                >
                                    <span className="truncate">@ {u.name}</span>
                                    {openingDm === u.id && (
                                        <Loader2 size={11} className="ml-auto animate-spin" />
                                    )}
                                </Button>
                            ))
                        }

                        {/* System */}
                        <SectionLabel icon={Monitor} label="System" unread={totalUnread(systemRooms)} />
                        {systemRooms.map((r) => (
                            <RoomRow key={r.id} room={r} displayName={r.name} active={activeRoomId === r.id} onPick={setActiveRoomId} />
                        ))}

                    </nav>
                )}
            </aside>

            {/* ══ Chat area ══════════════════════════════════════════════════════ */}
            {!activeRoom ? (
                <section className="flex flex-1 items-center justify-center text-muted-foreground">
                    <div className="text-center">
                        <MessageSquare size={40} strokeWidth={1} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Select a conversation to start chatting.</p>
                    </div>
                </section>
            ) : (
                <TeamRoomPane
                    key={activeRoom.id}
                    room={activeRoom}
                    title={activeRoom.type === "DIRECT_MESSAGE" && currentUserId ? dmPartnerName(activeRoom, currentUserId, teamUsers) : activeRoom.name}
                    currentUserId={currentUserId}
                    currentUserName={currentUserName}
                    onRead={(id) => setRooms((prev) => prev.map((r) => r.id === id ? { ...r, unreadCount: 0 } : r))}
                />
            )}
            </div>
        </div>
    );
}
