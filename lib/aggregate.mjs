// 901_会社集計／902_商材見通集計／903_対目標売上／対目標スト売上 と同等の集計を
// parseCompanySheet() の出力から計算する。元Excelの数式を実際に確認した上で移植したロジック
// （詳細は docs/design.md 参照）。

const METRIC = {
  SALES: "1", // 売上高（千円）
  STOCK_SALES: "13", // ④ストック売上額（千円）
  RETENTION: "19", // 顧客継続率（新規）
  GROWTH_COUNT: "21", // 顧客増加数
  SALES_YOY: "23", // 売上高 前年同月増加量
};

function findTotalLabel(totals, mustInclude) {
  return Object.keys(totals).find(
    (label) => label.startsWith("（会社）") && mustInclude.every((s) => label.includes(s))
  );
}

/** 商材レベルの指定コードの値を全商材で合計した月次値（会社サマリー行が無い場合のフォールバック用） */
function sumProductMetric(company, metricCode, months) {
  const sums = {};
  for (const month of months) sums[month] = null;
  for (const product of Object.values(company.products)) {
    const values = product.metrics[metricCode]?.values;
    if (!values) continue;
    for (const month of months) {
      if (values[month] == null) continue;
      sums[month] = (sums[month] ?? 0) + values[month];
    }
  }
  return sums;
}

/** 901_会社集計相当: 会社別の月次サマリー（売上高／ストック売上額／ストック比率） */
export function companySummary(parsed) {
  const out = {};
  for (const [code, company] of Object.entries(parsed.companies)) {
    const salesLabel = findTotalLabel(company.totals, ["売上高"]);
    const stockLabel = findTotalLabel(company.totals, ["ストック売上"]);
    const salesByMonth = salesLabel ? company.totals[salesLabel] : sumProductMetric(company, METRIC.SALES, parsed.months);
    const stockByMonth = stockLabel ? company.totals[stockLabel] : sumProductMetric(company, METRIC.STOCK_SALES, parsed.months);
    const monthly = {};
    for (const month of parsed.months) {
      const sales = salesByMonth[month] ?? null;
      const stockSales = stockByMonth[month] ?? null;
      monthly[month] = {
        sales,
        stockSales,
        stockRatio: sales ? (stockSales ?? 0) / sales : null,
      };
    }
    out[code] = { code, name: company.name, monthly };
  }
  return out;
}

/**
 * 901の「目標差異」／903・対目標スト売上 相当: 見通(actual側)と目標(target側)を会社コードで突き合わせ、
 * 月次の差異（見通-目標）を計算する。
 */
export function companyTargetVariance(actualParsed, targetParsed) {
  const actual = companySummary(actualParsed);
  const target = companySummary(targetParsed);
  const out = {};
  for (const code of new Set([...Object.keys(actual), ...Object.keys(target)])) {
    const a = actual[code]?.monthly ?? {};
    const t = target[code]?.monthly ?? {};
    const monthly = {};
    for (const month of actualParsed.months) {
      const am = a[month] ?? { sales: null, stockSales: null };
      const tm = t[month] ?? { sales: null, stockSales: null };
      monthly[month] = {
        sales: { actual: am.sales, target: tm.sales, diff: sub(am.sales, tm.sales) },
        stockSales: { actual: am.stockSales, target: tm.stockSales, diff: sub(am.stockSales, tm.stockSales) },
      };
    }
    out[code] = { code, name: actual[code]?.name ?? target[code]?.name ?? code, monthly };
  }
  return out;
}

/** 903_対目標売上／対目標スト売上 相当: 商材レベルの対目標差異（metricCodeは1=売上高 or 13=ストック売上額） */
export function productTargetVariance(actualParsed, targetParsed, metricCode = METRIC.SALES) {
  const rows = [];
  for (const [companyCode, company] of Object.entries(actualParsed.companies)) {
    const targetCompany = targetParsed.companies[companyCode];
    for (const [productKey, product] of Object.entries(company.products)) {
      const targetProduct = targetCompany?.products?.[productKey];
      const actualValues = product.metrics[metricCode]?.values ?? {};
      const targetValues = targetProduct?.metrics?.[metricCode]?.values ?? {};
      const monthly = {};
      for (const month of actualParsed.months) {
        monthly[month] = sub(actualValues[month] ?? null, targetValues[month] ?? null);
      }
      rows.push({
        companyCode,
        companyName: company.name,
        productNo: product.productNo,
        productName: product.name,
        productType: product.type,
        monthly,
      });
    }
  }
  return rows;
}

function sub(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) - (b ?? 0);
}

