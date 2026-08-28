// summary/company/product ページ共通のKPI一覧UI（目標・実績(見通)・差異のテーブルと、期間/Y軸レンジを
// 選べるKPIごとの比較グラフ）。データ整形はlib/aggregate.mjs、描画プリミティブはcharts.jsに任せ、
// このモジュールはその2つを束ねてDOMを組み立てる役割のみを持つ。
import { renderComparisonChart } from "./charts.js";

export function formatByUnit(unit) {
  switch (unit) {
    case "yen":
      return (v) => (v == null ? "—" : Math.round(v).toLocaleString("ja-JP") + " 千円");
    case "percent":
      return (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
    case "count":
      return (v) => (v == null ? "—" : Math.round(v).toLocaleString("ja-JP"));
    case "months":
      return (v) => (v == null ? "—" : v.toFixed(1) + "ヶ月");
    default:
      return (v) => (v == null ? "—" : String(v));
  }
}

/** 期間ピッカーの初期表示範囲: 直近12ヵ月の実績＋すべての見通（既存の会社別ページ等と同じ既定値）。 */
export function defaultPeriodRange(months, boundaryMonth, actualCount = 12) {
  const actual = months.filter((m) => m < boundaryMonth).slice(-actualCount);
  const forecast = months.filter((m) => m >= boundaryMonth);
  const range = [...actual, ...forecast];
  return { start: range[0] ?? months[0], end: range.at(-1) ?? months.at(-1) };
}

function formatMonthOption(m) {
  const [y, mo] = m.split("-");
  return `${y}年${Number(mo)}月`;
}

/** 指定した時系列（target[]・actual[]が全期間null）かどうかを判定する。KPI一覧・グラフから除外する判定に使う。 */
export function kpiSeriesHasData(series) {
  return (series?.target ?? []).some((v) => v != null) || (series?.actual ?? []).some((v) => v != null);
}

/** 目標・実績(見通)・目標差異の3列テーブル。rowsは {key,label,unit,target,actual,diff}[]（既に対象外KPIを除いたもの）。 */
export function renderKpiTable(container, rows, { primaryKey = "stockRatio" } = {}) {
  const body = rows.map((r) => {
    const fmt = formatByUnit(r.unit);
    const diffCls = r.diff > 0 ? "pos" : r.diff < 0 ? "neg" : "";
    const diffText = r.diff == null ? "—" : (r.diff >= 0 ? "+" : "") + fmt(r.diff);
    const badge = r.key === primaryKey ? ' <span class="tag">最重要</span>' : "";
    return `<tr>
      <td>${r.label}${badge}</td>
      <td class="num">${fmt(r.target)}</td>
      <td class="num">${fmt(r.actual)}</td>
      <td class="num ${diffCls}">${diffText}</td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <table class="datatable">
      <thead><tr><th>指標</th><th class="num">目標</th><th class="num">実績/見通</th><th class="num">目標差異</th></tr></thead>
      <tbody>${body || `<tr><td colspan="4" class="empty-state">目標・実績データがありません</td></tr>`}</tbody>
    </table>
  `;
}

/**
 * 表示期間（開始月・終了月）を選ぶ共通コントロール。ページ内のKPIグラフすべてに一括で効く
 * （指標ごとに毎回選ばせるのは冗長なため、1ページ1つの共有コントロールとする）。
 * onChange(startMonth, endMonth) を呼ぶ。戻り値は現在値取得用。
 */
export function renderPeriodRangePicker(container, { months, defaultStart, defaultEnd, onChange }) {
  const startSel = document.createElement("select");
  const endSel = document.createElement("select");
  months.forEach((m) => {
    const label = formatMonthOption(m);
    const o1 = document.createElement("option");
    o1.value = m;
    o1.textContent = label;
    startSel.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = m;
    o2.textContent = label;
    endSel.appendChild(o2);
  });
  startSel.value = defaultStart || months[0];
  endSel.value = defaultEnd || months[months.length - 1];

  function emit() {
    let s = startSel.value, e = endSel.value;
    if (s > e) {
      [s, e] = [e, s];
      startSel.value = s;
      endSel.value = e;
    }
    onChange(s, e);
  }
  startSel.addEventListener("change", emit);
  endSel.addEventListener("change", emit);

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "range-picker";
  const label = document.createElement("span");
  label.textContent = "表示期間:";
  const sep = document.createElement("span");
  sep.className = "sep";
  sep.textContent = "〜";
  wrap.append(label, startSel, sep, endSel);
  container.appendChild(wrap);

  return { getRange: () => ({ start: startSel.value, end: endSel.value }) };
}

/**
 * 表示基準（単月 or 年間合計）を選ぶ単一セレクト。全体サマリー冒頭のタイル・ランキングの基準切替に使う
 * （期間の範囲ではなく1点を選ぶ点で renderPeriodRangePicker とは役割が異なる）。
 * period: {type:"month", value:"YYYY-MM"} または {type:"year", value:"YYYY"}。onChange(period) を呼ぶ。
 */
export function renderPointPeriodPicker(container, { months, defaultPeriod, onChange }) {
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const sel = document.createElement("select");

  const monthGroup = document.createElement("optgroup");
  monthGroup.label = "単月";
  months.forEach((m) => {
    const o = document.createElement("option");
    o.value = `m:${m}`;
    o.textContent = formatMonthOption(m);
    monthGroup.appendChild(o);
  });
  sel.appendChild(monthGroup);

  const yearGroup = document.createElement("optgroup");
  yearGroup.label = "年間合計";
  years.forEach((y) => {
    const o = document.createElement("option");
    o.value = `y:${y}`;
    o.textContent = `${y}年（年間合計）`;
    yearGroup.appendChild(o);
  });
  sel.appendChild(yearGroup);

  sel.value = defaultPeriod.type === "year" ? `y:${defaultPeriod.value}` : `m:${defaultPeriod.value}`;

  sel.addEventListener("change", () => {
    const [type, value] = sel.value.split(":");
    onChange(type === "y" ? { type: "year", value } : { type: "month", value });
  });

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "range-picker";
  const label = document.createElement("span");
  label.textContent = "表示基準:";
  wrap.append(label, sel);
  container.appendChild(wrap);
}

/**
 * KPIごとの目標比較グラフをグリッド表示する。kpis: {key,label,unit}[]（対象外KPIは呼び出し側で除外済みのもの）。
 * seriesByKey: {[key]: {target:number[], actual:number[]}}（monthsと同じ長さ・並び順）。
 * 各カードに「表示範囲: 最小/最大」入力を付け、指標ごとに個別にY軸レンジを固定できるようにする（省略時は自動スケール）。
 */
export function renderKpiChartGrid(container, { kpis, months, seriesByKey, primaryKey = "stockRatio" }) {
  container.innerHTML = "";
  container.classList.add("kpi-chart-grid");

  for (const kpi of kpis) {
    const card = document.createElement("div");
    card.className = "kpi-chart-card";

    const head = document.createElement("div");
    head.className = "kpi-chart-head";

    const title = document.createElement("div");
    title.className = "kpi-chart-title";
    title.innerHTML = kpi.label + (kpi.key === primaryKey ? ' <span class="primary-badge">最重要</span>' : "");

    const yrange = document.createElement("div");
    yrange.className = "yrange";
    const isPercent = kpi.unit === "percent";
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.placeholder = "最小";
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.placeholder = "最大";
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "自動";
    const rangeLabel = document.createElement("span");
    rangeLabel.textContent = "表示範囲:";
    yrange.append(rangeLabel, minInput, maxInput, resetBtn);

    head.append(title, yrange);
    card.appendChild(head);

    const chartDiv = document.createElement("div");
    card.appendChild(chartDiv);
    container.appendChild(card);

    const fmt = formatByUnit(kpi.unit);
    const series = seriesByKey[kpi.key] || { target: [], actual: [] };

    function redraw() {
      const scale = isPercent ? 0.01 : 1;
      const yMin = minInput.value === "" ? null : Number(minInput.value) * scale;
      const yMax = maxInput.value === "" ? null : Number(maxInput.value) * scale;
      renderComparisonChart(chartDiv, {
        months, actual: series.actual, target: series.target,
        yMin, yMax, formatValue: fmt,
      });
    }
    minInput.addEventListener("change", redraw);
    maxInput.addEventListener("change", redraw);
    resetBtn.addEventListener("click", () => {
      minInput.value = "";
      maxInput.value = "";
      redraw();
    });
    redraw();
  }

  if (!kpis.length) {
    container.innerHTML = `<div class="empty-state">表示できるKPIグラフがありません</div>`;
  }
}
