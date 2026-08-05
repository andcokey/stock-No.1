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
