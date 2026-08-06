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

export { METRIC, QUADRANT_MAP };
