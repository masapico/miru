/*
 * schema.js — 列の型推論と、型に応じた値配列の生成
 *
 * 型: datetime | number | category | text | empty
 * ブラウザでは window.VizSchema、Node では module.exports。
 */
(function (root, factory) {
  var api = factory(root.VizDate || (typeof require === "function" ? require("./datetime.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VizSchema = api;
})(typeof self !== "undefined" ? self : this, function (VizDate) {
  "use strict";

  var TYPE_LABEL = { datetime: "日時", number: "数値", category: "カテゴリ", text: "文字列", empty: "空" };
  var MISSING = { "": 1, "-": 1, "—": 1, "NA": 1, "N/A": 1, "n/a": 1, "null": 1, "NULL": 1, "None": 1, "nan": 1, "NaN": 1, "#N/A": 1, "undefined": 1 };
  var NUM_RE = /^[¥$€£]?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:%|円|件|人|個)?$/i;
  var CATEGORY_MAX_DISTINCT = 200;

  function isMissing(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === "number") return !isFinite(v);
    if (typeof v === "string") return MISSING[v.trim()] === 1;
    return false;
  }

  /** 数値として解釈。解釈不能なら NaN、欠損なら null */
  function toNumber(v) {
    if (isMissing(v)) return null;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return NaN;
    var s = VizDate.normalize(v).replace(/^\((.*)\)$/, "-$1"); // (123) 表記の負数
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?/.test(s.replace(/^[¥$€£]\s*/, ""))) s = s.replace(/,/g, "");
    var m = NUM_RE.exec(s);
    return m ? parseFloat(m[1]) : NaN;
  }

  function toText(v) {
    if (isMissing(v)) return null;
    return typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  }

  function columnValues(table, idx) {
    var out = new Array(table.rows.length);
    for (var i = 0; i < table.rows.length; i++) out[i] = table.rows[i][idx];
    return out;
  }

  /** 自動判定 */
  function inferColumn(values, name, opt) {
    var present = values.filter(function (v) { return !isMissing(v); });
    if (!present.length) return { type: "empty" };

    var dt = VizDate.detectColumn(present, name, opt);
    if (dt) return { type: "datetime", dtFormat: dt.format, granularity: dt.granularity };

    var step = Math.max(1, Math.floor(present.length / 2000));
    var n = 0, numOk = 0;
    for (var i = 0; i < present.length; i += step) {
      n++;
      var x = toNumber(present[i]);
      if (x !== null && !isNaN(x)) numOk++;
    }
    if (numOk / n >= 0.9) return { type: "number" };

    var distinct = new Set();
    for (var j = 0; j < present.length && distinct.size <= CATEGORY_MAX_DISTINCT; j++) distinct.add(toText(present[j]));
    if (distinct.size <= CATEGORY_MAX_DISTINCT || distinct.size / present.length <= 0.5) return { type: "category" };
    return { type: "text" };
  }

  /**
   * 列定義の配列を作る
   * @returns {Array<{name, index, type, dtFormat, granularity, auto}>}
   */
  function infer(table, opt) {
    return table.columns.map(function (name, idx) {
      var auto = inferColumn(columnValues(table, idx), name, opt);
      return {
        name: name,
        index: idx,
        type: auto.type,
        dtFormat: auto.dtFormat || null,
        granularity: auto.granularity || null,
        auto: auto,
      };
    });
  }

  /**
   * 列定義に従って値配列を作る。
   * datetime/number → number|null、category/text → string|null
   * @returns {{values: Array, invalid: number, invalidSamples: string[], missing: number, granularity?: string, stats: object}}
   */
  function materialize(table, col, opt) {
    var raw = columnValues(table, col.index);
    var values = new Array(raw.length);
    var invalid = 0, missing = 0;
    var samples = [];
    var min = Infinity, max = -Infinity;
    var grans = {};
    var pattern = col.type === "datetime" ? VizDate.getPattern(col.dtFormat) : null;
    var distinct = new Map();

    for (var i = 0; i < raw.length; i++) {
      var v = raw[i];
      if (isMissing(v)) { values[i] = null; missing++; continue; }
      var out = null;
      if (col.type === "datetime") {
        var r = pattern ? VizDate.parseWith(pattern, v, opt) : null;
        if (r) { out = r.t; grans[r.g] = (grans[r.g] || 0) + 1; }
      } else if (col.type === "number") {
        var x = toNumber(v);
        if (x !== null && !isNaN(x)) out = x;
      } else {
        out = toText(v);
        if (distinct.size <= CATEGORY_MAX_DISTINCT * 5) distinct.set(out, (distinct.get(out) || 0) + 1);
      }
      if (out === null) {
        invalid++;
        if (samples.length < 5) samples.push(String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 40));
      } else if (typeof out === "number") {
        if (out < min) min = out;
        if (out > max) max = out;
      }
      values[i] = out;
    }

    var res = {
      values: values,
      invalid: invalid,
      invalidSamples: samples,
      missing: missing,
      stats: { min: min === Infinity ? null : min, max: max === -Infinity ? null : max },
    };
    if (col.type === "datetime") {
      var g = col.granularity;
      if (!g) {
        g = Object.keys(grans).sort(function (a, b) { return VizDate.granRank(a) - VizDate.granRank(b); })[0] || "day";
      }
      res.granularity = g;
    }
    if (col.type === "category" || col.type === "text") {
      // 出現頻度の降順(色の割り当て順を安定させるため)
      res.categories = Array.from(distinct.entries())
        .sort(function (a, b) { return b[1] - a[1]; })
        .map(function (e) { return { value: e[0], count: e[1] }; });
      res.stats.distinct = distinct.size;
    }
    return res;
  }

  /** 型・書式の上書き後に粒度を再計算する(書式変更時) */
  function redetectGranularity(table, col, opt) {
    var raw = columnValues(table, col.index).filter(function (v) { return !isMissing(v); });
    var p = VizDate.getPattern(col.dtFormat);
    if (!p) return null;
    var grans = {}, ts = [];
    var step = Math.max(1, Math.floor(raw.length / 1000));
    for (var i = 0; i < raw.length; i += step) {
      var r = VizDate.parseWith(p, raw[i], opt);
      if (r) { grans[r.g] = 1; ts.push(r.t); }
    }
    var g = Object.keys(grans).sort(function (a, b) { return VizDate.granRank(a) - VizDate.granRank(b); })[0];
    if (!g) return null;
    var det = VizDate.detectColumn(raw.slice(0, 1000), col.name, opt);
    if (det && det.format === col.dtFormat) return det.granularity;
    return g;
  }

  return {
    TYPE_LABEL: TYPE_LABEL,
    isMissing: isMissing,
    toNumber: toNumber,
    infer: infer,
    inferColumn: inferColumn,
    materialize: materialize,
    redetectGranularity: redetectGranularity,
  };
});
