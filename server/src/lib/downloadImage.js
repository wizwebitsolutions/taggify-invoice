/**
 * GETs an image with a short backoff between attempts. Instagram's edge
 * network 403/503s the *identical* URL on a genuinely random fraction of
 * requests (confirmed by hand, 11 Sep — see assets/service.js's profile-pic
 * notes), so one failure means "roll again", not "gone". Shared by the
 * profile-picture proxy (assets) and the post-thumbnail proxy (links).
 */
export async function downloadImage(url, attempts, sourceLabel) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const upstream = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (upstream.ok) return { buffer: Buffer.from(await upstream.arrayBuffer()), contentType: upstream.headers.get("content-type") ?? "image/jpeg" };
      lastError = new Error(`${sourceLabel} returned ${upstream.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  throw lastError;
}
