const CLIENT_ID = "657550956452-ockcho1n5v9vagkcrr80b63eidauleei.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = `${url.origin}/api/oauth/callback`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  });

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    "Cache-Control": "no-store"
  });
  headers.append(
    "Set-Cookie",
    `7d_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=600`
  );

  return new Response(null, { status: 302, headers });
}
