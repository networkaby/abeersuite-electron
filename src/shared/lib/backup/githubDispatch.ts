/**
 * dotenv strips a trailing `# comment` from .env values, but the Vercel env UI
 * does not — pasting a commented line there stores it verbatim, giving values
 * like "dev   # branch to use". That surfaces as a confusing 404 (bad ref) or
 * 401 (bad token) from GitHub, so strip the comment on our side as well.
 */
export function cleanEnvValue(value: string | undefined): string | undefined {
    return value?.split("#")[0].trim() || undefined;
}

/**
 * Triggers a GitHub Actions `workflow_dispatch` run. Used to run pg_dump /
 * pg_restore on a GitHub runner (which has the Postgres client tools) because
 * Vercel functions don't ship those binaries.
 *
 * Requires env: GITHUB_DISPATCH_TOKEN (fine-grained PAT with this repo in its
 * access list and Actions: read+write), GITHUB_REPO ("owner/repo"), and
 * optionally GITHUB_WORKFLOW_REF (branch holding the workflow, defaults to
 * "main"). The branch must exist on the remote — GitHub resolves the ref by
 * name, not by commit, so two branches sharing a commit are not interchangeable.
 */
export async function triggerWorkflow(workflowFile: string, inputs: Record<string, string>): Promise<void> {
    const token = cleanEnvValue(process.env.GITHUB_DISPATCH_TOKEN);
    const repo = cleanEnvValue(process.env.GITHUB_REPO);
    const ref = cleanEnvValue(process.env.GITHUB_WORKFLOW_REF) || "main";
    const workflow = cleanEnvValue(workflowFile);
    if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set.");
    if (!repo) throw new Error("GITHUB_REPO is not set (expected 'owner/repo').");

    const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
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
        // GitHub's own messages here are famously unhelpful: a fine-grained PAT
        // that cannot see the repo returns 404 (not 403), and a ref that does not
        // exist returns the same 404. Spell out what to check.
        const hint =
            res.status === 404
                ? ` — check that the PAT lists "${repo}" under Repository access, that branch "${ref}" exists on the remote, and that ${workflow} is on that branch.`
                : res.status === 401
                  ? " — GITHUB_DISPATCH_TOKEN is invalid, expired, or has a stray comment/whitespace in it."
                  : "";
        throw new Error(`GitHub workflow dispatch failed (HTTP ${res.status}): ${text.slice(0, 500)}${hint}`);
    }
}
