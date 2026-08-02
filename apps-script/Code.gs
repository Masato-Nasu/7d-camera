/**
 * 7D CAMERA — 毎日の自動整理
 *
 * 使い方:
 * 1. script.google.com で新しいプロジェクトを作る
 * 2. この内容を Code.gs に貼り付ける
 * 3. setup7DCameraCleanup() を一度実行して権限を許可する
 *
 * 毎日およそ午前3時（Asia/Tokyo）に、期限切れ写真を
 * Google Driveのゴミ箱へ移します。KEEPフォルダ内は対象外です。
 */

const ROOT_FOLDER_NAME = '7D CAMERA';
const CLEANUP_FUNCTION = 'cleanupExpiredPhotos';
const ROOT_FOLDER_ID_KEY = '7D_CAMERA_ROOT_FOLDER_ID';

function setup7DCameraCleanup() {
  const folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (!folders.hasNext()) {
    throw new Error('Google Driveに「7D CAMERA」フォルダがありません。先にPWAから写真を1枚保存してください。');
  }

  const folder = folders.next();
  PropertiesService.getScriptProperties().setProperty(ROOT_FOLDER_ID_KEY, folder.getId());

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === CLEANUP_FUNCTION)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(CLEANUP_FUNCTION)
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();

  cleanupExpiredPhotos();
  console.log('7D CAMERAの毎日自動整理を設定しました。');
}

function cleanupExpiredPhotos() {
  const folderId = PropertiesService.getScriptProperties().getProperty(ROOT_FOLDER_ID_KEY);
  if (!folderId) {
    throw new Error('先に setup7DCameraCleanup() を実行してください。');
  }

  const folder = DriveApp.getFolderById(folderId);
  const now = Date.now();
  let moved = 0;
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const description = file.getDescription() || '';

    if (!description.startsWith('7D_CAMERA')) continue;
    if (/^kept=1$/m.test(description)) continue;

    const match = description.match(/^expiresAt=(.+)$/m);
    if (!match) continue;

    const expiresAt = Date.parse(match[1].trim());
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      file.setTrashed(true);
      moved += 1;
    }
  }

  console.log(`${moved}枚をGoogle Driveのゴミ箱へ移しました。`);
  return moved;
}

function remove7DCameraCleanup() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === CLEANUP_FUNCTION)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  PropertiesService.getScriptProperties().deleteProperty(ROOT_FOLDER_ID_KEY);
  console.log('7D CAMERAの自動整理を解除しました。');
}
