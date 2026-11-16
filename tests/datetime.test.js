// node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/datetime.js");

const JST = { tz: "JST" };
const iso = (t) => D.toISO(t, "JST");

test("書式ごとの解析(JST)", () => {
  const cases = [
    // [書式, 入力, 期待 ISO(JST), 粒度]
    ["ymd", "2026-10-30T16:42:16+09:00", "2026-10-30T16:42:16+09:00", "second"],
    ["ymd", "2026-10-30T07:42:16Z", "2026-10-30T16:42:16+09:00", "second"],
    ["ymd", "2026-10-30 16:42:16.123", "2026-10-30T16:42:16.123+09:00", "millisecond"],
    ["ymd", "2026/10/30 16:42", "2026-10-30T16:42:00+09:00", "minute"],
    ["ymd", "2026-10-30", "2026-10-30T00:00:00+09:00", "day"],
    ["ymd", "2026/11/16(月) 午後3:05", "2026-11-16T15:05:00+09:00", "minute"],
    ["ymd", "２０２６／１０／３０", "2026-10-30T00:00:00+09:00", "day"],
    ["ymd-ja", "2026年10月30日", "2026-10-30T00:00:00+09:00", "day"],
    ["ymd-ja", "2026年10月30日 9時30分", "2026-10-30T09:30:00+09:00", "minute"],
    ["ymd-compact", "20261030", "2026-10-30T00:00:00+09:00", "day"],
    ["mdy", "10/30/2026", "2026-10-30T00:00:00+09:00", "day"],
    ["dmy", "30/10/2026", "2026-10-30T00:00:00+09:00", "day"],
    ["ym", "2026-11", "2026-11-01T00:00:00+09:00", "month"],
    ["ym", "2026/11", "2026-11-01T00:00:00+09:00", "month"],
    ["ym-ja", "2026年11月", "2026-11-01T00:00:00+09:00", "month"],
    ["ym-compact", "202611", "2026-11-01T00:00:00+09:00", "month"],
    ["y-ja", "2026年", "2026-01-01T00:00:00+09:00", "year"],
    ["fy", "2026年度", "2026-04-01T00:00:00+09:00", "fiscal"],
    ["quarter", "2026Q3", "2026-07-01T00:00:00+09:00", "quarter"],
    ["quarter", "2026年第3四半期", "2026-07-01T00:00:00+09:00", "quarter"],
    ["quarter", "2026年度第4四半期", "2027-01-01T00:00:00+09:00", "fquarter"],
    ["wareki", "令和8年11月", "2026-11-01T00:00:00+09:00", "month"],
    ["wareki", "令和8年11月1日", "2026-11-01T00:00:00+09:00", "day"],
    ["wareki", "令和８年１１月", "2026-11-01T00:00:00+09:00", "month"],
    ["wareki", "令和元年5月", "2019-05-01T00:00:00+09:00", "month"],
    ["wareki", "令和8年11月1日 9時30分", "2026-11-01T09:30:00+09:00", "minute"],
    ["wareki", "平成31年4月30日", "2019-04-30T00:00:00+09:00", "day"],
    ["wareki", "昭和64年1月7日", "1989-01-07T00:00:00+09:00", "day"],
    ["wareki", "平成元年1月8日", "1989-01-08T00:00:00+09:00", "day"],
    ["wareki", "令和8年", "2026-01-01T00:00:00+09:00", "year"],
    ["wareki", "R8年11月", "2026-11-01T00:00:00+09:00", "month"],
    ["wareki-short", "R8.11.1", "2026-11-01T00:00:00+09:00", "day"],
    ["wareki-short", "R8/11", "2026-11-01T00:00:00+09:00", "month"],
    ["wareki-short", "H31.4.30", "2019-04-30T00:00:00+09:00", "day"],
    ["wareki-short", "令8.11", "2026-11-01T00:00:00+09:00", "month"],
    ["wareki-short", "r1.5.1", "2019-05-01T00:00:00+09:00", "day"],
    ["wareki-fy", "令和8年度", "2026-04-01T00:00:00+09:00", "fiscal"],
    ["wareki-fy", "令和元年度", "2019-04-01T00:00:00+09:00", "fiscal"],
    ["wareki-fy", "令和8年度第1四半期", "2026-04-01T00:00:00+09:00", "fquarter"],
    ["unix-s", "1793000000", D.toISO(1793000000000, "JST"), "second"],
    ["unix-ms", "1793000000123", D.toISO(1793000000123, "JST"), "millisecond"],
    ["y", "2026", "2026-01-01T00:00:00+09:00", "year"],
  ];
  for (const [fmt, input, want, g] of cases) {
    const r = D.parseWith(fmt, input, JST);
    assert.ok(r, `${fmt} "${input}" が解析できない`);
    assert.equal(iso(r.t), want, `${fmt} "${input}"`);
    assert.equal(r.g, g, `${fmt} "${input}" 粒度`);
  }
});

