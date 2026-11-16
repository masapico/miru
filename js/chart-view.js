/*
 * chart-view.js — transform の結果から Chart.js の設定を組み立てて描画する
 */
(function () {
  "use strict";
  var D = window.VizDate;

  // DADS プリミティブカラーから選定。色覚多様性シミュレーションで隣接ペアの識別性を検証済み
  // blue-600, orange-600, green-600, magenta-600, yellow-700, purple-600, cyan-600, red-900
  var PALETTE = ["#3460fb", "#fb5b01", "#259d63", "#db00db", "#b78f00", "#8843e1", "#00a3bf", "#ce0000"];
  var TEXT = "#333333";     // solid-gray-800
  var MUTED = "#666666";    // solid-gray-600
  var GRID = "#e6e6e6";     // solid-gray-100
  var AXIS = "#949494";     // solid-gray-420

  var Chart = window.Chart;
  Chart.defaults.font.family = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
  Chart.defaults.font.size = 13;
  Chart.defaults.color = TEXT;
  Chart.defaults.borderColor = GRID;

  // PNG 保存時に背景が透明にならないよう白で塗る
  var bgPlugin = {
    id: "vizBackground",
    beforeDraw: function (chart) {
      var c = chart.ctx;
      c.save();
      c.globalCompositeOperation = "destination-over";
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, chart.width, chart.height);
      c.restore();
    },
  };

  var numFmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 3 });
  function fmtNum(v) {
    return v === null || v === undefined || isNaN(v) ? "—" : numFmt.format(v);
  }

  function color(i) {
    return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  }

  function alpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /** 隣接点の間隔の中央値 × factor を超える区間で線を切る */
  function gapThreshold(res, factor) {
    if (!factor || factor <= 0) return true;
    var xs = new Set();
    res.series.forEach(function (s) {
      s.data.forEach(function (p) { if (p.y !== null && p.y !== undefined) xs.add(p.x); });
    });
    var arr = Array.from(xs).sort(function (a, b) { return a - b; });
    if (arr.length < 3) return true;
    var diffs = [];
    for (var i = 1; i < arr.length; i++) diffs.push(arr[i] - arr[i - 1]);
    diffs.sort(function (a, b) { return a - b; });
    var median = diffs[Math.floor(diffs.length / 2)];
    return median > 0 ? median * factor : true;
  }

  var TIME_UNIT = { millisecond: "millisecond", second: "second", minute: "minute", hour: "hour", day: "day", week: "week", month: "month" };

  /** 円グラフ: 9 件以上は上位 7 件 + その他 */
  function pieData(res) {
    var s = res.series[0];
    var items = res.labels.map(function (l, i) { return { label: l, value: s.data[i] || 0, i: i }; })
      .filter(function (it) { return it.value > 0; });
    var notes = [];
    if (res.labels.length !== items.length) notes.push("0 以下・空の値は円グラフから除外しています。");
    if (items.length > PALETTE.length) {
      items.sort(function (a, b) { return b.value - a.value; });
      var head = items.slice(0, PALETTE.length - 1);
      var rest = items.slice(PALETTE.length - 1).reduce(function (a, b) { return a + b.value; }, 0);
      head.push({ label: "その他", value: rest, i: -1 });
      notes.push("項目が多いため、上位 " + (PALETTE.length - 1) + " 件以外を「その他」にまとめました。");
      items = head;
    }
    return { items: items, notes: notes };
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} res  VizTransform.build の結果
   * @param {object} o    {chartType, title, beginAtZero, showPoints, legend, gapFactor, display}
   * @returns {{chart: Chart, notes: string[]}}
   */
  function render(canvas, res, o) {
    var notes = [];
    var type = o.chartType;
    var many = res.pointCount > 5000;
    var config;

    if (type === "pie") {
      var pd = pieData(res);
      notes = pd.notes;
      config = {
        type: "doughnut",
        data: {
          labels: pd.items.map(function (it) { return it.label; }),
          datasets: [{
            label: res.series[0].label,
            data: pd.items.map(function (it) { return it.value; }),
            backgroundColor: pd.items.map(function (it, k) { return it.i === -1 ? "#949494" : color(k); }),
            borderColor: "#ffffff",
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          cutout: "55%",
          plugins: {
            title: titleOpt(o),
            legend: { display: o.legend !== "none", position: o.legend === "none" ? "right" : o.legend, labels: { boxWidth: 14, boxHeight: 14 } },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                  return ctx.label + ": " + fmtNum(ctx.parsed) + "(" + (total ? (ctx.parsed / total * 100).toFixed(1) : 0) + "%)";
                },
              },
            },
          },
        },
        plugins: [bgPlugin],
      };
      return { chart: new Chart(canvas, config), notes: notes };
    }

    var isTime = res.xKind === "time";
    var isLinear = res.xKind === "linear";
    var isCat = !isTime && !isLinear;
    var isLine = type === "line" || type === "area";
    var stacked = type === "stacked";
    var cjsType = type === "scatter" ? "scatter" : isLine ? "line" : "bar";
    var spanGaps = isLine && !isCat ? gapThreshold(res, o.gapFactor) : false;
    var hasRight = res.series.some(function (s) { return s.axis === "y2"; });

    var datasets = res.series.map(function (s) {
      var c = color(s.colorIndex);
      var ds = {
        label: s.label,
        data: s.data,
        yAxisID: s.axis,
        borderColor: c,
        backgroundColor: c,
      };
      if (cjsType === "line") {
        Object.assign(ds, {
          borderWidth: 2,
          tension: 0,
          pointRadius: o.showPoints ? 3 : 0,
          pointHoverRadius: 5,
          pointHitRadius: 6,
          pointBackgroundColor: c,
          pointBorderColor: "#ffffff",
          pointBorderWidth: o.showPoints ? 1 : 0,
          spanGaps: spanGaps,
          fill: type === "area" ? "origin" : false,
          backgroundColor: type === "area" ? alpha(c, 0.14) : c,
        });
      } else if (cjsType === "bar") {
        Object.assign(ds, {
          borderWidth: stacked ? { top: 2 } : 0,
          borderColor: stacked ? "#ffffff" : c,
          borderRadius: stacked ? 0 : 4,
          borderSkipped: "start",
          maxBarThickness: 56,
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        });
      } else {
        Object.assign(ds, { pointRadius: 4, pointHoverRadius: 6, borderColor: "#ffffff", borderWidth: 1 });
      }
      if (!isCat) ds.parsing = false;
      return ds;
    });

    var dateOpt = { tz: o.display.tz, calendar: o.display.calendar, fyStart: o.display.fyStart, gran: res.xGran };
    var x;
    if (isTime) {
      // 期間が短い(時刻目盛になる)ときだけ日付の境目を太字の目盛で示す。
      // 日単位以上の目盛で有効にすると、長い月ラベルが隣の目盛と重なるため。
      var xmin = Infinity, xmax = -Infinity;
      res.series.forEach(function (s) {
        if (s.data.length) {
          xmin = Math.min(xmin, s.data[0].x);
          xmax = Math.max(xmax, s.data[s.data.length - 1].x);
        }
      });
      var shortSpan = xmax - xmin <= 4 * 864e5;
      x = {
        type: "time",
        adapters: { date: dateOpt },
        time: { minUnit: TIME_UNIT[res.xGran] || "millisecond", tooltipFormat: "tooltip" },
        offset: cjsType === "bar",
        ticks: {
          source: "auto",
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 24,
          major: { enabled: shortSpan },
          font: function (ctx) { return ctx.tick && ctx.tick.major ? { weight: "bold" } : undefined; },
        },
      };
    } else if (isLinear) {
      x = { type: "linear", ticks: { callback: function (v) { return fmtNum(v); } } };
    } else {
      x = { type: "category", ticks: { maxRotation: 45, autoSkip: true } };
    }
    x.grid = { color: GRID, drawTicks: true };
    x.border = { color: AXIS };
    x.title = { display: true, text: res.xName + (res.xType === "datetime" ? "(" + D.TZ_LABEL[o.display.tz] + ")" : ""), color: MUTED };
    x.stacked = stacked;

    function yAxis(id) {
      var names = Array.from(new Set(res.series.filter(function (s) { return s.axis === id; }).map(function (s) { return s.yName; })));
      var title = names.length === 1 ? (names[0] === null ? "件数" : names[0]) : "";
      if (title && res.agg && res.agg !== "none" && res.agg !== "count") title += "(" + window.VizTransform.AGG_LABEL[res.agg] + ")";
      return {
        type: "linear",
        position: id === "y2" ? "right" : "left",
        beginAtZero: !!o.beginAtZero || stacked,
        stacked: stacked,
        grid: { color: GRID, drawOnChartArea: id === "y" },
        border: { display: false },
        ticks: { callback: function (v) { return fmtNum(v); } },
        title: { display: !!title, text: title, color: MUTED },
      };
    }
    var scales = { x: x, y: yAxis("y") };
    if (hasRight) scales.y2 = yAxis("y2");

    var interaction = res.sharedX
      ? { mode: "index", intersect: false }
      : { mode: "nearest", axis: "x", intersect: false };
    if (cjsType === "scatter") interaction = { mode: "nearest", intersect: true };

    config = {
      type: cjsType,
      data: isCat ? { labels: res.labels, datasets: datasets } : { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: many ? false : { duration: 300 },
        normalized: true,
        interaction: interaction,
        scales: scales,
        plugins: {
          title: titleOpt(o),
          legend: {
            display: o.legend !== "none" && datasets.length > 1,
            position: o.legend === "none" ? "top" : o.legend,
            labels: { boxWidth: 14, boxHeight: 14, usePointStyle: false },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed.y;
                return ctx.dataset.label + ": " + fmtNum(v);
              },
            },
          },
          decimation: {
            enabled: cjsType === "line" && !isCat && res.pointCount > 4000,
            algorithm: "min-max",
          },
          zoom: {
            pan: { enabled: true, mode: "x" },
            zoom: {
              wheel: { enabled: true, modifierKey: "ctrl" },
              pinch: { enabled: true },
              drag: { enabled: true, modifierKey: "shift", backgroundColor: "rgba(52,96,251,0.12)", borderColor: "#3460fb", borderWidth: 1 },
              mode: "x",
            },
            limits: { x: { min: "original", max: "original" } },
          },
        },
      },
      plugins: [bgPlugin],
    };
    if (hasRight) notes.push("右軸を使用しています。左右で目盛が異なるため、線の交差や高さの比較には意味がない点に注意してください。");
    return { chart: new Chart(canvas, config), notes: notes };
  }

  function titleOpt(o) {
    return { display: !!o.title, text: o.title, color: TEXT, font: { size: 16, weight: "bold" }, padding: { bottom: 12 } };
  }

  window.VizChart = { render: render, PALETTE: PALETTE, color: color, fmtNum: fmtNum };
})();