/**
 * 全体サマリー冒頭の表示基準（単月 or 年間合計）から、対象月配列を求める。
 * period: {type:"month", value:"YYYY-MM"} または {type:"year", value:"YYYY"}
 */
export function periodMonths(months, period) {
  if (period.type === "year") return months.filter((m) => m.startsWith(period.value + "-"));
  return months.includes(period.value) ? [period.value] : [];
}

export function periodLabel(period) {
  if (period.type === "year") return `${period.value}年（年間合計）`;
  const [y, mo] = period.value.split("-");
  return `${y}年${Number(mo)}月`;
}

/** 901_会社集計相当の全社合計を、表示基準（単月/年間合計）で集約する。対目標・前週差異バッジの共通計算に使う。 */
export function groupTotalsForPeriod(parsed, period) {
  if (!parsed) return { sales: null, stockSales: null, stockRatio: null };
  const months = periodMonths(parsed.months, period);
  let sales = 0, stockSales = 0, any = false;
  for (const c of Object.values(companySummary(parsed))) {
    for (const m of months) {
      const mv = c.monthly[m];
      if (!mv) continue;
      any = true;
      sales += mv.sales || 0;
      stockSales += mv.stockSales || 0;
    }
  }
  if (!any) return { sales: null, stockSales: null, stockRatio: null };
  return { sales, stockSales, stockRatio: sales ? stockSales / sales : null };
}

/** 会社別ランキング用: 会社1件の売上高を、表示基準（単月/年間合計）で集約する。 */
export function companySalesForPeriod(companySummaryRow, period, months) {
  const targetMonths = periodMonths(months, period);
  let sales = 0, any = false;
  for (const m of targetMonths) {
    const mv = companySummaryRow.monthly[m];
    if (!mv) continue;
    any = true;
    sales += mv.sales || 0;
  }
  return any ? sales : 0;
}

/**
 * 商材レベルの対目標差異ランキング用（全体サマリーのTOP5/WORST5ツールチップ）。
 * productTargetVariance は単月の月次系列を返すのに対し、この関数は指定した月配列（単月 or 年間合計）で
 * 実績値・目標差異を商材ごとに合算した1件のスナップショットを返す。
 */
export function productVarianceForPeriod(actualParsed, targetParsed, metricCode, months) {
  const rows = [];
  for (const [companyCode, company] of Object.entries(actualParsed.companies)) {
    const targetCompany = targetParsed.companies[companyCode];
    for (const [productKey, product] of Object.entries(company.products)) {
      const targetProduct = targetCompany?.products?.[productKey];
      const actualValues = product.metrics[metricCode]?.values ?? {};
      const targetValues = targetProduct?.metrics?.[metricCode]?.values ?? {};
      let actual = 0, targetSum = 0, any = false;
      for (const m of months) {
        if (actualValues[m] == null && targetValues[m] == null) continue;
        any = true;
        actual += actualValues[m] ?? 0;
        targetSum += targetValues[m] ?? 0;
      }
      if (!any) continue;
      rows.push({ companyName: company.name, productName: product.name, actual, diff: actual - targetSum });
    }
  }
  return rows;
}

/** 商材1件・指定コードの月次系列を、指定した月配列の順で返す（グラフのスパークライン用）。 */
export function productMetricSeries(parsed, companyCode, productNo, metricCode, months) {
  const values = parsed.companies[companyCode]?.products?.[String(productNo)]?.metrics[metricCode]?.values ?? {};
  return months.map((m) => values[m] ?? null);
}

const QUADRANT_MAP = {
  "○○": "順調成長",
  "×○": "積上純増",
  "○×": "ジレンマ",
  "××": "要改善",
};

function evalMark(value, test) {
  if (value == null) return null;
  return test(value) ? "○" : "×";
}

function average(values) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 902_商材見通集計相当: 商材ごとの成長ステージ4象限分類。
 * boundaryMonth（"YYYY-MM"）より前の直近月を「実績」、以降12ヵ月を「見通」として評価する。
 * 象限は 顧客継続率(新規)≧75% と 顧客増加数>0 の組み合わせのみで決まる
 * （売上高前年同月増加量は達成率の参考値であり、象限分類そのものには使われない — 元Excelの数式で確認済み）。
 */
