// node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// PapaParse はブラウザ同様グローバルに置く
globalThis.Papa = require("../vendor/papaparse/papaparse.min.js");
const D = require("../js/datetime.js");
const P = require("../js/parser.js");
const S = require("../js/schema.js");
const T = require("../js/transform.js");

const display = { tz: "JST", calendar: "gregorian", fyStart: 4 };

function load(text, fileName, opt) {
  const table = P.parse(text, Object.assign({ fileName }, opt));
  const defs = S.infer(table, display);
  const cols = {}, mat = {};
  defs.forEach((c) => { cols[c.name] = c; mat[c.name] = S.materialize(table, c, display); });
  return { table, defs, ctx: { cols, mat, rowCount: table.rows.length } };
}

/** 接続数ログと同じ形式の JSONL を生成(10 分間隔、途中に欠測あり) */
function makeConnectionLog() {
  const lines = [];
  const pad = (n) => String(n).padStart(2, "0");
  let t = Date.UTC(2026, 9, 30, 7, 42, 16); // 2026-10-30T16:42:16+09:00
  for (let i = 0; i < 400; i++, t += 600000) {
    if (i >= 150 && i < 200) continue; // 収集停止
    const d = new Date(t + 9 * 3600000);
    const time = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
    const online = (i * 7) % 6;
    lines.push(JSON.stringify({ time, online_users: online, total_connections: online + (i % 2), enabled_users: 58, utilization_rate: Math.round((online / 58) * 1000) / 10 }));
  }
  return lines.join("\n") + "\n";
}

test("接続数ログ形式の JSONL", () => {
  const text = makeConnectionLog();
  const { table, defs, ctx } = load(text, "connection_counts.log");
  assert.equal(table.format, "jsonl");
  assert.equal(table.errorCount, 0);
  assert.deepEqual(defs.map((d) => d.type), ["datetime", "number", "number", "number", "number"]);
  assert.equal(defs[0].granularity, "second");

  const raw = T.build(ctx, { chartType: "line", x: "time", ys: [{ name: "online_users" }, { name: "utilization_rate", right: true }], agg: "none", bucket: "raw", display });
  assert.equal(raw.xKind, "time");
  assert.equal(raw.sharedX, true);
  assert.equal(raw.series.length, 2);
  assert.equal(raw.series[0].data.length, table.rows.length);
  assert.equal(raw.series[1].axis, "y2");

  const daily = T.build(ctx, { chartType: "bar", x: "time", ys: [{ name: "online_users" }], agg: "max", bucket: "day", display });
  assert.equal(daily.xKind, "time");
  const firstDay = D.format(daily.series[0].data[0].x, "day", display);
  assert.equal(firstDay, "2026/10/30");
  const maxByHand = Math.max(...table.rows.filter((r) => r[0].startsWith("2026-10-30")).map((r) => r[1]));
  assert.equal(daily.series[0].data[0].y, maxByHand);

  const csv = T.toCSV(T.toTable(daily, display));
  assert.match(csv.split("\r\n")[1], /^2026-10-30T00:00:00\+09:00,/);
});

test("和暦の月次 CSV(行順ばらばら)→ 時刻順・年度集計", () => {
  const csv = [
    "年月,地域,件数",
    "令和8年6月,東京,30",
    "令和8年4月,東京,10",
    "令和8年5月,東京,20",
    "令和8年4月,大阪,5",
    "令和9年3月,大阪,7",
    "令和9年4月,東京,1",
  ].join("\n");
  const { defs, ctx } = load(csv, "m.csv");
  assert.deepEqual(defs.map((d) => [d.type, d.dtFormat, d.granularity]), [
    ["datetime", "wareki", "month"], ["category", null, null], ["number", null, null],
  ]);
  const r = T.build(ctx, { chartType: "line", x: "年月", ys: [{ name: "件数" }], agg: "none", bucket: "raw", display });
  assert.equal(r.xKind, "time");
  const xs = r.series[0].data.map((p) => D.format(p.x, "month", Object.assign({}, display, { calendar: "japanese" })));
  assert.deepEqual(xs, ["令和8年4月", "令和8年4月", "令和8年5月", "令和8年6月", "令和9年3月", "令和9年4月"]);

  const fy = T.build(ctx, { chartType: "bar", x: "年月", ys: [{ name: "件数" }], agg: "sum", bucket: "fiscal", display: Object.assign({}, display, { calendar: "japanese" }) });
  assert.equal(fy.xKind, "period");
  assert.deepEqual(fy.labels, ["令和8年度", "令和9年度"]);
  assert.deepEqual(fy.series[0].data, [72, 1]);

  const split = T.build(ctx, { chartType: "stacked", x: "年月", ys: [{ name: "件数" }], split: "地域", agg: "sum", bucket: "month", display });
  assert.deepEqual(split.series.map((s) => s.label), ["東京", "大阪"]);

  const filtered = T.build(ctx, { chartType: "line", x: "年月", ys: [{ name: "件数" }], agg: "none", bucket: "raw", filter: { col: "地域", values: ["大阪"] }, display });
  assert.equal(filtered.rowsUsed, 2);

  // 年度データは欠けた年度も軸に並ぶ
  const { ctx: c2 } = load("年度,値\n令和3年度,1\n令和5年度,3\n", "f.csv");
  const g = T.build(c2, { chartType: "bar", x: "年度", ys: [{ name: "値" }], agg: "none", bucket: "raw", display });
  assert.deepEqual(g.labels, ["2021年度", "2022年度", "2023年度"]);
  assert.deepEqual(g.series[0].data, [1, null, 3]);
});

