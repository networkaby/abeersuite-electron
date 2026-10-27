/** "Get it on Google Play" — the shop footer and the /app install page. The
 *  caller picks the link: our own install page or APK until Google approves the
 *  listing (SHOP_APP_ON_PLAY), then Play. `download`: the link is the APK file. */
export default function GooglePlayBadge({ href, external = false, download = false }: { href: string; external?: boolean; download?: boolean }) {
    return (
        <a
            href={href}
            download={download || undefined}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener" : undefined}
            aria-label="Get our app on Google Play"
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-background hover:opacity-90"
        >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                <path fill="#34A853" d="M3.6 2.2 13.4 12l-9.8 9.8c-.4-.2-.6-.7-.6-1.2V3.4c0-.5.2-1 .6-1.2z" />
                <path fill="#FBBC04" d="m16.8 15.4-3.4-3.4 3.4-3.4 3.9 2.2c1.1.6 1.1 1.8 0 2.4z" />
                <path fill="#4285F4" d="M16.8 8.6 13.4 12 3.6 2.2c.3-.2.8-.2 1.2 0z" />
                <path fill="#EA4335" d="M16.8 15.4 4.8 21.8c-.4.2-.9.2-1.2 0l9.8-9.8z" />
            </svg>
            <span className="leading-tight">
                <span className="block text-[10px] uppercase">Get it on</span>
                <span className="block text-sm font-semibold">Google Play</span>
            </span>
        </a>
    );
}
