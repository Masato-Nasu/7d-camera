# 7D CAMERA

**写真にも、消費期限を。**

駐車位置、値札、伝票、分解前の記録など、「一週間だけ残ればよい写真」を通常の写真一覧に混ぜず、利用者本人のGoogle Driveへ保存するPWAです。

[公開版を開く](https://7d-camera.pages.dev/) · [プライバシーポリシー](https://7d-camera.pages.dev/privacy.html) · [利用規約](https://7d-camera.pages.dev/terms.html)

![7D CAMERAのメイン画面](docs/images/app-hero.png)

## コンセプト

普通のカメラは、撮った写真をすべて残そうとします。しかし、日常の写真には「役目が終われば消えてよいもの」も多くあります。

7D CAMERAは、そうした写真を最初から一時保存として扱います。必要になった写真だけを`KEEP`へ移し、それ以外は期限後の次回接続時にGoogle Driveのゴミ箱へ移します。

> 保存しないのではない。役目が終わるまで預ける。

## 主な機能

- iPhone／Android共通のPWA
- カメラ撮影または写真選択
- 長辺2560pxのJPEGへ軽量化
- 利用者本人のGoogle Driveへ直接アップロード
- `7D CAMERA`と`7D CAMERA/KEEP`フォルダを自動作成
- 残り日数の表示
- KEEP、即時削除、URL共有
- ホーム画面への追加案内
- 期限切れ写真をGoogle Driveのゴミ箱へ移動

写真とGoogleアクセストークンは運営者のサーバーを経由しません。権限は、アプリ自身が作成したファイルだけを扱う`drive.file`を使用します。

## 利用方法

1. [公開URL](https://7d-camera.pages.dev/)をSafariまたはChromeで開く
2. 「Googleで始める」を押す
3. Google Driveへのアクセスを許可する
4. 「撮る」を押して撮影する
5. 残したい写真は期限内にKEEPへ移す

### ホーム画面へ追加

- iPhone：Safariの共有ボタン →「ホーム画面に追加」
- Android：Chromeのメニュー →「アプリをインストール」または「ホーム画面に追加」

LINE、Instagram、Gmailなどのアプリ内ブラウザではPWAを追加できない場合があります。その場合はSafariまたはChromeで開き直してください。

## 構成

```text
スマートフォン
  └─ 7D CAMERA（Cloudflare Pages）
       └─ Google OAuth
            └─ 利用者本人のGoogle Drive
                 ├─ 7D CAMERA
                 └─ KEEP
```

静的なHTML、CSS、JavaScriptだけで動作します。専用のアプリサーバーやデータベースは使用しません。

## 削除タイミング

この公開版は静的PWAです。ブラウザを閉じている間はGoogle Driveへアクセスできません。

期限切れ写真は、7日経過後に利用者がアプリを再度開き、Google Driveへ接続した時点でゴミ箱へ移ります。アプリを開かなくても毎日厳密に整理するには、更新トークンを安全に保管するサーバー側の定期処理が別途必要です。

`apps-script/Code.gs`は、自分専用に毎日整理を追加したい場合の任意ファイルです。一般利用者には設定を求めないでください。

## ファイル構成

```text
.
├─ index.html
├─ app.js
├─ styles.css
├─ config.js
├─ sw.js
├─ manifest.webmanifest
├─ privacy.html
├─ terms.html
├─ icons/
├─ apps-script/
├─ docs/images/
└─ deploy_7D_CAMERA.ps1
```

## 現在のバージョン

`v0.2.3`

- Google OAuthクライアントID設定済み
- Cloudflare Pages公開済み
- Google Auth Platform本番公開済み
- ローディング表示が残る問題を修正

## 注意事項

- Google Driveの空き容量を使用します。
- ゴミ箱へ移した写真は、Google Drive側の仕様に従って保持・削除されます。
- OAuthやCloudflareの管理画面は変更される場合があります。
- フォークして利用する場合は、自分のOAuthクライアントIDと公開URLへ必ず差し替えてください。
