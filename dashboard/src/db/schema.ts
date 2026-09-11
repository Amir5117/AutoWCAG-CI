import {
  integer,
  primaryKey,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// --- NextAuth (Auth.js) tables -----------------------------------------
// Shape required by @auth/drizzle-adapter's Postgres schema. Table names
// ("user", "account", "session", "verificationToken") are load-bearing --
// the adapter queries these exact names.

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);

// --- Domain model --------------------------------------------------------

export const patches = pgTable("patches", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  file: text("file").notNull(),
  ruleId: text("ruleId").notNull(),
  originalCode: text("originalCode").notNull(),
  patchedCode: text("patchedCode").notNull(),
  status: text("status").notNull().default("pending"),
  // Nullable for now -- NextAuth isn't wired up yet, so there's no
  // authenticated user to attribute existing/seeded patches to.
  userId: text("userId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});
