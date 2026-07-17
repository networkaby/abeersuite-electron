"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { Globe2, Users, ArrowRight } from "lucide-react";

interface Overview {
    profile:
        | { joined: false }
        | { joined: true; handle: string; avatarUrl: string | null; bio: string | null; joinedAt: string };
}

export default function PortalSocialPage() {
    const [loading, setLoading] = useState(true);
    const [joined, setJoined] = useState(false);
    const [handle, setHandle] = useState<string | null>(null);
    const [nickInput, setNickInput] = useState("");
    const [error, setError] = useState("");
    const [joining, setJoining] = useState(false);

    useEffect(() => {
        axios.get<Overview>("/api/portal/social")
            .then((res) => {
                if (res.data.profile.joined) {
                    setJoined(true);
                    setHandle(res.data.profile.handle);
                }
            })
            .catch(() => { /* fall through to the join card */ })
            .finally(() => setLoading(false));
    }, []);

    const canJoin = nickInput.trim().length >= 3;

    async function handleJoin() {
        const value = nickInput.trim();
        if (value.length < 3) {
            setError("Nickname must be at least 3 characters.");
            return;
        }
        setError("");
        setJoining(true);
        try {
            const res = await axios.post<{ handle: string }>("/api/portal/social/join", { handle: value });
            setJoined(true);
            setHandle(res.data.handle);
            toast.success("You've joined social!");
        } catch (e) {
            setError(extractApiError(e, "Could not join"));
        } finally {
            setJoining(false);
        }
    }

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="Social"
                    description="Join the Network Service customer community."
                    icon={Users}
                />

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : joined ? (
                    <Card className="border-border/70">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Globe2 className="size-4 text-primary" />
                                You&apos;re in{handle ? <> · <span className="text-primary">@{handle}</span></> : ""}!
                            </CardTitle>
                            <CardDescription>
                                Our team are your default friends. Jump into the feed to see what&apos;s happening and post your own updates.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button asChild>
                                <Link href="/portal/social/feed">Go social <ArrowRight className="size-4" /></Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-border/70">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Globe2 className="size-4 text-primary" />
                                Before you join
                            </CardTitle>
                            <CardDescription>
                                If you join, you will be visible to other customers and staff of Network Service. Choose a nickname to continue.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="nickname">Nickname</Label>
                                <Input
                                    id="nickname"
                                    value={nickInput}
                                    onChange={(e) => setNickInput(e.target.value)}
                                    placeholder="Choose your nickname"
                                    autoComplete="off"
                                />
                                {error ? <p className="text-xs text-destructive">{error}</p> : null}
                            </div>
                            <Button type="button" disabled={!canJoin || joining} onClick={() => void handleJoin()}>
                                {joining ? "Joining…" : "Join social"}
                            </Button>
                        </CardContent>
                    </Card>
                )}
            </div>
        </main>
    );
}
