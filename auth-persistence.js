(() => {
  "use strict";

  const CONSENT_KEY = "7d_google_consent";
  const LEGACY_TOKEN_KEY = "7d_google_access_token";
  const LEGACY_EXPIRES_KEY = "7d_google_access_token_expires_at";
  const SESSION_ENDPOINT = "/api/oauth/session";
  const START_ENDPOINT = "/api/oauth/start";

  let autoRestore = localStorage.getItem(CONSENT_KEY) === "1";
  let restoreTriggered = false;

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get("oauth") === "connected") {
    localStorage.setItem(CONSENT_KEY, "1");
    autoRestore = true;
    currentUrl.searchParams.delete("oauth");
    history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }

  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_EXPIRES_KEY);

  function startPersistentOAuth() {
    window.location.assign(START_ENDPOINT);
  }

  async function requestServerAccessToken() {
    const response = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });

    if (response.status === 401) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error("Cloudflare側のGoogle Client Secretが未設定です");
      }
      throw new Error(data?.error || `Googleセッション更新エラー (${response.status})`);
    }
    if (!data?.access_token) throw new Error("Googleアクセストークンを取得できませんでした");
    return data;
  }

  function installPersistentTokenClient() {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2 || oauth2.__sevenDServerSessionWrapped) return false;

    oauth2.initTokenClient = config => {
      let activeCallback = typeof config?.callback === "function" ? config.callback : () => {};

      const client = {
        requestAccessToken(overrideConfig = {}) {
          const prompt = String(overrideConfig?.prompt || "");
          const hasConsent = localStorage.getItem(CONSENT_KEY) === "1";

          if (!hasConsent || prompt.includes("consent")) {
            startPersistentOAuth();
            return;
          }

          requestServerAccessToken()
            .then(tokenResponse => {
              if (!tokenResponse) {
                startPersistentOAuth();
                return;
              }
              activeCallback(tokenResponse);
            })
            .catch(error => {
              console.error("7D CAMERA persistent auth failed", error);
              activeCallback({
                error: "persistent_auth_failed",
                error_description: error.message
              });
            });
        }
      };

      Object.defineProperty(client, "callback", {
        configurable: true,
        enumerable: true,
        get() {
          return activeCallback;
        },
        set(value) {
          activeCallback = typeof value === "function" ? value : () => {};
        }
      });

      if (autoRestore && !restoreTriggered) {
        restoreTriggered = true;
        window.setTimeout(() => {
          const connectButton = document.querySelector("#connectButton");
          const connectLabel = document.querySelector("#connectLabel");
          if (!connectButton || connectLabel?.textContent === "接続済み") return;
          connectButton.click();
        }, 0);
      }

      return client;
    };

    oauth2.__sevenDServerSessionWrapped = true;
    return true;
  }

  if (!installPersistentTokenClient()) {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (installPersistentTokenClient() || Date.now() - started > 15_000) {
        clearInterval(timer);
      }
    }, 50);
  }
})();