test("元号の範囲外・不正値は失敗", () => {
  const bad = [
    ["wareki", "平成31年5月1日"], // 令和元年
    ["wareki", "平成31年5月"],
    ["wareki", "令和元年4月"],
    ["wareki", "平成40年1月"],
    ["wareki", "昭和64年1月8日"],
    ["wareki", "令和8年13月"],
    ["wareki", "令和8年2月30日"],
    ["wareki", "令和8年度"], // 年度は別書式
    ["wareki-short", "H31.5.1"],
    ["wareki-fy", "平成32年度"],
    ["ymd", "2026-02-30"],
    ["ymd", "2026-10-30 25:00"],
    ["ym", "2026-13"],
    ["mdy", "30/10/2026"],
    ["unix-s", "12345"],
    ["ymd", "abc"],
  ];
  for (const [fmt, input] of bad) {
    assert.equal(D.parseWith(fmt, input, JST), null, `${fmt} "${input}" は失敗すべき`);
  }
});

test("年度開始月の変更", () => {
  const r = D.parseWith("fy", "2026年度", { tz: "JST", fyStart: 10 });
  assert.equal(iso(r.t), "2026-10-01T00:00:00+09:00");
});

test("データ TZ が UTC の場合", () => {
  const r = D.parseWith("ymd", "2026-10-30 00:00", { tz: "UTC" });
  assert.equal(iso(r.t), "2026-10-30T09:00:00+09:00");
});

test("カスタム書式", () => {
  const p = "custom:yyyy年M月d日 H時";
  assert.equal(iso(D.parseWith(p, "2026年1月2日 3時", JST).t), "2026-01-02T03:00:00+09:00");
  assert.equal(D.parseWith(p, "2026年1月2日 3時", JST).g, "hour");
  const w = "custom:gge年M月";
  assert.equal(iso(D.parseWith(w, "令和8年11月", JST).t), "2026-11-01T00:00:00+09:00");
  assert.equal(iso(D.parseWith("custom:'FY'yyyy", "FY2026", JST).t), "2026-01-01T00:00:00+09:00");
});

