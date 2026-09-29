import { MODULE_SECTIONS } from "@/shared/lib/constants/nav";
import { SIDEBAR_MODULES, type SidebarChildRow } from "@/shared/lib/auth/sidebarModules";

/**
 * Page lock — who may OPEN an office page, by the Role page's sidebar ticks.
 *
 * The sidebar hides a link whose `ui:sidebar:*` tick is off; this makes the page
 * behind it refuse too, so a typed address, a bookmark or a link on another screen
 * cannot reach what the Role page took away. Built from the sidebar itself
 * (sidebarModules.ts), so a page added to nav.ts is locked by its own tick with
 * nothing else to edit.
 *
 * A path is matched to the most specific thing that covers it:
 *   • a sidebar link whose address (or one of its `pathPrefixes`) it sits under →
 *     that link's tick. Detail pages ride their list: /office/repairing/tickets/42
 *     needs "All Repair".
 *   • else a module's own area — a hub such as /office/bi, or a drill-in no single
 *     link owns (/office/accountancy/account/7) → any one tick in that module.
 *   • else nothing: open to every signed-in staff member.
 * On a tie the link wins over its module (/office/help is both).
 *
 * Enforced in `proxy.ts` for every /office page. /vouchers and the print pages are
 * not sidebar pages: their writes are gated by the voucher ticks at the API.
 */

/** Where a refused page sends the person, and the flag that makes it say why. */
export const NO_ACCESS_HOME = "/office/work-flow-inbox";
export const NO_ACCESS_PARAM = "noaccess";

/** Open to every signed-in staff member whatever is ticked: Home, where a refusal
 *  lands (Work Flow, Inbox), and a person's own profile. */
const OPEN_TO_ALL = ["/office/work-flow-inbox", "/office/message", "/office/me", "/office/user"];

// Admin and Settings are sidebar groups, not MODULE_SECTIONS, so nav.ts gives them no
// area of their own.
const GROUP_PREFIXES: Record<string, string[]> = {
    admin: ["/office/admin"],
    settings: ["/office/settings"],
};

type Rule = { prefix: string; segments: number; link: boolean; ids: string[] };

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

const RULES: Rule[] = (() => {
    const byKey = new Map<string, Rule>();
    const add = (raw: string, link: boolean, ids: string[]) => {
        const prefix = raw.split(/[?#]/)[0].replace(/\/+$/, "");
        if (!under(prefix, "/office")) return;
        const key = `${link ? "link" : "area"}:${prefix}`;
        const hit = byKey.get(key);
        if (hit) hit.ids.push(...ids);
        else byKey.set(key, { prefix, segments: prefix.split("/").length, link, ids: [...ids] });
    };
    for (const mod of SIDEBAR_MODULES) {
        const walk = (rows: SidebarChildRow[]) => {
            for (const row of rows) {
                for (const path of row.paths) add(path, true, [row.permissionId]);
                if (row.children) walk(row.children);
            }
        };
        walk(mod.children);
        const area = MODULE_SECTIONS.find((s) => s.key === mod.key)?.pathPrefixes ?? GROUP_PREFIXES[mod.key] ?? [];
        for (const prefix of area) add(prefix, false, mod.childPermissionIds);
    }
    // Most specific first; a link before a module area on the same address.
    return [...byKey.values()].sort((a, b) => b.segments - a.segments || Number(b.link) - Number(a.link));
})();

/** The sidebar ticks that open `href` — any one of them will do — or null when no
 *  tick governs the page. A query or hash on the address is ignored. */
export function pageLinkIds(href: string): string[] | null {
    const pathname = href.split(/[?#]/)[0].replace(/(.)\/+$/, "$1");
    if (!under(pathname, "/office") || pathname === "/office") return null;
    if (OPEN_TO_ALL.some((p) => under(pathname, p))) return null;
    return RULES.find((r) => under(pathname, r.prefix))?.ids ?? null;
}

/** May someone holding `permissions` open this page? admin:bypass always may. */
export function canOpenPage(href: string, permissions: readonly string[]): boolean {
    const ids = pageLinkIds(href);
    if (ids == null || permissions.includes("admin:bypass")) return true;
    return ids.some((id) => permissions.includes(id));
}
