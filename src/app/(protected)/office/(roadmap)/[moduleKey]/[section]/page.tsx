import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findRoadmapSection, isRoadmapModuleKey } from "@/utils/roadmap-modules";

export default async function RoadmapSectionPage({
    params,
}: {
    params: Promise<{ moduleKey: string; section: string }>;
}) {
    const { moduleKey, section } = await params;
    if (!isRoadmapModuleKey(moduleKey)) notFound();

    const child = findRoadmapSection(moduleKey, section);
    if (!child) notFound();

    if (moduleKey === "hrm" && section === "directory") {
        return (
            <Card className="border-2 border-border">
                <CardHeader>
                    <CardTitle>Staff directory</CardTitle>
                    <CardDescription>
                        HR master profiles and documents will live here. Until then, use the staff
                        Users list and org chart.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button asChild variant="default">
                        <Link href="/office/users">Open Users</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/office/org-chart">Org chart</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (moduleKey === "helpdesk" && section === "queues") {
        return (
            <Card className="border-2 border-border">
                <CardHeader>
                    <CardTitle>Queues</CardTitle>
                    <CardDescription>
                        Dedicated helpdesk queues will split SLAs and routing from repair tickets.
                        Repair intake is already on the ticket board.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button asChild variant="default">
                        <Link href="/office/tickets">Open tickets</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/office/dashboard">Repair dashboard</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (moduleKey === "intelligence" && section === "tickets") {
        return (
            <Card className="border-2 border-border">
                <CardHeader>
                    <CardTitle>Ticket insights</CardTitle>
                    <CardDescription>
                        Aggregated repair analytics will appear here (milestone: reporting). Use
                        existing repair and finance views in the meantime.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button asChild variant="default">
                        <Link href="/office/dashboard">Repair dashboard</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/office/tickets">All tickets</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/office/finance/reports">Finance reports</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (moduleKey === "retention" && section === "coupons") {
        return (
            <Card className="border-2 border-border">
                <CardHeader>
                    <CardTitle>Coupon programs</CardTitle>
                    <CardDescription>
                        Retention-specific coupons and eligibility rules will be tracked here. Shop
                        coupons are already under E-Commerce.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild variant="default">
                        <Link href="/office/ecommerce/coupons">E-Commerce coupons</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-2 border-border">
            <CardHeader>
                <CardTitle>{child.label}</CardTitle>
                <CardDescription>
                    This screen is reserved for {child.label.toLowerCase()}. No persistence or APIs
                    are wired yet — structure matches the sidebar roadmap.
                </CardDescription>
            </CardHeader>
        </Card>
    );
}
