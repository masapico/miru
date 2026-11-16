/*
 * datetime.js — 日時・和暦・期間表記の解析と表示整形
 *
 * 内部表現は「エポックミリ秒 (t) + 粒度 (g)」。
 * タイムゾーンは 'JST' | 'UTC' | 'local'(閲覧端末)の 3 種。
 * Date.parse は書式・ブラウザ依存が大きく和暦も読めないため使わない。
 *
 * ブラウザでは window.VizDate、Node では module.exports として公開する。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VizDate = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 粒度 ---------- */

  var GRAN_ORDER = [
    "millisecond", "second", "minute", "hour", "day", "week",
    "month", "quarter", "fquarter", "fiscal", "year",
  ];
  var GRAN_LABEL = {
    millisecond: "ミリ秒", second: "秒", minute: "分", hour: "時", day: "日",
    week: "週", month: "月", quarter: "四半期", fquarter: "年度四半期",
    fiscal: "年度", year: "年",
  };
  var MS = { millisecond: 1, second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 };

  function granRank(g) {
    return GRAN_ORDER.indexOf(g);
  }

  /** データ粒度 g から集計可能なバケット粒度の一覧 */
  function allowedBuckets(g) {
    switch (g) {
      case "year": return ["year"];
      case "fiscal": return ["fiscal"];
      case "quarter": return ["quarter", "year"];
      case "fquarter": return ["fquarter", "fiscal"];
      case "month": return ["month", "quarter", "fquarter", "fiscal", "year"];
      default: {
        var r = granRank(g);
        return GRAN_ORDER.filter(function (x) {
          return granRank(x) >= r && x !== "millisecond";
        });
      }
    }
  }

  /** 時間軸ではなく、時刻順カテゴリ軸で描画すべき粗い粒度か */
  function isPeriodGran(g) {
    return g === "quarter" || g === "fquarter" || g === "fiscal" || g === "year";
  }

  /* ---------- タイムゾーン ---------- */

  var TZ_OFFSET = { JST: 540, UTC: 0 };
  var TZ_LABEL = { JST: "日本時間 (JST)", UTC: "協定世界時 (UTC)", local: "閲覧端末の設定" };

  function offsetFor(tz, utcMs) {
    if (tz === "local") return -new Date(utcMs).getTimezoneOffset();
    return tz in TZ_OFFSET ? TZ_OFFSET[tz] : 540;
  }

  /** 指定 TZ の壁時計時刻 → エポックミリ秒。月・日のオーバーフローは繰り上げる */
  function toUtcMs(tz, y, mo, d, h, mi, s, ms) {
    h = h || 0; mi = mi || 0; s = s || 0; ms = ms || 0;
    if (tz === "local") {
      var dt = new Date(2000, 0, 1, 0, 0, 0, 0);
      dt.setFullYear(y, mo - 1, d);
      dt.setHours(h, mi, s, ms);
      return dt.getTime();
    }
    var u = new Date(0);
    u.setUTCFullYear(y, mo - 1, d);
    u.setUTCHours(h, mi, s, ms);
    return u.getTime() - (tz in TZ_OFFSET ? TZ_OFFSET[tz] : 540) * 60000;
  }

  /** エポックミリ秒 → 指定 TZ の壁時計の各要素 */
  function wall(t, tz) {
    var d = new Date(t + offsetFor(tz, t) * 60000);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
      ms: d.getUTCMilliseconds(), dow: d.getUTCDay(),
    };
  }

  function daysInMonth(y, mo) {
    return new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }

  function validYmd(y, mo, d) {
    return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
  }

  /* ---------- 和暦 ---------- */

  // 新しい順。start は改元日(その日から当該元号)
  var ERAS = [
    { name: "令和", kanji: "令", abbr: "R", start: [2019, 5, 1] },
    { name: "平成", kanji: "平", abbr: "H", start: [1989, 1, 8] },
    { name: "昭和", kanji: "昭", abbr: "S", start: [1926, 12, 25] },
    { name: "大正", kanji: "大", abbr: "T", start: [1912, 7, 30] },
    { name: "明治", kanji: "明", abbr: "M", start: [1868, 1, 1] },
  ];
  ERAS.forEach(function (e, i) {
    e.offset = e.start[0] - 1;
    e.startKey = e.start[0] * 10000 + e.start[1] * 100 + e.start[2];
    e.endKey = i === 0 ? Infinity : ERAS[i - 1].startKey; // 排他的
  });

  function findEra(token) {
    var t = String(token).toUpperCase();
    for (var i = 0; i < ERAS.length; i++) {
      var e = ERAS[i];
      if (t === e.name || t === e.kanji || t === e.abbr) return e;
    }
    return null;
  }

  function eraYearNum(s) {
    return s === "元" ? 1 : parseInt(s, 10);
  }

  /** 和暦 → 西暦年。元号の範囲外なら null */
  function warekiYear(era, ey, mo, d) {
    if (!era || !(ey >= 1)) return null;
    var y = era.offset + ey;
    var lo, hi;
    if (d != null) {
      lo = hi = y * 10000 + mo * 100 + d;
    } else if (mo != null) {
      lo = y * 10000 + mo * 100 + 1;
      hi = y * 10000 + mo * 100 + daysInMonth(y, mo);
    } else {
      lo = y * 10000 + 101;
      hi = y * 10000 + 1231;
    }
    if (hi < era.startKey || lo >= era.endKey) return null;
    return y;
  }

  function eraOf(y, mo, d) {
    var key = y * 10000 + mo * 100 + d;
    for (var i = 0; i < ERAS.length; i++) {
      if (key >= ERAS[i].startKey) return ERAS[i];
    }
    return null;
  }

  function eraYearLabel(era, y) {
    var ey = y - era.offset;
    return era.name + (ey === 1 ? "元" : ey) + "年";
  }

  /* ---------- 文字列の前処理 ---------- */

  function normalize(v) {
    if (v == null) return "";
    var s = String(v);
    if (s.normalize) s = s.normalize("NFKC");
    return s.replace(/[‐-―−ー]/g, "-").trim();
  }

  /* ---------- 時刻部分 ---------- */

  var TIME_RE =
    /^(?:T|\s*)(?:(午前|午後|AM|PM)\s*)?(\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,9}))?)?|時(?:\s*(\d{1,2})\s*分(?:\s*(\d{1,2})\s*秒)?)?)\s*(午前|午後|AM|PM)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

  /** 日付の後ろに続く文字列を解析。空なら {none:true}、解析不能なら null */
  function parseTimeRest(rest) {
    rest = rest.replace(/^\s*\([^)]*\)/, ""); // (月) などの曜日
    if (rest.trim() === "") return { none: true };
    var m = TIME_RE.exec(rest);
    if (!m) return null;
    var h = parseInt(m[2], 10);
    var hasColon = m[3] != null;
    var mi = hasColon ? parseInt(m[3], 10) : m[6] != null ? parseInt(m[6], 10) : null;
    var s = hasColon ? (m[4] != null ? parseInt(m[4], 10) : null) : m[7] != null ? parseInt(m[7], 10) : null;
    var ms = m[5] != null ? parseInt((m[5] + "00").slice(0, 3), 10) : null;
    var ap = (m[1] || m[8] || "").toUpperCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "PM" || ap === "午後") h = h === 12 ? 12 : h + 12;
      else h = h === 12 ? 0 : h;
    }
    if (h > 24 || (mi != null && mi > 59) || (s != null && s > 60)) return null;
    var offset = null;
    if (m[9]) {
      if (m[9].toUpperCase() === "Z") offset = 0;
      else {
        var sign = m[9][0] === "-" ? -1 : 1;
        var digits = m[9].slice(1).replace(":", "");
        offset = sign * (parseInt(digits.slice(0, 2), 10) * 60 + (digits.length > 2 ? parseInt(digits.slice(2, 4), 10) : 0));
      }
    }
    var g = ms != null ? "millisecond" : s != null ? "second" : mi != null ? "minute" : "hour";
    return { h: h, mi: mi || 0, s: s || 0, ms: ms || 0, offset: offset, g: g };
  }

  function build(y, mo, d, time, g, opt) {
    if (!validYmd(y, mo, d)) return null;
    if (time && !time.none) {
      var t;
      if (time.offset != null) {
        var u = new Date(0);
        u.setUTCFullYear(y, mo - 1, d);
        u.setUTCHours(time.h, time.mi, time.s, time.ms);
        t = u.getTime() - time.offset * 60000;
      } else {
        t = toUtcMs(opt.tz, y, mo, d, time.h, time.mi, time.s, time.ms);
      }
      return { t: t, g: time.g };
    }
    return { t: toUtcMs(opt.tz, y, mo, d), g: g };
  }

  function fyStartOf(opt) {
    var m = opt && opt.fyStart ? parseInt(opt.fyStart, 10) : 4;
    return m >= 1 && m <= 12 ? m : 4;
  }

  /** 年度 fy の第 q 四半期の開始年月 */
  function fiscalQuarterStart(fy, q, fyStart) {
    var mo = fyStart + (q - 1) * 3;
    var y = fy;
    if (mo > 12) { mo -= 12; y += 1; }
    return { y: y, mo: mo };
  }

  /* ---------- 書式パターン ---------- */

  var ERA_TOKEN = "(明治|大正|昭和|平成|令和|明|大|昭|平|令|[MTSHR])";

  function ymdPattern(id, label, example, re, pick) {
    return {
      id: id, label: label, example: example,
      parse: function (s, opt) {
        var m = re.exec(s);
        if (!m) return null;
        var time = parseTimeRest(s.slice(m[0].length));
        if (!time) return null;
        var p = pick(m);
        return build(+p[0], +p[1], +p[2], time, "day", opt);
      },
    };
  }

  function exactPattern(id, label, example, re, fn) {
    return {
      id: id, label: label, example: example,
      parse: function (s, opt) {
        var m = re.exec(s);
        return m ? fn(m, opt) : null;
      },
    };
  }

  function inYearRange(y) {
    return y >= 1800 && y <= 2200;
  }

  var PATTERNS = [
    ymdPattern("ymd", "年-月-日 [時:分:秒]", "2026-10-30T16:42:16+09:00",
      /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})/, function (m) { return [m[1], m[3], m[4]]; }),
    ymdPattern("ymd-ja", "yyyy年M月d日 [H時m分]", "2026年10月30日 9時30分",
      /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/, function (m) { return [m[1], m[2], m[3]]; }),
    ymdPattern("ymd-compact", "yyyyMMdd", "20261030",
      /^(\d{4})(\d{2})(\d{2})(?!\d)/, function (m) { return [m[1], m[2], m[3]]; }),
    ymdPattern("mdy", "月/日/年", "10/30/2026",
      /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})/, function (m) { return [m[4], m[1], m[3]]; }),
    ymdPattern("dmy", "日/月/年", "30/10/2026",
      /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})/, function (m) { return [m[4], m[3], m[1]]; }),
    exactPattern("ym", "年-月", "2026-11", /^(\d{4})([-/.])(\d{1,2})$/, function (m, opt) {
      return build(+m[1], +m[3], 1, null, "month", opt);
    }),
    exactPattern("ym-ja", "yyyy年M月", "2026年11月", /^(\d{4})\s*年\s*(\d{1,2})\s*月$/, function (m, opt) {
      return build(+m[1], +m[2], 1, null, "month", opt);
    }),
    exactPattern("ym-compact", "yyyyMM", "202611", /^(\d{4})(\d{2})$/, function (m, opt) {
      return inYearRange(+m[1]) ? build(+m[1], +m[2], 1, null, "month", opt) : null;
    }),
    exactPattern("y-ja", "yyyy年", "2026年", /^(\d{4})\s*年$/, function (m, opt) {
      return build(+m[1], 1, 1, null, "year", opt);
    }),
    exactPattern("fy", "yyyy年度", "2026年度", /^(\d{4})\s*年度$/, function (m, opt) {
      return build(+m[1], fyStartOf(opt), 1, null, "fiscal", opt);
    }),
    exactPattern("quarter", "yyyy年第N四半期 / yyyyQN", "2026年第3四半期",
      /^(\d{4})\s*(?:(年度|年|FY)?\s*第?\s*([1-4])\s*(?:四半期|Q)|[-\s]?Q([1-4]))$/i, function (m, opt) {
        var y = +m[1];
        var q = +(m[3] || m[4]);
        if (m[2] === "年度" || (m[2] || "").toUpperCase() === "FY") {
          var p = fiscalQuarterStart(y, q, fyStartOf(opt));
          return build(p.y, p.mo, 1, null, "fquarter", opt);
        }
        return build(y, (q - 1) * 3 + 1, 1, null, "quarter", opt);
      }),
    {
      id: "wareki", label: "和暦(令和8年11月1日 など)", example: "令和8年11月1日",
      parse: (function () {
        var re = new RegExp("^" + ERA_TOKEN + "\\s*(\\d{1,2}|元)\\s*年(?:\\s*(\\d{1,2})\\s*月(?:\\s*(\\d{1,2})\\s*日)?)?", "i");
        return function (s, opt) {
          var m = re.exec(s);
          if (!m) return null;
          var era = findEra(m[1]);
          var mo = m[3] != null ? +m[3] : null;
          var d = m[4] != null ? +m[4] : null;
          var rest = s.slice(m[0].length);
          var time = d != null ? parseTimeRest(rest) : rest.trim() === "" ? { none: true } : null;
          if (!time) return null;
          if (mo != null && (mo < 1 || mo > 12)) return null;
          if (d != null && !validYmd(era ? era.offset + eraYearNum(m[2]) : 2000, mo, d)) return null;
          var y = warekiYear(era, eraYearNum(m[2]), mo, d);
          if (y == null) return null;
          return build(y, mo || 1, d || 1, time, d != null ? "day" : mo != null ? "month" : "year", opt);
        };
      })(),
    },
    {
      id: "wareki-short", label: "和暦略記(R8.11.1 / 令8.11 など)", example: "R8.11.1",
      parse: (function () {
        var re = /^([明大昭平令MTSHR])\s*(\d{1,2}|元)([./-])(\d{1,2})(?:\3(\d{1,2}))?/i;
        return function (s, opt) {
          var m = re.exec(s);
          if (!m) return null;
          var era = findEra(m[1]);
          var mo = +m[4];
          var d = m[5] != null ? +m[5] : null;
          var rest = s.slice(m[0].length);
          var time = d != null ? parseTimeRest(rest) : rest.trim() === "" ? { none: true } : null;
          if (!time || mo < 1 || mo > 12) return null;
          if (d != null && !validYmd(era ? era.offset + eraYearNum(m[2]) : 2000, mo, d)) return null;
          var y = warekiYear(era, eraYearNum(m[2]), mo, d);
          if (y == null) return null;
          return build(y, mo, d || 1, time, d != null ? "day" : "month", opt);
        };
      })(),
    },
    {
      id: "wareki-fy", label: "和暦年度(令和8年度 / 令和8年度第1四半期)", example: "令和8年度",
      parse: (function () {
        var re = new RegExp("^" + ERA_TOKEN + "\\s*(\\d{1,2}|元)\\s*年度(?:\\s*第?\\s*([1-4])\\s*(?:四半期|Q))?$", "i");
        return function (s, opt) {
          var m = re.exec(s);
          if (!m) return null;
          var era = findEra(m[1]);
          var fy = warekiYear(era, eraYearNum(m[2]), null, null);
          if (fy == null) return null;
          var fs = fyStartOf(opt);
          if (m[3]) {
            var p = fiscalQuarterStart(fy, +m[3], fs);
            return build(p.y, p.mo, 1, null, "fquarter", opt);
          }
          return build(fy, fs, 1, null, "fiscal", opt);
        };
      })(),
    },
    // 数値として与えられることが多い書式(自動判定は列名ヒント必須)
    exactPattern("unix-s", "UNIX 時刻(秒)", "1793000000", /^(\d{9,10})(?:\.\d+)?$/, function (m) {
      var v = +m[1];
      return v >= 1e9 && v < 4.2e9 ? { t: v * 1000, g: "second" } : null;
    }),
    exactPattern("unix-ms", "UNIX 時刻(ミリ秒)", "1793000000000", /^(\d{12,13})$/, function (m) {
      var v = +m[1];
      return v >= 1e12 && v < 4.2e12 ? { t: v, g: "millisecond" } : null;
    }),
    exactPattern("y", "yyyy(西暦年の数値)", "2026", /^(\d{4})$/, function (m, opt) {
      var y = +m[1];
      return inYearRange(y) ? build(y, 1, 1, null, "year", opt) : null;
    }),
  ];

  var PATTERN_BY_ID = {};
  PATTERNS.forEach(function (p) { PATTERN_BY_ID[p.id] = p; });

  // 自動判定で列名ヒントが必要な(数値と紛らわしい)書式
  var NEEDS_HINT = { "unix-s": 1, "unix-ms": 1, y: 1, "ym-compact": 1 };
  var NAME_HINT = /(date|time|日付|日時|時刻|時間|年月|年度|timestamp|^ts$|_at$|_on$|datetime|period|year|month|期間|年$|月$|^年|^月)/i;

  /* ---------- カスタム書式 ---------- */

  var CUSTOM_TOKEN = /'[^']*'|yyyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s|SSS|ggg|gg|g|ee|e|Q|\s+|./g;

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 書式文字列からパターンを生成する。
   * 使用可能: yyyy yy MM M dd d HH H mm m ss s SSS g(元号) e(和暦年/元) Q(四半期) '文字列'
   */
  function compileCustom(fmt) {
    var src = "^";
    var fields = [];
    var tokens = String(fmt).match(CUSTOM_TOKEN) || [];
    tokens.forEach(function (tk) {
      var grp = null;
      if (/^yyyy$/.test(tk)) grp = ["y", "(\\d{4})"];
      else if (tk === "yy") grp = ["yy", "(\\d{2})"];
      else if (tk === "MM" || tk === "M") grp = ["mo", "(\\d{1,2})"];
      else if (tk === "dd" || tk === "d") grp = ["d", "(\\d{1,2})"];
      else if (tk === "HH" || tk === "H") grp = ["h", "(\\d{1,2})"];
      else if (tk === "mm" || tk === "m") grp = ["mi", "(\\d{1,2})"];
      else if (tk === "ss" || tk === "s") grp = ["s", "(\\d{1,2})"];
      else if (tk === "SSS") grp = ["ms", "(\\d{1,3})"];
      else if (/^g+$/.test(tk)) grp = ["era", ERA_TOKEN];
      else if (/^e+$/.test(tk)) grp = ["ey", "(\\d{1,2}|元)"];
      else if (tk === "Q") grp = ["q", "([1-4])"];
      if (grp) {
        fields.push(grp[0]);
        src += grp[1];
      } else if (/^\s+$/.test(tk)) {
        src += "\\s*";
      } else if (tk[0] === "'" && tk.length > 1) {
        src += escapeRe(tk.slice(1, -1));
      } else {
        src += escapeRe(normalize(tk) || tk);
      }
    });
    src += "$";
    var re;
    try { re = new RegExp(src, "i"); } catch (e) { return null; }
    if (!fields.length) return null;
    return {
      id: "custom:" + fmt, label: "カスタム: " + fmt, example: fmt, custom: true,
      parse: function (s, opt) {
        var m = re.exec(s);
        if (!m) return null;
        var v = {};
        fields.forEach(function (f, i) { v[f] = m[i + 1]; });
        var y;
        if (v.y != null) y = +v.y;
        else if (v.yy != null) y = 2000 + +v.yy;
        var mo = v.mo != null ? +v.mo : v.q != null ? (+v.q - 1) * 3 + 1 : null;
        var d = v.d != null ? +v.d : null;
        if (v.era != null || v.ey != null) {
          y = warekiYear(findEra(v.era || "令和"), eraYearNum(v.ey || "1"), mo, d);
        }
        if (y == null || !isFinite(y)) return null;
        var g = v.ms != null ? "millisecond" : v.s != null ? "second" : v.mi != null ? "minute"
          : v.h != null ? "hour" : d != null ? "day" : v.mo != null ? "month" : v.q != null ? "quarter" : "year";
        var time = v.h != null ? { h: +v.h, mi: +(v.mi || 0), s: +(v.s || 0), ms: +(v.ms || 0), offset: null, g: g } : null;
        if (time && (time.h > 24 || time.mi > 59 || time.s > 60)) return null;
        return build(y, mo || 1, d || 1, time, g, opt);
      },
    };
  }

  function getPattern(id) {
    if (!id) return null;
    if (PATTERN_BY_ID[id]) return PATTERN_BY_ID[id];
    if (String(id).indexOf("custom:") === 0) return compileCustom(String(id).slice(7));
    return null;
  }

  /* ---------- 解析 API ---------- */

  function defaults(opt) {
    opt = opt || {};
    return { tz: opt.tz || "JST", fyStart: fyStartOf(opt) };
  }

  /** 書式 id を指定して 1 値を解析 → {t, g} | null */
  function parseWith(id, value, opt) {
    var p = typeof id === "object" ? id : getPattern(id);
    if (!p) return null;
    if (typeof value === "number") value = String(value);
    var s = normalize(value);
    if (!s) return null;
    var r = p.parse(s, defaults(opt));
    return r && isFinite(r.t) ? r : null;
  }

  /** 書式を問わず 1 値を解析(入力欄・フィルタ用) */
  function parseAny(value, opt) {
    for (var i = 0; i < PATTERNS.length; i++) {
      if (NEEDS_HINT[PATTERNS[i].id]) continue;
      var r = parseWith(PATTERNS[i], value, opt);
      if (r) return r;
    }
    return null;
  }

  /** 粒度を実データで細かすぎないよう補正(秒が全部 0 なら分、など) */
  function refineGran(g, ts, tz) {
    var order = ["millisecond", "second", "minute", "hour", "day"];
    var idx = order.indexOf(g);
    if (idx < 0 || !ts.length) return g;
    var parts = ts.map(function (t) { return wall(t, tz); });
    var keys = ["ms", "s", "mi", "h"];
    while (idx < 4) {
      var k = keys[idx];
      var allZero = parts.every(function (p) { return p[k] === 0; });
      if (!allZero) break;
      idx++;
    }
    return order[idx];
  }

  /**
   * 列の値から日時書式を判定する。
   * @returns {{format, label, granularity, rate}|null}
   */
  function detectColumn(values, colName, opt) {
    opt = defaults(opt);
    var sample = [];
    var nonEmpty = values.filter(function (v) { return v != null && String(v).trim() !== ""; });
    if (!nonEmpty.length) return null;
    var step = Math.max(1, Math.floor(nonEmpty.length / 1000));
    for (var i = 0; i < nonEmpty.length && sample.length < 1000; i += step) sample.push(nonEmpty[i]);
    var hint = NAME_HINT.test(String(colName || ""));
    var allNumbersTyped = sample.every(function (v) { return typeof v === "number"; });

    var best = null;
    PATTERNS.forEach(function (p) {
      if (NEEDS_HINT[p.id] && !hint) return;
      if (p.id === "ymd-compact" && allNumbersTyped && !hint) return;
      var ok = 0;
      var grans = {};
      var ts = [];
      for (var j = 0; j < sample.length; j++) {
        var r = parseWith(p, sample[j], opt);
        if (r) { ok++; grans[r.g] = (grans[r.g] || 0) + 1; ts.push(r.t); }
      }
      var rate = ok / sample.length;
      // 桁が固定の紛らわしい書式は全件一致を要求
      if ((p.id === "ymd-compact" || NEEDS_HINT[p.id]) && rate < 1) return;
      if (rate >= 0.9 && (!best || rate > best.rate)) {
        best = { pattern: p, rate: rate, grans: grans, ts: ts };
      }
    });
    if (!best) return null;
    // 最も細かい粒度を列の粒度とする
    var g = Object.keys(best.grans).sort(function (a, b) { return granRank(a) - granRank(b); })[0];
    g = refineGran(g, best.ts, opt.tz);
    return { format: best.pattern.id, label: best.pattern.label, granularity: g, rate: best.rate };
  }

  /* ---------- 期間の切り捨て・加算(バケット & チャート用) ---------- */

  function startOf(t, unit, opt) {
    opt = defaults(opt);
    var tz = opt.tz;
    if (unit === "millisecond") return t;
    if (unit === "second" || unit === "minute" || unit === "hour") {
      var p0 = wall(t, tz);
      if (unit === "second") return toUtcMs(tz, p0.y, p0.mo, p0.d, p0.h, p0.mi, p0.s);
      if (unit === "minute") return toUtcMs(tz, p0.y, p0.mo, p0.d, p0.h, p0.mi);
      return toUtcMs(tz, p0.y, p0.mo, p0.d, p0.h);
    }
    var p = wall(t, tz);
    switch (unit) {
      case "day": return toUtcMs(tz, p.y, p.mo, p.d);
      case "week":
      case "isoWeek": {
        var back = (p.dow + 6) % 7; // 月曜始まり
        return toUtcMs(tz, p.y, p.mo, p.d - back);
      }
      case "month": return toUtcMs(tz, p.y, p.mo, 1);
      case "quarter": return toUtcMs(tz, p.y, Math.floor((p.mo - 1) / 3) * 3 + 1, 1);
      case "year": return toUtcMs(tz, p.y, 1, 1);
      case "fiscal": {
        var fs = opt.fyStart;
        return toUtcMs(tz, p.mo >= fs ? p.y : p.y - 1, fs, 1);
      }
      case "fquarter": {
        var fs2 = opt.fyStart;
        var since = (p.mo - fs2 + 12) % 12;
        return toUtcMs(tz, p.y, p.mo - (since % 3), 1);
      }
      default: return t;
    }
  }

  function add(t, amount, unit, opt) {
    opt = defaults(opt);
    if (MS[unit] && unit !== "day" && unit !== "week") return t + amount * MS[unit];
    var p = wall(t, opt.tz);
    var y = p.y, mo = p.mo, d = p.d;
    switch (unit) {
      case "day": d += amount; break;
      case "week": d += amount * 7; break;
      case "month": mo += amount; break;
      case "quarter": case "fquarter": mo += amount * 3; break;
      case "year": case "fiscal": y += amount; break;
      default: return t + amount;
    }
    if (unit !== "day" && unit !== "week") {
      y += Math.floor((mo - 1) / 12);
      mo = ((mo - 1) % 12 + 12) % 12 + 1;
      d = Math.min(d, daysInMonth(y, mo));
    }
    return toUtcMs(opt.tz, y, mo, d, p.h, p.mi, p.s, p.ms);
  }

  function diff(a, b, unit, opt) {
    if (MS[unit]) return (a - b) / MS[unit];
    var pa = wall(a, defaults(opt).tz);
    var pb = wall(b, defaults(opt).tz);
    var months = (pa.y - pb.y) * 12 + (pa.mo - pb.mo);
    if (months > 0 && add(b, months, "month", opt) > a) months--;
    else if (months < 0 && add(b, months, "month", opt) < a) months++;
    if (unit === "month") return months;
    if (unit === "quarter" || unit === "fquarter") return Math.trunc(months / 3);
    return Math.trunc(months / 12);
  }

  /* ---------- 表示整形 ---------- */

  function pad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = "0" + s;
    return s;
  }

  function fiscalYearOf(p, fyStart) {
    return p.mo >= fyStart ? p.y : p.y - 1;
  }

  function fiscalLabel(fy, calendar) {
    if (calendar === "japanese") {
      // 年度の和暦表記は、年度開始時点ではなく当該西暦年の元号で表すのが慣例(令和元年度 = 2019年度)
      var era = eraOf(fy, 12, 31);
      if (era) return eraYearLabel(era, fy) + "度";
    }
    return fy + "年度";
  }

  function hms(p, g) {
    if (g === "hour") return p.h + "時";
    var s = pad(p.h) + ":" + pad(p.mi);
    if (g === "second" || g === "millisecond") s += ":" + pad(p.s);
    if (g === "millisecond") s += "." + pad(p.ms, 3);
    return s;
  }

  /**
   * 粒度に応じた完全表記
   * @param opt {tz, calendar:'gregorian'|'japanese', fyStart}
   */
  function format(t, g, opt) {
    opt = opt || {};
    var o = defaults(opt);
    var cal = opt.calendar === "japanese" ? "japanese" : "gregorian";
    var p = wall(t, o.tz);
    var era = cal === "japanese" ? eraOf(p.y, p.mo, p.d) : null;
    var yLabel = era ? eraYearLabel(era, p.y) : p.y + "年";
    switch (g) {
      case "year": return yLabel;
      case "fiscal": return fiscalLabel(fiscalYearOf(p, o.fyStart), cal);
      case "quarter": return yLabel + " 第" + (Math.floor((p.mo - 1) / 3) + 1) + "四半期";
      case "fquarter": {
        var since = (p.mo - o.fyStart + 12) % 12;
        return fiscalLabel(fiscalYearOf(p, o.fyStart), cal) + " 第" + (Math.floor(since / 3) + 1) + "四半期";
      }
      case "month": return yLabel + p.mo + "月";
    }
    var date = era
      ? yLabel + p.mo + "月" + p.d + "日"
      : p.y + "/" + pad(p.mo) + "/" + pad(p.d);
    if (g === "week") return date + " の週";
    if (g === "day") return date;
    return date + " " + hms(p, g);
  }

  /** 軸目盛用の短い表記 */
  function formatTick(t, unit, opt) {
    opt = opt || {};
    var o = defaults(opt);
    var cal = opt.calendar === "japanese" ? "japanese" : "gregorian";
    var p = wall(t, o.tz);
    switch (unit) {
      case "millisecond": return pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s) + "." + pad(p.ms, 3);
      case "second": return pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s);
      case "minute": case "hour": return pad(p.h) + ":" + pad(p.mi);
      case "day": case "week": return p.mo + "/" + p.d;
      default: return format(t, unit, opt);
    }
  }

  /** ISO 8601(表示 TZ のオフセット付き)— CSV 出力用 */
  function toISO(t, tz) {
    var off = offsetFor(tz || "JST", t);
    var p = wall(t, tz || "JST");
    var sign = off >= 0 ? "+" : "-";
    var a = Math.abs(off);
    return p.y + "-" + pad(p.mo) + "-" + pad(p.d) + "T" + pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s) +
      (p.ms ? "." + pad(p.ms, 3) : "") + sign + pad(Math.floor(a / 60)) + ":" + pad(a % 60);
  }

  /** <input type="datetime-local"> の値 ⇔ エポックミリ秒 */
  function toInputValue(t, tz) {
    var p = wall(t, tz);
    return p.y + "-" + pad(p.mo) + "-" + pad(p.d) + "T" + pad(p.h) + ":" + pad(p.mi);
  }
  function fromInputValue(s, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || "");
    if (!m) return null;
    return toUtcMs(tz, +m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
  }

  return {
    GRAN_ORDER: GRAN_ORDER,
    GRAN_LABEL: GRAN_LABEL,
    TZ_LABEL: TZ_LABEL,
    PATTERNS: PATTERNS,
    ERAS: ERAS,
    granRank: granRank,
    allowedBuckets: allowedBuckets,
    isPeriodGran: isPeriodGran,
    normalize: normalize,
    getPattern: getPattern,
    compileCustom: compileCustom,
    parseWith: parseWith,
    parseAny: parseAny,
    detectColumn: detectColumn,
    startOf: startOf,
    add: add,
    diff: diff,
    wall: wall,
    toUtcMs: toUtcMs,
    format: format,
    formatTick: formatTick,
    toISO: toISO,
    toInputValue: toInputValue,
    fromInputValue: fromInputValue,
  };
});
