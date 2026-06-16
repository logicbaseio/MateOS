import type { Request } from "express";
import type { AuthUser } from "@workspace/api-zod";

export function getAuthMode(): "local" | "oidc" {
  return process.env.MATEOS_AUTH_MODE === "oidc" ? "oidc" : "local";
}

export function isLocalAuthMode(): boolean {
  return getAuthMode() === "local";
}

export function getLocalAdminUser(): AuthUser {
  return {
    id: process.env.MATEOS_LOCAL_ADMIN_ID ?? "mateos.local",
    email: process.env.MATEOS_LOCAL_ADMIN_EMAIL ?? "owner@example.com",
    firstName: process.env.MATEOS_LOCAL_ADMIN_FIRST_NAME ?? "MateOS",
    lastName: process.env.MATEOS_LOCAL_ADMIN_LAST_NAME ?? "Admin",
    profileImageUrl: null,
  };
}

export function shouldUseSecureCookies(req: Request): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return proto === "https" || req.secure;
}
