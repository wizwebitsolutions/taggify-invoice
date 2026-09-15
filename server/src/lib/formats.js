import { z } from "zod";

/**
 * The only post formats the app accepts anywhere (user request, 14 Sep —
 * "format will [be] for reel and story only, no other format from entire
 * app"). Links, plans, campaign sheet rows, rate cards and the inventory
 * sheet importer all validate against this one list. Rows already stored
 * with an older format (carousel, video, custom names) stay readable —
 * only new writes are limited.
 */
export const FORMATS = ["reel", "story"];
export const formatSchema = z.enum(FORMATS);