test("Shift_JIS・引用符・カンマ入り CSV", () => {
  const sjis = fs.readFileSync(path.join(__dirname, "fixtures/sjis.csv"));
  const dec = P.decode(sjis.buffer.slice(sjis.byteOffset, sjis.byteOffset + sjis.length), "auto");
  assert.equal(dec.encoding, "shift_jis");
  const { table, defs } = load(dec.text, "sjis.csv");
  assert.deepEqual(table.columns, ["日付", "支店", "売上", "備考"]);
  assert.equal(defs[2].type, "number");
  assert.equal(table.rows[0][3], "カンマ, 入り");
  assert.equal(S.toNumber("1,234"), 1234);
  assert.equal(S.toNumber("12.5%"), 12.5);
  assert.equal(S.toNumber("１２３"), 123);
});

test("壊れた行・ネストを含む JSONL", () => {
  const text = '{"t":"2026-01-01","a":{"b":1}}\n{broken\n\n{"t":"2026-01-02","a":{"b":2},"c":[1,2]}\n[1,2]\n';
  const t = P.parse(text, { fileName: "x.jsonl" });
  assert.equal(t.errorCount, 2);
  assert.deepEqual(t.columns, ["t", "a.b", "c"]);
  assert.equal(t.rows[1][2], "[1,2]");
});

test("系列が多いときは「その他」にまとめる", () => {
  const lines = ["d,k,v"];
  for (let i = 0; i < 12; i++) for (let j = 0; j <= i; j++) lines.push(`2026-01-0${(j % 9) + 1},k${i},1`);
  const { ctx } = load(lines.join("\n"), "x.csv");
  const r = T.build(ctx, { chartType: "line", x: "d", ys: [{ name: "v" }], split: "k", agg: "sum", bucket: "day", display });
  assert.equal(r.series.length, 8);
  assert.equal(r.series[7].label, "その他");
  assert.equal(new Set(r.series.map((s) => s.colorIndex)).size, 8);
});

test("右軸だけ棒のときも、数値の X はカテゴリ軸にする", () => {
  const { ctx } = load("n,a,b\n1,10,100\n2,20,200\n3,30,300\n", "n.csv");
  const ys = [{ name: "a" }, { name: "b", right: true }];
  const line = T.build(ctx, { chartType: "line", x: "n", ys, agg: "none", bucket: "raw", display });
  assert.equal(line.xKind, "linear");
  const mixed = T.build(ctx, { chartType: "line", chartTypeRight: "bar", x: "n", ys, agg: "none", bucket: "raw", display });
  assert.equal(mixed.xKind, "category");
  assert.deepEqual(mixed.series.map((s) => s.axis), ["y", "y2"]);
  const stacked = T.build(ctx, { chartType: "area", chartTypeRight: "stacked", x: "n", ys, agg: "none", bucket: "raw", display });
  assert.equal(stacked.xKind, "category");
});

