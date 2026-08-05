/**
 * stock-No.1 — GAS プロキシ
 *
 * ダッシュボードの「インポート」画面から送られてくる暗号化済みスナップショットを受け取り、
 * GitHub Contents API 経由でリポジトリ（sync/配下）にコミットする。
 * データは常にクライアント側で暗号化済みのものが送られてくるため、このスクリプト自身は
 * 復号もNotion連携も行わない（my_dashboard/kokkaigiin-kankei-dbのGASとは書き込み先が異なる）。
 *
 * スクリプトプロパティに以下を設定すること:
 *   SHARED_TOKEN  … フロント側と共有する合言葉（インポート画面の合言葉と同じもの）
 *   GITHUB_TOKEN  … リポジトリへの書き込み権限を持つ GitHub Personal Access Token (repo scope)
 *   GITHUB_REPO   … "andcokey/stock-No.1"
 *   GITHUB_BRANCH … 省略時 "main"
 *
 * デプロイ: 「ウェブアプリとして導入」→ アクセスできるユーザー「全員」
 * フロント側は POST 時に Content-Type: text/plain を指定し、CORS プリフライトを回避すること。
 */

function doGet(e) {
  return handle(e);
}

function doPost(e) {
  return handle(e);
}

function handle(e) {
  try {
    var params = parseParams(e);
    var sharedToken = getProp('SHARED_TOKEN');
    if (!sharedToken || params.token !== sharedToken) {
      return jsonOut({ ok: false, error: '認証エラー: token不一致' });
    }

    var result;
    switch (params.action) {
      case 'saveForecast':
        result = saveSnapshot('forecast', params.snapshotDate, params.data);
        break;
      case 'saveTarget':
        result = saveSnapshot('target', params.snapshotDate, params.data);
        break;
      default:
        return jsonOut({ ok: false, error: '不明なaction: ' + params.action });
    }
    return jsonOut({ ok: true, data: result });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/**
 * sync/<domain>-latest.enc.json を上書きし、sync/<domain>-<snapshotDate>.enc.json を新規作成する。
 * data は既にクライアント側でAES-256-GCM暗号化済みのオブジェクト（{__enc:1,...}）を想定。
 */
function saveSnapshot(domain, snapshotDate, data) {
  if (!data || data.__enc !== 1) throw new Error('data は暗号化済みオブジェクトである必要があります');
  var content = JSON.stringify(data);
  var latestPath = 'sync/' + domain + '-latest.enc.json';
  var datedPath = 'sync/' + domain + '-' + (snapshotDate || 'unknown') + '.enc.json';

  var latestResult = putFile(latestPath, content, 'Update ' + domain + ' snapshot (' + snapshotDate + ')');
  var datedResult = putFile(datedPath, content, 'Add ' + domain + ' snapshot history (' + snapshotDate + ')');
  return { latest: latestResult, dated: datedResult };
}

function putFile(path, content, message) {
  var repo = getProp('GITHUB_REPO');
  var branch = getProp('GITHUB_BRANCH') || 'main';
  var token = getProp('GITHUB_TOKEN');
  var base = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(path);

  var sha = null;
  var getRes = UrlFetchApp.fetch(base + '?ref=' + branch, {
    method: 'get',
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  if (getRes.getResponseCode() === 200) {
    sha = JSON.parse(getRes.getContentText()).sha;
  }

  var payload = {
    message: message,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch,
  };
  if (sha) payload.sha = sha;

  var putRes = UrlFetchApp.fetch(base, {
    method: 'put',
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (putRes.getResponseCode() >= 300) {
    throw new Error('GitHub commit失敗 (' + path + '): ' + putRes.getResponseCode() + ' ' + putRes.getContentText());
  }
  var body = JSON.parse(putRes.getContentText());
  return { path: path, commitSha: body.commit && body.commit.sha };
}

function parseParams(e) {
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents) || {};
    } catch (err) {
      return {};
    }
  }
  return (e.parameter) || {};
}

function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
