// TODO(rbac): this layout previously gated Service Centers on warranty:convert.
// Gating removed — open to all authenticated staff (the office layout already
// blocks non-staff). Re-add a position-based gate here when RBAC is re-wired.
export default function ServiceCentersLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
