// Viewing Item Import is a read — default-open for signed-in staff (the Settings
// sidebar tick decides who sees the link). The import write API
// (/api/settings/item-import/*) keeps its inventory module gate
// (requireModuleAccess("inventory")), so an unprivileged viewer can open the
// page but the commit still requires access.
export default function ItemImportLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
