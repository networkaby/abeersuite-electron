// Viewing Customer Import is a read — default-open for signed-in staff (the
// Settings sidebar tick decides who sees the link). The import write API
// (/api/settings/customer-import/*) keeps its customers:edit gate, so an
// unprivileged viewer can open the page but the commit still requires the grant.
export default function CustomerImportLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
