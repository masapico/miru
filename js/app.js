/*
 * app.js — 画面の状態管理とイベント配線
 */
(function () {
  "use strict";
  var D = window.VizDate, P = window.VizParser, S = window.VizSchema, T = window.VizTransform, V = window.VizChart;

  var CHART_TYPES = [
    ["line", "折れ線"], ["area", "面"], ["bar", "棒"],
    ["stacked", "積み上げ棒"], ["scatter", "散布図"], ["pie", "円(ドーナツ)"],
  ];
  var RIGHT_TYPES = [["line", "折れ線"], ["area", "面"], ["bar", "棒"], ["stacked", "積み上げ棒"]];
  var LABEL_INPUTS = ["chart-title", "chart-subtitle", "x-title", "y-title", "y2-title", "chart-note", "chart-source"];
  var TYPE_OPTIONS = [["datetime", "日時"], ["number", "数値"], ["category", "カテゴリ"], ["text", "文字列"]];
  var MAX_Y = 8;
  var RAW_HEAD_STEP = 20; // 「ファイルの先頭」の最小の表示行数と、1 回に増やす行数

  var state = {
    file: null,          // {name, size, buf}
    // headerRow / dataRow は 1 始まり(null は自動)。colNames は列番号順の、画面で付けた列名
    loadOpt: { format: "auto", encoding: "auto", header: "yes", headerRow: null, dataRow: null, colNames: [], tz: "JST", fyStart: 4 },
    table: null,
    rawShown: RAW_HEAD_STEP, // 「ファイルの先頭」に表示する行数
    defs: [],
    cols: {},
    mat: {},
    chart: null,
    lastRes: null,
    yChecked: new Set(),
    yRight: new Set(),
  };

  /* ---------- DOM ヘルパー ---------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "text") e.textContent = v;
        else if (k === "className") e.className = v;
        else if (k === "dataset") Object.assign(e.dataset, v);
        else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? "" : v);
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  var CHEVRON = '<svg class="dads-select__chevron" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17L3 8L4 7L12 15L20 7L21 8L12 17Z" fill="currentcolor"/></svg>';

  /** DADS セレクトボックス */
  function makeSelect(id, options, value, attrs) {
    var sel = el("select", Object.assign({ id: id, className: "dads-select__select", "data-size": "sm" }, attrs || {}));
    fillSelect(sel, options, value);
    var ctrl = el("span", { className: "dads-select__control" }, [sel]);
    ctrl.insertAdjacentHTML("beforeend", CHEVRON);
    return el("span", { className: "dads-select" }, [ctrl]);
  }

  function fillSelect(sel, options, value) {
    sel.textContent = "";
    options.forEach(function (o) {
      if (o.group) {
        var g = el("optgroup", { label: o.group });
        o.options.forEach(function (oo) { g.appendChild(el("option", { value: oo[0], text: oo[1] })); });
        sel.appendChild(g);
      } else {
        sel.appendChild(el("option", { value: o[0], text: o[1] }));
      }
    });
    if (value !== undefined && value !== null) sel.value = String(value);
    if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
  }

  /** index.html の data-select プレースホルダにセレクトを差し込む */
  function mountSelect(id, options, value, attrs) {
    var slot = document.querySelector('[data-select="' + id + '"]');
    slot.textContent = "";
    slot.appendChild(makeSelect(id, options, value, attrs));
    return $(id);
  }

  function makeCheckbox(label, attrs, size) {
    var input = el("input", Object.assign({ className: "dads-checkbox__input", type: "checkbox" }, attrs || {}));
    return el("label", { className: "dads-checkbox", "data-size": size || "sm" }, [
      el("span", { className: "dads-checkbox__checkbox" }, [input]),
      el("span", { className: "dads-checkbox__label", text: label }),
    ]);
  }

  function makeRadio(name, value, label, checked) {
    var input = el("input", { className: "dads-radio__input", type: "radio", name: name, value: value, checked: checked });
    return el("label", { className: "dads-radio", "data-size": "sm" }, [
      el("span", { className: "dads-radio__radio" }, [input]),
      el("span", { className: "dads-radio__label", text: label }),
    ]);
  }

  /* ---------- 通知バナー ---------- */

  var BANNER_ICON = {
    error: '<path d="M8.25 21 3 15.75v-7.5L8.25 3h7.5L21 8.25v7.5L15.75 21h-7.5Z" fill="currentcolor"/><path d="m12 13.4-2.85 2.85-1.4-1.4L10.6 12 7.75 9.15l1.4-1.4L12 10.6l2.85-2.85 1.4 1.4L13.4 12l2.85 2.85-1.4 1.4L12 13.4Z" fill="Canvas"/>',
    warning: '<path d="M1 21 12 2l11 19H1Z" fill="currentcolor"/><path d="M13 15h-2v-5h2v5Z" fill="Canvas"/><circle cx="12" cy="17" r="1" fill="Canvas"/>',
    success: '<circle cx="12" cy="12" r="10" fill="currentcolor"/><path d="m10.6 16.2 7-7-1.4-1.4-5.6 5.6-2.8-2.8-1.4 1.4 4.2 4.2Z" fill="Canvas"/>',
    "info-1": '<circle cx="12" cy="12" r="10" fill="currentcolor"/><path d="M11 17h2v-6h-2v6Zm1-8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="Canvas"/>',
  };
  var BANNER_LABEL = { error: "エラー", warning: "警告", success: "成功", "info-1": "お知らせ" };
  var bannerSeq = 0;

  function showBanner(type, heading, lines) {
    var id = "banner-close-" + ++bannerSeq;
    var banner = el("div", { className: "dads-notification-banner", "data-style": "standard", "data-type": type, role: type === "error" ? "alert" : "status" });
    var h = el("h2", { className: "dads-notification-banner__heading" });
    h.insertAdjacentHTML("beforeend", '<svg class="dads-notification-banner__icon" width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="' + BANNER_LABEL[type] + '">' + BANNER_ICON[type] + "</svg>");
    h.appendChild(el("span", { className: "dads-notification-banner__heading-text", text: heading }));
    banner.appendChild(h);
    var close = el("button", { className: "dads-notification-banner__close", type: "button", "aria-labelledby": id, onclick: function () { banner.remove(); } });
    close.insertAdjacentHTML("beforeend", '<svg class="dads-notification-banner__close-icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 18.6-1-1 5.5-5.6-5.6-5.6 1.1-1 5.6 5.5 5.6-5.6 1 1.1L13 12l5.6 5.6-1 1L12 13l-5.6 5.6Z" fill="currentcolor"/></svg>');
    close.appendChild(el("span", { id: id, className: "dads-notification-banner__close-label", text: "閉じる" }));
    banner.appendChild(close);
    if (lines && lines.length) {
      var body = el("div", { className: "dads-notification-banner__body" });
      if (lines.length === 1) body.appendChild(el("p", { text: lines[0] }));
      else body.appendChild(el("ul", { className: "app-banner-list" }, lines.map(function (l) { return el("li", { text: l }); })));
      banner.appendChild(body);
    }
    $("banners").appendChild(banner);
  }

  function clearBanners() { $("banners").textContent = ""; }

  /* ---------- ファイル読み込み ---------- */

  function hookFileUpload() {
    var FU = customElements.get("dads-file-upload");
    if (!FU || FU.prototype.__vizHooked) return;
    ["addFiles", "removeFile"].forEach(function (m) {
      var orig = FU.prototype[m];
      FU.prototype[m] = function () {
        var r = orig.apply(this, arguments);
        this.dispatchEvent(new CustomEvent("viz-files-change", { bubbles: true }));
        return r;
      };
    });
    FU.prototype.__vizHooked = true;
  }

  function onFilesChange(e) {
    var fu = e.currentTarget;
    var info = (fu.files || []).filter(function (f) { return f.file; })[0];
    if (!info) { resetAll(); return; }
    if (info.errors && info.errors.length) {
      resetAll();
      showBanner("error", "このファイルは読み込めません", info.errors);
      return;
    }
    var file = info.file;
    if (state.file && state.file.ref === file) return;
    $("chart-meta").textContent = "読み込み中…";
    file.arrayBuffer().then(function (buf) {
      state.file = { name: file.name, size: file.size, buf: buf, ref: file };
      state.loadOpt.format = "auto";
      state.loadOpt.encoding = "auto";
      resetRowOptions();
      loadData(true);
    }).catch(function (err) {
      showBanner("error", "ファイルを読み込めませんでした", [String(err && err.message || err)]);
    });
  }

  function resetAll() {
    state.file = null;
    state.table = null;
    destroyChart();
    clearBanners();
    $("load-result").hidden = true;
    $("viz-section").hidden = true;
  }

  /** 開始行と列名の指定を既定(自動)に戻す */
  function resetRowOptions() {
    state.loadOpt.headerRow = null;
    state.loadOpt.dataRow = null;
    state.loadOpt.colNames = [];
  }

  function parseOpt() {
    return { tz: state.loadOpt.tz, fyStart: state.loadOpt.fyStart };
  }

  /** デコード → 解析 → 型推論 → 値配列化 */
  function loadData(isNewFile) {
    clearBanners();
    var dec, table;
    try {
      dec = P.decode(state.file.buf, state.loadOpt.encoding);
      table = P.parse(dec.text, {
        format: state.loadOpt.format,
        fileName: state.file.name,
        hasHeader: state.loadOpt.header !== "no",
        headerRow: state.loadOpt.headerRow,
        dataRow: state.loadOpt.dataRow,
        columnNames: state.loadOpt.colNames,
      });
    } catch (err) {
      showBanner("error", "データを解析できませんでした", [
        String(err && err.message || err),
        "「ファイル形式」「文字コード」の設定を変えて再度お試しください。",
      ]);
      $("load-result").hidden = false;
      renderLoadOptions(dec ? dec.encoding : "utf-8", null);
      $("viz-section").hidden = true;
      return;
    }
    state.table = table;
    state.encoding = dec.encoding;
    if (!table.rows.length || !table.columns.length) {
      showBanner("error", "データ行が見つかりません", ["ファイルの中身、または「ファイル形式」「列名の行の位置」「データの開始行」の設定を確認してください。"]);
    }
    if (table.errorCount) {
      var lines = table.errors.slice(0, 5).map(function (e) {
        return (e.line ? e.line + " 行目: " : "") + e.message + (e.text ? "「" + e.text + "」" : "");
      });
      if (table.errorCount > 5) lines.push("ほか " + (table.errorCount - 5) + " 件");
      showBanner("warning", table.warnOnly
        ? "列数が揃わない行が " + table.errorCount + " 行あります(値は取り込みました)"
        : "解析できない行を " + table.errorCount + " 行スキップしました", lines);
    }

    state.defs = S.infer(table, parseOpt());
    state.cols = {};
    state.mat = {};
    state.defs.forEach(function (c) {
      state.cols[c.name] = c;
      state.mat[c.name] = S.materialize(table, c, parseOpt());
    });
    reportInvalid();

    renderLoadOptions(dec.encoding, table);
    // 列名の行・データの開始行が下の方にあっても、その少し先まで見えるようにする(広げた表示は縮めない)
    var need = Math.max(RAW_HEAD_STEP, (table.dataRow || 0) + 5);
    state.rawShown = isNewFile ? need : Math.max(state.rawShown, need);
    renderRawHead();
    state.rawScrollPending = true;
    scrollRawHeadToStart();
    renderStats();
    renderColumnTable();
    renderPreview();
    $("load-result").hidden = false;

    if (!table.rows.length) { $("viz-section").hidden = true; return; }
    $("viz-section").hidden = false;
    initSettings(isNewFile);
    scheduleRender(0);
  }

  function rematerialize(name) {
    var c = state.cols[name];
    state.mat[name] = S.materialize(state.table, c, parseOpt());
  }

  function reportInvalid() {
    var lines = [];
    state.defs.forEach(function (c) {
      var m = state.mat[c.name];
      if ((c.type === "datetime" || c.type === "number") && m.invalid) {
        lines.push("「" + c.name + "」(" + S.TYPE_LABEL[c.type] + "): " + m.invalid + " 件を欠損として除外 — 例: " +
          m.invalidSamples.map(function (s) { return "「" + s + "」"; }).join(" "));
      }
    });
    var old = document.querySelector("[data-banner='invalid']");
    if (old) old.remove();
    if (lines.length) {
      showBanner("warning", "解析できない値があります", lines);
      $("banners").lastChild.setAttribute("data-banner", "invalid");
    }
  }

  /* ---------- 読み込み結果の表示 ---------- */

  function renderLoadOptions(encoding, table) {
    var fmtLabel = table ? "自動(" + P.FORMAT_LABEL[table.format] + ")" : "自動";
    mountSelect("opt-format", [["auto", fmtLabel], ["jsonl", "JSON Lines"], ["json", "JSON 配列"], ["csv", "CSV"], ["tsv", "TSV"]], state.loadOpt.format)
      .addEventListener("change", function (e) { state.loadOpt.format = e.target.value; resetRowOptions(); loadData(false); });
    var encLabel = { "utf-8": "UTF-8", shift_jis: "Shift_JIS", "utf-16le": "UTF-16LE", "utf-16be": "UTF-16BE" };
    mountSelect("opt-encoding", [["auto", "自動(" + (encLabel[encoding] || encoding) + ")"], ["utf-8", "UTF-8"], ["shift_jis", "Shift_JIS"], ["utf-16le", "UTF-16LE"]], state.loadOpt.encoding)
      .addEventListener("change", function (e) { state.loadOpt.encoding = e.target.value; loadData(false); });
    var isDelim = table && (table.format === "csv" || table.format === "tsv");
    var hdr = mountSelect("opt-header", [["yes", "あり"], ["no", "なし"]], state.loadOpt.header, { disabled: !isDelim });
    hdr.addEventListener("change", function (e) { state.loadOpt.header = e.target.value; loadData(false); });
    // 開始行: 空欄は自動。自動で決まった行は placeholder に出す
    var hasHeader = state.loadOpt.header !== "no";
    var hr = $("opt-header-row");
    hr.disabled = !isDelim || !hasHeader;
    hr.value = hasHeader && state.loadOpt.headerRow ? state.loadOpt.headerRow : "";
    hr.placeholder = isDelim && table.headerRow ? "自動(" + table.headerRow + " 行目)" : "";
    var dr = $("opt-data-row");
    dr.disabled = !isDelim;
    dr.value = state.loadOpt.dataRow || "";
    dr.placeholder = isDelim ? "自動(" + table.dataRow + " 行目)" : "";
    mountSelect("opt-tz", [["JST", D.TZ_LABEL.JST], ["UTC", D.TZ_LABEL.UTC], ["local", D.TZ_LABEL.local]], state.loadOpt.tz, { "aria-describedby": "opt-tz-help" })
      .addEventListener("change", function (e) { state.loadOpt.tz = e.target.value; refreshDatetimeColumns(); });
    var months = [];
    for (var m = 1; m <= 12; m++) months.push([m, m + " 月"]);
    mountSelect("opt-fystart", months, state.loadOpt.fyStart)
      .addEventListener("change", function (e) {
        state.loadOpt.fyStart = parseInt(e.target.value, 10);
        refreshDatetimeColumns();
      });
  }

  function onRowOptionChange(key, e) {
    var n = parseInt(e.target.value, 10);
    state.loadOpt[key] = n >= 1 ? n : null;
    loadData(false);
  }

  /** ファイルの先頭を行番号つきで表示する(列名の行・データの開始行を確かめるため) */
  function renderRawHead() {
    var t = state.table;
    var section = $("raw-head-section");
    var body = $("raw-head-body");
    body.textContent = "";
    if (!t.rawHead) { section.hidden = true; return; }
    section.hidden = false;
    var shown = t.rawHead.slice(0, state.rawShown);
    var width = shown.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    $("raw-head-content").colSpan = width;
    var total = t.rawTotal;
    var count = shown.length >= total
      ? "全 " + total.toLocaleString("ja-JP") + " 行を表示"
      : "全 " + total.toLocaleString("ja-JP") + " 行のうち先頭 " + shown.length.toLocaleString("ja-JP") + " 行を表示";
    var more = shown.length < t.rawHead.length;
    if (!more && shown.length < total) count += "(ここで確認できるのは先頭 " + shown.length.toLocaleString("ja-JP") + " 行までです)";
    $("raw-head-count").textContent = count;
    $("raw-head-more").hidden = !more;
    function chip(text, color) {
      return el("span", { className: "dads-chip-label", "data-style": "filled-1", "data-color": color, text: text });
    }
    shown.forEach(function (r, i) {
      var line = i + 1;
      var empty = r.every(function (v) { return String(v).trim() === ""; });
      var role = null;
      if (line === t.headerRow) role = chip("列名", "blue");
      else if (line === t.dataRow) role = chip("データの開始", "green");
      else if (line < t.dataRow || empty) role = el("span", { className: "app-text-muted", text: empty ? "空行" : "読み飛ばす" });
      var cells = [];
      for (var c = 0; c < width; c++) cells.push(el("td", { text: r[c] === undefined ? "" : String(r[c]).slice(0, 60) }));
      body.appendChild(el("tr", { className: line < t.dataRow && line !== t.headerRow ? "app-row-skipped" : null, "data-start": line === (t.headerRow || t.dataRow) ? "" : null }, [
        el("th", { scope: "row", className: "app-rownum", text: String(line) }),
        el("td", null, [role]),
      ].concat(cells)));
    });
  }

  /**
   * 読み込みの後、列名の行(なければデータの開始行)が見える位置まで表の枠をスクロールする。
   * 折りたたまれている間は位置を決められないので、開いたときに行う。
   */
  function scrollRawHeadToStart() {
    var section = $("raw-head-section");
    if (!state.rawScrollPending || section.hidden || !section.open) return;
    state.rawScrollPending = false;
    var row = $("raw-head-body").querySelector("tr[data-start]");
    var box = section.querySelector(".app-table-scroll");
    if (!row) { box.scrollTop = 0; return; }
    // 見出し行の下に、直前の 2 行と合わせて見えるようにする
    var prev = row.previousElementSibling;
    if (prev && prev.previousElementSibling) prev = prev.previousElementSibling;
    var head = section.querySelector("thead");
    box.scrollTop = Math.max(0, (prev || row).offsetTop - head.offsetHeight);
  }

  function refreshDatetimeColumns() {
    state.defs.forEach(function (c) { if (c.type === "datetime") rematerialize(c.name); });
    reportInvalid();
    renderColumnTable();
    updateDependentControls();
    scheduleRender(0);
  }

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function renderStats() {
    var t = state.table;
    var dl = $("load-stats");
    dl.textContent = "";
    [
      ["ファイル", state.file.name + "(" + fmtBytes(state.file.size) + ")"],
      ["形式", P.FORMAT_LABEL[t.format] + (t.delimiter === "\t" && t.format === "csv" ? "(タブ区切り)" : "")],
      ["文字コード", { "utf-8": "UTF-8", shift_jis: "Shift_JIS" }[state.encoding] || state.encoding],
      ["行数", t.rows.length.toLocaleString("ja-JP")],
      ["列数", t.columns.length.toLocaleString("ja-JP")],
    ].forEach(function (kv) {
      dl.appendChild(el("div", { className: "app-stats__item" }, [el("dt", { text: kv[0] }), el("dd", { text: kv[1] })]));
    });
  }

  function formatOptions(c) {
    var builtIn = D.PATTERNS.map(function (p) { return [p.id, p.label]; });
    var opts = [{ group: "書式", options: builtIn }];
    var custom = c.dtFormat && c.dtFormat.indexOf("custom:") === 0 ? c.dtFormat : null;
    opts.push({ group: "その他", options: [[custom || "custom:", custom ? "カスタム: " + custom.slice(7) : "カスタム(書式を入力)…"]] });
    return opts;
  }

  function exampleValues(c) {
    var out = [];
    var rows = state.table.rows;
    for (var i = 0; i < rows.length && out.length < 3; i++) {
      var v = rows[i][c.index];
      if (!S.isMissing(v)) out.push(String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 30));
    }
    return out.join(" / ");
  }

  function renderColumnTable() {
    var tbody = $("column-rows");
    tbody.textContent = "";
    state.defs.forEach(function (c, i) {
      var m = state.mat[c.name];
      var typeOpts = TYPE_OPTIONS.slice();
      if (c.type === "empty") typeOpts.unshift(["empty", "空"]);
      var typeSel = makeSelect("col-type-" + i, typeOpts, c.type, { "aria-label": "「" + c.name + "」の型" });
      typeSel.querySelector("select").addEventListener("change", function (e) { changeColumnType(c, e.target.value); });

      var fmtCell = el("td");
      if (c.type === "datetime") {
        var fs = makeSelect("col-fmt-" + i, formatOptions(c), c.dtFormat, { "aria-label": "「" + c.name + "」の日時の書式" });
        var isCustom = c.dtFormat && c.dtFormat.indexOf("custom:") === 0;
        var customBox = makeCustomFormatInput(c, i);
        customBox.hidden = !isCustom;
        fs.querySelector("select").addEventListener("change", function (e) {
          var v = e.target.value;
          if (v.indexOf("custom:") === 0) {
            customBox.hidden = false;
            customBox.querySelector("input").focus();
            return;
          }
          changeColumnFormat(c, v);
        });
        fmtCell.appendChild(fs);
        fmtCell.appendChild(customBox);
      } else {
        fmtCell.appendChild(el("span", { className: "app-text-muted", text: "—" }));
      }

      var granText = c.type === "datetime" && m.granularity ? D.GRAN_LABEL[m.granularity] : "—";
      var bad = m.missing + " / " + m.invalid;
      var tr = el("tr", null, [
        el("th", { scope: "row", className: "app-colname" }, [makeNameInput(c, i)]),
        el("td", null, [typeSel]),
        fmtCell,
        el("td", { text: granText }),
        el("td", { className: m.invalid ? "app-cell-warn" : null, text: bad }),
        el("td", { className: "app-example", text: exampleValues(c) }),
      ]);
      tbody.appendChild(tr);
    });
  }

  /** 列名の入力欄。確定(change)で列名を変える */
  function makeNameInput(c, i) {
    var input = el("input", {
      id: "col-name-" + i, className: "dads-input-text__input", type: "text", "data-size": "sm",
      value: c.name, placeholder: state.table.sourceColumns[i], "aria-label": (i + 1) + " 列目の列名",
    });
    input.addEventListener("change", function () { renameColumn(c, input.value); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    return el("span", { className: "dads-input-text app-colname-input" }, [input]);
  }

  /**
   * 列名を変える。型の手動変更やグラフの設定を保つため、再解析せずその場で付け替える。
   * 空なら元の列名に戻し、他の列と重なる名前には _2 などを付ける。
   */
  function renameColumn(c, name) {
    var t = state.table;
    var old = c.name;
    name = String(name).trim();
    var custom = name !== "";
    var others = t.columns.slice();
    others.splice(c.index, 1);
    name = P.uniqueHeaders(others.concat([custom ? name : t.sourceColumns[c.index]])).pop();
    state.loadOpt.colNames[c.index] = custom ? name : null;
    if (name === old) { renderColumnTable(); return; }

    t.columns[c.index] = name;
    c.name = name;
    state.cols[name] = c;
    delete state.cols[old];
    state.mat[name] = state.mat[old];
    delete state.mat[old];
    [state.yChecked, state.yRight].forEach(function (set) {
      if (set.delete(old)) set.add(name);
    });
    // 選択中の列は、選択肢の値を新しい列名に書き換えて選択を保つ
    ["x-col", "split-col", "filter-col"].forEach(function (id) {
      var sel = $(id);
      if (sel && sel.value === old) sel.options[sel.selectedIndex].value = name;
    });
    reportInvalid();
    renderColumnTable();
    renderPreview();
    updateDependentControls();
    scheduleRender(0);
  }

  /** カスタム書式の入力欄(DADS インプットテキスト + 適用ボタン) */
  function makeCustomFormatInput(c, i) {
    var id = "col-custom-" + i;
    var errId = id + "-err";
    var cur = c.dtFormat && c.dtFormat.indexOf("custom:") === 0 ? c.dtFormat.slice(7) : "";
    var input = el("input", {
      id: id, className: "dads-input-text__input", type: "text", "data-size": "sm",
      value: cur, placeholder: "例: yyyy年M月d日 H時", "aria-label": "「" + c.name + "」のカスタム書式",
    });
    var err = el("span", { id: errId, className: "dads-input-text__error-text", hidden: true });
    function apply() {
      var f = input.value.trim();
      if (!f || !D.compileCustom(f)) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", errId);
        err.textContent = "＊書式を解釈できません。y M d H m s g e Q などの記号で指定してください。";
        err.hidden = false;
        input.focus();
        return;
      }
      changeColumnFormat(c, "custom:" + f);
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); apply(); } });
    var btn = el("button", { className: "dads-button", "data-type": "outline", "data-size": "xs", type: "button", text: "適用", onclick: apply });
    return el("div", { className: "app-custom-format" }, [el("span", { className: "dads-input-text" }, [input, err]), btn]);
  }

  function changeColumnType(c, type) {
    c.type = type;
    if (type === "datetime") {
      var det = D.detectColumn(state.table.rows.map(function (r) { return r[c.index]; }), c.name, parseOpt());
      // 列名ヒントなしでは判定しない書式(UNIX 時刻・年)も、手動指定時は候補にする
      if (!det) det = D.detectColumn(state.table.rows.map(function (r) { return r[c.index]; }), "date " + c.name, parseOpt());
      c.dtFormat = det ? det.format : c.dtFormat || "ymd";
      c.granularity = det ? det.granularity : null;
    }
    rematerialize(c.name);
    reportInvalid();
    renderColumnTable();
    updateDependentControls();
    scheduleRender(0);
  }

  function changeColumnFormat(c, fmt) {
    c.dtFormat = fmt;
    c.granularity = S.redetectGranularity(state.table, c, parseOpt());
    rematerialize(c.name);
    reportInvalid();
    renderColumnTable();
    updateDependentControls();
    scheduleRender(0);
  }

  function renderPreview() {
    var t = state.table;
    var head = $("preview-head");
    var body = $("preview-body");
    head.textContent = "";
    body.textContent = "";
    head.appendChild(el("tr", null, t.columns.map(function (c) {
      return el("th", { className: "dads-table__col-header", scope: "col", text: c });
    })));
    var frag = document.createDocumentFragment();
    t.rows.slice(0, 100).forEach(function (r) {
      frag.appendChild(el("tr", null, r.map(function (v) {
        return el("td", { text: v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v) });
      })));
    });
    body.appendChild(frag);
  }

  /* ---------- グラフ設定 ---------- */

  function colsOfType(types) {
    return state.defs.filter(function (c) { return types.indexOf(c.type) >= 0; });
  }

  function colLabel(c) {
    var m = state.mat[c.name];
    var t = S.TYPE_LABEL[c.type];
    if (c.type === "datetime" && m && m.granularity) t += "・" + D.GRAN_LABEL[m.granularity];
    return c.name + "(" + t + ")";
  }

  function initSettings(isNewFile) {
    // グラフ種類
    var ct = $("chart-types");
    if (!ct.childElementCount) {
      CHART_TYPES.forEach(function (t, i) { ct.appendChild(makeRadio("chartType", t[0], t[1], i === 0)); });
      ct.addEventListener("change", function () { onSettingsChange(); });
    }
    mountSelect("chart-type-right", RIGHT_TYPES, isNewFile || !$("chart-type-right") ? "line" : $("chart-type-right").value, { "aria-describedby": "right-type-help" })
      .addEventListener("change", onSettingsChange);

    var prevX = $("x-col") ? $("x-col").value : null;
    var xCandidates = state.defs.filter(function (c) { return c.type !== "empty"; });
    var defaultX = colsOfType(["datetime"])[0] || colsOfType(["category"])[0] || colsOfType(["number"])[0] || xCandidates[0];
    var xVal = !isNewFile && prevX && state.cols[prevX] ? prevX : defaultX && defaultX.name;
    mountSelect("x-col", xCandidates.map(function (c) { return [c.name, colLabel(c)]; }), xVal, { "aria-describedby": "x-col-help" })
      .addEventListener("change", function () { onXChange(); });

    if (isNewFile) {
      state.yChecked = new Set();
      state.yRight = new Set();
      colsOfType(["number"]).filter(function (c) { return c.name !== xVal; }).slice(0, 3)
        .forEach(function (c) { state.yChecked.add(c.name); });
    }

    mountSelect("agg", Object.keys(T.AGG_LABEL).map(function (k) { return [k, T.AGG_LABEL[k]]; }), isNewFile ? "none" : $("agg") && $("agg").value || "none")
      .addEventListener("change", onSettingsChange);

    mountSelect("legend-pos", [["top", "上"], ["bottom", "下"], ["right", "右"], ["none", "表示しない"]], "top")
      .addEventListener("change", onSettingsChange);
    mountSelect("display-tz", [["JST", D.TZ_LABEL.JST], ["UTC", D.TZ_LABEL.UTC], ["local", D.TZ_LABEL.local]], $("display-tz") ? $("display-tz").value : "JST")
      .addEventListener("change", function () { syncRangeInputs(); onSettingsChange(); });
    mountSelect("calendar", [["gregorian", "西暦"], ["japanese", "和暦"]], "gregorian")
      .addEventListener("change", onSettingsChange);

    if (isNewFile) {
      LABEL_INPUTS.forEach(function (id) { $(id).value = ""; });
      document.querySelector('input[name="chartType"][value="line"]').checked = true;
    }
    onXChange(true);
  }

  /** 列の型変更などで選択肢が変わるコントロールを作り直す */
  function updateDependentControls() {
    var xSel = $("x-col");
    if (!xSel) return;
    var cur = xSel.value;
    var xCandidates = state.defs.filter(function (c) { return c.type !== "empty"; });
    fillSelect(xSel, xCandidates.map(function (c) { return [c.name, colLabel(c)]; }), cur);
    onXChange(false, true);
  }

  function onXChange(initial, keepOptions) {
    var x = state.cols[$("x-col").value];
    var xm = x ? state.mat[x.name] : null;

    // 日付表記の既定: 和暦の書式なら和暦
    if (x && x.type === "datetime" && !keepOptions) {
      $("calendar").value = /^wareki|custom:.*g/.test(x.dtFormat || "") ? "japanese" : "gregorian";
    }

    // 既定のグラフ種類: 粗い粒度で点が少なければ棒、カテゴリなら棒
    if (x && !keepOptions && !initial) {
      var type = "line";
      if (x.type === "category" || x.type === "text") type = "bar";
      else if (x.type === "datetime" && D.granRank(xm.granularity) >= D.granRank("month")) type = "bar";
      document.querySelector('input[name="chartType"][value="' + type + '"]').checked = true;
    } else if (x && initial) {
      if (x.type === "category" || x.type === "text" ||
        (x.type === "datetime" && D.granRank(xm.granularity) >= D.granRank("month") && state.table.rows.length <= 60)) {
        document.querySelector('input[name="chartType"][value="bar"]').checked = true;
      }
    }

    renderYList();

    // 同じ X の値が複数行にある(地域別の月次表など)なら既定の集計を「合計」に
    if (x && !keepOptions && (x.type === "datetime" || x.type === "number")) {
      $("agg").value = hasDuplicates(xm.values) ? "sum" : "none";
    }

    // 系列分割
    var splitCands = colsOfType(["category", "text"]).filter(function (c) { return !x || c.name !== x.name; });
    var prevSplit = $("split-col") ? $("split-col").value : "";
    mountSelect("split-col", [["", "分割しない"]].concat(splitCands.map(function (c) {
      return [c.name, c.name + "(" + (state.mat[c.name].stats.distinct || 0) + " 種類)"];
    })), prevSplit, { "aria-describedby": "split-help" }).addEventListener("change", onSettingsChange);

    // 時間の単位
    var bf = $("bucket-field");
    if (x && x.type === "datetime") {
      bf.hidden = false;
      var g = xm.granularity || "day";
      var opts = [["raw", "元データのまま(" + D.GRAN_LABEL[g] + ")"]].concat(
        D.allowedBuckets(g).filter(function (b) { return b !== g; })
          .map(function (b) { return [b, D.GRAN_LABEL[b] + "ごと"]; }));
      var prevB = $("bucket") ? $("bucket").value : "raw";
      mountSelect("bucket", opts, keepOptions ? prevB : "raw").addEventListener("change", onBucketChange);
    } else {
      bf.hidden = true;
      if (!$("bucket")) mountSelect("bucket", [["raw", "元データのまま"]], "raw");
      $("bucket").value = "raw";
    }

    // 期間フィルタ
    $("range-fields").hidden = !(x && x.type === "datetime");
    if (!keepOptions) { $("range-from").value = ""; $("range-to").value = ""; }
    syncRangeInputs();

    // カテゴリフィルタ
    var filterCands = colsOfType(["category"]);
    var prevF = $("filter-col") ? $("filter-col").value : "";
    mountSelect("filter-col", [["", "絞り込まない"]].concat(filterCands.map(function (c) { return [c.name, c.name]; })), keepOptions ? prevF : prevF && state.cols[prevF] ? prevF : "")
      .addEventListener("change", function () { renderFilterValues(); onSettingsChange(); });
    renderFilterValues(keepOptions);

    if (!initial) onSettingsChange();
  }

  function hasDuplicates(values) {
    var seen = new Set();
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === null) continue;
      if (seen.has(v)) return true;
      seen.add(v);
    }
    return false;
  }

  function onBucketChange() {
    // 時間の単位を選んだのに集計が「なし」なら平均にする
    if ($("bucket").value !== "raw" && $("agg").value === "none") $("agg").value = "avg";
    onSettingsChange();
  }

  function renderYList() {
    var x = $("x-col").value;
    var box = $("y-list");
    box.textContent = "";
    var nums = colsOfType(["number"]).filter(function (c) { return c.name !== x; });
    if (!nums.length) {
      box.appendChild(el("p", { className: "app-text-muted", text: "数値の列がありません。「集計」で「件数」を選ぶと行数をグラフにできます。" }));
      return;
    }
    nums.forEach(function (c, i) {
      var checked = state.yChecked.has(c.name);
      var main = makeCheckbox(c.name, { checked: checked, "data-y": c.name, id: "y-" + i });
      var right = makeCheckbox("右軸", { checked: state.yRight.has(c.name), "data-y-right": c.name, disabled: !checked, "aria-label": "「" + c.name + "」を右軸に表示" }, "sm");
      right.classList.add("app-y-right");
      var sw = el("span", { className: "app-swatch", "aria-hidden": "true" });
      sw.style.background = V.color(numericColorIndex(c.name));
      box.appendChild(el("div", { className: "app-y-row" }, [sw, main, right]));
    });
    enforceYLimit();
    box.onchange = function (e) {
      var t = e.target;
      if (t.dataset.y) {
        if (t.checked) state.yChecked.add(t.dataset.y); else state.yChecked.delete(t.dataset.y);
        var r = box.querySelector('[data-y-right="' + cssEscape(t.dataset.y) + '"]');
        if (r) r.disabled = !t.checked;
        enforceYLimit();
      } else if (t.dataset.yRight) {
        if (t.checked) state.yRight.add(t.dataset.yRight); else state.yRight.delete(t.dataset.yRight);
      }
      onSettingsChange();
    };
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  function enforceYLimit() {
    var boxes = $("y-list").querySelectorAll("input[data-y]");
    var n = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).length;
    boxes.forEach(function (b) { if (!b.checked) b.disabled = n >= MAX_Y; });
  }

  /** 色は数値列の並び順で固定(選択を変えても色が変わらない) */
  function numericColorIndex(name) {
    var nums = colsOfType(["number"]);
    for (var i = 0; i < nums.length; i++) if (nums[i].name === name) return i % V.PALETTE.length;
    return 0;
  }

  function renderFilterValues(keep) {
    var col = $("filter-col").value;
    var field = $("filter-values-field");
    var box = $("filter-values");
    var prev = keep ? currentFilterValues() : null;
    box.textContent = "";
    if (!col) { field.hidden = true; updateFilterBadge(); return; }
    field.hidden = false;
    var m = state.mat[col];
    var cats = (m.categories || []).slice(0, 300);
    if (m.missing) cats = cats.concat([{ value: "(空)", count: m.missing }]);
    cats.forEach(function (c, i) {
      box.appendChild(makeCheckbox(c.value + "(" + c.count.toLocaleString("ja-JP") + ")", {
        checked: prev ? prev.indexOf(c.value) >= 0 : true, "data-fv": c.value, id: "fv-" + i,
      }));
    });
    if ((m.categories || []).length > 300) box.appendChild(el("p", { className: "app-text-muted", text: "値が多いため上位 300 件のみ表示しています。" }));
    box.onchange = onSettingsChange;
    updateFilterBadge();
  }

  function currentFilterValues() {
    var boxes = $("filter-values").querySelectorAll("input[data-fv]");
    var out = [];
    boxes.forEach(function (b) { if (b.checked) out.push(b.dataset.fv); });
    return out;
  }

  function updateFilterBadge() {
    var active = 0;
    if (!$("range-fields").hidden && ($("range-from").value || $("range-to").value)) active++;
    if ($("filter-col") && $("filter-col").value) {
      var all = $("filter-values").querySelectorAll("input[data-fv]");
      var on = currentFilterValues().length;
      if (on < all.length) active++;
    }
    var b = $("filter-badge");
    b.textContent = "";
    if (active) b.appendChild(el("span", { className: "dads-chip-label", "data-style": "filled-1", "data-color": "blue", text: active + " 件適用中" }));
  }

  function syncRangeInputs() {
    var x = state.cols[$("x-col").value];
    if (!x || x.type !== "datetime") return;
    var st = state.mat[x.name].stats;
    var tz = $("display-tz").value;
    if (st.min !== null) {
      $("range-from").placeholder = D.toInputValue(st.min, tz);
      $("range-to").placeholder = D.toInputValue(st.max, tz);
      $("range-from").min = $("range-to").min = D.toInputValue(st.min, tz);
      $("range-from").max = $("range-to").max = D.toInputValue(st.max, tz);
    }
  }

  function readConfig() {
    var x = $("x-col").value;
    var tz = $("display-tz").value;
    var display = { tz: tz, calendar: $("calendar").value, fyStart: state.loadOpt.fyStart };
    var from = $("range-from").value ? D.fromInputValue($("range-from").value, tz) : null;
    var to = $("range-to").value ? D.fromInputValue($("range-to").value, tz) + 59999 : null;
    var ys = [];
    colsOfType(["number"]).forEach(function (c) {
      if (c.name !== x && state.yChecked.has(c.name)) {
        ys.push({ name: c.name, right: state.yRight.has(c.name), color: numericColorIndex(c.name) });
      }
    });
    var fcol = $("filter-col").value;
    var chartType = (document.querySelector('input[name="chartType"]:checked') || {}).value || "line";
    var agg = $("agg").value;
    var usesRight = agg !== "count" && ys.some(function (y) { return y.right; });
    var mixable = chartType !== "pie" && chartType !== "scatter";
    return {
      chartType: chartType,
      chartTypeRight: usesRight && mixable ? $("chart-type-right").value : null,
      usesRight: usesRight,
      x: x,
      ys: ys,
      split: $("split-col").value || null,
      agg: agg,
      bucket: $("bucket").value,
      from: from,
      to: to,
      filter: fcol ? { col: fcol, values: currentFilterValues() } : null,
      display: display,
      labels: {
        title: $("chart-title").value,
        subtitle: $("chart-subtitle").value,
        xTitle: $("x-title").value,
        yTitle: $("y-title").value,
        y2Title: $("y2-title").value,
        note: $("chart-note").value,
        source: $("chart-source").value,
      },
      beginAtZero: $("begin-zero").checked,
      showPoints: $("show-points").checked,
      legend: $("legend-pos").value,
      gapFactor: parseFloat($("gap-factor").value) || 0,
    };
  }

  /* ---------- 描画 ---------- */

  var renderTimer = null;
  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderChart, delay === undefined ? 120 : delay);
  }

  function onSettingsChange() {
    updateFilterBadge();
    scheduleRender();
  }

  function destroyChart() {
    if (state.chart) { state.chart.destroy(); state.chart = null; }
  }

  function showEmpty(msg) {
    destroyChart();
    state.lastRes = null;
    var e = $("chart-empty");
    e.hidden = false;
    e.textContent = msg;
    $("chart").hidden = true;
    $("chart-meta").textContent = "";
    $("chart-notes").textContent = "";
    $("summary-rows").textContent = "";
    setToolbarEnabled(false);
  }

  function setToolbarEnabled(on) {
    ["btn-reset-zoom", "btn-png", "btn-svg", "btn-csv"].forEach(function (id) { $(id).disabled = !on; });
  }

  function renderChart() {
    if (!state.table || $("viz-section").hidden) return;
    var cfg = readConfig();
    syncDependentFields(cfg);
    var res;
    try {
      res = T.build({ cols: state.cols, mat: state.mat, rowCount: state.table.rows.length }, cfg);
    } catch (err) {
      console.error(err);
      showEmpty("グラフを作成できませんでした: " + (err && err.message || err));
      return;
    }
    if (res.error) { showEmpty(res.error); return; }
    if (!res.rowsUsed || !res.pointCount) { showEmpty("表示できるデータがありません。絞り込み条件や列の型を確認してください。"); return; }

    $("chart-empty").hidden = true;
    $("chart").hidden = false;
    destroyChart();
    var out;
    try {
      out = V.render($("chart"), res, cfg);
    } catch (err) {
      console.error(err);
      showEmpty("グラフを描画できませんでした: " + (err && err.message || err));
      return;
    }
    state.chart = out.chart;
    state.lastRes = res;
    state.lastCfg = cfg;
    setToolbarEnabled(true);
    $("btn-reset-zoom").disabled = cfg.chartType === "pie";

    // メタ情報・注意書き
    var meta = "対象 " + res.rowsUsed.toLocaleString("ja-JP") + " / " + res.rowsTotal.toLocaleString("ja-JP") + " 行";
    if (res.xGran) meta += "・" + D.GRAN_LABEL[res.xGran] + "単位";
    if (res.agg !== "none") meta += "・" + T.AGG_LABEL[res.agg];
    if (res.pointCount > 4000 && (cfg.chartType === "line" || cfg.chartType === "area")) meta += "・点が多いため間引いて描画";
    $("chart-meta").textContent = meta;

    var notes = res.notes.concat(out.notes);
    if (res.excludedX) notes.push("X 軸の値が空または解析できない " + res.excludedX.toLocaleString("ja-JP") + " 行は除外しています。");
    var ul = $("chart-notes");
    ul.textContent = "";
    notes.forEach(function (n) { ul.appendChild(el("li", { text: n })); });

    renderSummary(res);
    $("chart").setAttribute("aria-label", describe(res, cfg));
    $("x-title").placeholder = out.axisTitles.x || "";
    $("y-title").placeholder = out.axisTitles.y || "";
    $("y2-title").placeholder = out.axisTitles.y2 || "";
  }

  /** 右軸の種類・軸名の入力欄を、いまの設定で意味があるときだけ表示する */
  function syncDependentFields(cfg) {
    var pie = cfg.chartType === "pie";
    $("right-type-field").hidden = !cfg.chartTypeRight;
    $("axis-title-fields").hidden = pie;
    $("y2-title-field").hidden = pie || !cfg.usesRight;
  }

  function describe(res, cfg) {
    function label(list, v) { return list.filter(function (t) { return t[0] === v; })[0][1]; }
    var title = cfg.labels.title.trim();
    var s = (title ? title + "。" : "") + label(CHART_TYPES, cfg.chartType) + "グラフ";
    if (cfg.chartTypeRight) s += "(右軸は" + label(RIGHT_TYPES, cfg.chartTypeRight) + ")";
    s += "。横軸: " + res.xName + "。";
    s += res.series.map(function (x) {
      return x.label + "(最小 " + V.fmtNum(x.summary.min) + "、最大 " + V.fmtNum(x.summary.max) + "、平均 " + V.fmtNum(x.summary.avg) + ")";
    }).join("、");
    return s + "。数値は下の要約表にもあります。";
  }

  function renderSummary(res) {
    var tbody = $("summary-rows");
    tbody.textContent = "";
    var pie = state.lastCfg.chartType === "pie";
    res.series.forEach(function (s) {
      var sw = el("span", { className: "app-swatch", "aria-hidden": "true" });
      sw.style.background = pie ? "transparent" : V.color(s.colorIndex);
      if (pie) sw.hidden = true;
      tbody.appendChild(el("tr", null, [
        el("th", { scope: "row" }, [sw, " " + s.label + (s.axis === "y2" ? "(右軸)" : "")]),
        el("td", { className: "app-num", text: s.summary.count.toLocaleString("ja-JP") }),
        el("td", { className: "app-num", text: V.fmtNum(s.summary.min) }),
        el("td", { className: "app-num", text: V.fmtNum(s.summary.max) }),
        el("td", { className: "app-num", text: V.fmtNum(s.summary.avg) }),
        el("td", { className: "app-num", text: V.fmtNum(s.summary.last) }),
      ]));
    });
  }

  /* ---------- 出力 ---------- */

  function baseName() {
    return (state.file ? state.file.name.replace(/\.[^.]+$/, "") : "chart") || "chart";
  }

  function download(href, name) {
    var a = el("a", { href: href, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function savePNG() {
    if (!state.chart) return;
    download(state.chart.toBase64Image("image/png", 1), baseName() + "_chart.png");
  }

  function saveSVG() {
    if (!state.chart || !state.lastRes) return;
    var c = state.chart;
    var xRange = null;
    if (c.isZoomedOrPanned && c.isZoomedOrPanned() && c.scales.x) xRange = { min: c.scales.x.min, max: c.scales.x.max };
    var svg;
    try {
      svg = V.exportSVG(state.lastRes, state.lastCfg, { width: c.width, height: c.height, xRange: xRange });
    } catch (err) {
      console.error(err);
      showBanner("error", "SVG を作成できませんでした", [String(err && err.message || err)]);
      return;
    }
    var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    download(url, baseName() + "_chart.svg");
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function saveCSV() {
    if (!state.lastRes) return;
    var csv = T.toCSV(T.toTable(state.lastRes, state.lastCfg.display));
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    download(url, baseName() + "_chart_data.csv");
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- 初期化 ---------- */

  function init() {
    hookFileUpload();
    $("file-upload").addEventListener("viz-files-change", onFilesChange);
    $("btn-reset-zoom").addEventListener("click", function () { if (state.chart && state.chart.resetZoom) state.chart.resetZoom(); });
    $("btn-png").addEventListener("click", savePNG);
    $("btn-svg").addEventListener("click", saveSVG);
    $("btn-csv").addEventListener("click", saveCSV);
    $("range-clear").addEventListener("click", function () { $("range-from").value = ""; $("range-to").value = ""; onSettingsChange(); });
    $("filter-all").addEventListener("click", function () {
      $("filter-values").querySelectorAll("input[data-fv]").forEach(function (b) { b.checked = true; });
      onSettingsChange();
    });
    $("filter-none").addEventListener("click", function () {
      $("filter-values").querySelectorAll("input[data-fv]").forEach(function (b) { b.checked = false; });
      onSettingsChange();
    });
    ["range-from", "range-to", "begin-zero", "show-points", "gap-factor"].forEach(function (id) {
      $(id).addEventListener("change", onSettingsChange);
    });
    LABEL_INPUTS.forEach(function (id) {
      $(id).addEventListener("input", function () { scheduleRender(300); });
    });
    $("opt-header-row").addEventListener("change", function (e) { onRowOptionChange("headerRow", e); });
    $("opt-data-row").addEventListener("change", function (e) { onRowOptionChange("dataRow", e); });
    $("raw-head-section").addEventListener("toggle", scrollRawHeadToStart);
    $("raw-head-more").addEventListener("click", function () {
      state.rawShown += RAW_HEAD_STEP;
      renderRawHead();
    });
    $("settings").addEventListener("submit", function (e) { e.preventDefault(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
