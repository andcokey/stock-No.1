// summary/company/product ページ共通のスナップショット読み込み。
// sync/forecast-latest.enc.json（週次・必須）と sync/target-latest.enc.json（年次・無ければnull）を
// 合言葉で復号して返す。まだインポートされていない場合は forecast:null を返す（404は正常系）。
import { resolveEncrypted } from "./crypto-client.js";

async function fetchJsonOrNull(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export async function loadSnapshots() {
  const [forecastRaw, targetRaw] = await Promise.all([
    fetchJsonOrNull("sync/forecast-latest.enc.json"),
    fetchJsonOrNull("sync/target-latest.enc.json"),
  ]);
  const forecast = forecastRaw ? await resolveEncrypted(forecastRaw) : null;
  const target = targetRaw ? await resolveEncrypted(targetRaw) : null;
  return { forecast, target };
}

// 前週差異用: GitHub Pagesは静的配信のためsync/配下のディレクトリ一覧を取得できない。
// リポジトリがPublicであることを利用し、GitHub Contents API（無認証・CORS対応）でsync/の
// ファイル一覧を取得し、日付入りスナップショット（forecast-YYYY-MM-DD.enc.json）を検出する。
const REPO = "andcokey/stock-No.1";

async function listSnapshotDates(domain) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/sync`, { cache: "no-store" });
    if (!res.ok) return [];
    const files = await res.json();
    const re = new RegExp(`^${domain}-(\\d{4}-\\d{2}-\\d{2})\\.enc\\.json$`);
    return files.map((f) => f.name.match(re)?.[1]).filter(Boolean).sort();
  } catch {
    return [];
  }
}

/**
 * 現在のforecastより前の直近の日付スナップショット（前週分）を取得する。
 * 見つからない場合（初回インポート直後・GitHub API利用不可時など）はnullを返す（正常系、バッジ非表示扱い）。
 */
export async function loadPreviousForecast(currentSnapshotDate) {
  if (!currentSnapshotDate) return null;
  const dates = await listSnapshotDates("forecast");
  const prevDate = dates.filter((d) => d < currentSnapshotDate).at(-1);
  if (!prevDate) return null;
  const raw = await fetchJsonOrNull(`sync/forecast-${prevDate}.enc.json`);
  if (!raw) return null;
  try {
    return await resolveEncrypted(raw);
  } catch {
    return null;
  }
}
