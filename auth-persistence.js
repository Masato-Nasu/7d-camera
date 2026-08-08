(() => {
  "use strict";

  const TOKEN_KEY = "7d_google_access_token";
  const EXPIRES_KEY = "7d_google_access_token_expires_at";
  const CONSENT_KEY = "7d_google_consent";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const EARLY_EXPIRY_MS = 60_000;

  function clearCachedToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  }

  function readCachedToken() {
    const accessToken = localStorage.getItem(TOKEN_KEY) || "";
    const expiresAt = Number(localStorage.getItem(EXPIRES_KEY) || 0);

    if (!accessToken || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      clearCachedToken();
      return null;
    }

    return {
      access_token: accessToken,
      expires_in: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
      scope: DRIVE_SCOPE,
      token_type: "Bearer"
    };
  }

  function rememberToken(response) {
    if (!response?.access_token) return;

    const expiresIn = Math.max(60, Number(response.expires_in || 3600));
    const expiresAt = Date.now() + expiresIn * 1000 - EARLY_EXPIRY_MS;
    localStorage.setItem(TOKEN_KEY, response.access_token);
    localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  }

  function wrapGoogleTokenClient() {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2 || oauth2.__sevenDPersistenceWrapped) return false;

    const originalInitTokenClient = oauth2.initTokenClient.bind(oauth2);

    oauth2.initTokenClient = config => {
      let activeCallback = typeof config.callback === "function" ? config.callback : () => {};

      const client = originalInitTokenClient({
        ...config,
        callback: response => {
          rememberToken(response);
          activeCallback(response);
        }
      });

      return new Proxy(client, {
        get(target, property, receiver) {
          if (property === "callback") return activeCallback;

          if (property === "requestAccessToken") {
            return overrideConfig => {
              const cachedToken = readCachedToken();
              if (cachedToken) {
                queueMicrotask(() => activeCallback(cachedToken));
                return;
              }
              return target.requestAccessToken.call(target, overrideConfig);
            };
          }

          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },

        set(target, property, value, receiver) {
          if (property === "callback") {
            activeCallback = typeof value === "function" ? value : () => {};
            target.callback = response => {
              rememberToken(response);
              activeCallback(response);
            };
            return true;
          }
          return Reflect.set(target, property, value, receiver);
        }
      });
    };

    oauth2.__sevenDPersistenceWrapped = true;
    return true;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";

    if (response.status === 401 && url.includes("googleapis.com") && url.includes("drive")) {
      clearCachedToken();
    }

    return response;
  };

  if (!wrapGoogleTokenClient()) {
    console.warn("7D CAMERA: Google Identity Services was not ready for session persistence");
  }

  window.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem(CONSENT_KEY) !== "1") return;
    if (!readCachedToken()) return;

    window.setTimeout(() => {
      const connectButton = document.querySelector("#connectButton");
      const connectLabel = document.querySelector("#connectLabel");
      if (!connectButton || connectLabel?.textContent === "接続済み") return;
      connectButton.click();
    }, 350);
  });
})();
