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

  /* ---------- 下部の注記・出典 ---------- */

  var FOOTER_FONT = { size: 12, lineHeight: 1.5 };
  var FOOTER_PAD = { top: 10, x: 8, bottom: 4 };

  /** 幅に収まるよう折り返す。日本語は文字単位、空白があれば空白の位置で切る */
  function wrapText(measure, text, maxWidth) {
    var out = [];
    String(text).split(/\r?\n/).forEach(function (para) {
      var line = "";
      Array.from(para).forEach(function (ch) {
        if (line && measure(line + ch) > maxWidth) {
          var sp = line.lastIndexOf(" ");
          if (ch !== " " && sp > 0 && /[\x21-\x7e]$/.test(line)) {
            out.push(line.slice(0, sp));
            line = line.slice(sp + 1) + ch;
          } else {
            out.push(line);
            line = ch === " " ? "" : ch;
          }
        } else {
          line += ch;
        }
      });
      out.push(line);
    });
    return out;
  }

  /** Chart.js のレイアウトに参加する下部テキストの箱(組み込みの Title と同じ仕組み) */
  function FooterBox(chart) {
    this.chart = chart;
    this.ctx = chart.ctx;
    this.options = {};
    this.lines = [];
    this.top = this.bottom = this.left = this.right = this.width = this.height = 0;
  }
  FooterBox.prototype.isHorizontal = function () { return true; };
  FooterBox.prototype._font = function () {
    return FOOTER_FONT.size + "px " + Chart.defaults.font.family;
  };
  FooterBox.prototype.update = function (maxWidth) {
    var texts = this.options.texts || [];
    this.width = maxWidth;
    this.left = 0;
    this.right = maxWidth;
    if (!texts.length) { this.lines = []; this.height = 0; return; }
    var ctx = this.ctx;
    ctx.save();
    ctx.font = this._font();
    var w = Math.max(40, maxWidth - FOOTER_PAD.x * 2);
    var lines = [];
    texts.forEach(function (t) {
      lines = lines.concat(wrapText(function (s) { return ctx.measureText(s).width; }, t, w));
    });
    ctx.restore();
    this.lines = lines;
    this.height = FOOTER_PAD.top + lines.length * FOOTER_FONT.size * FOOTER_FONT.lineHeight + FOOTER_PAD.bottom;
  };
  FooterBox.prototype.draw = function () {
    if (!this.lines.length) return;
    var ctx = this.ctx;
    var lh = FOOTER_FONT.size * FOOTER_FONT.lineHeight;
    ctx.save();
    ctx.font = this._font();
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    var x = this.left + FOOTER_PAD.x;
    var y = this.top + FOOTER_PAD.top + lh / 2;
    this.lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lh); });
    ctx.restore();
  };

  var footerPlugin = {
    id: "vizFooter",
    start: function (chart, args, opts) {
      var box = new FooterBox(chart);
      box.options = opts;
      Chart.layouts.configure(chart, box, opts);
      Chart.layouts.addBox(chart, box);
      chart.$vizFooter = box;
    },
    stop: function (chart) {
      if (chart.$vizFooter) Chart.layouts.removeBox(chart, chart.$vizFooter);
      delete chart.$vizFooter;
    },
    beforeUpdate: function (chart, args, opts) {
      var box = chart.$vizFooter;
      if (!box) return;
      Chart.layouts.configure(chart, box, opts);
      box.options = opts;
    },
    // 凡例(1000)より外側に置く
    defaults: { position: "bottom", weight: 3000, fullSize: true, texts: [] },
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
  var CJS_KIND = { line: "line", area: "line", bar: "bar", stacked: "bar", scatter: "scatter" };
  function isBarType(t) { return t === "bar" || t === "stacked"; }
  function byDatasetIndex(a, b) { return a.datasetIndex - b.datasetIndex; }

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

  function labelsOf(o) {
    var l = o.labels || {};
    return {
      title: (l.title || "").trim(),
      subtitle: (l.subtitle || "").trim(),
      xTitle: (l.xTitle || "").trim(),
      yTitle: (l.yTitle || "").trim(),
      y2Title: (l.y2Title || "").trim(),
      note: (l.note || "").trim(),
      source: (l.source || "").trim(),
    };
  }

  /** 軸名の自動値(入力欄が空のときに使い、placeholder にも表示する) */
  function autoAxisTitles(res, o) {
    function yName(id) {
      var names = Array.from(new Set(res.series.filter(function (s) { return s.axis === id; }).map(function (s) { return s.yName; })));
      var title = names.length === 1 ? (names[0] === null ? "件数" : names[0]) : "";
      if (title && res.agg && res.agg !== "none" && res.agg !== "count") title += "(" + window.VizTransform.AGG_LABEL[res.agg] + ")";
      return title;
    }
    return {
      x: res.xName + (res.xType === "datetime" ? "(" + D.TZ_LABEL[o.display.tz] + ")" : ""),
      y: yName("y"),
      y2: yName("y2"),
    };
  }

  /** タイトル・説明・注記・出典(グラフの種類によらず共通) */
  function textPlugins(lb) {
    var footer = [];
    if (lb.note) footer.push("注: " + lb.note);
    if (lb.source) footer.push("出典: " + lb.source);
    return {
      title: {
        display: !!lb.title, text: lb.title, color: TEXT,
        font: { size: 16, weight: "bold" }, padding: { top: 4, bottom: lb.subtitle ? 4 : 12 },
      },
      subtitle: {
        display: !!lb.subtitle, text: lb.subtitle.split(/\r?\n/), color: MUTED,
        font: { size: 13 }, padding: { bottom: 12 },
      },
      vizFooter: { texts: footer },
    };
  }

  /**
   * Chart.js の設定を組み立てる(画面描画と SVG 出力で共用)
   * @param {object} res  VizTransform.build の結果
   * @param {object} o    {chartType, chartTypeRight, labels, beginAtZero, showPoints, legend, gapFactor, display}
   * @returns {{config: object, notes: string[], axisTitles: {x, y, y2}}}
   */
  function buildConfig(res, o) {
    var notes = [];
    var lb = labelsOf(o);
    var auto = autoAxisTitles(res, o);
    var leftType = o.chartType;
    var config;

    if (leftType === "pie") {
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
          plugins: Object.assign(textPlugins(lb), {
            legend: { display: o.legend !== "none", position: o.legend === "none" ? "right" : o.legend, labels: { boxWidth: 14, boxHeight: 14 } },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                  return ctx.label + ": " + fmtNum(ctx.parsed) + "(" + (total ? (ctx.parsed / total * 100).toFixed(1) : 0) + "%)";
                },
              },
            },
          }),
        },
        plugins: [bgPlugin, footerPlugin],
      };
      return { config: config, notes: notes, axisTitles: auto };
    }

    var isTime = res.xKind === "time";
    var isLinear = res.xKind === "linear";
    var isCat = !isTime && !isLinear;
    var isScatter = leftType === "scatter";
    var rightType = !isScatter && o.chartTypeRight ? o.chartTypeRight : leftType;
    var hasRight = res.series.some(function (s) { return s.axis === "y2"; });
    function typeOf(axis) { return axis === "y2" ? rightType : leftType; }

    var used = res.series.map(function (s) { return typeOf(s.axis); });
    var anyBar = used.some(isBarType);
    var anyLine = used.some(function (t) { return t === "line" || t === "area"; });
    var anyStacked = used.indexOf("stacked") >= 0;
    var cjsType = isScatter ? "scatter" : anyBar ? "bar" : "line";
    var spanGaps = anyLine && !isCat ? gapThreshold(res, o.gapFactor) : false;
    var many = res.pointCount > 5000;

    var datasets = res.series.map(function (s, i) {
      var t = typeOf(s.axis);
      var kind = CJS_KIND[t];
      var c = color(s.colorIndex);
      var ds = {
        type: kind,
        label: s.label,
        data: s.data,
        yAxisID: s.axis,
        borderColor: c,
        backgroundColor: c,
      };
      if (kind === "line") {
        Object.assign(ds, {
          order: 0, // 線を棒の上に描く
          borderWidth: 2,
          tension: 0,
          pointRadius: o.showPoints ? 3 : 0,
          pointHoverRadius: 5,
          pointHitRadius: 6,
          pointBackgroundColor: c,
          pointBorderColor: "#ffffff",
          pointBorderWidth: o.showPoints ? 1 : 0,
          spanGaps: spanGaps,
          fill: t === "area" ? "origin" : false,
          backgroundColor: t === "area" ? alpha(c, 0.14) : c,
        });
      } else if (kind === "bar") {
        var stk = t === "stacked";
        Object.assign(ds, {
          order: 1,
          borderWidth: stk ? { top: 2 } : 0,
          borderColor: stk ? "#ffffff" : c,
          borderRadius: stk ? 0 : 4,
          borderSkipped: "start",
          maxBarThickness: 56,
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        });
        // 積み上げる系列は軸ごとに 1 つの山、積み上げない棒は 1 本ずつ横に並べる
        if (anyStacked) ds.stack = stk ? "stack-" + s.axis : "solo-" + i;
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
        offset: anyBar,
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
    x.title = { display: true, text: lb.xTitle || auto.x, color: MUTED };
    x.stacked = anyStacked;

    function yAxis(id) {
      var t = typeOf(id);
      var title = (id === "y2" ? lb.y2Title : lb.yTitle) || auto[id];
      return {
        type: "linear",
        position: id === "y2" ? "right" : "left",
        // 棒の高さで比べるため、棒の軸は常に 0 から
        beginAtZero: !!o.beginAtZero || isBarType(t),
        stacked: t === "stacked",
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
    if (isScatter) interaction = { mode: "nearest", intersect: true };

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
        plugins: Object.assign(textPlugins(lb), {
          legend: {
            display: o.legend !== "none" && datasets.length > 1,
            position: o.legend === "none" ? "top" : o.legend,
            // 描画順(order)ではなく系列の順に並べる
            labels: { boxWidth: 14, boxHeight: 14, usePointStyle: false, sort: byDatasetIndex },
          },
          tooltip: {
            itemSort: byDatasetIndex,
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed.y;
                return ctx.dataset.label + ": " + fmtNum(v);
              },
            },
          },
          decimation: {
            enabled: anyLine && !isCat && res.pointCount > 4000,
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
        }),
      },
      plugins: [bgPlugin, footerPlugin],
    };
    if (hasRight) notes.push("右軸を使用しています。左右で目盛が異なるため、線の交差や高さの比較には意味がない点に注意してください。");
    return { config: config, notes: notes, axisTitles: auto };
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @returns {{chart: Chart, notes: string[], axisTitles: {x, y, y2}}}
   */
  function render(canvas, res, o) {
    var b = buildConfig(res, o);
    return { chart: new Chart(canvas, b.config), notes: b.notes, axisTitles: b.axisTitles };
  }

  /* ---------- SVG 出力 ---------- */

  /** Path2D の代わりに描画命令を記録し、stroke(path) / fill(path) で canvas2svg 上に再生する */
  function RecordingPath() { this.cmds = []; }
  ["moveTo", "lineTo", "bezierCurveTo", "quadraticCurveTo", "arc", "arcTo", "ellipse", "rect", "closePath"].forEach(function (m) {
    RecordingPath.prototype[m] = function () { this.cmds.push([m, Array.prototype.slice.call(arguments)]); };
  });
  RecordingPath.prototype.addPath = function (p) { if (p && p.cmds) this.cmds = this.cmds.concat(p.cmds); };

  /** canvas2svg が持たない Canvas API を補う(Chart.js 4 が呼ぶもの) */
  function shimSvgContext(c) {
    var dash = [];
    c.setLineDash = function (d) { dash = d || []; };
    c.getLineDash = function () { return dash; };
    c.resetTransform = function () {};
    c.ellipse = function (x, y, rx, ry, rot, a0, a1, ccw) { this.arc(x, y, Math.max(rx, ry), a0, a1, ccw); };

    // canvas2svg 1.0.x の clip() はパスの d 属性を書き出さずに clipPath へ移すため、
    // 空のクリップになり目盛やデータが消える。先に d を確定させる(同梱版の内部 API に依存)。
    var clip = c.clip;
    c.clip = function () {
      if (this.__currentElement && this.__currentElement.nodeName === "path") this.__applyCurrentDefaultPath();
      return clip.call(this);
    };

    // stroke(path) / fill(path) / clip(path): 記録した命令を現在のパスとして再生してから実行する
    ["stroke", "fill", "clip"].forEach(function (m) {
      var orig = c[m];
      c[m] = function (path) {
        if (path instanceof RecordingPath) {
          var self = this;
          self.beginPath();
          path.cmds.forEach(function (cmd) { self[cmd[0]].apply(self, cmd[1]); });
        }
        return orig.call(this);
      };
    });
  }

  /**
   * 画面と同じ設定で SVG を作る。文字は <text> として残る。
   * @param {object} opt {width, height, xRange: {min, max}|null}
   * @returns {string} SVG 文字列
   */
  function exportSVG(res, o, opt) {
    if (typeof window.C2S !== "function") throw new Error("SVG 出力用のライブラリ(canvas2svg)を読み込めませんでした。");
    var w = Math.max(1, Math.round(opt.width)), h = Math.max(1, Math.round(opt.height));
    var b = buildConfig(res, o);
    var cfg = b.config;
    var svgCtx = new window.C2S(w, h);
    shimSvgContext(svgCtx);
    // Chart.js にはキャンバスとして渡す(BasicPlatform は getContext しか使わない)
    var fakeCanvas = { width: w, height: h, style: {}, getContext: function () { return svgCtx; } };
    svgCtx.canvas = fakeCanvas;

    cfg.platform = Chart.BasicPlatform;
    cfg.options.responsive = false;
    cfg.options.animation = false;
    cfg.options.devicePixelRatio = 1;
    cfg.options.events = [];
    cfg.options.plugins.zoom = false;
    cfg.options.plugins.tooltip = { enabled: false };
    if (opt.xRange && cfg.options.scales && cfg.options.scales.x) {
      cfg.options.scales.x.min = opt.xRange.min;
      cfg.options.scales.x.max = opt.xRange.max;
    }
    // 折れ線は Path2D で描かれるため、描画の間だけ記録用の Path2D に差し替える(処理は同期的に終わる)
    var origPath2D = window.Path2D;
    window.Path2D = RecordingPath;
    var chart;
    try {
      chart = new Chart(fakeCanvas, cfg);
      svgCtx.getSvg().setAttribute("viewBox", "0 0 " + w + " " + h);
      return svgCtx.getSerializedSvg(true);
    } finally {
      window.Path2D = origPath2D;
      if (chart) chart.destroy();
    }
  }

  window.VizChart = {
    render: render, buildConfig: buildConfig, exportSVG: exportSVG, autoAxisTitles: autoAxisTitles,
    wrapText: wrapText, PALETTE: PALETTE, color: color, fmtNum: fmtNum,
  };
})();