export function classifyProducts(parsed, { boundaryMonth }) {
  const actualMonths = parsed.months.filter((m) => m < boundaryMonth);
  const forecastMonths = parsed.months.filter((m) => m >= boundaryMonth);
  const lastActualMonth = actualMonths.at(-1);
  const lastForecastMonth = forecastMonths.at(-1);

  const rows = [];
  for (const [companyCode, company] of Object.entries(parsed.companies)) {
    for (const product of Object.values(company.products)) {
      const retention = product.metrics[METRIC.RETENTION]?.values ?? {};
      const growth = product.metrics[METRIC.GROWTH_COUNT]?.values ?? {};
      const salesYoy = product.metrics[METRIC.SALES_YOY]?.values ?? {};

      const actualRetentionMark = evalMark(lastActualMonth ? retention[lastActualMonth] : null, (v) => v >= 0.75);
      const actualGrowthMark = evalMark(lastActualMonth ? growth[lastActualMonth] : null, (v) => v > 0);
      const forecastRetentionMark = evalMark(
        average(forecastMonths.map((m) => retention[m])),
        (v) => v >= 0.75
      );
      const forecastGrowthMark = evalMark(lastForecastMonth ? growth[lastForecastMonth] : null, (v) => v > 0);

      const actualQuadrant =
        actualRetentionMark && actualGrowthMark ? QUADRANT_MAP[actualRetentionMark + actualGrowthMark] : null;
      const forecastQuadrant =
        forecastRetentionMark && forecastGrowthMark
          ? QUADRANT_MAP[forecastRetentionMark + forecastGrowthMark]
          : null;

      rows.push({
        companyCode,
        companyName: company.name,
        productNo: product.productNo,
        productName: product.name,
        productType: product.type,
        actual: {
          retention: actualRetentionMark,
          retentionValue: lastActualMonth ? retention[lastActualMonth] ?? null : null,
          growth: actualGrowthMark,
          growthValue: lastActualMonth ? growth[lastActualMonth] ?? null : null,
          quadrant: actualQuadrant,
          salesYoy: lastActualMonth ? salesYoy[lastActualMonth] ?? null : null,
        },
        forecast: {
          retention: forecastRetentionMark,
          retentionValue: average(forecastMonths.map((m) => retention[m])),
          growth: forecastGrowthMark,
          growthValue: lastForecastMonth ? growth[lastForecastMonth] ?? null : null,
          quadrant: forecastQuadrant,
          salesYoySum: forecastMonths.reduce((sum, m) => sum + (salesYoy[m] ?? 0), 0),
        },
      });
    }
  }
  return rows;
}

// ---- 汎用KPI比較（目標・実績/見通・差異）: ①②③④⑤⑥⑧⑨⑪ ----
// 実データ確認済み: ⑦（アップセル・クロスセル数）⑩（NRR）は元テンプレート（見通管理・目標作成シート双方、
// 商材集計 シート）に項目自体が存在しないため対象外。③は「顧客生涯価値（LTV）」ではなく実際のラベルは
// 「初年度顧客価値（※集客効率算出用）」のため、そのまま表示する（LTVと偽装しない）。
// 集計用コード番号は全50ファイルでの対応が確認し切れていない（docs/design.md参照）ため、
// コード番号ではなくラベル先頭の丸数字で該当行を検出する（テンプレート上不変の識別子として丸数字を使う）。

const RAW_LABEL = {
  sales: (label) => typeof label === "string" && label.includes("売上高"),
  cost: (label) => typeof label === "string" && label.includes("売上原価"),
  marketingCost: (label) => typeof label === "string" && label.includes("マーケティング費用"),
  newCustomers: (label) => typeof label === "string" && label.includes("新規獲得顧客数"),
};

function prefixLabel(prefix) {
  return (label) => typeof label === "string" && label.startsWith(prefix);
}

export const KPI_DEFS = [
  { key: "cac", prefix: "①", label: "①CAC（顧客獲得コスト）", unit: "yen", companyRollup: "recompute-cac" },
  { key: "cacPayback", prefix: "②", label: "②CAC回収期間", unit: "months", companyRollup: "weighted-avg" },
  { key: "firstYearValue", prefix: "③", label: "③初年度顧客価値（集客効率算出用）", unit: "yen", companyRollup: "weighted-avg" },
  { key: "stockSales", prefix: "④", label: "④ストック売上額", unit: "yen", companyRollup: "sum" },
  { key: "customers", prefix: "⑤", label: "⑤顧客数", unit: "count", companyRollup: "sum" },
  { key: "arpu", prefix: "⑥", label: "⑥ARPU（顧客単価）", unit: "yen", companyRollup: "recompute-arpu" },
  { key: "crr", prefix: "⑧", label: "⑧CRR（顧客継続率）", unit: "percent", companyRollup: "weighted-avg" },
  { key: "arr", prefix: "⑨", label: "⑨ARR（年間経常収益）", unit: "yen", companyRollup: "sum" },
  { key: "grossMargin", prefix: "⑪", label: "⑪粗利率", unit: "percent", companyRollup: "recompute-margin" },
];
const STOCK_RATIO_KPI = { key: "stockRatio", label: "ストック比率", unit: "percent" };

