import { createServer } from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { handleTwilioHumeBridge } from "./routes/hume-bridge";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

const wss = new WebSocketServer({ server, path: "/api/webhooks/voice/stream" });

wss.on("connection", (ws, req) => {
  const urlParams = new URLSearchParams(req.url?.split("?")[1] ?? "");
  const callerPhone = urlParams.get("caller") ?? "";
  console.log("[ws] Twilio Media Stream connected from:", req.socket.remoteAddress, "caller:", callerPhone);
  handleTwilioHumeBridge(ws, callerPhone);
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
