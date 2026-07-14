"use client";

// Auto-breadcrumb derived from the current pathname. Used by area layouts
// (accountancy/masters, accountancy/vouchers-registers, accountancy/reports,
// inventory/masters, …) to give every page under the layout a consistent
// breadcrumb without per-page boilerplate.
//
// Also binds Escape → router.back() with the standard input/dialog guards
// (delegated to the shared `useEscapeBack` hook) so the user can navigate
// up by keyboard from anywhere under the layout. Pass `escapeBack={false}`
// to opt out (e.g. a page that consumes Esc itself).
//
// The breadcrumb root + intermediate segments are configured via props so
// the same component serves multiple areas. Unknown segments fall back to
// a title-cased version of the slug (kebab/snake → Title Case).

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useEscapeBack } from "@/shared/hooks/useEscapeBack";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";

export interface PathBreadcrumbProps {
    /** First crumb: clickable link to the module/area root. */
    root: { href: string; label: string };
    /** Segments under `root` whose href starts with this prefix will be
     *  walked. Pathname segments outside this prefix are ignored — the root
     *  href acts as the boundary. Defaults to `root.href`. */
    basePath?: string;
    /** Map slug → human label for known segments. Unknown slugs are
     *  title-cased automatically (e.g. "vouchers-registers" → "Vouchers
     *  Registers"). */
    labels?: Record<string, string>;
    /** If true, Esc → router.back() with input/dialog guards. Default is
     *  false so the breadcrumb never double-binds Esc on pages that already
     *  install their own handler (Plan A — exact return path everywhere).
     *  Pages without their own Esc handler can opt-in by passing
     *  `escapeBack` on the layout's PathBreadcrumb. */
    escapeBack?: boolean;
    /** Hide a segment from the rendered breadcrumb (still walked for href
     *  composition). Useful when a route group like `(gl)` shouldn't show. */
    hide?: Set<string>;
    /** Suppress the breadcrumb entirely on these exact pathnames. Use for
     *  full-bleed pages (e.g. day-book uses `-m-8` and would render under
     *  the breadcrumb). */
    hideOn?: string[];
    /** Extra className on the wrapping <nav>. */
    className?: string;
}

function titleCase(slug: string): string {
    return slug
        .replace(/[-_]/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}

export function PathBreadcrumb({
    root,
    basePath,
    labels,
    escapeBack = false,
    hide,
    hideOn,
    className,
}: PathBreadcrumbProps) {
    const pathname = usePathname();
    useEscapeBack(escapeBack);

    if (hideOn?.includes(pathname)) return null;

    const boundary = basePath ?? root.href;
    // Only walk segments that live under `boundary`. Drop the boundary
    // prefix so we don't re-emit "office" / "accountancy" etc.
    const rel = pathname.startsWith(boundary) ? pathname.slice(boundary.length) : "";
    const parts = rel.split("/").filter(Boolean);

    type Crumb = { label: string; href: string; isLast: boolean };
    const crumbs: Crumb[] = [];
    let accum = boundary;
    parts.forEach((part, i) => {
        accum = `${accum}/${part}`;
        if (hide?.has(part)) return;
        // Numeric drill-in ids (e.g. /groups/123) — render as "#123" rather
        // than capitalising. Avoids "123" appearing as a bare leaf word.
        const label = /^\d+$/.test(part)
            ? `#${part}`
            : (labels?.[part] ?? titleCase(part));
        crumbs.push({ label, href: accum, isLast: i === parts.length - 1 });
    });

    return (
        <BreadcrumbBar className={className}>
            <Breadcrumb>
            <BreadcrumbList>
                <BreadcrumbItem>
                    {crumbs.length === 0 ? (
                        <BreadcrumbPage>{root.label}</BreadcrumbPage>
                    ) : (
                        <BreadcrumbLink asChild>
                            <Link href={root.href}>{root.label}</Link>
                        </BreadcrumbLink>
                    )}
                </BreadcrumbItem>
                {crumbs.map((c) => (
                    <BreadcrumbSeparator key={`sep-${c.href}`}>
                        {/* default separator renders chevron */}
                    </BreadcrumbSeparator>
                )).flatMap((sep, i) => [
                    sep,
                    (
                        <BreadcrumbItem key={crumbs[i].href}>
                            {crumbs[i].isLast ? (
                                <BreadcrumbPage>{crumbs[i].label}</BreadcrumbPage>
                            ) : (
                                <BreadcrumbLink asChild>
                                    <Link href={crumbs[i].href}>{crumbs[i].label}</Link>
                                </BreadcrumbLink>
                            )}
                        </BreadcrumbItem>
                    ),
                ])}
            </BreadcrumbList>
            </Breadcrumb>
        </BreadcrumbBar>
    );
}
