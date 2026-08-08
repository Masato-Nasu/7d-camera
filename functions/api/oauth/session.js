const CLIENT_ID = "657550956452-ockcho1n5v9vagkcrr80b63eidauleei.apps.googleusercontent.com";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SESSION_COOKIE = "7d_refresh_session";

function parseCookies(request) {
  const result = {};
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptionKey(secret) {
  const material = new TextEncoder().encode(`7d-camera-refresh-v1:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function openRefreshToken(value, secret) {
  const [ivPart, ciphertextPart] = String(value || "").split(".");
  if (!ivPart || !ciphertextPart) throw new Error("invalid session");
  const key = await encryptionKey(secret);
  const iv = fromBase64Url(ivPart);
  const ciphertext = fromBase64Url(ciphertextPart);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (payload?.v !== 1 || !payload?.refreshToken) throw new Error("invalid session");
  return payload.refreshToken;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders
    }
  });
}

function clearSessionResponse(message, status = 401) {
  return json(
    { error: message },
    status,
    { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0` }
  );
}

export async function onRequestPost(context) {
  const secret = context.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return json({ error: "server_not_configured" }, 503);

  const cookies = parseCookies(context.request);
  const sealed = cookies[SESSION_COOKIE];
  if (!sealed) return json({ error: "no_session" }, 401);

  let refreshToken;
  try {
    refreshToken = await openRefreshToken(sealed, secret);
  } catch (error) {
    console.error("7D CAMERA session decrypt failed", error);
    return clearSessionResponse("invalid_session");
  }

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokens = await tokenResponse.json().catch(() => ({}));

  if (!tokenResponse.ok || !tokens.access_token) {
    console.error("Google refresh failed", tokens?.error || tokenResponse.status);
    if (tokens?.error === "invalid_grant") return clearSessionResponse("google_session_expired");
    return json({ error: "refresh_failed" }, 502);
  }

  return json({
    access_token: tokens.access_token,
    expires_in: Number(tokens.expires_in || 3600),
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || "https://www.googleapis.com/auth/drive.file"
  });
}
