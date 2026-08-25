import { z } from "zod";

export const signupSchema = z.object({
  phoneNumber: z.string().min(8).max(15),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"]).default("CREATOR"),
});

export const loginSchema = z.object({
  phoneNumber: z.string().min(8).max(15),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// Mirrors the strength rules shown on creator.wldd.in's change-password form.
const strongPassword = z
  .string()
  .min(8)
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: strongPassword,
});
