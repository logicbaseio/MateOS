import * as zod from "zod";

export const AuthUserSchema = zod.object({
  id: zod.string(),
  email: zod.string().nullable().optional(),
  firstName: zod.string().nullable().optional(),
  lastName: zod.string().nullable().optional(),
  profileImageUrl: zod.string().nullable().optional(),
});

export type AuthUser = zod.infer<typeof AuthUserSchema>;
