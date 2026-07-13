// Viewing Customer Tools is a read — default-open for signed-in staff. The
// convert / merge write APIs keep their customers:edit gates.
export default function CustomerToolsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
