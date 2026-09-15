const DRIVE_API = "https://www.googleapis.com/drive/v3";

/**
 * "Anyone with the link → Viewer" (user request, 10 Sep — "public view
 * access of sheet to anyone"). Only callable with the OAuth access token
 * of the file's actual owner (googleOAuthClient.js) — the service account
 * has no permission to change sharing on a file it doesn't own.
 */
export async function makeFilePublicViewable({ accessToken, fileId }) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  });
  if (!res.ok) {
    throw new Error(`Google Drive API error sharing file: ${res.status} ${await res.text()}`);
  }
}
