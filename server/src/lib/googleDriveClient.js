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

/**
 * Edit access for one person (8 Oct — "on sheet generation there should be
 * edit access to that email as well who's generating sheet"). No Google
 * notification email: they get the link in the app straight away. Re-sharing
 * someone who already has access is a no-op on Google's side.
 */
export async function shareFileWithEditor({ accessToken, fileId, email }) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions?sendNotificationEmail=false`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
  });
  if (!res.ok) {
    throw new Error(`Google Drive API error sharing file with ${email}: ${res.status} ${await res.text()}`);
  }
}
