-- Accounts are created with an email (24 Sep); phone becomes optional contact info.
ALTER TABLE "User" ALTER COLUMN "phoneNumber" DROP NOT NULL;
