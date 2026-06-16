import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, teamChannelsTable } from "@workspace/db";
import {
  ListTeamChannelsResponse,
  CreateTeamChannelBody,
  ListTeamChannelsResponseItem,
  UpdateTeamChannelParams,
  UpdateTeamChannelBody,
  UpdateTeamChannelResponse,
  DeleteTeamChannelParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/team-channels", async (_req, res): Promise<void> => {
  const channels = await db.select().from(teamChannelsTable);
  res.json(ListTeamChannelsResponse.parse(channels));
});

router.post("/team-channels", async (req, res): Promise<void> => {
  const parsed = CreateTeamChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [channel] = await db
    .insert(teamChannelsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(ListTeamChannelsResponseItem.parse(channel));
});

router.patch("/team-channels/:id", async (req, res): Promise<void> => {
  const params = UpdateTeamChannelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTeamChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(teamChannelsTable)
    .set(parsed.data)
    .where(eq(teamChannelsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Team channel not found" });
    return;
  }

  res.json(UpdateTeamChannelResponse.parse(updated));
});

router.delete("/team-channels/:id", async (req, res): Promise<void> => {
  const params = DeleteTeamChannelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(teamChannelsTable)
    .where(eq(teamChannelsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Team channel not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
