import type { patches } from "@/db/schema";

export type Patch = typeof patches.$inferSelect;
