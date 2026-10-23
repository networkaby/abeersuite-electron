import PostComposer from "@/modules/campaigns/components/PostComposer";

export const metadata = { title: "New post" };

/**
 * `?at=<ISO>` — a slot clicked on the calendar; the post starts at that time.
 * `?product=<id>` — "Make a post" on a shop product; the post starts from it.
 */
export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ at?: string; product?: string }> }) {
    const { at, product } = await searchParams;
    const start = at && !Number.isNaN(Date.parse(at)) ? at : null;
    const productId = product && /^\d+$/.test(product) ? Number(product) : null;
    return <PostComposer postId={null} startAt={start} startProductId={productId} />;
}