function findMetricByLabel(product, predicate) {
  for (const m of Object.values(product.metrics)) {
    if (predicate(m.label)) return m;
  }
  return null;
}

function productValue(product, predicate, month) {
  return findMetricByLabel(product, predicate)?.values?.[month] ?? null;
}

function sumAcross(products, predicate, month) {
  let sum = null;
  for (const product of products) {
    const v = productValue(product, predicate, month);
    if (v == null) continue;
    sum = (sum ?? 0) + v;
  }
  return sum;
}

/** 商材ごとの値を weightPredicate（⑤顧客数）で加重平均する。正確な再計算式が数式で確認できていない指標
 * （②CAC回収期間／③初年度顧客価値／⑧CRR）の近似値として使う。 */
function weightedAvgAcross(products, predicate, weightPredicate, month) {
  let wSum = 0, vwSum = 0;
  for (const product of products) {
    const v = productValue(product, predicate, month);
    const w = productValue(product, weightPredicate, month);
    if (v == null || w == null || w <= 0) continue;
    vwSum += v * w;
    wSum += w;
  }
  return wSum > 0 ? vwSum / wSum : null;
}

/** 会社（またはグループ全体）レベルでのKPIロールアップ。商材ごとの生値を合算・再計算・加重平均で合成する。 */
function rollupKpiValue(products, kpiDef, month) {
  const kpiPredicate = prefixLabel(kpiDef.prefix);
  switch (kpiDef.companyRollup) {
    case "sum":
      return sumAcross(products, kpiPredicate, month);
    case "recompute-cac": {
      const cost = sumAcross(products, RAW_LABEL.marketingCost, month);
      const newCustomers = sumAcross(products, RAW_LABEL.newCustomers, month);
      return newCustomers ? (cost ?? 0) / newCustomers : null;
    }
    case "recompute-arpu": {
      const sales = sumAcross(products, RAW_LABEL.sales, month);
      const customers = sumAcross(products, prefixLabel("⑤"), month);
      return customers ? (sales ?? 0) / customers : null;
    }
    case "recompute-margin": {
      const sales = sumAcross(products, RAW_LABEL.sales, month);
      const cost = sumAcross(products, RAW_LABEL.cost, month);
      return sales ? (sales - (cost ?? 0)) / sales : null;
    }
    case "weighted-avg":
      return weightedAvgAcross(products, kpiPredicate, prefixLabel("⑤"), month);
    default:
      return null;
  }
}

function productsOf(parsed, companyCode) {
  const company = parsed?.companies?.[companyCode];
  return company ? Object.values(company.products) : [];
}

function allProducts(parsed) {
  const list = [];
  for (const company of Object.values(parsed?.companies ?? {})) list.push(...Object.values(company.products));
  return list;
}

/** 会社1件のストック比率／ストック売上額。company.totals（（会社）サマリー行）を優先しフォールバックで商材合算する
 * companySummary()と同じ値を返す。実データで「（会社）」行が商材合算と食い違うケース（入力ミス・#N/A行など）を
 * 確認済みのため、この2指標だけは常にcompanySummary()経由で取得し、KPI一覧の表示とトップのサマリータイルの
 * 数値が食い違わないようにする。 */
function companySalesStockAt(parsed, companyCode, month) {
  const mv = parsed ? companySummary(parsed)[companyCode]?.monthly?.[month] : null;
  return mv ?? { sales: null, stockSales: null, stockRatio: null };
}

/** グループ（全社合計）版。会社ごとにcompanySalesStockAtで取った値を合算してからストック比率を再計算する
 * （商材を全社ぶんフラットに合算するより、会社ごとの「（会社）」行優先ロジックを尊重できる）。 */
function groupSalesStockAt(parsed, month) {
  if (!parsed) return { sales: null, stockSales: null, stockRatio: null };
  const summary = companySummary(parsed);
  let sales = 0, stockSales = 0, any = false;
  for (const c of Object.values(summary)) {
    const mv = c.monthly[month];
    if (!mv) continue;
    any = true;
    sales += mv.sales || 0;
    stockSales += mv.stockSales || 0;
  }
  if (!any) return { sales: null, stockSales: null, stockRatio: null };
  return { sales, stockSales, stockRatio: sales ? stockSales / sales : null };
}

function buildKpiRow(kpiDef, target, actual) {
  return { key: kpiDef.key, label: kpiDef.label, unit: kpiDef.unit, target, actual, diff: sub(actual, target) };
}

