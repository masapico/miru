/*
 * transform.js — 絞り込み・集計・系列分割(DOM 非依存)
 *
 * ブラウザでは window.VizTransform、Node では module.exports。
 */
(function (root, factory) {
  var api = factory(root.VizDate || (typeof require === "function" ? require("./datetime.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VizTransform = api;
})(typeof self !== "undefined" ? self : this, function (VizDate) {
  "use strict";

  var MAX_SERIES = 8; // 色を循環させない上限。超える分は「その他」にまとめる
  var AGG_LABEL = { none: "なし", sum: "合計", avg: "平均", max: "最大", min: "最小", count: "件数" };
  var EMPTY_LABEL = "(空)";
  var OTHER_LABEL = "その他";

  function acc() {
    return { sum: 0, n: 0, rows: 0, min: Infinity, max: -Infinity, last: null };
  }
  function push(a, y) {
    a.rows++;
    if (y === null || y === undefined || isNaN(y)) return;
    a.sum += y; a.n++;
    if (y < a.min) a.min = y;
    if (y > a.max) a.max = y;
    a.last = y;
  }
  function result(a, agg) {
    switch (agg) {
      case "count": return a.rows;
      case "sum": return a.n ? a.sum : null;
      case "avg": return a.n ? a.sum / a.n : null;
      case "max": return a.n ? a.max : null;
      case "min": return a.n ? a.min : null;
      default: return a.last;
    }
  }

  /**
   * @param ctx  {cols: {name: colDef}, mat: {name: materialized}, rowCount}
   * @param cfg  {chartType, x, ys:[{name, right, color}], split, agg, bucket, from, to,
   *              filter:{col, values:[]}|null, display:{tz, calendar, fyStart}}
   */
  function build(ctx, cfg) {
    var notes = [];
    var display = cfg.display || { tz: "JST" };
    var xcol = ctx.cols[cfg.x];
    var xm = ctx.mat[cfg.x];
    if (!xcol || !xm) return { error: "X 軸の列を選択してください" };

    var agg = cfg.agg || "none";
    var chartType = cfg.chartType || "line";
    var ys = (cfg.ys || []).filter(function (y) { return ctx.mat[y.name]; });
    if (agg !== "count" && !ys.length) return { error: "Y 軸に表示する数値列を 1 つ以上選択してください" };
    if (agg === "count") ys = [{ name: null, label: "件数", right: false, color: 0 }];

    var isPie = chartType === "pie";
    var isScatter = chartType === "scatter";
    if (isScatter && agg !== "none") {
      notes.push("散布図では集計を行わず、すべての点を表示します。");
      agg = "none";
    }

    /* --- X の種類 --- */
    var xType = xcol.type;
    var bucket = xType === "datetime" && cfg.bucket && cfg.bucket !== "raw" ? cfg.bucket : null;
    var xGran = xType === "datetime" ? bucket || xm.granularity : null;
    var xKind;
    if (xType === "datetime") xKind = isPie || VizDate.isPeriodGran(xGran) ? "period" : "time";
    else if (xType === "number") xKind = isPie || chartType === "bar" || chartType === "stacked" ? "category" : "linear";
    else xKind = "category";

    /* --- 行の絞り込み --- */
    var n = ctx.rowCount;
    var fvals = null, allowed = null;
    if (cfg.filter && cfg.filter.col && ctx.mat[cfg.filter.col] && cfg.filter.values) {
      fvals = ctx.mat[cfg.filter.col].values;
      allowed = new Set(cfg.filter.values);
    }
    var useRange = xType === "datetime" && (cfg.from != null || cfg.to != null);
    var idx = [];
    var xv = xm.values;
    for (var i = 0; i < n; i++) {
      var x = xv[i];
      if (x === null || x === undefined) continue;
      if (useRange && ((cfg.from != null && x < cfg.from) || (cfg.to != null && x > cfg.to))) continue;
      if (allowed) {
        var fv = fvals[i] === null ? EMPTY_LABEL : String(fvals[i]);
        if (!allowed.has(fv)) continue;
      }
      idx.push(i);
    }
    var excludedX = n - xv.filter(function (v) { return v !== null && v !== undefined; }).length;

    /* --- 系列分割 --- */
    var groups = [null];
    var groupOf = null;
    var sm = cfg.split && ctx.mat[cfg.split] ? ctx.mat[cfg.split] : null;
    if (sm && !isPie) {
      var cats = (sm.categories || []).map(function (c) { return c.value; });
      if (sm.values.some(function (v) { return v === null; })) cats.push(EMPTY_LABEL);
      var maxGroups = Math.max(1, Math.floor(MAX_SERIES / ys.length));
      var present = new Set();
      idx.forEach(function (i) { present.add(sm.values[i] === null ? EMPTY_LABEL : String(sm.values[i])); });
      var visible = cats.filter(function (c) { return present.has(c); });
      var keep = visible.length > maxGroups ? visible.slice(0, maxGroups - 1) : visible;
      var keepSet = new Set(keep);
      groups = keep.slice();
      if (visible.length > keep.length) {
        groups.push(OTHER_LABEL);
        notes.push("系列が多いため、上位 " + keep.length + " 件以外を「" + OTHER_LABEL + "」にまとめました。");
      }
      // 色は全データでの出現頻度順に固定(絞り込みで色が変わらないように)
      var colorOfGroup = {};
      cats.forEach(function (c, k) { colorOfGroup[c] = k; });
      groupOf = function (i) {
        var g = sm.values[i] === null ? EMPTY_LABEL : String(sm.values[i]);
        return keepSet.has(g) ? g : OTHER_LABEL;
      };
      groups.colorOf = function (g) {
        return g === OTHER_LABEL ? MAX_SERIES - 1 : Math.min(colorOfGroup[g], MAX_SERIES - 2);
      };
    } else if (sm && isPie) {
      notes.push("円グラフでは系列分割は使用しません。");
    }

    if (isPie && ys.length > 1) {
      notes.push("円グラフでは最初の Y 列「" + ys[0].name + "」のみを表示します。");
      ys = ys.slice(0, 1);
    }

    /* --- 系列定義 --- */
    var series = [];
    groups.forEach(function (g) {
      ys.forEach(function (y, k) {
        var label = y.name === null ? "件数" : y.name;
        if (g !== null) label = ys.length > 1 ? g + " - " + label : g;
        series.push({
          id: (g === null ? "" : g + "\u0000") + (y.name || "#count"),
          label: label,
          group: g,
          yName: y.name,
          axis: y.right ? "y2" : "y",
          colorIndex: g !== null ? (ys.length > 1 ? series.length : groups.colorOf(g)) : (y.color != null ? y.color : k),
          values: y.name === null ? null : ctx.mat[y.name].values,
        });
      });
    });
    var seriesOfGroup = {};
    series.forEach(function (s) {
      var key = s.group === null ? "" : s.group;
      (seriesOfGroup[key] = seriesOfGroup[key] || []).push(s);
    });

    /* --- X キー --- */
    function keyOf(i) {
      var x = xv[i];
      if (xType === "datetime" && bucket) return VizDate.startOf(x, bucket, display);
      if (xKind === "category" && xType !== "number") return String(x);
      return x;
    }

    var effAgg = agg;
    // カテゴリ軸で集計なしの場合、同じ X に複数行あれば合計する
    if ((xKind === "category" || xKind === "period") && agg === "none") {
      var seen = new Set();
      var dup = false;
      for (var d = 0; d < idx.length && !dup; d++) {
        var kk = (groupOf ? groupOf(idx[d]) + "\u0000" : "") + keyOf(idx[d]);
        if (seen.has(kk)) dup = true;
        seen.add(kk);
      }
      if (dup) {
        effAgg = "sum";
        notes.push("同じ X の値を持つ行が複数あるため、合計して表示しています(「集計」で変更できます)。");
      }
    }

    var out = {
      xKind: xKind,
      xType: xType,
      xGran: xGran,
      xName: cfg.x,
      agg: effAgg,
      rowsUsed: idx.length,
      rowsTotal: n,
      excludedX: excludedX,
      notes: notes,
      sharedX: false,
      labels: null,
      keys: null,
      series: [],
    };

    /* --- 集計なし(時間軸・数値軸) --- */
    if (effAgg === "none" && (xKind === "time" || xKind === "linear")) {
      var sorted = idx.slice().sort(function (a, b) { return xv[a] - xv[b]; });
      if (!groupOf && !isScatter) {
        for (var q = 1; q < sorted.length; q++) {
          if (xv[sorted[q]] === xv[sorted[q - 1]]) {
            notes.push("同じ X の値を持つ行が複数あります。「集計」を指定するか、「系列の分割」でカテゴリごとに分けると見やすくなります。");
            break;
          }
        }
      }
      if (!groupOf) {
        out.sharedX = true;
        series.forEach(function (s) {
          s.data = sorted.map(function (i) { return { x: xv[i], y: s.values[i] }; });
        });
      } else {
        series.forEach(function (s) { s.data = []; });
        sorted.forEach(function (i) {
          var ss = seriesOfGroup[groupOf(i)];
          if (!ss) return;
          ss.forEach(function (s) {
            var y = s.values[i];
            if (y !== null && y !== undefined) s.data.push({ x: xv[i], y: y });
          });
        });
      }
      finish(out, series);
      return out;
    }

    /* --- 集計あり、またはカテゴリ軸 --- */
    var keyOrder = [];
    var keySeen = new Map();
    var cells = new Map(); // series.id → Map(key → acc)
    series.forEach(function (s) { cells.set(s.id, new Map()); });
    idx.forEach(function (i) {
      var key = keyOf(i);
      if (!keySeen.has(key)) { keySeen.set(key, keyOrder.length); keyOrder.push(key); }
      var ss = seriesOfGroup[groupOf ? groupOf(i) : ""];
      if (!ss) return;
      ss.forEach(function (s) {
        var m = cells.get(s.id);
        var a = m.get(key);
        if (!a) { a = acc(); m.set(key, a); }
        push(a, s.values ? s.values[i] : 1);
      });
    });

    if (xKind === "time" || xKind === "linear" || xKind === "period" || xType === "number") {
      keyOrder.sort(function (a, b) { return a - b; });
    }
    // 年・年度などは欠けた期間も軸に並べる
    if (xKind === "period" && VizDate.isPeriodGran(xGran)) {
      keyOrder = fillPeriods(keyOrder, xGran, display);
    }

    if (xKind === "time" || xKind === "linear") {
      series.forEach(function (s) {
        var m = cells.get(s.id);
        s.data = [];
        keyOrder.forEach(function (k) {
          var a = m.get(k);
          if (a) s.data.push({ x: k, y: result(a, effAgg) });
        });
      });
      out.sharedX = !groupOf;
    } else {
      out.keys = keyOrder;
      out.labels = keyOrder.map(function (k) {
        if (xKind === "period") return VizDate.format(k, xGran, display);
        return String(k);
      });
      series.forEach(function (s) {
        var m = cells.get(s.id);
        s.data = keyOrder.map(function (k) {
          var a = m.get(k);
          return a ? result(a, effAgg) : null;
        });
      });
      out.sharedX = true;
    }
    finish(out, series);
    return out;
  }

  function fillPeriods(keys, gran, display) {
    if (keys.length < 2) return keys;
    var unit = gran === "fiscal" ? "year" : gran === "fquarter" ? "quarter" : gran;
    var res = [];
    var t = keys[0];
    var last = keys[keys.length - 1];
    var guard = 0;
    while (t <= last && guard++ < 2000) {
      res.push(t);
      t = VizDate.add(t, 1, unit, display);
    }
    return guard >= 2000 ? keys : res;
  }

  function finish(out, series) {
    out.series = series.map(function (s) {
      var count = 0, sum = 0, min = Infinity, max = -Infinity, last = null;
      s.data.forEach(function (p) {
        var y = typeof p === "object" && p !== null ? p.y : p;
        if (y === null || y === undefined || isNaN(y)) return;
        count++; sum += y; last = y;
        if (y < min) min = y;
        if (y > max) max = y;
      });
      return {
        id: s.id,
        label: s.label,
        axis: s.axis,
        colorIndex: s.colorIndex,
        yName: s.yName,
        data: s.data,
        summary: {
          count: count,
          min: count ? min : null,
          max: count ? max : null,
          avg: count ? sum / count : null,
          last: last,
        },
      };
    });
    out.pointCount = out.series.reduce(function (a, s) { return a + s.data.length; }, 0);
  }

  /** 表示中のデータを表形式に(CSV 出力用) */
  function toTable(res, display) {
    var header = [res.xName].concat(res.series.map(function (s) { return s.label; }));
    var rows = [];
    function fmtX(k) {
      if (res.xKind === "time") return VizDate.toISO(k, display.tz);
      return k;
    }
    if (res.labels) {
      res.labels.forEach(function (label, i) {
        rows.push([label].concat(res.series.map(function (s) { return s.data[i]; })));
      });
    } else {
      var map = new Map();
      res.series.forEach(function (s, si) {
        s.data.forEach(function (p) {
          var r = map.get(p.x);
          if (!r) { r = new Array(res.series.length).fill(null); map.set(p.x, r); }
          r[si] = p.y;
        });
      });
      Array.from(map.keys()).sort(function (a, b) { return a - b; }).forEach(function (k) {
        rows.push([fmtX(k)].concat(map.get(k)));
      });
    }
    return { header: header, rows: rows };
  }

  function toCSV(table) {
    function cell(v) {
      if (v === null || v === undefined) return "";
      var s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [table.header].concat(table.rows).map(function (r) { return r.map(cell).join(","); }).join("\r\n");
  }

  return {
    MAX_SERIES: MAX_SERIES,
    AGG_LABEL: AGG_LABEL,
    build: build,
    toTable: toTable,
    toCSV: toCSV,
  };
});
