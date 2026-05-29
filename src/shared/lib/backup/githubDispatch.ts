/**
 * Triggers a GitHub Actions `workflow_dispatch` run. Used to run pg_dump /
 * pg_restore on a GitHub runner (which has the Postgres client tools) because
 * Vercel functions don't ship those binaries.
 *
 * Requires env: GITHUB_DISPATCH_TOKEN (fine-grained PAT, Actions: read+write),
 * GITHUB_REPO ("owner/repo"), and optionally GITHUB_WORKFLOW_REF (branch,
 * defaults to "main").
 */
export async function triggerWorkflow(workflowFile: string, inputs: Record<string, string>): Promise<void> {
    const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
    const repo = process.env.GITHUB_REPO?.trim();
    const ref = process.env.GITHUB_WORKFLOW_REF?.trim() || "main";
    if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set.");
    if (!repo) throw new Error("GITHUB_REPO is not set (expected 'owner/repo').");

    const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref, inputs }),
        },
    );

    // A successful dispatch returns 204 No Content.
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GitHub workflow dispatch failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }
}