test("前置きつき CSV: 列名の行を自動で決める", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "sample", "preamble_units.csv"), "utf8");
  const auto = P.parse(text, { fileName: "preamble_units.csv" });
  assert.equal(auto.headerRow, 4);
  assert.equal(auto.dataRow, 5);
  assert.deepEqual(auto.columns, ["年月", "地域", "売上", "来客数"]);
  assert.deepEqual(auto.rows[0], [null, null, "千円", "人"]); // 単位行はデータの開始行を指定して外す
  assert.deepEqual(auto.rawHead[0], ["地域別 月次売上(サンプル)", "", "", ""]);

  const { table, defs } = load(text, "preamble_units.csv", { dataRow: 6 });
  assert.equal(table.dataRow, 6);
  assert.equal(table.rows.length, 12);
  assert.deepEqual(table.rows[0], ["2025-04", "東", "1200", "340"]);
  assert.deepEqual(defs.map((c) => c.type), ["datetime", "category", "number", "number"]);
  assert.equal(table.errorCount, 0);

  // 先頭が普通のヘッダーなら今までどおり 1 行目
  const plain = P.parse(fs.readFileSync(path.join(__dirname, "..", "sample", "monthly_wareki.csv"), "utf8"), { fileName: "m.csv" });
  assert.equal(plain.headerRow, 1);
  assert.equal(plain.dataRow, 2);
});

test("列名の行・データの開始行の指定と、警告の行番号", () => {
  const text = "メモ\na,b,c\n(単位),,\n\n1,2,3\n4,5\n7,8,9\n";
  const t = P.parse(text, { fileName: "x.csv", headerRow: 2, dataRow: 4 });
  assert.deepEqual(t.columns, ["a", "b", "c"]);
  assert.deepEqual(t.rows, [["1", "2", "3"], ["4", "5", null], ["7", "8", "9"]]);
  assert.equal(t.errorCount, 1);
  assert.equal(t.errors[0].line, 6); // 空行も数えた、ファイル上の行番号

  // データの開始行が列名の行以前なら、列名の行の次から
  assert.equal(P.parse(text, { fileName: "x.csv", headerRow: 2, dataRow: 1 }).dataRow, 3);

  // タブ区切りで前置きが長くても区切り文字を判定できる
  const tsv = "表題\n作成者\n部署\n日付\n備考1\n備考2\n備考3\n備考4\nx\ty\n1\t2\n3\t4\n";
  const tt = P.parse(tsv, { fileName: "x.txt" });
  assert.equal(tt.delimiter, "\t");
  assert.equal(tt.headerRow, 9);
  assert.deepEqual(tt.columns, ["x", "y"]);
  assert.deepEqual(tt.rows, [["1", "2"], ["3", "4"]]);
});

test("ファイルの先頭(rawHead): 列名の行が 20 行より下にあっても含む", () => {
  const pre = [];
  for (let i = 1; i <= 26; i++) pre.push(i % 5 === 0 ? "" : "前置き " + i);
  const text = pre.join("\n") + "\n日付,地域,値\n2026-01-01,東,10\n2026-01-02,西,20\n";
  const t = P.parse(text, { fileName: "x.csv" });
  assert.equal(t.headerRow, 27);
  assert.equal(t.dataRow, 28);
  assert.equal(t.rawTotal, 29); // 末尾の改行による空行は数えない
  assert.equal(t.rawHead.length, 29);
  assert.deepEqual(t.rawHead[26], ["日付", "地域", "値"]);

  // 長いファイルは先頭 1000 行まで。全体の行数は rawTotal でわかる
  let long = "a,b\n";
  for (let i = 0; i < 1500; i++) long += i + "," + i * 2 + "\n";
  const lt = P.parse(long, { fileName: "x.csv" });
  assert.equal(lt.rawHead.length, 1000);
  assert.equal(lt.rawTotal, 1501);
});

test("列名なしの CSV に列名を付ける・列名の変更", () => {
  const text = "出力結果\n\n2026-01-01,東,10\n2026-01-02,西,20\n";
  const none = P.parse(text, { fileName: "x.csv", hasHeader: false });
  assert.equal(none.headerRow, null);
  assert.equal(none.dataRow, 3);
  assert.deepEqual(none.columns, ["列1", "列2", "列3"]);
  assert.equal(none.rows.length, 2);

  const named = P.parse(text, { fileName: "x.csv", hasHeader: false, columnNames: ["日付", " ", "列1"] });
  assert.deepEqual(named.columns, ["日付", "列2", "列1"]);
  assert.deepEqual(named.sourceColumns, ["列1", "列2", "列3"]);
  assert.deepEqual(P.parse(text, { fileName: "x.csv", hasHeader: false, columnNames: ["値", "値"] }).columns, ["値", "値_2", "列3"]);

  const jsonl = P.parse('{"very.long.name":1,"b":2}\n', { fileName: "x.jsonl", columnNames: ["短い名前"] });
  assert.deepEqual(jsonl.columns, ["短い名前", "b"]);
  assert.deepEqual(jsonl.sourceColumns, ["very.long.name", "b"]);
});
