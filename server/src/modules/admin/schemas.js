import { z } from "zod";
import { PERMISSION_KEYS } from "../../lib/permissions.js";

// Every key optional — an admin only ever sends the ones they're changing,
// not a full re-declaration of the whole set (see adminService.updateUserPermissions
// for the merge-with-existing-overlay behavior that makes that safe).
const permissionsShape = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, z.boolean().optional()]));

export const updatePermissionsSchema = z.object({
  permissions: z.object(permissionsShape).strict(),
});
