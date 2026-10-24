-- 21 Oct: admin "Deactivate user" -- null = active; set = no sign-in, records kept.
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
