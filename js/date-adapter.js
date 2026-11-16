/*
 * date-adapter.js — Chart.js 時間軸用の日付アダプタ
 *
 * 公式の date-fns アダプタは閲覧端末のタイムゾーンで目盛を切るため、
 * 表示タイムゾーン(既定 JST)を固定できるよう VizDate で実装している。
 * スケール設定の adapters.date に {tz, calendar, fyStart, gran} を渡す。
 */
(function () {
  "use strict";
  if (!window.Chart || !window.VizDate) return;
  var D = window.VizDate;

  window.Chart._adapters._date.override({
    _id: "viz-date",

    formats: function () {
      return {
        datetime: "tooltip",
        millisecond: "tick:millisecond",
        second: "tick:second",
        minute: "tick:minute",
        hour: "tick:hour",
        day: "tick:day",
        week: "tick:week",
        month: "tick:month",
        quarter: "tick:quarter",
        year: "tick:year",
      };
    },

    parse: function (value) {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return isFinite(value) ? value : null;
      if (value instanceof Date) return value.getTime();
      var r = D.parseAny(value, this.options);
      return r ? r.t : null;
    },

    format: function (time, fmt) {
      var o = this.options || {};
      if (fmt === "tooltip") return D.format(time, o.gran || "second", o);
      if (typeof fmt === "string" && fmt.indexOf("tick:") === 0) return D.formatTick(time, fmt.slice(5), o);
      return D.format(time, "second", o);
    },

    add: function (time, amount, unit) {
      return D.add(time, amount, unit, this.options);
    },

    diff: function (max, min, unit) {
      return D.diff(max, min, unit, this.options);
    },

    startOf: function (time, unit) {
      return D.startOf(time, unit, this.options);
    },

    endOf: function (time, unit) {
      return D.add(D.startOf(time, unit, this.options), 1, unit, this.options) - 1;
    },
  });
})();
