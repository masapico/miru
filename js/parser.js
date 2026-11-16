/*
 * parser.js — ファイルのデコードと JSONL / JSON / CSV / TSV の解析
 *
 * 出力は列指向ではなく、列名配列 + 行配列(各行は列順の値配列)。
 * ブラウザでは window.VizParser、Node では module.exports。
 * CSV 解析は PapaParse(グローバル Papa)を使う。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VizParser = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var FORMAT_LABEL = { jsonl: "JSON Lines", json: "JSON 配列", csv: "CSV", tsv: "TSV" };
  var MAX_ERRORS_KEPT = 20;

  function getPapa() {
    if (root && root.Papa) return root.Papa;
    if (typeof Papa !== "undefined") return Papa; // eslint-disable-line no-undef
    throw new Error("PapaParse が読み込まれていません");
  }

  /* ---------- 文字コード ---------- */

  /**
   * @param {ArrayBuffer} buf
   * @param {'auto'|'utf-8'|'shift_jis'|'utf-16le'|'utf-16be'} enc
   * @returns {{text: string, encoding: string}}
   */
  function decode(buf, enc) {
    var bytes = new Uint8Array(buf);
    enc = enc || "auto";
    if (enc === "auto") {
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) enc = "utf-8";
      else if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = "utf-16le";
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) enc = "utf-16be";
      else {
        try {
          var t = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          return { text: stripBom(t), encoding: "utf-8" };
        } catch (e) {
          enc = "shift_jis";
        }
      }
    }
    var text = new TextDecoder(enc).decode(bytes);
    return { text: stripBom(text), encoding: enc };
  }

  function stripBom(s) {
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  /* ---------- 形式判定 ---------- */

  function detectFormat(text, fileName) {
    var name = String(fileName || "").toLowerCase();
    var head = text.slice(0, 65536);
    var firstLine = "";
    var lines = head.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { firstLine = lines[i].trim(); break; }
    }
    if (firstLine[0] === "[") return "json";
    if (firstLine[0] === "{") {
      // 1 行目だけで JSON として完結していれば JSONL、そうでなければ整形済み JSON
      try { JSON.parse(firstLine); return "jsonl"; } catch (e) { return "json"; }
    }
    if (/\.tsv$/.test(name)) return "tsv";
    if (/\.csv$/.test(name)) return "csv";
    var tabs = (firstLine.match(/\t/g) || []).length;
    var commas = (firstLine.match(/,/g) || []).length;
    return tabs > commas ? "tsv" : "csv";
  }

  /* ---------- JSON 系 ---------- */

  /** ネストしたオブジェクトを a.b.c 形式にフラット化。配列は JSON 文字列として保持 */
  function flatten(obj, prefix, out) {
    out = out || {};
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var key = prefix ? prefix + "." + k : k;
      var v = obj[k];
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        if (Object.keys(v).length === 0) out[key] = null;
        else flatten(v, key, out);
      } else if (Array.isArray(v)) {
        out[key] = JSON.stringify(v);
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  function recordsToTable(records) {
    var columns = [];
    var index = {};
    var flat = records.map(function (r) {
      var f = flatten(r);
      for (var k in f) {
        if (!(k in index)) { index[k] = columns.length; columns.push(k); }
      }
      return f;
    });
    var rows = flat.map(function (f) {
      var row = new Array(columns.length);
      for (var i = 0; i < columns.length; i++) {
        var v = f[columns[i]];
        row[i] = v === undefined ? null : v;
      }
      return row;
    });
    return { columns: columns, rows: rows };
  }

  function parseJSONL(text) {
    var lines = text.split(/\r?\n/);
    var records = [];
    var errors = [];
    var errorCount = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var v = JSON.parse(line);
        if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("オブジェクトではありません");
        records.push(v);
      } catch (e) {
        errorCount++;
        if (errors.length < MAX_ERRORS_KEPT) errors.push({ line: i + 1, message: e.message, text: line.slice(0, 80) });
      }
    }
    var t = recordsToTable(records);
    t.errors = errors;
    t.errorCount = errorCount;
    return t;
  }

  /** JSON 配列、または配列を含むオブジェクト({data:[...]} など) */
  function parseJSON(text) {
    var v = JSON.parse(text);
    var arr = null;
    if (Array.isArray(v)) arr = v;
    else if (v && typeof v === "object") {
      for (var k in v) {
        if (Array.isArray(v[k]) && v[k].length && typeof v[k][0] === "object") { arr = v[k]; break; }
      }
      if (!arr) arr = [v];
    }
    if (!arr) throw new Error("JSON の中にレコードの配列が見つかりません");
    // 配列の配列(先頭行がヘッダー)にも対応
    if (arr.length && Array.isArray(arr[0])) return rowsToTable(arr.map(function (r) { return r.map(stringifyCell); }));
    var errorCount = 0;
    var records = arr.filter(function (r) {
      var ok = r !== null && typeof r === "object" && !Array.isArray(r);
      if (!ok) errorCount++;
      return ok;
    });
    var t = recordsToTable(records);
    t.errors = errorCount ? [{ line: null, message: errorCount + " 件の要素がオブジェクトではありません", text: "" }] : [];
    t.errorCount = errorCount;
    return t;
  }

  function stringifyCell(v) {
    return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : v;
  }

  /* ---------- CSV / TSV ---------- */

  function uniqueHeaders(header) {
    var seen = {};
    return header.map(function (h, i) {
      var name = String(h == null ? "" : h).trim() || "列" + (i + 1);
      var base = name;
      var n = 2;
      while (seen[name]) name = base + "_" + n++;
      seen[name] = true;
      return name;
    });
  }

  function rowsToTable(data, hasHeader) {
    if (hasHeader === undefined) hasHeader = true;
    var width = data.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var header = hasHeader ? data[0] || [] : [];
    while (header.length < width) header = header.concat([""]);
    var columns = uniqueHeaders(hasHeader ? header : header.map(function () { return ""; }));
    var body = hasHeader ? data.slice(1) : data;
    var rows = body.map(function (r) {
      var row = new Array(columns.length);
      for (var i = 0; i < columns.length; i++) {
        var v = r[i];
        row[i] = v === undefined || v === "" ? null : v;
      }
      return row;
    });
    return { columns: columns, rows: rows, errors: [], errorCount: 0 };
  }

  function parseDelimited(text, delimiter, hasHeader) {
    var res = getPapa().parse(text, {
      delimiter: delimiter || "",
      skipEmptyLines: "greedy",
      header: false,
      dynamicTyping: false,
    });
    var t = rowsToTable(res.data, hasHeader);
    t.delimiter = res.meta.delimiter;
    // 列数が揃わない行は警告として扱う(値は取り込む)
    var expected = t.columns.length;
    var mismatch = 0;
    var errors = [];
    var startLine = hasHeader === false ? 1 : 2;
    res.data.slice(hasHeader === false ? 0 : 1).forEach(function (r, i) {
      if (r.length !== expected) {
        mismatch++;
        if (errors.length < MAX_ERRORS_KEPT) errors.push({ line: i + startLine, message: "列数が " + r.length + "(期待値 " + expected + ")", text: r.join(res.meta.delimiter).slice(0, 80) });
      }
    });
    (res.errors || []).forEach(function (e) {
      if (e.code === "UndetectableDelimiter") return;
      if (errors.length < MAX_ERRORS_KEPT) errors.push({ line: e.row != null ? e.row + 1 : null, message: e.message, text: "" });
    });
    t.errors = errors;
    t.errorCount = mismatch;
    t.warnOnly = true;
    return t;
  }

  /**
   * テキストを解析する
   * @param {string} text
   * @param {{format?: 'auto'|'jsonl'|'json'|'csv'|'tsv', fileName?: string, hasHeader?: boolean}} opt
   */
  function parse(text, opt) {
    opt = opt || {};
    var format = opt.format && opt.format !== "auto" ? opt.format : detectFormat(text, opt.fileName);
    var t;
    if (format === "jsonl") t = parseJSONL(text);
    else if (format === "json") t = parseJSON(text);
    else if (format === "tsv") t = parseDelimited(text, "\t", opt.hasHeader);
    else t = parseDelimited(text, "", opt.hasHeader);
    t.format = format;
    t.formatLabel = FORMAT_LABEL[format];
    return t;
  }

  return {
    FORMAT_LABEL: FORMAT_LABEL,
    decode: decode,
    detectFormat: detectFormat,
    flatten: flatten,
    parse: parse,
  };
});