test("列の自動判定", () => {
  const det = (vals, name) => D.detectColumn(vals, name, JST);
  assert.equal(det(["2026-10-30T16:42:16+09:00", "2026-10-30T16:52:16+09:00"], "time").format, "ymd");
  assert.equal(det(["2026-10-30T16:42:16+09:00"], "time").granularity, "second");
  assert.equal(det(["2026/10/30 16:42:00", "2026/10/30 16:52:00"], "x").granularity, "minute");
  assert.equal(det(["2026-10-30 00:00:00", "2026-10-31 00:00:00"], "x").granularity, "day");
  assert.equal(det(["令和8年4月", "令和8年5月", "令和8年6月"], "年月").format, "wareki");
  assert.equal(det(["令和8年4月", "令和8年5月"], "年月").granularity, "month");
  assert.equal(det(["令和7年度", "令和8年度"], "年度").granularity, "fiscal");
  // 曖昧な日付: 13 以上が先頭にあれば日/月/年
  assert.equal(det(["01/02/2026", "25/02/2026"], "date").format, "dmy");
  assert.equal(det(["01/02/2026", "03/04/2026"], "date").format, "mdy");
  // 90% 以上一致で採用、未満は日時扱いしない
  const mixed = Array.from({ length: 19 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`).concat(["不明"]);
  assert.equal(det(mixed, "d").format, "ymd");
  assert.equal(det(["2026-01-01", "x", "y"], "d"), null);
  // 数値列は列名ヒントがなければ日時扱いしない
  assert.equal(det([1793000000, 1793000600], "count"), null);
  assert.equal(det([1793000000, 1793000600], "timestamp").format, "unix-s");
  assert.equal(det([2024, 2025, 2026], "value"), null);
  assert.equal(det([2024, 2025, 2026], "year").format, "y");
  assert.equal(det(["1", "2", "3"], "id"), null);
});

test("表示整形(西暦・和暦)", () => {
  const t = D.parseWith("ymd", "2026-11-01 09:30", JST).t;
  assert.equal(D.format(t, "minute", { tz: "JST" }), "2026/11/01 09:30");
  assert.equal(D.format(t, "month", { tz: "JST", calendar: "japanese" }), "令和8年11月");
  assert.equal(D.format(t, "day", { tz: "JST", calendar: "japanese" }), "令和8年11月1日");
  assert.equal(D.format(t, "fiscal", { tz: "JST" }), "2026年度");
  assert.equal(D.format(t, "fiscal", { tz: "JST", calendar: "japanese" }), "令和8年度");
  assert.equal(D.format(t, "fquarter", { tz: "JST" }), "2026年度 第3四半期");
  const r1 = D.parseWith("wareki", "令和元年5月1日", JST).t;
  assert.equal(D.format(r1, "day", { tz: "JST", calendar: "japanese" }), "令和元年5月1日");
  const h31 = D.parseWith("wareki", "平成31年4月30日", JST).t;
  assert.equal(D.format(h31, "day", { tz: "JST", calendar: "japanese" }), "平成31年4月30日");
  assert.equal(D.format(t, "minute", { tz: "UTC" }), "2026/11/01 00:30");
});

test("バケット(JST 基準)", () => {
  const t = D.parseWith("ymd", "2027-02-15T23:30:00+09:00", JST).t;
  assert.equal(iso(D.startOf(t, "day", JST)), "2027-02-15T00:00:00+09:00");
  assert.equal(iso(D.startOf(t, "week", JST)), "2027-02-15T00:00:00+09:00"); // 月曜
  assert.equal(iso(D.startOf(t, "month", JST)), "2027-02-01T00:00:00+09:00");
  assert.equal(iso(D.startOf(t, "quarter", JST)), "2027-01-01T00:00:00+09:00");
  assert.equal(iso(D.startOf(t, "fiscal", JST)), "2026-04-01T00:00:00+09:00");
  assert.equal(iso(D.startOf(t, "fquarter", JST)), "2027-01-01T00:00:00+09:00");
  assert.equal(iso(D.add(D.startOf(t, "month", JST), 1, "month", JST)), "2027-03-01T00:00:00+09:00");
  const jan31 = D.parseWith("ymd", "2027-01-31", JST).t;
  assert.equal(iso(D.add(jan31, 1, "month", JST)), "2027-02-28T00:00:00+09:00");
  assert.equal(D.diff(D.add(jan31, 14, "month", JST), jan31, "month", JST), 14);
  assert.deepEqual(D.allowedBuckets("month"), ["month", "quarter", "fquarter", "fiscal", "year"]);
  assert.ok(!D.allowedBuckets("month").includes("day"));
});
