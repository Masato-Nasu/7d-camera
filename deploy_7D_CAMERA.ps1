$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "7D CAMERA deployment" -ForegroundColor Cyan
Write-Host "--------------------"

$config = Get-Content -Raw -Path ".\config.js"
if ($config -match "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE") {
    Write-Host ""
    Write-Host "Google OAuth クライアントIDはまだ設定されていません。" -ForegroundColor Yellow
    Write-Host "公開URLを先に作成します。URLをGoogle OAuthへ登録し、config.jsを設定後、もう一度デプロイしてください。"
}

Write-Host "Cloudflare Pagesへデプロイします。"
npx wrangler pages deploy . --project-name 7d-camera

Write-Host ""
Write-Host "デプロイが完了しました。" -ForegroundColor Green
