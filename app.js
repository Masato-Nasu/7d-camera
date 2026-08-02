(() => {
  "use strict";

  const config = window.SEVEN_D_CONFIG || {};
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const DRIVE_API = "https://www.googleapis.com/drive/v3";
  const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const APP_KEY = "sevenDCamera";
  const APP_VALUE = "1";
  const MAX_GALLERY_ITEMS = 36;
  const THUMBNAIL_CONCURRENCY = 3;

  const dom = {
    connectButton: document.querySelector("#connectButton"),
    connectLabel: document.querySelector("#connectLabel"),
    shareButton: document.querySelector("#shareButton"),
    cameraButton: document.querySelector("#cameraButton"),
    cameraInput: document.querySelector("#cameraInput"),
    refreshButton: document.querySelector("#refreshButton"),
    installButton: document.querySelector("#installButton"),
    summaryBar: document.querySelector("#summaryBar"),
    photoCount: document.querySelector("#photoCount"),
    urgentCount: document.querySelector("#urgentCount"),
    emptyState: document.querySelector("#emptyState"),
    emptyTitle: document.querySelector("#emptyTitle"),
    emptyText: document.querySelector("#emptyText"),
    photoGrid: document.querySelector("#photoGrid"),
    captureDialog: document.querySelector("#captureDialog"),
    capturePreview: document.querySelector("#capturePreview"),
    retakeButton: document.querySelector("#retakeButton"),
    saveButton: document.querySelector("#saveButton"),
    confirmDialog: document.querySelector("#confirmDialog"),
    confirmTitle: document.querySelector("#confirmTitle"),
    confirmText: document.querySelector("#confirmText"),
    confirmActionButton: document.querySelector("#confirmActionButton"),
    installDialog: document.querySelector("#installDialog"),
    installTitle: document.querySelector("#installTitle"),
    installText: document.querySelector("#installText"),
    loadingOverlay: document.querySelector("#loadingOverlay"),
    loadingText: document.querySelector("#loadingText"),
    toast: document.querySelector("#toast"),
    photoCardTemplate: document.querySelector("#photoCardTemplate")
  };

  const state = {
    tokenClient: null,
    accessToken: null,
    tokenExpiresAt: 0,
    rootFolderId: localStorage.getItem("7d_root_folder_id") || "",
    keepFolderId: localStorage.getItem("7d_keep_folder_id") || "",
    pendingBlob: null,
    pendingPreviewUrl: "",
    files: [],
    objectUrls: new Map(),
    deferredInstallPrompt: null,
    pendingConfirmAction: null,
    toastTimer: null,
    busy: false
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindEvents();
    registerServiceWorker();
    updateDisconnectedUI();

    if (isConfigured()) {
      prepareTokenClient();
    } else {
      dom.connectLabel.textContent = "準備中";
      dom.emptyTitle.textContent = "公開設定が完了していません";
      dom.emptyText.textContent = "配布者がGoogle OAuthの初期設定を完了すると、利用できるようになります。";
    }
  }

  function bindEvents() {
    dom.connectButton.addEventListener("click", () => connectDrive());
    dom.shareButton.addEventListener("click", shareApp);
    dom.cameraButton.addEventListener("click", async () => {
      if (hasValidToken()) {
        dom.cameraInput.click();
        return;
      }
      await connectDrive({ openCameraAfter: true });
    });
    dom.cameraInput.addEventListener("change", handleSelectedPhoto);
    dom.saveButton.addEventListener("click", savePendingPhoto);
    dom.retakeButton.addEventListener("click", clearPendingPhoto);
    dom.captureDialog.addEventListener("close", () => {
      if (dom.captureDialog.returnValue === "cancel") clearPendingPhoto();
    });
    dom.refreshButton.addEventListener("click", refreshLibrary);
    dom.confirmActionButton.addEventListener("click", async () => {
      const action = state.pendingConfirmAction;
      state.pendingConfirmAction = null;
      dom.confirmDialog.close();
      if (action) await action();
    });

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      dom.installButton.textContent = "インストール";
    });

    window.addEventListener("appinstalled", () => {
      state.deferredInstallPrompt = null;
      dom.installButton.textContent = "インストール済み";
      showToast("ホーム画面に追加しました");
    });

    dom.installButton.addEventListener("click", handleInstallRequest);
  }

  async function shareApp() {
    const shareData = {
      title: "7D CAMERA",
      text: "一週間だけ残ればよい写真を、自分のGoogle Driveへ預けるカメラ。",
      url: window.location.href.split("#")[0]
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(shareData.url);
      showToast("URLをコピーしました");
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        showToast("共有できませんでした");
      }
    }
  }

  async function handleInstallRequest() {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      dom.installButton.textContent = "アプリとして使う";
      return;
    }

    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

    if (isStandalone) {
      dom.installTitle.textContent = "インストール済みです";
      dom.installText.textContent = "7D CAMERAはホーム画面からアプリとして起動できます。";
    } else if (isIOS) {
      dom.installTitle.textContent = "iPhoneに追加";
      dom.installText.textContent = "Safariで開き、共有ボタンを押して「ホーム画面に追加」を選んでください。LINEやGmail内のブラウザでは追加できない場合があります。";
    } else if (isAndroid) {
      dom.installTitle.textContent = "Androidに追加";
      dom.installText.textContent = "Chromeのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。";
    } else {
      dom.installTitle.textContent = "アプリとして使う";
      dom.installText.textContent = "ブラウザのメニューから「インストール」または「ホーム画面に追加」を選んでください。";
    }
    dom.installDialog.showModal();
  }

  function isConfigured() {
    const id = String(config.GOOGLE_CLIENT_ID || "").trim();
    return id && !id.includes("PASTE_YOUR_");
  }

  async function prepareTokenClient() {
    try {
      await waitForGoogleIdentityServices();
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: () => {}
      });
      dom.connectButton.disabled = false;
    } catch (error) {
      console.error(error);
      dom.connectButton.disabled = false;
      dom.connectLabel.textContent = "認証を再読込";
    }
  }

  async function connectDrive({ openCameraAfter = false } = {}) {
    if (state.busy) return false;
    if (!isConfigured()) {
      showToast("公開者側のGoogle設定が完了していません");
      return false;
    }

    try {
      if (!state.tokenClient) {
        showToast("Google認証を準備しています。もう一度押してください");
        prepareTokenClient();
        return false;
      }

      setBusy(true, "Google Driveへ接続しています");
      const tokenResponse = await requestAccessToken();
      if (tokenResponse.error) throw new Error(tokenResponse.error_description || tokenResponse.error);

      state.accessToken = tokenResponse.access_token;
      const expiresIn = Number(tokenResponse.expires_in || 3600);
      state.tokenExpiresAt = Date.now() + (expiresIn * 1000) - 60_000;
      localStorage.setItem("7d_google_consent", "1");

      updateConnectedUI();
      await bootstrapDrive();
      await cleanupExpiredPhotos();
      await loadPhotos();
      showToast("Google Driveに接続しました");
      if (openCameraAfter) window.setTimeout(() => dom.cameraInput.click(), 120);
      return true;
    } catch (error) {
      console.error(error);
      updateDisconnectedUI();
      showToast(readableError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestAccessToken() {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Google認証がタイムアウトしました")), 60_000);
      state.tokenClient.callback = response => {
        clearTimeout(timeout);
        resolve(response);
      };
      const hasGrantedConsent = localStorage.getItem("7d_google_consent") === "1";
      state.tokenClient.requestAccessToken({ prompt: hasGrantedConsent ? "" : "consent" });
    });
  }

  function waitForGoogleIdentityServices() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 15_000) {
          clearInterval(timer);
          reject(new Error("Google認証ライブラリを読み込めませんでした"));
        }
      }, 120);
    });
  }

  async function bootstrapDrive() {
    assertToken();
    state.rootFolderId = await ensureFolder({
      cachedId: state.rootFolderId,
      name: config.ROOT_FOLDER_NAME || "7D CAMERA",
      parentId: null,
      role: "root"
    });
    localStorage.setItem("7d_root_folder_id", state.rootFolderId);

    state.keepFolderId = await ensureFolder({
      cachedId: state.keepFolderId,
      name: config.KEEP_FOLDER_NAME || "KEEP",
      parentId: state.rootFolderId,
      role: "keep"
    });
    localStorage.setItem("7d_keep_folder_id", state.keepFolderId);
  }

  async function ensureFolder({ cachedId, name, parentId, role }) {
    if (cachedId) {
      try {
        const existing = await driveFetch(`/files/${encodeURIComponent(cachedId)}?fields=id,name,trashed,mimeType`);
        if (!existing.trashed && existing.mimeType === "application/vnd.google-apps.folder") return existing.id;
      } catch (error) {
        console.warn("Cached folder was unavailable", error);
      }
    }

    const clauses = [
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `appProperties has { key='${APP_KEY}' and value='${APP_VALUE}' }`,
      `appProperties has { key='role' and value='${role}' }`
    ];
    if (parentId) clauses.push(`'${parentId}' in parents`);

    const params = new URLSearchParams({
      q: clauses.join(" and "),
      spaces: "drive",
      fields: "files(id,name,parents,appProperties)",
      pageSize: "10"
    });
    const result = await driveFetch(`/files?${params}`);
    if (result.files?.length) return result.files[0].id;

    const metadata = {
      name,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { [APP_KEY]: APP_VALUE, role }
    };
    if (parentId) metadata.parents = [parentId];

    const created = await driveFetch("/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata)
    });
    return created.id;
  }

  async function handleSelectedPhoto(event) {
    const [file] = event.target.files || [];
    if (!file) return;

    try {
      setBusy(true, "写真を準備しています");
      state.pendingBlob = await compressImage(file);
      state.pendingPreviewUrl = URL.createObjectURL(state.pendingBlob);
      dom.capturePreview.src = state.pendingPreviewUrl;
      dom.captureDialog.showModal();
    } catch (error) {
      console.error(error);
      showToast("写真を読み込めませんでした");
      clearPendingPhoto();
    } finally {
      setBusy(false);
    }
  }

  async function compressImage(file) {
    const image = await loadImage(file);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const maxSide = 2560;
    const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) throw new Error("画像変換に失敗しました");
    return blob;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像をデコードできませんでした"));
      };
      image.src = url;
    });
  }

  async function savePendingPhoto() {
    if (!state.pendingBlob) return;
    try {
      assertToken();
      setBusy(true, "Google Driveへ保存しています");
      const createdAt = new Date();
      const expiryDays = Number(config.EXPIRY_DAYS || 7);
      const expiresAt = new Date(createdAt.getTime() + expiryDays * DAY_MS);
      const name = makeFilename(createdAt);

      await uploadPhoto({
        blob: state.pendingBlob,
        name,
        createdAt,
        expiresAt
      });

      dom.captureDialog.close();
      clearPendingPhoto();
      await loadPhotos();
      showToast("7日間の一時保存を開始しました");
    } catch (error) {
      console.error(error);
      showToast(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto({ blob, name, createdAt, expiresAt }) {
    const metadata = {
      name,
      parents: [state.rootFolderId],
      mimeType: "image/jpeg",
      description: buildDescription({ createdAt, expiresAt, kept: false }),
      appProperties: {
        [APP_KEY]: APP_VALUE,
        createdAt: String(createdAt.getTime()),
        expiresAt: String(expiresAt.getTime()),
        kept: "0"
      }
    };

    const boundary = `seven_d_${crypto.randomUUID().replaceAll("-", "")}`;
    const multipart = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });

    return driveUploadFetch("/files?uploadType=multipart&fields=id,name,createdTime,appProperties", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart
    });
  }

  function buildDescription({ createdAt, expiresAt, kept }) {
    const lines = [
      "7D_CAMERA",
      `createdAt=${createdAt.toISOString()}`,
      `kept=${kept ? "1" : "0"}`
    ];
    if (expiresAt) lines.push(`expiresAt=${expiresAt.toISOString()}`);
    return lines.join("\n");
  }

  async function refreshLibrary() {
    if (!hasValidToken()) {
      showToast("Google Driveへ再接続してください");
      return;
    }
    try {
      setBusy(true, "写真を更新しています");
      await cleanupExpiredPhotos();
      await loadPhotos();
      showToast("最新の状態に更新しました");
    } catch (error) {
      console.error(error);
      showToast(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadPhotos() {
    assertToken();
    revokeObjectUrls();

    const params = new URLSearchParams({
      q: `'${state.rootFolderId}' in parents and trashed = false and appProperties has { key='${APP_KEY}' and value='${APP_VALUE}' }`,
      spaces: "drive",
      fields: "files(id,name,createdTime,mimeType,size,thumbnailLink,webViewLink,description,appProperties)",
      orderBy: "createdTime desc",
      pageSize: String(MAX_GALLERY_ITEMS)
    });
    const result = await driveFetch(`/files?${params}`);
    state.files = (result.files || []).filter(file => file.mimeType?.startsWith("image/") && file.appProperties?.kept !== "1");
    renderPhotos();
    await loadThumbnails(state.files);
  }

  function renderPhotos() {
    dom.photoGrid.replaceChildren();
    const files = state.files;
    const urgent = files.filter(file => remainingDays(file) <= 1).length;

    dom.photoCount.textContent = `${files.length}枚`;
    dom.urgentCount.textContent = `今日まで ${urgent}枚`;
    dom.summaryBar.hidden = files.length === 0;

    if (files.length === 0) {
      dom.emptyState.hidden = false;
      dom.emptyTitle.textContent = "一時保存中の写真はありません";
      dom.emptyText.textContent = "上のシャッターから、残さなくてよい写真を撮影できます。";
      return;
    }

    dom.emptyState.hidden = true;
    for (const file of files) {
      const node = dom.photoCardTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.fileId = file.id;
      const days = remainingDays(file);
      const badge = node.querySelector(".days-badge");
      badge.textContent = days <= 1 ? "今日まで" : `あと${days}日`;
      if (days <= 1) badge.classList.add("urgent");

      const date = new Date(Number(file.appProperties?.createdAt) || file.createdTime);
      const time = node.querySelector(".photo-date");
      time.dateTime = date.toISOString();
      time.textContent = formatDate(date);

      node.querySelector(".keep-button").addEventListener("click", () => confirmKeep(file));
      node.querySelector(".trash-button").addEventListener("click", () => confirmTrash(file));
      dom.photoGrid.append(node);
    }
  }

  async function loadThumbnails(files) {
    const queue = [...files];
    const workers = Array.from({ length: Math.min(THUMBNAIL_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const file = queue.shift();
        if (!file) continue;
        try {
          const blob = await fetchThumbnailBlob(file);
          const url = URL.createObjectURL(blob);
          state.objectUrls.set(file.id, url);
          const card = dom.photoGrid.querySelector(`[data-file-id="${CSS.escape(file.id)}"]`);
          const image = card?.querySelector(".photo-image");
          const placeholder = card?.querySelector(".photo-placeholder");
          if (image) {
            image.src = url;
            image.addEventListener("load", () => image.classList.add("loaded"), { once: true });
          }
          if (placeholder) image?.addEventListener("load", () => placeholder.remove(), { once: true });
        } catch (error) {
          console.warn(`Thumbnail failed for ${file.id}`, error);
        }
      }
    });
    await Promise.all(workers);
  }

  async function fetchThumbnailBlob(file) {
    if (file.thumbnailLink) {
      try {
        const thumbnailResponse = await fetch(file.thumbnailLink, { headers: authorizationHeader() });
        if (thumbnailResponse.ok) return thumbnailResponse.blob();
      } catch (error) {
        console.warn("Drive thumbnail URL failed; falling back to file media", error);
      }
    }

    const mediaUrl = `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`;
    const mediaResponse = await fetch(mediaUrl, { headers: authorizationHeader() });
    if (!mediaResponse.ok) throw new Error(`画像取得エラー (${mediaResponse.status})`);
    return mediaResponse.blob();
  }

  function confirmKeep(file) {
    openConfirm({
      title: "この写真を残しますか？",
      text: "Google Driveの「KEEP」フォルダへ移動し、自動削除の対象から外します。",
      actionLabel: "KEEPへ移す",
      danger: false,
      action: () => keepPhoto(file)
    });
  }

  function confirmTrash(file) {
    openConfirm({
      title: "今すぐ削除しますか？",
      text: "Google Driveのゴミ箱へ移します。ゴミ箱から復元できます。",
      actionLabel: "ゴミ箱へ",
      danger: true,
      action: () => trashPhoto(file)
    });
  }

  function openConfirm({ title, text, actionLabel, danger, action }) {
    dom.confirmTitle.textContent = title;
    dom.confirmText.textContent = text;
    dom.confirmActionButton.textContent = actionLabel;
    dom.confirmActionButton.className = danger ? "danger-button" : "primary-button";
    state.pendingConfirmAction = action;
    dom.confirmDialog.showModal();
  }

  async function keepPhoto(file) {
    try {
      setBusy(true, "KEEPへ移しています");
      const createdAtMs = Number(file.appProperties?.createdAt) || new Date(file.createdTime).getTime();
      const params = new URLSearchParams({
        addParents: state.keepFolderId,
        removeParents: state.rootFolderId,
        fields: "id,parents,appProperties"
      });
      await driveFetch(`/files/${encodeURIComponent(file.id)}?${params}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: buildDescription({ createdAt: new Date(createdAtMs), expiresAt: null, kept: true }),
          appProperties: {
            [APP_KEY]: APP_VALUE,
            createdAt: String(createdAtMs),
            expiresAt: "0",
            kept: "1"
          }
        })
      });
      await loadPhotos();
      showToast("KEEPへ移しました");
    } catch (error) {
      console.error(error);
      showToast(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function trashPhoto(file) {
    try {
      setBusy(true, "ゴミ箱へ移しています");
      await trashFile(file.id);
      await loadPhotos();
      showToast("Google Driveのゴミ箱へ移しました");
    } catch (error) {
      console.error(error);
      showToast(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function cleanupExpiredPhotos() {
    assertToken();
    const params = new URLSearchParams({
      q: `'${state.rootFolderId}' in parents and trashed = false and appProperties has { key='${APP_KEY}' and value='${APP_VALUE}' }`,
      spaces: "drive",
      fields: "files(id,mimeType,appProperties)",
      pageSize: "1000"
    });
    const result = await driveFetch(`/files?${params}`);
    const now = Date.now();
    const expired = (result.files || []).filter(file => {
      if (!file.mimeType?.startsWith("image/")) return false;
      if (file.appProperties?.kept === "1") return false;
      const expiresAt = Number(file.appProperties?.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now;
    });

    for (const file of expired) await trashFile(file.id);
    if (expired.length) showToast(`${expired.length}枚を期限切れとしてゴミ箱へ移しました`);
  }

  function trashFile(fileId) {
    return driveFetch(`/files/${encodeURIComponent(fileId)}?fields=id,trashed`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true })
    });
  }

  async function driveFetch(path, options = {}) {
    assertToken();
    const response = await fetch(`${DRIVE_API}${path}`, {
      ...options,
      headers: {
        ...authorizationHeader(),
        ...(options.headers || {})
      }
    });
    return parseGoogleResponse(response);
  }

  async function driveUploadFetch(path, options = {}) {
    assertToken();
    const response = await fetch(`${DRIVE_UPLOAD_API}${path}`, {
      ...options,
      headers: {
        ...authorizationHeader(),
        ...(options.headers || {})
      }
    });
    return parseGoogleResponse(response);
  }

  async function parseGoogleResponse(response) {
    if (response.status === 204) return {};
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Google Drive APIエラー (${response.status})`;
      if (response.status === 401) {
        state.accessToken = null;
        state.tokenExpiresAt = 0;
        updateDisconnectedUI();
      }
      throw new Error(message);
    }
    return data;
  }

  function authorizationHeader() {
    return { Authorization: `Bearer ${state.accessToken}` };
  }

  function assertToken() {
    if (!hasValidToken()) throw new Error("Google Driveへ再接続してください");
  }

  function hasValidToken() {
    return Boolean(state.accessToken && Date.now() < state.tokenExpiresAt);
  }

  function updateConnectedUI() {
    dom.connectButton.classList.add("connected");
    dom.connectLabel.textContent = "接続済み";
    dom.cameraButton.disabled = false;
    dom.refreshButton.disabled = false;
    dom.emptyTitle.textContent = "写真を読み込んでいます";
    dom.emptyText.textContent = "Google Driveの専用フォルダを確認しています。";
  }

  function updateDisconnectedUI() {
    dom.connectButton.classList.remove("connected");
    if (isConfigured()) dom.connectLabel.textContent = "Googleで始める";
    dom.cameraButton.disabled = false;
    dom.refreshButton.disabled = true;
    dom.summaryBar.hidden = true;
    dom.photoGrid.replaceChildren();
    dom.emptyState.hidden = false;
    if (isConfigured()) {
      dom.emptyTitle.textContent = "Googleで始めてください";
      dom.emptyText.textContent = "一度許可すると、このアプリが作成した写真だけを管理します。";
    }
  }

  function remainingDays(file) {
    const expiresAt = Number(file.appProperties?.expiresAt);
    if (!expiresAt) return Number(config.EXPIRY_DAYS || 7);
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function makeFilename(date) {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(date).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `7DC_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}.jpg`;
  }

  function clearPendingPhoto() {
    state.pendingBlob = null;
    dom.cameraInput.value = "";
    dom.capturePreview.removeAttribute("src");
    if (state.pendingPreviewUrl) URL.revokeObjectURL(state.pendingPreviewUrl);
    state.pendingPreviewUrl = "";
  }

  function revokeObjectUrls() {
    for (const url of state.objectUrls.values()) URL.revokeObjectURL(url);
    state.objectUrls.clear();
  }

  function setBusy(busy, text = "処理しています") {
    state.busy = busy;
    dom.loadingText.textContent = text;
    dom.loadingOverlay.hidden = !busy;
    dom.connectButton.disabled = busy;
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    state.toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 3600);
  }

  function readableError(error) {
    const message = String(error?.message || error || "処理に失敗しました");
    if (message.includes("popup_closed")) return "Google認証画面が閉じられました";
    if (message.includes("access_denied")) return "Google Driveへのアクセスが許可されませんでした";
    if (message.includes("Failed to fetch")) return "通信できませんでした。ネット接続を確認してください";
    return message;
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }
})();
