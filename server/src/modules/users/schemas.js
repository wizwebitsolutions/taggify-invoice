import { z } from "zod";

export const addTeamMemberSchema = z.object({
  userId: z.string().min(1),
  canSeeMoney: z.boolean().default(false),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  secondaryPhone: z.string().min(8).max(15).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  state: z.string().max(60).optional(),
  pincode: z.string().max(10).optional(),
});
