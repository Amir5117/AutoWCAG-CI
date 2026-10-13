// Sourced from the Drizzle schema so the frontend's notion of a "Patch" can
// never drift from the actual database table. Type-only, so nothing from
// the Drizzle/pg runtime is pulled into the client bundle.
import type { patches } from "@/db/schema";

export type Patch = typeof patches.$inferSelect;
