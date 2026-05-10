export type DemoReview = {
    id: string;
    author: string;
    rating: number;
    title: string;
    body: string;
    when: string;
    verified: boolean;
};

const REVIEWERS = [
    "Arjun K.",
    "Meera S.",
    "Rahul V.",
    "Priya N.",
    "Vikram D.",
    "Ananya R.",
    "Karthik M.",
    "Sneha P.",
];

const TITLES = [
    "Exceeded expectations",
    "Solid purchase",
    "Worth the price in ₹",
    "Fast delivery, well packed",
    "Using daily — no issues",
    "Great for work from home",
];

export function demoReviewsForProduct(productId: number): DemoReview[] {
    const base = (productId * 7919) % 10000;
    const n = 4 + (base % 3);
    const out: DemoReview[] = [];
    for (let i = 0; i < n; i++) {
        const seed = base + i * 1337;
        out.push({
            id: `r-${productId}-${i}`,
            author: REVIEWERS[seed % REVIEWERS.length],
            rating: 4 + (seed % 20) / 20,
            title: TITLES[seed % TITLES.length],
            body: "Build quality and packaging were excellent. Support answered pre‑purchase questions quickly. Would recommend for anyone upgrading their setup this season.",
            when: `${1 + (seed % 28)} days ago`,
            verified: seed % 3 !== 0,
        });
    }
    return out;
}
