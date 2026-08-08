const CLIENT_ID = "657550956452-ockcho1n5v9vagkcrr80b63eidauleei.apps.googleusercontent.com";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SESSION_COOKIE = "7d_refresh_session";
const STATE_COOKIE = "7d_oauth_state";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

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

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function encryptionKey(secret) {
  const material = new TextEncoder().encode(`7d-camera-refresh-v1:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function sealRefreshToken(refreshToken, secret) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    v: 1,
    refreshToken,
    createdAt: Date.now()
  }));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

function errorPage(message, status = 400) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>7D CAMERA</title><style>body{font-family:system-ui,sans-serif;padding:32px;line-height:1.7}a{color:inherit}</style><h1>Google接続を完了できませんでした</h1><p>${message}</p><p><a href="/">7D CAMERAへ戻る</a></p>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  const secret = context.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return errorPage("Cloudflare側のGoogle Client Secretが未設定です。", 503);

  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return errorPage("Google Driveへの許可が完了しませんでした。");
  if (!code || !state) return errorPage("Googleから認証コードを受け取れませんでした。");

  const cookies = parseCookies(context.request);
  if (!cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== state) {
    return errorPage("認証状態を確認できませんでした。もう一度Googleへ接続してください。");
  }

  const redirectUri = `${url.origin}/api/oauth/callback`;
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const tokens = await tokenResponse.json().catch(() => ({}));

  if (!tokenResponse.ok) {
    console.error("Google code exchange failed", tokens?.error || tokenResponse.status);
    return errorPage("Googleの認証コードをトークンへ交換できませんでした。", 502);
  }
  if (!tokens.refresh_token) {
    return errorPage("更新トークンを取得できませんでした。Google接続を一度解除してから、再度接続してください。", 502);
  }

  const sealed = await sealRefreshToken(tokens.refresh_token, secret);
  const headers = new Headers({
    Location: "/?oauth=connected",
    "Cache-Control": "no-store"
  });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sealed}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_MAX_AGE}`
  );
  headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=0`
  );

  return new Response(null, { status: 302, headers });
}
