import { z } from "zod";
import { PERMISSION_KEYS } from "../../lib/permissions.js";

const permissionsShape = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, z.boolean().optional()]));

// Email is required and is the new account's login (24 Sep); the password
// is generated server-side. Phone is optional contact info.
export const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  phoneNumber: z.string().min(8).max(15).optional(),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"]).default("CREATOR"),
  // Sub-admin creation (newTask.md, 8 Sep) for ADMIN; granted-access
  // creation (15 Sep) for every other role — see auth/service.js's signup.
  permissions: z.object(permissionsShape).strict().optional(),
});

// Email + password only (24 Sep) — phone-number login is gone.
export const loginSchema = z.object({
  email: z.string().trim().email("Enter your email address").max(254),
  password: z.string().min(1),
});

const otpCode = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

// remember: the "Remember this device for 7 days" checkbox (23 Sep) —
// defaults true so an older client that never sends it keeps the original
// always-remember behavior.
export const verifyLoginOtpSchema = z.object({ challengeToken: z.string().min(1), code: otpCode, remember: z.boolean().default(true) });
export const resendLoginOtpSchema = z.object({ challengeToken: z.string().min(1) });

// challengeToken is only sent by a locked-out login; an in-app caller
// authenticates with its bearer token instead (see routes.js).
export const startEmailVerificationSchema = z.object({
  email: z.string().email().max(254),
  challengeToken: z.string().min(1).optional(),
});
export const confirmEmailVerificationSchema = z.object({
  code: otpCode,
  challengeToken: z.string().min(1).optional(),
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
