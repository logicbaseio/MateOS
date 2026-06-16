import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConversationsTable } from "@workspace/db";
import {
  ListConversationsQueryParams,
  ListConversationsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/conversations", async (req, res): Promise<void> => {
  const query = ListConversationsQueryParams.safeParse(req.query);
  let conversations;
  if (query.success && query.data.botType) {
    conversations = await db
      .select()
      .from(botConversationsTable)
      .where(eq(botConversationsTable.botType, query.data.botType))
      .orderBy(desc(botConversationsTable.createdAt));
  } else {
    conversations = await db
      .select()
      .from(botConversationsTable)
      .orderBy(desc(botConversationsTable.createdAt));
  }
  res.json(ListConversationsResponse.parse(conversations));
});

export default router;
