// Excelの日付セル（Dateオブジェクト／シリアル値／{__date:"YYYY-MM-DD"}）を "YYYY-MM" キーに正規化する。

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // Excelのシリアル値0 = 1899-12-30

export function toMonthKey(cell) {
  if (cell == null) return null;
  if (cell instanceof Date) {
    return `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof cell === "object" && typeof cell.__date === "string") {
    return cell.__date.slice(0, 7);
  }
  if (typeof cell === "number") {
    const ms = EXCEL_EPOCH_UTC + cell * 86400000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof cell === "string" && /^\d{4}-\d{2}/.test(cell)) {
    return cell.slice(0, 7);
  }
  return null;
}

export function isDateLike(cell) {
  return toMonthKey(cell) !== null;
}

export function compareMonthKey(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addMonths(monthKey, n) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
