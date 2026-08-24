import { z } from "zod";

export const addTeamMemberSchema = z.object({
  userId: z.string().min(1),
  canSeeMoney: z.boolean().default(false),
});
