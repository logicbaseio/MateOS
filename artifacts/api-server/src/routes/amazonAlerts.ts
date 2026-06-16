import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, amazonAlertsTable, teamChannelsTable } from "@workspace/db";
import {
  ListAmazonAlertsQueryParams,
  ListAmazonAlertsResponse,
  UpdateAmazonAlertParams,
  UpdateAmazonAlertBody,
  UpdateAmazonAlertResponse,
  ProcessIncomingEmailBody,
  ProcessIncomingEmailResponse,
} from "@workspace/api-zod";
import { postAlertToTeamsChannel } from "../lib/teamsNotifier";

const router: IRouter = Router();

router.get("/amazon-alerts", async (req, res): Promise<void> => {
  const query = ListAmazonAlertsQueryParams.safeParse(req.query);
  const conditions = [];

  if (query.success) {
    if (query.data.status) {
      conditions.push(eq(amazonAlertsTable.status, query.data.status));
    }
    if (query.data.priority) {
      conditions.push(eq(amazonAlertsTable.priority, query.data.priority));
    }
  }

  let alerts;
  if (conditions.length > 0) {
    alerts = await db
      .select()
      .from(amazonAlertsTable)
      .where(and(...conditions))
      .orderBy(desc(amazonAlertsTable.receivedAt));
  } else {
    alerts = await db
      .select()
      .from(amazonAlertsTable)
      .orderBy(desc(amazonAlertsTable.receivedAt));
  }

  res.json(ListAmazonAlertsResponse.parse(alerts));
});

router.patch("/amazon-alerts/:id", async (req, res): Promise<void> => {
  const params = UpdateAmazonAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAmazonAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(amazonAlertsTable)
    .set(parsed.data)
    .where(eq(amazonAlertsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }

  res.json(UpdateAmazonAlertResponse.parse(updated));
});

function classifyEmail(subject: string, body: string) {
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();
  const combined = subjectLower + " " + bodyLower;

  let alertType = "general";
  if (combined.includes("listing") || combined.includes("asin")) alertType = "listing_issue";
  else if (combined.includes("account") && combined.includes("health")) alertType = "account_health";
  else if (combined.includes("policy") || combined.includes("violation")) alertType = "policy_violation";
  else if (combined.includes("payment") || combined.includes("disbursement")) alertType = "payment";
  else if (combined.includes("inventory") || combined.includes("stock")) alertType = "inventory";
  else if (combined.includes("review") || combined.includes("feedback")) alertType = "review";
  else if (combined.includes("order") || combined.includes("return")) alertType = "order";
  else if (combined.includes("advertising") || combined.includes("campaign")) alertType = "advertising";

  let priority: "critical" | "high" | "medium" | "low" = "medium";
  if (combined.includes("urgent") || combined.includes("suspend") || combined.includes("deactivat") || combined.includes("immediately")) priority = "critical";
  else if (combined.includes("warning") || combined.includes("violation") || combined.includes("action required")) priority = "high";
  else if (combined.includes("notice") || combined.includes("reminder")) priority = "low";

  const accountMatch = combined.match(/account[:\s#]*([a-z0-9-]+)/i) ||
    combined.match(/seller[:\s#]*([a-z0-9-]+)/i);
  const amazonAccountId = accountMatch ? accountMatch[1] : "unknown";

  return { alertType, priority, amazonAccountId };
}

router.post("/amazon-alerts/process", async (req, res): Promise<void> => {
  const parsed = ProcessIncomingEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { alertType, priority, amazonAccountId } = classifyEmail(
    parsed.data.subject,
    parsed.data.body
  );

  const matchingChannels = await db
    .select()
    .from(teamChannelsTable)
    .where(
      and(
        eq(teamChannelsTable.amazonAccountId, amazonAccountId),
        eq(teamChannelsTable.isActive, true)
      )
    );

  let routedToTeam: string | null = null;
  let routedToChannel: string | null = null;
  let matchedChannel: typeof matchingChannels[number] | null = null;

  if (matchingChannels.length > 0) {
    const bestMatch = matchingChannels.find(ch =>
      ch.alertTypes.includes(alertType)
    ) || matchingChannels[0];
    routedToTeam = bestMatch.teamName;
    routedToChannel = bestMatch.channelName;
    matchedChannel = bestMatch;
  }

  const [alert] = await db
    .insert(amazonAlertsTable)
    .values({
      subject: parsed.data.subject,
      body: parsed.data.body,
      senderEmail: parsed.data.senderEmail,
      amazonAccountId,
      alertType,
      priority,
      status: routedToTeam ? "routed" : "new",
      routedToTeam,
      routedToChannel,
      receivedAt: new Date(parsed.data.receivedAt),
      processedAt: new Date(),
    })
    .returning();

  if (matchedChannel && routedToTeam && routedToChannel) {
    setImmediate(() => {
      postAlertToTeamsChannel(
        {
          id: alert.id,
          subject: alert.subject,
          alertType: alert.alertType,
          priority: alert.priority,
          amazonAccountId: alert.amazonAccountId,
          body: alert.body,
        },
        routedToTeam!,
        routedToChannel!,
        matchedChannel!.msTeamId,
        matchedChannel!.msChannelId,
      );
    });
  }

  const result = {
    alertCreated: true,
    alertId: alert.id,
    amazonAccountId,
    alertType,
    priority,
    routedTo: routedToTeam ? `${routedToTeam} / ${routedToChannel}` : null,
    message: routedToTeam
      ? `Alert routed to ${routedToTeam} / ${routedToChannel}`
      : "Alert created but no matching team channel found for routing",
  };

  res.json(ProcessIncomingEmailResponse.parse(result));
});

export default router;
