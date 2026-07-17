// Shared Prisma select + mapper for a wall post's like/comment counts and whether
// the current customer has liked it — used by the feed, wall, and actor routes so
// every post shape carries the same interaction fields.

export function likeCommentSelect(customerId: number) {
    return {
        _count: { select: { likes: true, comments: true } },
        likes: { where: { likerKind: "PERSON" as const, likerId: customerId }, select: { id: true }, take: 1 },
    };
}

export function shapeCounts(row: { _count: { likes: number; comments: number }; likes: { id: number }[] }) {
    return {
        likeCount: row._count.likes,
        commentCount: row._count.comments,
        likedByMe: row.likes.length > 0,
    };
}
