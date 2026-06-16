import { Router, type IRouter, type Request, type Response } from "express";
import { fetchAccessToken } from "hume";

const router: IRouter = Router();

const ZARA_CONFIG_ID = "79d22afd-439b-4e6a-991c-6125a979edd7";

router.get("/hume/token", async (_req: Request, res: Response): Promise<void> => {
  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "HUME_API_KEY not configured" });
    return;
  }

  const secretKey = process.env.HUME_SECRET_KEY;

  try {
    if (secretKey) {
      const accessToken = await fetchAccessToken({ apiKey, secretKey });
      res.json({ accessToken, configId: ZARA_CONFIG_ID, authMode: "token" });
    } else {
      res.json({ apiKey, configId: ZARA_CONFIG_ID, authMode: "apiKey" });
    }
  } catch (err) {
    console.error("[Hume] Failed to get access token:", err);
    res.status(500).json({ error: "Failed to generate Hume access token" });
  }
});

export default router;
