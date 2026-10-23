import PostComposer from "@/modules/campaigns/components/PostComposer";

export const metadata = { title: "New post" };

/** `?at=<ISO>` — a slot clicked on the calendar; the post starts at that time. */
export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
    const { at } = await searchParams;
    const start = at && !Number.isNaN(Date.parse(at)) ? at : null;
    return <PostComposer postId={null} startAt={start} />;
}
