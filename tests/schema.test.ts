import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

describe("schema conventions", () => {
  const tables = (Object.values(schema) as unknown[]).filter((t): t is PgTable => is(t, PgTable));

  it("every tenant table has workspace_id", () => {
    // Identity & tenancy tables live above workspaces.
    const exempt = new Set(["workspaces", "app_meta", "organizations", "memberships", "invitations", "users"]);
    for (const t of tables) {
      if (exempt.has(getTableName(t))) continue;
      const cols = Object.values(getTableColumns(t)).map((c) => c.name);
      expect(cols, getTableName(t)).toContain("workspace_id");
    }
    expect(tables.length).toBeGreaterThan(20);
  });

  it("money columns are integers (bigint), never floats", () => {
    for (const t of tables) {
      for (const c of Object.values(getTableColumns(t))) {
        if (c.name.endsWith("_minor")) expect(c.getSQLType(), `${getTableName(t)}.${c.name}`).toBe("bigint");
      }
    }
  });

  it("timestamps are timestamptz", () => {
    for (const t of tables) {
      for (const c of Object.values(getTableColumns(t))) {
        if (c.name.endsWith("_at")) expect(c.getSQLType(), `${getTableName(t)}.${c.name}`).toContain("with time zone");
      }
    }
  });
});
