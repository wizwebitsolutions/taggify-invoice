import { z } from "zod";
import { PERMISSION_KEYS } from "../../lib/permissions.js";

// Every key optional — an admin only ever sends the ones they're changing,
// not a full re-declaration of the whole set (see adminService.updateUserPermissions
// for the merge-with-existing-overlay behavior that makes that safe).
const permissionsShape = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, z.boolean().optional()]));

export const updatePermissionsSchema = z.object({
  permissions: z.object(permissionsShape).strict(),
});

// Admin sets a user's email — their login (24 Sep).
export const updateUserEmailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
});

// Admin edits another account's contact + address (12 Oct, People → Edit
// details). Every field optional — only what changed is sent; a blank
// string clears it. Email is NOT here: changing someone's login stays on
// updateUserEmailSchema's own guarded flow.
const clearable = (schema) => z.union([z.literal(""), schema]).optional();
export const updateUserDetailsSchema = z
  .object({
    name: z.string().trim().min(1, "Name can't be empty").max(100).optional(),
    phoneNumber: clearable(z.string().regex(/^\+91\d{10}$/, "Phone must be +91 followed by 10 digits")),
    secondaryPhone: clearable(z.string().min(8).max(15)),
    addressLine1: clearable(z.string().trim().max(200)),
    addressLine2: clearable(z.string().trim().max(200)),
    state: clearable(z.string().trim().max(60)),
    pincode: clearable(z.string().regex(/^\d{6}$/, "Pincode must be 6 digits")),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
