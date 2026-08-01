// Small "we accept" strip for the footer — flat, hand-drawn badges (not
// downloaded brand assets) so there's no external file or licensing to manage.
// Reflects what Razorpay actually settles for us: cards, UPI, netbanking.

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <span
            className={`flex h-6 w-10 shrink-0 items-center justify-center rounded-[3px] border border-border/60 bg-white ${className}`}
        >
            {children}
        </span>
    );
}

function VisaBadge() {
    return (
        <Chip>
            <svg viewBox="0 0 40 24" className="h-3.5 w-8" aria-hidden="true">
                <text x="20" y="16" textAnchor="middle" fontSize="11" fontStyle="italic" fontWeight="700" fill="#1a1f71" fontFamily="Arial, sans-serif">
                    VISA
                </text>
            </svg>
        </Chip>
    );
}

function MastercardBadge() {
    return (
        <Chip>
            <svg viewBox="0 0 40 24" className="h-4 w-6" aria-hidden="true">
                <circle cx="16" cy="12" r="7" fill="#eb001b" />
                <circle cx="24" cy="12" r="7" fill="#f79e1b" fillOpacity="0.9" />
            </svg>
        </Chip>
    );
}

function RuPayBadge() {
    return (
        <Chip>
            <svg viewBox="0 0 40 24" className="h-3.5 w-8" aria-hidden="true">
                <text x="20" y="16" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#0a5f38" fontFamily="Arial, sans-serif">
                    Ru<tspan fill="#f47b20">Pay</tspan>
                </text>
            </svg>
        </Chip>
    );
}

function UpiBadge() {
    return (
        <Chip>
            <svg viewBox="0 0 40 24" className="h-3.5 w-8" aria-hidden="true">
                <text x="20" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="#097939" fontFamily="Arial, sans-serif">
                    UPI
                </text>
            </svg>
        </Chip>
    );
}

export default function PaymentMethodLogos({ className = "" }: { className?: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`} aria-label="Accepted payment methods: cards, UPI, netbanking via Razorpay">
            <VisaBadge />
            <MastercardBadge />
            <RuPayBadge />
            <UpiBadge />
        </span>
    );
}
