import { prisma } from "../../lib/prisma.js";
import { buildFinanceWorkbook } from "../../lib/financeWorkbook.js";
import { ensureBranchExists, upsertGitHubFile } from "../../lib/githubClient.js";

/**
 * newTask.md #2 — daily finance export, pushed to GitHub. Requires
 * GITHUB_TOKEN + GITHUB_REPO_OWNER + GITHUB_REPO_NAME to be configured
 * (see server/.env.example) — throws a clear, specific error rather than
 * silently no-op'ing if they're missing, so a misconfiguration shows up
 * plainly in the JobRun log (runTrackedJob records it) instead of just
 * "nothing happened, uncertain why."
 */
export async function financeExportJob() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  if (!token || !owner || !repo) {
    throw new Error(
      "Finance export not configured: set GITHUB_TOKEN, GITHUB_REPO_OWNER, and GITHUB_REPO_NAME (see server/.env.example)"
    );
  }
  // A dedicated branch, not `main` — this repo's render.yaml auto-deploys on
  // every push to `main`, and a daily data-only commit shouldn't trigger a
  // full app redeploy.
  const branch = process.env.GITHUB_FINANCE_BRANCH || "finance-data";
  const path = process.env.GITHUB_FINANCE_PATH || "finance-exports/finance-data.xlsx";

  const [invoices, links, clientInvoices] = await Promise.all([
    prisma.invoice.findMany({
      include: { creator: { select: { name: true, phoneNumber: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.link.findMany({
      include: { campaign: true, asset: true, submittedBy: { select: { name: true } }, invoiceItem: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.clientInvoice.findMany({
      include: { plan: { select: { name: true, clientName: true, clientCompany: true, campaign: { select: { title: true } } } } },
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  const buffer = await buildFinanceWorkbook({ invoices, links, clientInvoices });
  const today = new Date().toISOString().slice(0, 10);

  await ensureBranchExists({ token, owner, repo, branch });
  return upsertGitHubFile({
    token,
    owner,
    repo,
    branch,
    path,
    content: buffer,
    message: `Daily finance export — ${today}`,
  });
}
