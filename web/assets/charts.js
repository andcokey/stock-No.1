// summary/company/product ページ共通のグラフ描画（外部ライブラリ非依存・SVG生成）。
// 単一Y軸のみ（2軸チャートは作らない）。すべてホバー/フォーカスで詳細ツールチップを表示する。
// 色は style.css の既存トークン（--accent/--good/--warn/--bad/--s1..--s8等）をそのまま利用する。

const NS = "http://www.w3.org/2000/svg";

const QUAD_COLOR_VAR = { "順調成長": "--good", "積上純増": "--accent", "ジレンマ": "--warn", "要改善": "--bad" };

function svgEl(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function formatMonthShort(m) {
  const [y, mo] = m.split("-");
  return y.slice(2) + "." + Number(mo);
}

function formatMonthLong(m) {
  const [y, mo] = m.split("-");
  return `${y}年${Number(mo)}月`;
}

function roundedTopBar(x, yTop, w, yBottom, r) {
  r = Math.max(0, Math.min(r, w / 2, yBottom - yTop));
  if (r <= 0.3) {
    return svgEl("path", { d: `M${x} ${yBottom} L${x} ${yTop} L${x + w} ${yTop} L${x + w} ${yBottom} Z` });
  }
  const d = `M${x} ${yBottom} L${x} ${yTop + r} A${r} ${r} 0 0 1 ${x + r} ${yTop} ` +
    `L${x + w - r} ${yTop} A${r} ${r} 0 0 1 ${x + w} ${yTop + r} L${x + w} ${yBottom} Z`;
  return svgEl("path", { d });
}

// ---- ツールチップ（チャートごとに1つ、chart-root相対配置） ----

function ensureTooltip(root) {
  let tip = root.querySelector(".chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    root.appendChild(tip);
  }
  return tip;
}

function ttTitle(tip, text) {
  const t = document.createElement("div");
  t.className = "tt-title";
  t.textContent = text;
  tip.appendChild(t);
}

function ttSub(tip, text) {
  const s = document.createElement("div");
  s.className = "tt-sub";
  s.textContent = text;
  tip.appendChild(s);
}

function ttRow(tip, { label, value, color }) {
  const row = document.createElement("div");
  row.className = "tt-row";
  if (color) {
    const key = document.createElement("span");
    key.className = "tt-key";
    key.style.background = color;
    row.appendChild(key);
  }
  const lab = document.createElement("span");
  lab.className = "tt-label";
  lab.textContent = label;
  const val = document.createElement("span");
  val.className = "tt-value";
  val.textContent = value;
  row.appendChild(lab);
  row.appendChild(val);
  tip.appendChild(row);
}

function showTooltip(tip, root, clientX, clientY, build) {
  clearChildren(tip);
  build(tip);
  tip.classList.add("show");
  const rootRect = root.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = clientX - rootRect.left + 14;
  let y = clientY - rootRect.top - th - 12;
  if (x + tw > rootRect.width) x = clientX - rootRect.left - tw - 14;
  if (x < 0) x = 4;
  if (y < 0) y = clientY - rootRect.top + 14;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function hideTooltip(tip) {
  tip.classList.remove("show");
}

// 商材テーブルのスパークライン用: 行数が多いため、共有の1つのツールチップを body に固定配置する
let sharedTip = null;
function getSharedTooltip() {
  if (!sharedTip) {
    sharedTip = document.createElement("div");
    sharedTip.className = "chart-tooltip chart-tooltip-fixed";
    document.body.appendChild(sharedTip);
  }
  return sharedTip;
}
function showSharedTooltip(clientX, clientY, build) {
  const tip = getSharedTooltip();
  clearChildren(tip);
  build(tip);
  tip.classList.add("show");
  let x = clientX + 14, y = clientY - 10;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > window.innerWidth) x = clientX - tw - 14;
  if (x < 0) x = 4;
  if (y < 0) y = clientY + 14;
  if (y + th > window.innerHeight) y = window.innerHeight - th - 4;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
function hideSharedTooltip() {
  if (sharedTip) sharedTip.classList.remove("show");
}

/**
 * 月次バーチャート（単一軸）。boundaryMonth以降は「見通」として薄く表示する。
 */
export function renderBarChart(container, opts) {
  const {
    months, values, boundaryMonth,
    height = 200, unit = "",
    formatValue = (v) => (v == null ? "—" : Math.round(v).toLocaleString("ja-JP")),
    legendLabels = ["実績", "見通"],
  } = opts;

  clearChildren(container);
  container.classList.add("chart-root");

  const W = 680, H = height;
  const padL = 56, padR = 10, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const maxV = niceMax(Math.max(0, ...values.filter((v) => v != null)));
  const n = months.length;
  const slot = n ? plotW / n : plotW;
  const barW = Math.max(2, Math.min(24, slot - 2));

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "月次バーチャート");

  [0, 0.5, 1].forEach((frac) => {
    const y = padT + plotH * (1 - frac);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: frac === 0 ? "chart-baseline" : "chart-gridline" }));
    const label = svgEl("text", { x: padL - 8, y: y + 3, "text-anchor": "end", class: "chart-axis-label" });
    label.textContent = frac === 0 ? "0" : Math.round(maxV * frac).toLocaleString("ja-JP");
    svg.appendChild(label);
  });

  const tip = ensureTooltip(container);
  const labelEvery = Math.max(1, Math.ceil(n / 9));
  const boundaryIdx = boundaryMonth ? months.findIndex((m) => m >= boundaryMonth) : -1;

  months.forEach((m, i) => {
    const v = values[i];
    const x = padL + i * slot + (slot - barW) / 2;
    const isForecast = boundaryIdx !== -1 && i >= boundaryIdx;
    const h = v == null ? 0 : Math.max(0, (v / maxV) * plotH);
    const yTop = padT + plotH - h;
    const r = Math.min(4, barW / 2, h);

    let bar = null;
    if (v != null && h > 0.4) {
      bar = roundedTopBar(x, yTop, barW, padT + plotH, r);
      bar.setAttribute("class", isForecast ? "chart-bar-forecast" : "chart-bar-actual");
      svg.appendChild(bar);
    }

    const hit = svgEl("rect", { x: padL + i * slot, y: padT, width: slot, height: plotH, class: "chart-hit", tabindex: "0" });
    hit.setAttribute("aria-label", `${formatMonthLong(m)}: ${formatValue(v)}${unit}`);

    const onEnter = (clientX, clientY) => {
      if (bar) bar.setAttribute("opacity", "0.8");
      showTooltip(tip, container, clientX, clientY, (t) => {
        ttTitle(t, formatMonthLong(m));
        ttRow(t, { label: isForecast ? legendLabels[1] : legendLabels[0], value: `${formatValue(v)}${unit}` });
      });
    };
    const onLeave = () => {
      if (bar) bar.removeAttribute("opacity");
      hideTooltip(tip);
    };
    hit.addEventListener("pointerenter", (e) => onEnter(e.clientX, e.clientY));
    hit.addEventListener("pointermove", (e) => onEnter(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", onLeave);
    hit.addEventListener("focus", () => {
      const rect = hit.getBoundingClientRect();
      onEnter(rect.left + rect.width / 2, rect.top);
    });
    hit.addEventListener("blur", onLeave);
    svg.appendChild(hit);

    if (i % labelEvery === 0 || i === n - 1) {
      const lbl = svgEl("text", { x: padL + i * slot + slot / 2, y: H - 6, "text-anchor": "middle", class: "chart-axis-label" });
      lbl.textContent = formatMonthShort(m);
      svg.appendChild(lbl);
    }
  });

  container.appendChild(svg);

  if (boundaryIdx > 0) {
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    [["actual", legendLabels[0]], ["forecast", legendLabels[1]]].forEach(([cls, label]) => {
      const item = document.createElement("span");
      item.className = "lg-item";
      const sw = document.createElement("span");
      sw.className = `lg-swatch bar-${cls}`;
      const lab = document.createElement("span");
      lab.textContent = label;
      item.appendChild(sw);
      item.appendChild(lab);
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }
}

/**
 * 月次折れ線チャート（単一軸）。domainMaxを渡すと0〜domainMaxに固定（比率系に使用）。
 * extraRows(index) を渡すとツールチップに追加行を出せる（ホバー詳細の拡張用）。
 */
export function renderLineChart(container, opts) {
  const {
    months, values, boundaryMonth,
    height = 200, unit = "%", seriesLabel = "値",
    domainMax = null,
    formatValue = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%"),
    extraRows = null,
  } = opts;

  clearChildren(container);
  container.classList.add("chart-root");

  const W = 680, H = height;
  const padL = 50, padR = 10, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const nums = values.filter((v) => v != null);
  const maxV = domainMax != null ? domainMax : niceMax(Math.max(0, ...nums));
  const n = months.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "月次折れ線チャート");

  [0, 0.5, 1].forEach((frac) => {
    const y = padT + plotH * (1 - frac);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: frac === 0 ? "chart-baseline" : "chart-gridline" }));
    const label = svgEl("text", { x: padL - 8, y: y + 3, "text-anchor": "end", class: "chart-axis-label" });
    label.textContent = frac === 0 ? "0" : formatValue(maxV * frac);
    svg.appendChild(label);
  });

  const pts = months.map((m, i) => {
    const v = values[i];
    const x = padL + i * stepX;
    const y = v == null ? null : padT + plotH * (1 - Math.min(1, Math.max(0, v / maxV)));
    return { x, y, v, m };
  });

  const segments = [];
  let cur = [];
  pts.forEach((p) => {
    if (p.y == null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  });
  if (cur.length) segments.push(cur);

  segments.forEach((seg) => {
    if (seg.length < 2) return;
    const lineD = seg.map((p, idx) => (idx === 0 ? `M${p.x} ${p.y}` : `L${p.x} ${p.y}`)).join(" ");
    const areaD = `M${seg[0].x} ${padT + plotH} ` +
      seg.map((p) => `L${p.x} ${p.y}`).join(" ") +
      ` L${seg[seg.length - 1].x} ${padT + plotH} Z`;
    svg.appendChild(svgEl("path", { d: areaD, class: "chart-area" }));
    svg.appendChild(svgEl("path", { d: lineD, class: "chart-line" }));
  });

  const tip = ensureTooltip(container);
  const crosshair = svgEl("line", { class: "chart-crosshair", y1: padT, y2: padT + plotH, x1: -100, x2: -100, opacity: 0 });
  svg.appendChild(crosshair);

  const labelEvery = Math.max(1, Math.ceil(n / 9));

  pts.forEach((p, i) => {
    if (i % labelEvery === 0 || i === n - 1) {
      const lbl = svgEl("text", { x: p.x, y: H - 6, "text-anchor": "middle", class: "chart-axis-label" });
      lbl.textContent = formatMonthShort(p.m);
      svg.appendChild(lbl);
    }
    if (p.y == null) return;

    const ring = svgEl("circle", { cx: p.x, cy: p.y, r: 5, class: "chart-dot-ring" });
    const dot = svgEl("circle", { cx: p.x, cy: p.y, r: 3, class: "chart-dot" });
    svg.appendChild(ring);
    svg.appendChild(dot);

    const hit = svgEl("circle", { cx: p.x, cy: p.y, r: 12, class: "chart-hit", tabindex: "0" });
    hit.setAttribute("aria-label", `${formatMonthLong(p.m)}: ${formatValue(p.v)}`);

    const onEnter = (clientX, clientY) => {
      crosshair.setAttribute("x1", p.x);
      crosshair.setAttribute("x2", p.x);
      crosshair.setAttribute("opacity", "1");
      dot.setAttribute("r", "5");
      showTooltip(tip, container, clientX, clientY, (t) => {
        ttTitle(t, formatMonthLong(p.m));
        ttRow(t, { label: seriesLabel, value: formatValue(p.v), color: "var(--accent)" });
        if (extraRows) extraRows(i).forEach((row) => ttRow(t, row));
      });
    };
    const onLeave = () => {
      crosshair.setAttribute("opacity", "0");
      dot.setAttribute("r", "3");
      hideTooltip(tip);
    };
    hit.addEventListener("pointerenter", (e) => onEnter(e.clientX, e.clientY));
    hit.addEventListener("pointermove", (e) => onEnter(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", onLeave);
    hit.addEventListener("focus", () => {
      const rect = hit.getBoundingClientRect();
      onEnter(rect.left + rect.width / 2, rect.top);
    });
    hit.addEventListener("blur", onLeave);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/**
 * 商材ポートフォリオの4象限散布図（継続率 × 顧客増加数）。単一軸×単一軸のプレーンな散布図。
 * points: [{x:0-1の継続率, y:顧客増加数, quadrant:"順調成長"等, label, sub}]
 */
export function renderQuadrantScatter(container, opts) {
  const { points, height = 340, xThreshold = 0.75, yThreshold = 0 } = opts;

  clearChildren(container);
  container.classList.add("chart-root");

  const W = 700, H = height;
  const padL = 54, padR = 20, padT = 18, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const valid = points.filter((p) => p.x != null && p.y != null);
  const yMaxAbs = Math.max(1, ...valid.map((p) => Math.abs(p.y)));
  const yMax = niceMax(yMaxAbs);
  const yMin = -yMax;
  const xMin = 0, xMax = 1;

  const scaleX = (v) => padL + ((v - xMin) / (xMax - xMin)) * plotW;
  const scaleY = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "商材ポートフォリオ散布図");

  const xt = scaleX(xThreshold), yt = scaleY(yThreshold);
  const zones = [
    { key: "順調成長", x: xt, y: padT, w: padL + plotW - xt, h: yt - padT },
    { key: "積上純増", x: padL, y: padT, w: xt - padL, h: yt - padT },
    { key: "ジレンマ", x: xt, y: yt, w: padL + plotW - xt, h: padT + plotH - yt },
    { key: "要改善", x: padL, y: yt, w: xt - padL, h: padT + plotH - yt },
  ];
  zones.forEach((z) => {
    svg.appendChild(svgEl("rect", { x: z.x, y: z.y, width: Math.max(0, z.w), height: Math.max(0, z.h), class: `chart-quad-bg-${z.key}` }));
  });

  svg.appendChild(svgEl("line", { x1: xt, x2: xt, y1: padT, y2: padT + plotH, class: "chart-gridline" }));
  svg.appendChild(svgEl("line", { x1: padL, x2: padL + plotW, y1: yt, y2: yt, class: "chart-gridline" }));
  svg.appendChild(svgEl("line", { x1: padL, x2: padL + plotW, y1: padT + plotH, y2: padT + plotH, class: "chart-baseline" }));
  svg.appendChild(svgEl("line", { x1: padL, x2: padL, y1: padT, y2: padT + plotH, class: "chart-baseline" }));

  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    const x = scaleX(f);
    const lbl = svgEl("text", { x, y: H - 10, "text-anchor": "middle", class: "chart-axis-label" });
    lbl.textContent = Math.round(f * 100) + "%";
    svg.appendChild(lbl);
  });
  [yMin, 0, yMax].forEach((v) => {
    const y = scaleY(v);
    const lbl = svgEl("text", { x: padL - 8, y: y + 3, "text-anchor": "end", class: "chart-axis-label" });
    lbl.textContent = Math.round(v).toLocaleString("ja-JP");
    svg.appendChild(lbl);
  });
  svg.appendChild(Object.assign(svgEl("text", { x: padL, y: padT - 6, class: "chart-axis-caption" }), { textContent: "縦軸: 顧客増加数" }));
  svg.appendChild(Object.assign(svgEl("text", { x: padL + plotW, y: padT - 6, "text-anchor": "end", class: "chart-axis-caption" }), { textContent: "横軸: 顧客継続率（区切り線=閾値75%）" }));

  const tip = ensureTooltip(container);

  valid.forEach((p) => {
    const cx = scaleX(p.x), cy = scaleY(Math.max(yMin, Math.min(yMax, p.y)));
    const dotClass = p.quadrant ? `chart-quad-dot-${p.quadrant}` : "chart-quad-dot-unknown";
    const ring = svgEl("circle", { cx, cy, r: 5, class: "chart-dot-ring" });
    const dot = svgEl("circle", { cx, cy, r: 4, class: dotClass });
    const hit = svgEl("circle", { cx, cy, r: 13, class: "chart-hit", tabindex: "0" });
    svg.appendChild(ring);
    svg.appendChild(dot);
    svg.appendChild(hit);

    const onEnter = (clientX, clientY) => {
      dot.setAttribute("r", "6");
      showTooltip(tip, container, clientX, clientY, (t) => {
        ttTitle(t, p.label);
        if (p.sub) ttSub(t, p.sub);
        ttRow(t, { label: "継続率", value: (p.x * 100).toFixed(1) + "%" });
        ttRow(t, { label: "顧客増加数", value: p.y.toLocaleString("ja-JP") });
        ttRow(t, {
          label: "成長ステージ",
          value: p.quadrant || "—",
          color: p.quadrant ? `var(${QUAD_COLOR_VAR[p.quadrant]})` : undefined,
        });
      });
    };
    const onLeave = () => {
      dot.setAttribute("r", "4");
      hideTooltip(tip);
    };
    hit.addEventListener("pointerenter", (e) => onEnter(e.clientX, e.clientY));
    hit.addEventListener("pointermove", (e) => onEnter(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", onLeave);
    hit.addEventListener("focus", () => {
      const rect = hit.getBoundingClientRect();
      onEnter(rect.left + rect.width / 2, rect.top);
    });
    hit.addEventListener("blur", onLeave);
  });

  container.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  ["順調成長", "積上純増", "ジレンマ", "要改善"].forEach((q) => {
    const item = document.createElement("span");
    item.className = "lg-item";
    const sw = document.createElement("span");
    sw.className = `lg-swatch quad-${q}`;
    const lab = document.createElement("span");
    lab.textContent = q;
    item.appendChild(sw);
    item.appendChild(lab);
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

/**
 * 商材テーブルの行に埋め込む小型スパークライン（バー）。ホバーで月次値を表示する。
 */
export function renderSparkline(container, opts) {
  const {
    values, months, boundaryIndex = -1, unit = "",
    formatValue = (v) => (v == null ? "—" : Math.round(v).toLocaleString("ja-JP")),
  } = opts;

  clearChildren(container);
  container.classList.add("spark-root");

  const W = 96, H = 28, pad = 2;
  const n = values.length;
  const maxV = Math.max(1, ...values.filter((v) => v != null).map((v) => Math.abs(v)));
  const slot = n ? (W - pad * 2) / n : W;
  const barW = Math.max(1.5, Math.min(8, slot - 1));

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
  svg.style.width = W + "px";
  svg.style.height = H + "px";
  svg.style.display = "block";
  svg.setAttribute("aria-hidden", "true");

  values.forEach((v, i) => {
    const x = pad + i * slot + (slot - barW) / 2;
    const h = v == null ? 0 : Math.max(0, (Math.abs(v) / maxV) * (H - 5));
    const y = H - 2 - h;
    const isForecast = boundaryIndex !== -1 && i >= boundaryIndex;
    if (v != null && h > 0.3) {
      svg.appendChild(svgEl("rect", {
        x, y, width: barW, height: Math.max(1, h), rx: 1,
        class: isForecast ? "chart-bar-forecast" : "chart-bar-actual",
      }));
    }
    const hit = svgEl("rect", { x: pad + i * slot, y: 0, width: slot, height: H, class: "chart-hit" });
    hit.addEventListener("pointerenter", (e) => showSpark(e));
    hit.addEventListener("pointermove", (e) => showSpark(e));
    hit.addEventListener("pointerleave", hideSharedTooltip);
    svg.appendChild(hit);

    function showSpark(e) {
      showSharedTooltip(e.clientX, e.clientY, (t) => {
        ttTitle(t, formatMonthLong(months[i]));
        ttRow(t, { label: isForecast ? "見通" : "実績", value: `${formatValue(v)}${unit}` });
      });
    }
  });

  container.appendChild(svg);
}

/**
 * チャートの下に「表で見る」トグルを付け、同じ月次データを table.datatable としても提供する
 * （アクセシビリティ: すべてのチャートに表形式の対がある状態を保つ）。
 */
export function renderToggleTable(container, opts) {
  const { months, columns, toggleLabel = "月次の数値を表で見る" } = opts;
  clearChildren(container);

  const link = document.createElement("span");
  link.className = "chart-toggle";
  link.textContent = `${toggleLabel} ▾`;

  const tableWrap = document.createElement("div");
  tableWrap.className = "chart-tablewrap";
  tableWrap.style.display = "none";

  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "datatable";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = "月";
  headRow.appendChild(th0);
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.className = "num";
    th.textContent = c.label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  months.forEach((m, i) => {
    const tr = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.textContent = m;
    tr.appendChild(td0);
    columns.forEach((c) => {
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = c.formatValue(c.values[i]);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  scroller.appendChild(table);
  tableWrap.appendChild(scroller);

  link.addEventListener("click", () => {
    const isOpen = tableWrap.style.display !== "none";
    tableWrap.style.display = isOpen ? "none" : "block";
    link.textContent = `${toggleLabel} ${isOpen ? "▾" : "▴"}`;
  });

  container.appendChild(link);
  container.appendChild(tableWrap);
}
