import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, meetingRequestsTable, preferencesTable } from "@workspace/db";
import {
  ListMeetingRequestsQueryParams,
  ListMeetingRequestsResponse,
  CreateMeetingRequestBody,
  ListMeetingRequestsResponseItem,
  GetMeetingRequestParams,
  GetMeetingRequestResponse,
  UpdateMeetingRequestParams,
  UpdateMeetingRequestBody,
  UpdateMeetingRequestResponse,
  SuggestMeetingTimeParams,
  SuggestMeetingTimeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/meeting-requests", async (req, res): Promise<void> => {
  const query = ListMeetingRequestsQueryParams.safeParse(req.query);
  let requests;
  if (query.success && query.data.status) {
    requests = await db
      .select()
      .from(meetingRequestsTable)
      .where(eq(meetingRequestsTable.status, query.data.status))
      .orderBy(desc(meetingRequestsTable.createdAt));
  } else {
    requests = await db
      .select()
      .from(meetingRequestsTable)
      .orderBy(desc(meetingRequestsTable.createdAt));
  }
  res.json(ListMeetingRequestsResponse.parse(requests));
});

router.post("/meeting-requests", async (req, res): Promise<void> => {
  const parsed = CreateMeetingRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [request] = await db
    .insert(meetingRequestsTable)
    .values({
      requesterName: parsed.data.requesterName,
      requesterEmail: parsed.data.requesterEmail,
      purpose: parsed.data.purpose,
      urgency: parsed.data.urgency,
      preferredDate: new Date(parsed.data.preferredDate),
    })
    .returning();

  res.status(201).json(ListMeetingRequestsResponseItem.parse(request));
});

router.get("/meeting-requests/:id", async (req, res): Promise<void> => {
  const params = GetMeetingRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [request] = await db
    .select()
    .from(meetingRequestsTable)
    .where(eq(meetingRequestsTable.id, params.data.id));

  if (!request) {
    res.status(404).json({ error: "Meeting request not found" });
    return;
  }

  res.json(GetMeetingRequestResponse.parse(request));
});

router.patch("/meeting-requests/:id", async (req, res): Promise<void> => {
  const params = UpdateMeetingRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateMeetingRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.status) updateData.status = parsed.data.status;
  if (parsed.data.bossResponse) updateData.bossResponse = parsed.data.bossResponse;
  if (parsed.data.scheduledTime) updateData.scheduledTime = new Date(parsed.data.scheduledTime);

  const [updated] = await db
    .update(meetingRequestsTable)
    .set(updateData)
    .where(eq(meetingRequestsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Meeting request not found" });
    return;
  }

  res.json(UpdateMeetingRequestResponse.parse(updated));
});

router.post("/meeting-requests/:id/suggest", async (req, res): Promise<void> => {
  const params = SuggestMeetingTimeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [request] = await db
    .select()
    .from(meetingRequestsTable)
    .where(eq(meetingRequestsTable.id, params.data.id));

  if (!request) {
    res.status(404).json({ error: "Meeting request not found" });
    return;
  }

  let [prefs] = await db.select().from(preferencesTable).limit(1);
  if (!prefs) {
    [prefs] = await db.insert(preferencesTable).values({}).returning();
  }

  const preferredDate = new Date(request.preferredDate);
  const suggestedTime = new Date(preferredDate);

  const timeMap: Record<string, number> = {
    morning: 9,
    afternoon: 14,
    evening: 18,
    night: 22,
  };
  suggestedTime.setHours(timeMap[prefs.preferredMeetingTime] || 14, 0, 0, 0);

  const alt1 = new Date(suggestedTime);
  alt1.setHours(alt1.getHours() + 1);
  const alt2 = new Date(suggestedTime);
  alt2.setHours(alt2.getHours() + 2);

  const moodContext: Record<string, string> = {
    available: "Boss is in a good mood and open to meetings",
    busy: "Boss is busy but this request has been flagged",
    do_not_disturb: "Boss prefers not to be disturbed - only critical meetings",
    flexible: "Boss is flexible with timing today",
  };

  const suggestion = {
    suggestedTime: suggestedTime.toISOString(),
    reasoning: `Based on ${prefs.bossName}'s preferences: Currently in ${prefs.currentCity} (${prefs.timezone}). ${moodContext[prefs.mood] || "Available"}. Prefers ${prefs.preferredMeetingTime} meetings. Request urgency: ${request.urgency}. Purpose: ${request.purpose}.`,
    alternativeTimes: [alt1.toISOString(), alt2.toISOString()],
    contextNotes: `${prefs.bossName} has a max of ${prefs.maxMeetingsPerDay} meetings/day with ${prefs.meetingDurationMinutes}min duration and ${prefs.breakBetweenMeetings}min breaks. ${prefs.notes || "No additional notes."}`,
  };

  const [updated] = await db
    .update(meetingRequestsTable)
    .set({ botSuggestion: suggestion.reasoning })
    .where(eq(meetingRequestsTable.id, params.data.id))
    .returning();

  res.json(SuggestMeetingTimeResponse.parse(suggestion));
});

export default router;
