import "dotenv/config";
import { db } from "./index";
import { patches, users } from "./schema";

async function main() {
  const [user] = await db.select().from(users).limit(1);

  if (!user) {
    console.error(
      "No user found in the database. Sign in with GitHub at least once, then re-run this seed."
    );
    process.exit(1);
  }

  const [patch] = await db
    .insert(patches)
    .values({
      file: "CheckoutForm.jsx",
      ruleId: "image-alt",
      originalCode: `<img src="/vite.svg" width="48" height="48" />`,
      patchedCode: `<img src="/vite.svg" width="48" height="48" alt="Vite logo" />`,
      status: "pending",
      userId: user.id,
    })
    .returning();

  console.log(
    `Seeded patch ${patch.id} (${patch.file} / ${patch.ruleId}) for user ${user.id} (${
      user.email ?? user.name ?? "unknown"
    }).`
  );

  // Short-lived script -- exit explicitly rather than trying to tear down
  // the shared `db` pool, which isn't designed to be closed mid-app-lifetime.
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
