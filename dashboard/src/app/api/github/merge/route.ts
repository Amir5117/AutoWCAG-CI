import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { RequestError } from "octokit";
import { auth } from "@/auth";
import { db } from "@/db";
import { patches } from "@/db/schema";
import { getOctokitForRepo } from "@/lib/github";
import { describeRule } from "@/lib/rule-labels";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function describeGitHubError(err: unknown): string {
  if (err instanceof RequestError) {
    if (err.status === 403) {
      return "AutoWCAG-CI doesn't have permission to update this repository. Check that the GitHub App has Contents: Read & write access.";
    }
    if (err.status === 404) {
      return "GitHub couldn't find this file or pull request. It may have been moved or deleted, or the app may not have access to the repository.";
    }
    if (err.status === 409 || err.status === 422) {
      return "GitHub rejected the update because the branch changed in the meantime. Please try again.";
    }
  }
  return "Couldn't reach GitHub. Please try again.";
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => null);
  const patchId = typeof body?.patchId === "string" ? body.patchId : null;

  if (!patchId) {
    return fail("patchId is required", 400);
  }

  const ownedByUser = and(eq(patches.id, patchId), eq(patches.userId, session.user.id));
  const [patch] = await db.select().from(patches).where(ownedByUser);

  if (!patch) {
    return fail("Fix not found", 404);
  }

  if (patch.status === "merged") {
    return NextResponse.json(patch);
  }

  const { repoOwner: owner, repoName: repo, pullNumber } = patch;

  if (!owner || !repo || pullNumber === null) {
    return fail(
      "This fix isn't linked to a pull request, so it can't be applied automatically.",
      422
    );
  }

  try {
    const octokit = await getOctokitForRepo(owner, repo);

    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });

    if (pr.state !== "open") {
      return fail("The pull request for this fix is no longer open.", 409);
    }

    if (pr.head.repo?.full_name !== `${owner}/${repo}`) {
      return fail("Fixes can only be applied to branches in the same repository, not forks.", 422);
    }

    const branch = pr.head.ref;

    const { data: current } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: patch.file,
      ref: branch,
    });

    if (Array.isArray(current) || current.type !== "file") {
      return fail("This fix points to something that isn't a file on the branch anymore.", 422);
    }

    const currentCode = Buffer.from(current.content, "base64").toString("utf-8");

    if (currentCode !== patch.patchedCode) {
      if (currentCode !== patch.originalCode) {
        return fail(
          "This file has changed since it was analyzed. Push your latest changes to trigger a fresh analysis.",
          409
        );
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: patch.file,
        branch,
        sha: current.sha,
        message: `fix(accessibility): ${describeRule(patch.ruleId)} in ${patch.file}\n\nApplied from the AutoWCAG-CI dashboard after automated browser testing.`,
        content: Buffer.from(patch.patchedCode, "utf-8").toString("base64"),
      });
    }

    const [updated] = await db
      .update(patches)
      .set({ status: "merged" })
      .where(ownedByUser)
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error(`Failed to apply fix ${patchId} to ${owner}/${repo}#${pullNumber}:`, err);
    return fail(describeGitHubError(err), 502);
  }
}
