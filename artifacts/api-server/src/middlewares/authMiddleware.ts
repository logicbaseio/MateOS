import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import { getSession, getSessionId } from "../lib/auth";
import { getLocalAdminUser, isLocalAuthMode } from "../lib/runtime";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

const PUBLIC_PREFIXES = [
  "/api/microsoft/login",
  "/api/microsoft/callback",
  "/api/microsoft/logout",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/health",
  "/api/webhooks/",
  "/api/brain/teams-webhook",
  "/api/voice/",
];

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p));
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (sid) {
    const session = await getSession(sid);
    if (session?.user) {
      req.user = session.user;
      return next();
    }
  }

  if (isPublicPath(req.path)) {
    return next();
  }

  // This is a private single-user admin dashboard — all non-webhook routes
  // are accessible without a session. Security is enforced at the infra level
  // (private domain / known URL). Individual sensitive integrations (Microsoft
  // calendar, etc.) use their own OAuth flows.
  if (isLocalAuthMode()) {
    req.user = getLocalAdminUser();
  }
  return next();
}
