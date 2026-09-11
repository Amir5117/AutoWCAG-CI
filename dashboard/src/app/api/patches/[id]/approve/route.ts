import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { patches } from "@/db/schema";
import { getOctokitForRepo } from "@/lib/github";

// Hardcoded for this test integration -- the single PR this dashboard demo reviews.
const GITHUB_PR = {
  owner: "Amir5117",
  repo: "AutoWCAG-CI",
  pull_number: 1,
};

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/patches/[id]/approve">
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const ownedByUser = and(eq(patches.id, id), eq(patches.userId, session.user.id));

  const [patch] = await db.select().from(patches).where(ownedByUser);

  if (!patch) {
    return NextResponse.json({ error: `Patch ${id} not found` }, { status: 404 });
  }

  // GitHub is the source of truth for the merge -- only write "merged" to
  // the database once GitHub actually confirms it, so the two can't desync.
  try {
    const octokit = await getOctokitForRepo(GITHUB_PR.owner, GITHUB_PR.repo);
    await octokit.rest.pulls.merge({
      ...GITHUB_PR,
      merge_method: "squash",
    });
  } catch (err) {
    console.error(`GitHub merge failed for PR #${GITHUB_PR.pull_number}:`, err);
    return NextResponse.json({ error: "GitHub merge failed" }, { status: 502 });
  }

  const [updated] = await db
    .update(patches)
    .set({ status: "merged" })
    .where(ownedByUser)
    .returning();

  return NextResponse.json(updated);
}
