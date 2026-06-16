import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, and, sql } from "drizzle-orm";
import { db, customersTable, customerInteractionsTable, meetingRequestsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/customers", async (req, res): Promise<void> => {
  try {
    const { search, tier, status } = req.query as Record<string, string | undefined>;
    let query = db.select().from(customersTable).$dynamic();
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(customersTable.name, `%${search}%`),
          ilike(customersTable.email, `%${search}%`),
          sql`${customersTable.company} ilike ${'%' + search + '%'}`,
          sql`${customersTable.phone} ilike ${'%' + search + '%'}`,
        )
      );
    }
    if (tier) {
      conditions.push(eq(customersTable.tier, tier));
    }
    if (status) {
      conditions.push(eq(customersTable.status, status));
    }

    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }

    const customers = await query.orderBy(desc(customersTable.lastContactAt));

    const customersWithCounts = await Promise.all(
      customers.map(async (customer) => {
        const [meetingCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(meetingRequestsTable)
          .where(eq(meetingRequestsTable.customerId, customer.id));
        return {
          ...customer,
          meetingCount: meetingCount?.count ?? 0,
        };
      })
    );

    res.json(customersWithCounts);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/customers", async (req, res): Promise<void> => {
  try {
    const { name, email, phone, company, tier, status, notes, currency } = req.body as Record<string, string | undefined>;
    if (!name || !email) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }
    const [customer] = await db
      .insert(customersTable)
      .values({
        name,
        email,
        phone: phone || null,
        company: company || null,
        tier: tier || "new",
        status: status || "active",
        notes: notes || null,
        currency: currency || "USD",
      })
      .returning();
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/customers/lookup", async (req, res): Promise<void> => {
  try {
    const { q } = req.query as { q?: string };
    if (!q) {
      res.status(400).json({ error: "q query param required" });
      return;
    }
    const results = await db
      .select()
      .from(customersTable)
      .where(
        or(
          ilike(customersTable.name, `%${q}%`),
          ilike(customersTable.email, `%${q}%`),
          sql`${customersTable.phone} ilike ${'%' + q + '%'}`,
        )
      )
      .limit(5);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/customers/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid customer ID" });
      return;
    }
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, id));
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const interactions = await db
      .select()
      .from(customerInteractionsTable)
      .where(eq(customerInteractionsTable.customerId, id))
      .orderBy(desc(customerInteractionsTable.createdAt));

    const meetingRequests = await db
      .select()
      .from(meetingRequestsTable)
      .where(eq(meetingRequestsTable.customerId, id))
      .orderBy(desc(meetingRequestsTable.createdAt));

    res.json({ ...customer, interactions, meetingRequests });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid customer ID" });
      return;
    }
    const allowed = ["name", "email", "phone", "company", "tier", "status", "notes", "currency"] as const;
    const updateData: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) updateData[key] = (req.body as Record<string, unknown>)[key];
    }
    updateData.lastContactAt = new Date();

    const [updated] = await db
      .update(customersTable)
      .set(updateData)
      .where(eq(customersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid customer ID" });
      return;
    }
    const [deleted] = await db
      .delete(customersTable)
      .where(eq(customersTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/customers/:id/interactions", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid customer ID" });
      return;
    }
    const { type, title, notes, metadata } = req.body as {
      type?: string;
      title?: string;
      notes?: string;
      metadata?: unknown;
    };
    if (!type || !title) {
      res.status(400).json({ error: "type and title are required" });
      return;
    }
    const [interaction] = await db
      .insert(customerInteractionsTable)
      .values({ customerId: id, type, title, notes: notes || null, metadata: metadata ?? null })
      .returning();

    await db
      .update(customersTable)
      .set({ lastContactAt: new Date() })
      .where(eq(customersTable.id, id));

    res.status(201).json(interaction);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/customers/:id/revenue", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid customer ID" });
      return;
    }
    const { amount, description, currency } = req.body as {
      amount?: number | string;
      description?: string;
      currency?: string;
    };
    if (amount === undefined || amount === null || amount === "") {
      res.status(400).json({ error: "amount is required" });
      return;
    }
    const amountNum = typeof amount === "number" ? amount : parseFloat(String(amount));
    if (isNaN(amountNum)) {
      res.status(400).json({ error: "amount must be a valid number" });
      return;
    }

    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const newTotal = parseFloat(String(customer.totalRevenue)) + amountNum;
    const [updated] = await db
      .update(customersTable)
      .set({ totalRevenue: String(newTotal), lastContactAt: new Date() })
      .where(eq(customersTable.id, id))
      .returning();

    await db
      .insert(customerInteractionsTable)
      .values({
        customerId: id,
        type: "revenue",
        title: `Revenue added: ${currency ?? customer.currency} ${amountNum.toFixed(2)}`,
        notes: description || null,
        metadata: { amount: amountNum, currency: currency ?? customer.currency },
      });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
