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
