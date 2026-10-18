/**
 * Run `work` over `items` with at most `size` in flight. A free slot takes the
 * next item at once, so one slow item never holds up a whole batch. Return
 * `false` from `work` to stop handing out further items (in-flight ones finish).
 */
export async function runPool<T>(items: T[], size: number, work: (item: T) => Promise<boolean | void>): Promise<void> {
    let next = 0;
    let stopped = false;
    const lane = async () => {
        while (!stopped && next < items.length) {
            if ((await work(items[next++])) === false) stopped = true;
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}
