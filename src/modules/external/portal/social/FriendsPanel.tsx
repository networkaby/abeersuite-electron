"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import UserAvatar from "@/shared/components/UserAvatar";
import { extractApiError } from "@/shared/lib/api";
import { Search, UserPlus, Check, X, Clock } from "lucide-react";
import { type Actor, portalActorHref } from "./shared";

type SearchStatus = "friend" | "pending_out" | "pending_in" | "none";
interface SearchResult { actor: Actor; status: SearchStatus; requestId?: number }
interface FriendRequest { requestId: number; createdAt: string; from: Actor }

// Requests inbox + people search + friends list. `friends` comes from the parent
// (the social overview); `onChanged` refetches it when a friendship is formed.
export function FriendsPanel({ friends, onChanged }: { friends: Actor[]; onChanged: () => void }) {
    const [requests, setRequests] = useState<FriendRequest[]>([]);
    const [q, setQ] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const loadRequests = useCallback(async () => {
        try {
            const r = await axios.get<FriendRequest[]>("/api/portal/social/requests");
            setRequests(r.data);
        } catch { /* requests panel is non-critical */ }
    }, []);
    useEffect(() => { void loadRequests(); }, [loadRequests]);

    // Debounced search.
    useEffect(() => {
        const term = q.trim();
        if (!term) { setResults([]); setSearching(false); return; }
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const r = await axios.get<SearchResult[]>(`/api/portal/social/search?q=${encodeURIComponent(term)}`);
                setResults(r.data);
            } catch { setResults([]); }
            finally { setSearching(false); }
        }, 300);
        return () => clearTimeout(t);
    }, [q]);

    async function sendRequest(personId: number) {
        setBusyId(`P-${personId}`);
        try {
            await axios.post("/api/portal/social/friend-request", { personId });
            setResults((rs) => rs.map((r) => (r.actor.kind === "PERSON" && r.actor.id === personId ? { ...r, status: "pending_out" } : r)));
            toast.success("Request sent");
        } catch (e) { toast.error(extractApiError(e, "Failed to send request")); }
        finally { setBusyId(null); }
    }

    async function respond(requestId: number, accept: boolean) {
        setBusyId(`R-${requestId}`);
        try {
            await axios.post(`/api/portal/social/friend-request/${requestId}/respond`, { accept });
            setRequests((rs) => rs.filter((r) => r.requestId !== requestId));
            if (accept) { toast.success("You're now friends"); onChanged(); }
        } catch (e) { toast.error(extractApiError(e, "Failed")); }
        finally { setBusyId(null); }
    }

    return (
        <div className="max-w-2xl space-y-5">
            {/* Incoming requests */}
            {requests.length > 0 && (
                <Card className="border-border/70">
                    <CardHeader><CardTitle className="text-base">Friend requests</CardTitle></CardHeader>
                    <CardContent className="space-y-2.5">
                        {requests.map((r) => (
                            <div key={r.requestId} className="flex items-center gap-2.5 rounded-md border border-border/70 p-2.5">
                                <Link href={portalActorHref(r.from)} className="shrink-0"><UserAvatar avatarUrl={r.from.avatarUrl} name={r.from.name} role={r.from.role} sizePx={36} /></Link>
                                <Link href={portalActorHref(r.from)} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">{r.from.name}</Link>
                                <Button size="sm" onClick={() => void respond(r.requestId, true)} disabled={busyId === `R-${r.requestId}`}><Check className="size-3.5" /> Accept</Button>
                                <Button size="sm" variant="ghost" onClick={() => void respond(r.requestId, false)} disabled={busyId === `R-${r.requestId}`}><X className="size-3.5" /></Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* Search */}
            <Card className="border-border/70">
                <CardHeader><CardTitle className="text-base">Find people</CardTitle></CardHeader>
                <CardContent className="space-y-2.5">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or @handle…" className="pl-9" />
                    </div>
                    {q.trim() && (
                        searching ? <p className="text-sm text-muted-foreground">Searching…</p>
                            : results.length === 0 ? <p className="text-sm text-muted-foreground">No matches.</p>
                                : <div className="space-y-2">
                                    {results.map((r) => (
                                        <div key={`${r.actor.kind}-${r.actor.id}`} className="flex items-center gap-2.5 rounded-md border border-border/70 p-2.5">
                                            <Link href={portalActorHref(r.actor)} className="shrink-0"><UserAvatar avatarUrl={r.actor.avatarUrl} name={r.actor.name} role={r.actor.role} sizePx={36} /></Link>
                                            <Link href={portalActorHref(r.actor)} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                                                {r.actor.name}
                                                {!r.actor.isCustomer && <span className="ml-1 text-xs text-muted-foreground">· {r.actor.roleBadge?.label ?? "Staff"}</span>}
                                            </Link>
                                            {r.status === "friend" ? <Badge variant="outline" className="text-[10px]">Friends</Badge>
                                                : r.status === "pending_out" ? <Badge variant="outline" className="text-[10px]"><Clock className="mr-1 size-3" /> Requested</Badge>
                                                    : r.status === "pending_in" ? <Badge className="text-[10px]">Wants to connect</Badge>
                                                        : <Button size="sm" variant="outline" onClick={() => void sendRequest(r.actor.id)} disabled={busyId === `P-${r.actor.id}`}><UserPlus className="size-3.5" /> Add</Button>}
                                        </div>
                                    ))}
                                </div>
                    )}
                </CardContent>
            </Card>

            {/* Friends */}
            <Card className="border-border/70">
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="text-base">Your friends</CardTitle>
                    <span className="text-xs text-muted-foreground">{friends.length}</span>
                </CardHeader>
                <CardContent>
                    {friends.length === 0 ? <p className="text-sm text-muted-foreground">No friends yet.</p>
                        : <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            {friends.map((f) => (
                                <Link key={`${f.kind}-${f.id}`} href={portalActorHref(f)} className="flex items-center gap-2.5 rounded-md border border-border/70 p-2.5 transition-colors hover:bg-muted/50">
                                    <UserAvatar avatarUrl={f.avatarUrl} name={f.name} role={f.role} sizePx={32} />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{f.name}</p>
                                        {f.roleBadge && <p className="text-xs text-muted-foreground">{f.roleBadge.label}</p>}
                                    </div>
                                </Link>
                            ))}
                        </div>}
                </CardContent>
            </Card>
        </div>
    );
}
