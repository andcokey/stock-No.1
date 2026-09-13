// 会社別「見通管理」ファイルの `商材集計` シート（1商材=集計用コード付きの複数行ブロック）を
// 構造化データに変換する。列位置はヘッダー行のラベル文字列から動的に検出するため、
// 行番号がファイルによって微妙にずれても追従できる。
//
// 入力 rows: 2次元配列（SheetJSの sheet_to_json(ws, {header:1}) と同じ形。0始まりの行・列）。
// 日付セルは Date / Excelシリアル値 / {__date:"YYYY-MM-DD"} のいずれでも良い（dates.mjs参照）。
import { toMonthKey } from "./dates.mjs";

function findHeaderRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    if (row.slice(0, 10).some((v) => v === "商材名")) return r;
  }
  throw new Error("ヘッダー行（「商材名」列）が見つかりませんでした");
}

function indexOfNth(arr, value, n) {
  let idx = -1;
  for (let i = 0; i < n; i++) {
    idx = arr.indexOf(value, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

function detectColumns(headerRow) {
  const productNameDisplay = headerRow.indexOf("商材名");
  const productNameRepeat = indexOfNth(headerRow, "商材名", 2);
  const productNo = headerRow.indexOf("商材番号");
  const metricCode = headerRow.indexOf("集計用");
  const productType = headerRow.indexOf("契約型/習慣型");
  const metricLabel = headerRow.indexOf("項目");
  if ([productNameDisplay, productNo, metricCode, productType, metricLabel].some((i) => i === -1)) {
    throw new Error("必要な列（商材名/商材番号/集計用/契約型/習慣型/項目）が揃っていません");
  }
  return {
    legalName: productNameDisplay - 2,
    companyCode: productNameDisplay - 1,
    productNameDisplay,
    productNameRepeat: productNameRepeat === -1 ? productNameDisplay : productNameRepeat,
    productNo,
    metricCode,
    productType,
    metricLabel,
    dateStart: metricLabel + 1,
  };
}

function detectMonths(headerRow, dateStart) {
  const months = [];
  for (let c = dateStart; c < headerRow.length; c++) {
    const month = toMonthKey(headerRow[c]);
    if (month) months.push({ col: c, month });
  }
  return months;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function readMonthlyValues(row, months) {
  const values = {};
  for (const { col, month } of months) values[month] = toNumberOrNull(row[col]);
  return values;
}

/**
 * 「商材一覧」マスタシート（901_ストック強化_集計シート等）を解析し、
 * (会社コード, 商材名) → 通し番号（グループ全体で一意の商材ID）の対応表を作る。
 * 見通管理ファイル側の「商材番号」列は会社によって空欄運用だったり値が違うことがあるため、
 * このマスタの通し番号を商材IDの正本として使う（parseCompanySheetのproductMasterに渡す）。
 */
function findProductMasterHeaderRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    if (row.includes("通し番号") && row.includes("DIVACODE") && row.includes("商材・事業名")) return r;
  }
  return -1;
}

export function parseProductMaster(rows) {
  const headerRowIdx = findProductMasterHeaderRow(rows);
  if (headerRowIdx === -1) {
    throw new Error("商材一覧のヘッダー行（通し番号/DIVACODE/商材・事業名）が見つかりませんでした");
  }
  const header = rows[headerRowIdx];
  const idCol = header.indexOf("通し番号");
  const codeCol = header.indexOf("DIVACODE");
  const nameCol = header.indexOf("商材・事業名");

  const byCompanyAndName = {}; // { [companyCode]: { [productName]: id } }
  let entryCount = 0;
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const id = row[idCol];
    const code = row[codeCol];
    const name = row[nameCol];
    if (code == null || code === "" || name == null || name === "" || id == null || id === "") continue;
    const companyCode = String(code);
    if (!byCompanyAndName[companyCode]) byCompanyAndName[companyCode] = {};
    byCompanyAndName[companyCode][name] = Number(id);
    entryCount++;
  }
  return { byCompanyAndName, entryCount };
}

/**
 * @param {any[][]} rows
 * @param {{ byCompanyAndName: Record<string, Record<string, number>> } | null} [productMaster]
 *   parseProductMaster()の結果。渡すと商材IDの解決にこのマスタを最優先で使う（未掲載の商材は
 *   従来通りファイル自身の商材番号→フォールバックの順で解決する）。
 * @returns {{
 *   months: string[],
 *   companies: Record<string, {
 *     code: string, name: string,
 *     totals: Record<string, Record<string, number|null>>,
 *     products: Record<string, { productNo: number, name: string, type: string,
 *       metrics: Record<string, { code: number, label: string, values: Record<string, number|null> }> }>
 *   }>,
 *   productMasterStats: { matched: number, unmatched: number, unmatchedNames: string[] }
 * }}
 */
export function parseCompanySheet(rows, productMaster = null) {
  const headerRowIdx = findHeaderRow(rows);
  const col = detectColumns(rows[headerRowIdx]);
  const months = detectMonths(rows[headerRowIdx], col.dateStart);
  const monthKeys = months.map((m) => m.month);

  const companies = {};

  function ensureCompany(code, name) {
    if (!companies[code]) companies[code] = { code, name: name || code, totals: {}, products: {} };
    else if (name && companies[code].name === companies[code].code) companies[code].name = name;
    return companies[code];
  }

  // ヘッダー行より上の「会社サマリー」行（項目名が「（」始まり = （会社）売上高／（契約型）売上高 等）は、
  // 単一会社ファイルなら「その会社の合計」、複数会社を連結したシートなら「グループ合計」を意味する。
  // どちらの会社に属するかはこの時点では確定できないため、いったん保留して検出会社数で後から振り分ける。
  const preHeaderTotals = {};
  for (let r = 0; r < headerRowIdx; r++) {
    const row = rows[r];
    if (!row) continue;
    const label = row[col.metricLabel];
    if (typeof label === "string" && label.startsWith("（")) {
      preHeaderTotals[label] = readMonthlyValues(row, months);
    }
  }

  let lastCompanyCode = null;
  let lastProductName = null;
  let lastProductType = null;
  // 商材番号列を使わず商材名だけで運用している会社（実データで確認済み）向けのフォールバックID発行用。
  // 会社コードごとに連番を振り、実データの商材番号（正の数）と衝突しないよう負数にする。
  const syntheticProductNoCounters = new Map();
  const productMasterStats = { matched: 0, unmatched: 0, unmatchedNames: [] };

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const rawProductNo = row[col.productNo];
    const metricCode = row[col.metricCode];
    const metricLabel = row[col.metricLabel];
    // 商材番号は必須にしない: 商材番号列を空欄のまま運用している会社があり、
    // そこだけ全行が捨てられて会社が丸ごと集計から消えてしまう事故が実際に発生したため。
    if (metricCode == null || metricCode === "" || metricLabel == null || metricLabel === "") continue;

    const rawCompanyCode = row[col.companyCode];
    const companyCode = rawCompanyCode != null && rawCompanyCode !== "" ? String(rawCompanyCode) : lastCompanyCode;
    if (companyCode == null) continue; // 会社コードが特定できない行は捨てる
    lastCompanyCode = companyCode;

    const productName = row[col.productNameRepeat] || row[col.productNameDisplay] || lastProductName;
    lastProductName = productName;
    const productType = row[col.productType] || lastProductType;
    lastProductType = productType;
    if (productName == null) continue; // 商材番号も商材名も無ければ商材を特定できない

    const legalName = typeof row[col.legalName] === "string" ? row[col.legalName].trim() : "";
    const company = ensureCompany(companyCode, legalName || null);

    // 商材名の前後空白ゆれ（同じ商材なのに全角スペース等が付いて別名扱いになる）を吸収してマスタと突き合わせる。
    const productNameTrimmed = typeof productName === "string" ? productName.trim() : productName;
    const masterId = productMaster?.byCompanyAndName[companyCode]?.[productName]
      ?? productMaster?.byCompanyAndName[companyCode]?.[productNameTrimmed];
    const numericProductNo = Number(rawProductNo);
    let key, productNo;
    if (masterId != null) {
      // マスタ（商材一覧）に載っている商材はそちらのIDを正本として使う。
      // ファイル自身の商材番号が空欄・不一致でも、会社をまたいで一意なIDに揃えられる。
      productNo = masterId;
      key = String(productNo);
      if (!company.products[key]) productMasterStats.matched++;
    } else if (rawProductNo != null && rawProductNo !== "" && Number.isFinite(numericProductNo)) {
      // Number.isFinite() で "#ERROR!" 等の壊れた数式結果（Number()がNaNを返す）を弾く。
      // 弾かずに通すとNaNがJSON化時にnullへ化け、目標/見通で商材IDが噛み合わなくなる事故が実際に発生した。
      productNo = numericProductNo;
      key = String(productNo);
    } else {
      key = `name:${productName}`;
      if (company.products[key]) {
        productNo = company.products[key].productNo;
      } else {
        const counter = (syntheticProductNoCounters.get(companyCode) ?? 0) + 1;
        syntheticProductNoCounters.set(companyCode, counter);
        productNo = -counter;
      }
    }
    if (masterId == null && productMaster && !company.products[key]) {
      productMasterStats.unmatched++;
      productMasterStats.unmatchedNames.push(`${companyCode}:${productName}`);
    }

    if (!company.products[key]) {
      company.products[key] = { productNo, name: productName, type: productType, metrics: {} };
    }
    company.products[key].metrics[String(metricCode)] = {
      code: Number(metricCode),
      label: metricLabel,
      values: readMonthlyValues(row, months),
    };
  }

  const companyCodes = Object.keys(companies);
  if (companyCodes.length === 1) {
    // 単一会社ファイル: ヘッダー上の会社サマリー行はそのままその会社の合計として使える
    companies[companyCodes[0]].totals = preHeaderTotals;
  }

  return {
    months: monthKeys,
    companies,
    groupTotals: companyCodes.length === 1 ? null : preHeaderTotals,
    productMasterStats,
  };
}

/**
 * 50社分など、複数ファイルを parseCompanySheet() した結果を1つにまとめる
 * （インポート画面で複数ファイルをドラッグ&ドロップした際に使用）。
 * 同一会社コードが複数ファイルに含まれる場合は後から処理したファイルで上書きする。
 */
export function mergeParsed(parsedList) {
  const monthSet = new Set();
  const companies = {};
  const productMasterStats = { matched: 0, unmatched: 0, unmatchedNames: [] };
  for (const parsed of parsedList) {
    for (const m of parsed.months) monthSet.add(m);
    for (const [code, company] of Object.entries(parsed.companies)) {
      companies[code] = company;
    }
    if (parsed.productMasterStats) {
      productMasterStats.matched += parsed.productMasterStats.matched;
      productMasterStats.unmatched += parsed.productMasterStats.unmatched;
      productMasterStats.unmatchedNames.push(...parsed.productMasterStats.unmatchedNames);
    }
  }
  return { months: [...monthSet].sort(), companies, productMasterStats };
}
