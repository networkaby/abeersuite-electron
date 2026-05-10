"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMockSocial } from "@/shared/lib/portal/mockAdapters";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { usePortalSocialStore } from "@/store/external/portalSocialStore";
import { Globe2, Users } from "lucide-react";

export default function PortalSocialPage() {
    const { joined, nickname, join } = usePortalSocialStore();
    const [nickInput, setNickInput] = useState(nickname || "");
    const [error, setError] = useState("");

    const canJoin = nickInput.trim().length >= 3;

    async function handleJoin() {
        const value = nickInput.trim();
        if (value.length < 3) {
            setError("Nickname must be at least 3 characters.");
            return;
        }
        setError("");
        join(value);
    }

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="Social"
                    description="Join the Network Service customer community."
                    icon={Users}
                />

                {!joined ? (
                    <Card className="border-border/70">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Globe2 className="size-4 text-primary" />
                                Before you join
                            </CardTitle>
                            <CardDescription>
                                If you join, you will be visible to other customers of Network Service. Choose a nickname to continue.
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
                            <Button type="button" disabled={!canJoin} onClick={() => void handleJoin()}>
                                Join social
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <JoinedSocialView nickname={nickname} />
                )}
            </div>
        </main>
    );
}

function JoinedSocialView({ nickname }: { nickname: string }) {
    const [posts, setPosts] = useState<Awaited<ReturnType<typeof getMockSocial>>["posts"]>([]);
    const [friends, setFriends] = useState<Awaited<ReturnType<typeof getMockSocial>>["friends"]>([]);

    useEffect(() => {
        let cancelled = false;
        getMockSocial().then((data) => {
            if (cancelled) return;
            setPosts(data.posts);
            setFriends(data.friends);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg">Community feed</CardTitle>
                    <CardDescription>Welcome @{nickname}. Public feed is ready. Posting backend arrives in phase 2.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {posts.map((post) => (
                        <article key={post.id} className="rounded-lg border border-border/70 bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium">{post.author}</p>
                                <span className="text-xs text-muted-foreground">{post.at}</span>
                            </div>
                            <p className="mt-1.5 text-sm text-foreground">{post.text}</p>
                        </article>
                    ))}
                </CardContent>
            </Card>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-base">Initial friends (internal team)</CardTitle>
                    <CardDescription>Starter suggestions from Network Service team.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5">
                    {friends.map((friend) => (
                        <div key={friend.id} className="flex items-center justify-between rounded-md border border-border/70 p-2.5">
                            <div>
                                <p className="text-sm font-medium">{friend.name}</p>
                                <p className="text-xs text-muted-foreground">{friend.role}</p>
                            </div>
                            <Badge variant="outline">Suggested</Badge>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}

