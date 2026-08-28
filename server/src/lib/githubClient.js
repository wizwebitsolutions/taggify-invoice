/**
 * Minimal GitHub REST client for the daily finance export (newTask.md #2).
 * Uses the Contents API to create/update one file per call — no local git
 * checkout, working tree, or push credentials needed, so this works
 * identically locally and on a host like Render whose running containers
 * don't retain git push access even though the build step did a git clone.
 * https://docs.github.com/en/rest/repos/contents
 */
const GITHUB_API = "https://api.github.com";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubFetch(url, token, init) {
  const res = await fetch(url, { ...init, headers: headers(token) });
  return res;
}

/**
 * Creates `branch` off the repo's default branch if it doesn't already
 * exist — so the export truly runs "automatically" (newTask.md #2) without
 * a one-time manual `git checkout -b` first. Pushing the daily export to
 * its own branch, not `main`, is deliberate: this repo's `render.yaml`
 * auto-deploys on every push to `main`, and a data-only commit shouldn't
 * trigger a full app redeploy every day.
 */
export async function ensureBranchExists({ token, owner, repo, branch }) {
  const existing = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  if (existing.status === 200) return;
  if (existing.status !== 404) {
    throw new Error(`GitHub API error checking branch "${branch}": ${existing.status} ${await existing.text()}`);
  }

  const repoInfo = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}`, token);
  if (!repoInfo.ok) throw new Error(`GitHub API error reading repo: ${repoInfo.status} ${await repoInfo.text()}`);
  const { default_branch } = await repoInfo.json();

  const baseRef = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${default_branch}`, token);
  if (!baseRef.ok) throw new Error(`GitHub API error reading base branch: ${baseRef.status} ${await baseRef.text()}`);
  const { object } = await baseRef.json();

  const created = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }),
  });
  if (!created.ok) throw new Error(`GitHub API error creating branch "${branch}": ${created.status} ${await created.text()}`);
}

/** Creates or updates a single file's content, in one commit. */
export async function upsertGitHubFile({ token, owner, repo, branch, path, content, message }) {
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  let sha;
  const existing = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, token);
  if (existing.status === 200) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub API error checking existing file: ${existing.status} ${await existing.text()}`);
  }

  const res = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub API error writing file: ${res.status} ${await res.text()}`);

  const result = await res.json();
  return { commitSha: result.commit?.sha, htmlUrl: result.content?.html_url };
}
