import { z } from "zod";

import { tenantIdSchema, userIdSchema, utcTimestampSchema } from "@signal/contracts";

export const tenantRoleSchema = z.enum([
  "owner",
  "administrator",
  "member",
  "auditor",
  "service_operator",
]);

export const principalSchema = z
  .object({
    subject: z.string().min(1).max(500),
    tenantId: tenantIdSchema,
    userId: userIdSchema,
    roles: z.array(tenantRoleSchema).min(1),
    scopes: z.array(z.string().min(1).max(500)),
    sessionId: z.string().min(8).max(500),
    authenticatedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    deviceId: z.string().min(8).max(500).nullable(),
    delegatedUserId: userIdSchema.optional(),
    supportGrantId: z
      .string()
      .regex(/^sag_[a-zA-Z0-9_-]{8,}$/)
      .optional(),
  })
  .strict();

export type Principal = z.infer<typeof principalSchema>;
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export class AuthorizationError extends Error {
  public constructor(
    message: string,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function requireTenant(principal: Principal, tenantId: string): void {
  if (principal.tenantId !== tenantId) {
    throw new AuthorizationError("The requested resource belongs to another tenant.", "FORBIDDEN");
  }
}

export function requireRole(principal: Principal, roles: readonly TenantRole[]): void {
  if (!principal.roles.some((role) => roles.includes(role))) {
    throw new AuthorizationError("This role cannot perform the requested operation.", "FORBIDDEN");
  }
}

export function requireRecentAuthentication(
  principal: Principal,
  now: Date,
  maximumAgeSeconds: number,
): void {
  const authenticatedAt = new Date(principal.authenticatedAt).getTime();
  if (now.getTime() - authenticatedAt > maximumAgeSeconds * 1_000) {
    throw new AuthorizationError("Recent authentication is required.", "UNAUTHENTICATED");
  }
}

export * from "./device-commands.js";
