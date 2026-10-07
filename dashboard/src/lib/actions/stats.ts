"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { patches } from "@/db/schema";

export interface DashboardStats {
  totalCleared: number;
  passRate: number;
  prsMonitored: number;
  hoursSaved: number;
  chartData: { day: string; fixes: number }[];
}

const PRS_MONITORED = 1;

const HOURS_SAVED_PER_PATCH = 0.5;
const CHART_DAYS = 7;

export async function getDashboardStats(): Promise<DashboardStats> {
  const [{ total, merged }] = await db
    .select({
      total: sql<number>`count(*)`,
      merged: sql<number>`count(*) filter (where ${patches.status} = 'merged')`,
    })
    .from(patches);

  const totalGenerated = Number(total);
  const totalCleared = Number(merged);
  const passRate =
    totalGenerated === 0 ? 0 : Math.round((totalCleared / totalGenerated) * 100);
  const hoursSaved = totalCleared * HOURS_SAVED_PER_PATCH;

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  rangeStart.setDate(rangeStart.getDate() - (CHART_DAYS - 1));

  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${patches.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)`,
    })
    .from(patches)
    .where(and(eq(patches.status, "merged"), gte(patches.createdAt, rangeStart)))
    .groupBy(sql`to_char(${patches.createdAt}, 'YYYY-MM-DD')`);

  const countByDay = new Map(dailyRows.map((row) => [row.day, Number(row.count)]));

  const chartData = Array.from({ length: CHART_DAYS }, (_, i) => {
    const date = new Date(rangeStart);
    date.setDate(rangeStart.getDate() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      fixes: countByDay.get(key) ?? 0,
    };
  });

  return {
    totalCleared,
    passRate,
    prsMonitored: PRS_MONITORED,
    hoursSaved,
    chartData,
  };
}
