import { Router, type IRouter } from "express";
import { eq, sql, and, gte, lt } from "drizzle-orm";
import { db, meetingRequestsTable, amazonAlertsTable, botConversationsTable, teamChannelsTable } from "@workspace/db";
import { GetDashboardStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [pendingResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetingRequestsTable)
    .where(eq(meetingRequestsTable.status, "pending"));

  const [todaysResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetingRequestsTable)
    .where(
      and(
        eq(meetingRequestsTable.status, "scheduled"),
        gte(meetingRequestsTable.scheduledTime, startOfDay),
        lt(meetingRequestsTable.scheduledTime, endOfDay)
      )
    );

  const [activeAlertsResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(amazonAlertsTable)
    .where(eq(amazonAlertsTable.status, "new"));

  const [resolvedAlertsResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(amazonAlertsTable)
    .where(eq(amazonAlertsTable.status, "resolved"));

  const [conversationsResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(botConversationsTable);

  const [teamChannelsResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamChannelsTable);

  const stats = {
    pendingMeetings: pendingResult?.count ?? 0,
    todaysMeetings: todaysResult?.count ?? 0,
    activeAlerts: activeAlertsResult?.count ?? 0,
    resolvedAlerts: resolvedAlertsResult?.count ?? 0,
    totalConversations: conversationsResult?.count ?? 0,
    teamChannels: teamChannelsResult?.count ?? 0,
  };

  res.json(GetDashboardStatsResponse.parse(stats));
});

export default router;
