/** WhatsApp brand mark — fixed green and white, so it reads the same in dark mode. */
export function WhatsAppIcon({ className = "size-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" className={`inline-block shrink-0 ${className}`} aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#25D366" />
            <path
                fill="#fff"
                d="M16 6.5a9.4 9.4 0 0 0-8.1 14.2L6.6 25.4l4.8-1.3A9.4 9.4 0 1 0 16 6.5Zm0 17.2a7.8 7.8 0 0 1-4-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A7.8 7.8 0 1 1 16 23.7Zm4.3-5.8c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.4 6.4 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.4-.2Z"
            />
        </svg>
    );
}