/** 会社1件・月1点のKPI一覧（ストック比率＋①②③④⑤⑥⑧⑨⑪）。目標データが無ければtarget側は全てnullになる。 */
export function companyKpiTable(actualParsed, targetParsed, companyCode, month) {
  const actualProducts = productsOf(actualParsed, companyCode);
  const targetProducts = targetParsed ? productsOf(targetParsed, companyCode) : [];
  const actualSS = companySalesStockAt(actualParsed, companyCode, month);
  const targetSS = companySalesStockAt(targetParsed, companyCode, month);
  const rows = [buildKpiRow(STOCK_RATIO_KPI, targetSS.stockRatio, actualSS.stockRatio)];
  for (const kpi of KPI_DEFS) {
    if (kpi.key === "stockSales") {
      rows.push(buildKpiRow(kpi, targetSS.stockSales, actualSS.stockSales));
      continue;
    }
    rows.push(buildKpiRow(kpi, rollupKpiValue(targetProducts, kpi, month), rollupKpiValue(actualProducts, kpi, month)));
  }
  return rows;
}

/** 全社合計（グループ）版。summary.html用。 */
export function groupKpiTable(actualParsed, targetParsed, month) {
  const actualProducts = allProducts(actualParsed);
  const targetProducts = targetParsed ? allProducts(targetParsed) : [];
  const actualGS = groupSalesStockAt(actualParsed, month);
  const targetGS = groupSalesStockAt(targetParsed, month);
  const rows = [buildKpiRow(STOCK_RATIO_KPI, targetGS.stockRatio, actualGS.stockRatio)];
  for (const kpi of KPI_DEFS) {
    if (kpi.key === "stockSales") {
      rows.push(buildKpiRow(kpi, targetGS.stockSales, actualGS.stockSales));
      continue;
    }
    rows.push(buildKpiRow(kpi, rollupKpiValue(targetProducts, kpi, month), rollupKpiValue(actualProducts, kpi, month)));
  }
  return rows;
}

/**
 * 商材1件・月1点のKPI一覧。会社レベルのような再計算・加重平均はせず、元シートの該当行の値をそのまま使う
 * （単一商材を再計算すると元Excelの数式と食い違う可能性があるため、商材レベルでは生値をそのまま出す）。
 */
export function productKpiTable(actualParsed, targetParsed, companyCode, productNo, month) {
  const actualProduct = actualParsed.companies[companyCode]?.products?.[String(productNo)];
  const targetProduct = targetParsed?.companies?.[companyCode]?.products?.[String(productNo)];
  const salesA = actualProduct ? productValue(actualProduct, RAW_LABEL.sales, month) : null;
  const stockA = actualProduct ? productValue(actualProduct, prefixLabel("④"), month) : null;
  const salesT = targetProduct ? productValue(targetProduct, RAW_LABEL.sales, month) : null;
  const stockT = targetProduct ? productValue(targetProduct, prefixLabel("④"), month) : null;
  const rows = [buildKpiRow(
    STOCK_RATIO_KPI,
    salesT ? (stockT ?? 0) / salesT : null,
    salesA ? (stockA ?? 0) / salesA : null,
  )];
  for (const kpi of KPI_DEFS) {
    const a = actualProduct ? productValue(actualProduct, prefixLabel(kpi.prefix), month) : null;
    const t = targetProduct ? productValue(targetProduct, prefixLabel(kpi.prefix), month) : null;
    rows.push(buildKpiRow(kpi, t, a));
  }
  return rows;
}

/**
 * グラフ用の時系列取得。scope.kind: "company"|"group"|"product"。kpiKeyは "stockRatio" または KPI_DEFS の key。
 * 指定した月配列の順で {target[], actual[]} を返す（月ごとに対応するKpiTable関数を呼んで該当行を抜き出す）。
 */
export function kpiSeries(actualParsed, targetParsed, scope, kpiKey, months) {
  const rowsForMonth = (month) => {
    if (scope.kind === "product") return productKpiTable(actualParsed, targetParsed, scope.companyCode, scope.productNo, month);
    if (scope.kind === "company") return companyKpiTable(actualParsed, targetParsed, scope.companyCode, month);
    return groupKpiTable(actualParsed, targetParsed, month);
  };
  const target = [], actual = [];
  for (const month of months) {
    const row = rowsForMonth(month).find((r) => r.key === kpiKey);
    target.push(row?.target ?? null);
    actual.push(row?.actual ?? null);
  }
  return { target, actual };
}

export { METRIC, QUADRANT_MAP };
