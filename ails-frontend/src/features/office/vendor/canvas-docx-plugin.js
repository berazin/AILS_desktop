/* Adapted from @hufe921/canvas-editor-plugin-docx 0.0.6, MIT. Export returns Blob for atomic AILS saving. See LICENSE.canvas-docx. */
import { TitleLevel as qn, ElementType as vt, ListStyle as uy, RowFlex as yi, VerticalAlign as so, TableBorder as co } from "@hufe921/canvas-editor";
var Ee = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function ly(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
function dy(e) {
  if (e.__esModule)
    return e;
  var t = e.default;
  if (typeof t == "function") {
    var n = function r() {
      return this instanceof r ? Reflect.construct(t, arguments, this.constructor) : t.apply(this, arguments);
    };
    n.prototype = t.prototype;
  } else
    n = {};
  return Object.defineProperty(n, "__esModule", { value: !0 }), Object.keys(e).forEach(function(r) {
    var i = Object.getOwnPropertyDescriptor(e, r);
    Object.defineProperty(n, r, i.get ? i : {
      enumerable: !0,
      get: function() {
        return e[r];
      }
    });
  }), n;
}
var Rf = { exports: {} }, If = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkgrey: [169, 169, 169],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  grey: [128, 128, 128],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightgrey: [211, 211, 211],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50]
}, Nf = { exports: {} }, hy = function(t) {
  return !t || typeof t == "string" ? !1 : t instanceof Array || Array.isArray(t) || t.length >= 0 && (t.splice instanceof Function || Object.getOwnPropertyDescriptor(t, t.length - 1) && t.constructor.name !== "String");
}, fy = hy, py = Array.prototype.concat, gy = Array.prototype.slice, Dl = Nf.exports = function(t) {
  for (var n = [], r = 0, i = t.length; r < i; r++) {
    var a = t[r];
    fy(a) ? n = py.call(n, gy.call(a)) : n.push(a);
  }
  return n;
};
Dl.wrap = function(e) {
  return function() {
    return e(Dl(arguments));
  };
};
var my = Nf.exports, Hr = If, oi = my, Of = Object.hasOwnProperty, Wf = /* @__PURE__ */ Object.create(null);
for (var uo in Hr)
  Of.call(Hr, uo) && (Wf[Hr[uo]] = uo);
var xt = Rf.exports = {
  to: {},
  get: {}
};
xt.get = function(e) {
  var t = e.substring(0, 3).toLowerCase(), n, r;
  switch (t) {
    case "hsl":
      n = xt.get.hsl(e), r = "hsl";
      break;
    case "hwb":
      n = xt.get.hwb(e), r = "hwb";
      break;
    default:
      n = xt.get.rgb(e), r = "rgb";
      break;
  }
  return n ? { model: r, value: n } : null;
};
xt.get.rgb = function(e) {
  if (!e)
    return null;
  var t = /^#([a-f0-9]{3,4})$/i, n = /^#([a-f0-9]{6})([a-f0-9]{2})?$/i, r = /^rgba?\(\s*([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)\s*(?:[,|\/]\s*([+-]?[\d\.]+)(%?)\s*)?\)$/, i = /^rgba?\(\s*([+-]?[\d\.]+)\%\s*,?\s*([+-]?[\d\.]+)\%\s*,?\s*([+-]?[\d\.]+)\%\s*(?:[,|\/]\s*([+-]?[\d\.]+)(%?)\s*)?\)$/, a = /^(\w+)$/, s = [0, 0, 0, 1], o, c, u;
  if (o = e.match(n)) {
    for (u = o[2], o = o[1], c = 0; c < 3; c++) {
      var h = c * 2;
      s[c] = parseInt(o.slice(h, h + 2), 16);
    }
    u && (s[3] = parseInt(u, 16) / 255);
  } else if (o = e.match(t)) {
    for (o = o[1], u = o[3], c = 0; c < 3; c++)
      s[c] = parseInt(o[c] + o[c], 16);
    u && (s[3] = parseInt(u + u, 16) / 255);
  } else if (o = e.match(r)) {
    for (c = 0; c < 3; c++)
      s[c] = parseInt(o[c + 1], 0);
    o[4] && (o[5] ? s[3] = parseFloat(o[4]) * 0.01 : s[3] = parseFloat(o[4]));
  } else if (o = e.match(i)) {
    for (c = 0; c < 3; c++)
      s[c] = Math.round(parseFloat(o[c + 1]) * 2.55);
    o[4] && (o[5] ? s[3] = parseFloat(o[4]) * 0.01 : s[3] = parseFloat(o[4]));
  } else
    return (o = e.match(a)) ? o[1] === "transparent" ? [0, 0, 0, 0] : Of.call(Hr, o[1]) ? (s = Hr[o[1]], s[3] = 1, s) : null : null;
  for (c = 0; c < 3; c++)
    s[c] = gn(s[c], 0, 255);
  return s[3] = gn(s[3], 0, 1), s;
};
xt.get.hsl = function(e) {
  if (!e)
    return null;
  var t = /^hsla?\(\s*([+-]?(?:\d{0,3}\.)?\d+)(?:deg)?\s*,?\s*([+-]?[\d\.]+)%\s*,?\s*([+-]?[\d\.]+)%\s*(?:[,|\/]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*)?\)$/, n = e.match(t);
  if (n) {
    var r = parseFloat(n[4]), i = (parseFloat(n[1]) % 360 + 360) % 360, a = gn(parseFloat(n[2]), 0, 100), s = gn(parseFloat(n[3]), 0, 100), o = gn(isNaN(r) ? 1 : r, 0, 1);
    return [i, a, s, o];
  }
  return null;
};
xt.get.hwb = function(e) {
  if (!e)
    return null;
  var t = /^hwb\(\s*([+-]?\d{0,3}(?:\.\d+)?)(?:deg)?\s*,\s*([+-]?[\d\.]+)%\s*,\s*([+-]?[\d\.]+)%\s*(?:,\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*)?\)$/, n = e.match(t);
  if (n) {
    var r = parseFloat(n[4]), i = (parseFloat(n[1]) % 360 + 360) % 360, a = gn(parseFloat(n[2]), 0, 100), s = gn(parseFloat(n[3]), 0, 100), o = gn(isNaN(r) ? 1 : r, 0, 1);
    return [i, a, s, o];
  }
  return null;
};
xt.to.hex = function() {
  var e = oi(arguments);
  return "#" + bi(e[0]) + bi(e[1]) + bi(e[2]) + (e[3] < 1 ? bi(Math.round(e[3] * 255)) : "");
};
xt.to.rgb = function() {
  var e = oi(arguments);
  return e.length < 4 || e[3] === 1 ? "rgb(" + Math.round(e[0]) + ", " + Math.round(e[1]) + ", " + Math.round(e[2]) + ")" : "rgba(" + Math.round(e[0]) + ", " + Math.round(e[1]) + ", " + Math.round(e[2]) + ", " + e[3] + ")";
};
xt.to.rgb.percent = function() {
  var e = oi(arguments), t = Math.round(e[0] / 255 * 100), n = Math.round(e[1] / 255 * 100), r = Math.round(e[2] / 255 * 100);
  return e.length < 4 || e[3] === 1 ? "rgb(" + t + "%, " + n + "%, " + r + "%)" : "rgba(" + t + "%, " + n + "%, " + r + "%, " + e[3] + ")";
};
xt.to.hsl = function() {
  var e = oi(arguments);
  return e.length < 4 || e[3] === 1 ? "hsl(" + e[0] + ", " + e[1] + "%, " + e[2] + "%)" : "hsla(" + e[0] + ", " + e[1] + "%, " + e[2] + "%, " + e[3] + ")";
};
xt.to.hwb = function() {
  var e = oi(arguments), t = "";
  return e.length >= 4 && e[3] !== 1 && (t = ", " + e[3]), "hwb(" + e[0] + ", " + e[1] + "%, " + e[2] + "%" + t + ")";
};
xt.to.keyword = function(e) {
  return Wf[e.slice(0, 3)];
};
function gn(e, t, n) {
  return Math.min(Math.max(t, e), n);
}
function bi(e) {
  var t = Math.round(e).toString(16).toUpperCase();
  return t.length < 2 ? "0" + t : t;
}
var yy = Rf.exports;
const Vr = If, Lf = {};
for (const e of Object.keys(Vr))
  Lf[Vr[e]] = e;
const ye = {
  rgb: { channels: 3, labels: "rgb" },
  hsl: { channels: 3, labels: "hsl" },
  hsv: { channels: 3, labels: "hsv" },
  hwb: { channels: 3, labels: "hwb" },
  cmyk: { channels: 4, labels: "cmyk" },
  xyz: { channels: 3, labels: "xyz" },
  lab: { channels: 3, labels: "lab" },
  lch: { channels: 3, labels: "lch" },
  hex: { channels: 1, labels: ["hex"] },
  keyword: { channels: 1, labels: ["keyword"] },
  ansi16: { channels: 1, labels: ["ansi16"] },
  ansi256: { channels: 1, labels: ["ansi256"] },
  hcg: { channels: 3, labels: ["h", "c", "g"] },
  apple: { channels: 3, labels: ["r16", "g16", "b16"] },
  gray: { channels: 1, labels: ["gray"] }
};
var Pf = ye;
for (const e of Object.keys(ye)) {
  if (!("channels" in ye[e]))
    throw new Error("missing channels property: " + e);
  if (!("labels" in ye[e]))
    throw new Error("missing channel labels property: " + e);
  if (ye[e].labels.length !== ye[e].channels)
    throw new Error("channel and label counts mismatch: " + e);
  const { channels: t, labels: n } = ye[e];
  delete ye[e].channels, delete ye[e].labels, Object.defineProperty(ye[e], "channels", { value: t }), Object.defineProperty(ye[e], "labels", { value: n });
}
ye.rgb.hsl = function(e) {
  const t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.min(t, n, r), a = Math.max(t, n, r), s = a - i;
  let o, c;
  a === i ? o = 0 : t === a ? o = (n - r) / s : n === a ? o = 2 + (r - t) / s : r === a && (o = 4 + (t - n) / s), o = Math.min(o * 60, 360), o < 0 && (o += 360);
  const u = (i + a) / 2;
  return a === i ? c = 0 : u <= 0.5 ? c = s / (a + i) : c = s / (2 - a - i), [o, c * 100, u * 100];
};
ye.rgb.hsv = function(e) {
  let t, n, r, i, a;
  const s = e[0] / 255, o = e[1] / 255, c = e[2] / 255, u = Math.max(s, o, c), h = u - Math.min(s, o, c), y = function(w) {
    return (u - w) / 6 / h + 1 / 2;
  };
  return h === 0 ? (i = 0, a = 0) : (a = h / u, t = y(s), n = y(o), r = y(c), s === u ? i = r - n : o === u ? i = 1 / 3 + t - r : c === u && (i = 2 / 3 + n - t), i < 0 ? i += 1 : i > 1 && (i -= 1)), [
    i * 360,
    a * 100,
    u * 100
  ];
};
ye.rgb.hwb = function(e) {
  const t = e[0], n = e[1];
  let r = e[2];
  const i = ye.rgb.hsl(e)[0], a = 1 / 255 * Math.min(t, Math.min(n, r));
  return r = 1 - 1 / 255 * Math.max(t, Math.max(n, r)), [i, a * 100, r * 100];
};
ye.rgb.cmyk = function(e) {
  const t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.min(1 - t, 1 - n, 1 - r), a = (1 - t - i) / (1 - i) || 0, s = (1 - n - i) / (1 - i) || 0, o = (1 - r - i) / (1 - i) || 0;
  return [a * 100, s * 100, o * 100, i * 100];
};
function by(e, t) {
  return (e[0] - t[0]) ** 2 + (e[1] - t[1]) ** 2 + (e[2] - t[2]) ** 2;
}
ye.rgb.keyword = function(e) {
  const t = Lf[e];
  if (t)
    return t;
  let n = 1 / 0, r;
  for (const i of Object.keys(Vr)) {
    const a = Vr[i], s = by(e, a);
    s < n && (n = s, r = i);
  }
  return r;
};
ye.keyword.rgb = function(e) {
  return Vr[e];
};
ye.rgb.xyz = function(e) {
  let t = e[0] / 255, n = e[1] / 255, r = e[2] / 255;
  t = t > 0.04045 ? ((t + 0.055) / 1.055) ** 2.4 : t / 12.92, n = n > 0.04045 ? ((n + 0.055) / 1.055) ** 2.4 : n / 12.92, r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  const i = t * 0.4124 + n * 0.3576 + r * 0.1805, a = t * 0.2126 + n * 0.7152 + r * 0.0722, s = t * 0.0193 + n * 0.1192 + r * 0.9505;
  return [i * 100, a * 100, s * 100];
};
ye.rgb.lab = function(e) {
  const t = ye.rgb.xyz(e);
  let n = t[0], r = t[1], i = t[2];
  n /= 95.047, r /= 100, i /= 108.883, n = n > 8856e-6 ? n ** (1 / 3) : 7.787 * n + 16 / 116, r = r > 8856e-6 ? r ** (1 / 3) : 7.787 * r + 16 / 116, i = i > 8856e-6 ? i ** (1 / 3) : 7.787 * i + 16 / 116;
  const a = 116 * r - 16, s = 500 * (n - r), o = 200 * (r - i);
  return [a, s, o];
};
ye.hsl.rgb = function(e) {
  const t = e[0] / 360, n = e[1] / 100, r = e[2] / 100;
  let i, a, s;
  if (n === 0)
    return s = r * 255, [s, s, s];
  r < 0.5 ? i = r * (1 + n) : i = r + n - r * n;
  const o = 2 * r - i, c = [0, 0, 0];
  for (let u = 0; u < 3; u++)
    a = t + 1 / 3 * -(u - 1), a < 0 && a++, a > 1 && a--, 6 * a < 1 ? s = o + (i - o) * 6 * a : 2 * a < 1 ? s = i : 3 * a < 2 ? s = o + (i - o) * (2 / 3 - a) * 6 : s = o, c[u] = s * 255;
  return c;
};
ye.hsl.hsv = function(e) {
  const t = e[0];
  let n = e[1] / 100, r = e[2] / 100, i = n;
  const a = Math.max(r, 0.01);
  r *= 2, n *= r <= 1 ? r : 2 - r, i *= a <= 1 ? a : 2 - a;
  const s = (r + n) / 2, o = r === 0 ? 2 * i / (a + i) : 2 * n / (r + n);
  return [t, o * 100, s * 100];
};
ye.hsv.rgb = function(e) {
  const t = e[0] / 60, n = e[1] / 100;
  let r = e[2] / 100;
  const i = Math.floor(t) % 6, a = t - Math.floor(t), s = 255 * r * (1 - n), o = 255 * r * (1 - n * a), c = 255 * r * (1 - n * (1 - a));
  switch (r *= 255, i) {
    case 0:
      return [r, c, s];
    case 1:
      return [o, r, s];
    case 2:
      return [s, r, c];
    case 3:
      return [s, o, r];
    case 4:
      return [c, s, r];
    case 5:
      return [r, s, o];
  }
};
ye.hsv.hsl = function(e) {
  const t = e[0], n = e[1] / 100, r = e[2] / 100, i = Math.max(r, 0.01);
  let a, s;
  s = (2 - n) * r;
  const o = (2 - n) * i;
  return a = n * i, a /= o <= 1 ? o : 2 - o, a = a || 0, s /= 2, [t, a * 100, s * 100];
};
ye.hwb.rgb = function(e) {
  const t = e[0] / 360;
  let n = e[1] / 100, r = e[2] / 100;
  const i = n + r;
  let a;
  i > 1 && (n /= i, r /= i);
  const s = Math.floor(6 * t), o = 1 - r;
  a = 6 * t - s, s & 1 && (a = 1 - a);
  const c = n + a * (o - n);
  let u, h, y;
  switch (s) {
    default:
    case 6:
    case 0:
      u = o, h = c, y = n;
      break;
    case 1:
      u = c, h = o, y = n;
      break;
    case 2:
      u = n, h = o, y = c;
      break;
    case 3:
      u = n, h = c, y = o;
      break;
    case 4:
      u = c, h = n, y = o;
      break;
    case 5:
      u = o, h = n, y = c;
      break;
  }
  return [u * 255, h * 255, y * 255];
};
ye.cmyk.rgb = function(e) {
  const t = e[0] / 100, n = e[1] / 100, r = e[2] / 100, i = e[3] / 100, a = 1 - Math.min(1, t * (1 - i) + i), s = 1 - Math.min(1, n * (1 - i) + i), o = 1 - Math.min(1, r * (1 - i) + i);
  return [a * 255, s * 255, o * 255];
};
ye.xyz.rgb = function(e) {
  const t = e[0] / 100, n = e[1] / 100, r = e[2] / 100;
  let i, a, s;
  return i = t * 3.2406 + n * -1.5372 + r * -0.4986, a = t * -0.9689 + n * 1.8758 + r * 0.0415, s = t * 0.0557 + n * -0.204 + r * 1.057, i = i > 31308e-7 ? 1.055 * i ** (1 / 2.4) - 0.055 : i * 12.92, a = a > 31308e-7 ? 1.055 * a ** (1 / 2.4) - 0.055 : a * 12.92, s = s > 31308e-7 ? 1.055 * s ** (1 / 2.4) - 0.055 : s * 12.92, i = Math.min(Math.max(0, i), 1), a = Math.min(Math.max(0, a), 1), s = Math.min(Math.max(0, s), 1), [i * 255, a * 255, s * 255];
};
ye.xyz.lab = function(e) {
  let t = e[0], n = e[1], r = e[2];
  t /= 95.047, n /= 100, r /= 108.883, t = t > 8856e-6 ? t ** (1 / 3) : 7.787 * t + 16 / 116, n = n > 8856e-6 ? n ** (1 / 3) : 7.787 * n + 16 / 116, r = r > 8856e-6 ? r ** (1 / 3) : 7.787 * r + 16 / 116;
  const i = 116 * n - 16, a = 500 * (t - n), s = 200 * (n - r);
  return [i, a, s];
};
ye.lab.xyz = function(e) {
  const t = e[0], n = e[1], r = e[2];
  let i, a, s;
  a = (t + 16) / 116, i = n / 500 + a, s = a - r / 200;
  const o = a ** 3, c = i ** 3, u = s ** 3;
  return a = o > 8856e-6 ? o : (a - 16 / 116) / 7.787, i = c > 8856e-6 ? c : (i - 16 / 116) / 7.787, s = u > 8856e-6 ? u : (s - 16 / 116) / 7.787, i *= 95.047, a *= 100, s *= 108.883, [i, a, s];
};
ye.lab.lch = function(e) {
  const t = e[0], n = e[1], r = e[2];
  let i;
  i = Math.atan2(r, n) * 360 / 2 / Math.PI, i < 0 && (i += 360);
  const s = Math.sqrt(n * n + r * r);
  return [t, s, i];
};
ye.lch.lab = function(e) {
  const t = e[0], n = e[1], i = e[2] / 360 * 2 * Math.PI, a = n * Math.cos(i), s = n * Math.sin(i);
  return [t, a, s];
};
ye.rgb.ansi16 = function(e, t = null) {
  const [n, r, i] = e;
  let a = t === null ? ye.rgb.hsv(e)[2] : t;
  if (a = Math.round(a / 50), a === 0)
    return 30;
  let s = 30 + (Math.round(i / 255) << 2 | Math.round(r / 255) << 1 | Math.round(n / 255));
  return a === 2 && (s += 60), s;
};
ye.hsv.ansi16 = function(e) {
  return ye.rgb.ansi16(ye.hsv.rgb(e), e[2]);
};
ye.rgb.ansi256 = function(e) {
  const t = e[0], n = e[1], r = e[2];
  return t === n && n === r ? t < 8 ? 16 : t > 248 ? 231 : Math.round((t - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(t / 255 * 5) + 6 * Math.round(n / 255 * 5) + Math.round(r / 255 * 5);
};
ye.ansi16.rgb = function(e) {
  let t = e % 10;
  if (t === 0 || t === 7)
    return e > 50 && (t += 3.5), t = t / 10.5 * 255, [t, t, t];
  const n = (~~(e > 50) + 1) * 0.5, r = (t & 1) * n * 255, i = (t >> 1 & 1) * n * 255, a = (t >> 2 & 1) * n * 255;
  return [r, i, a];
};
ye.ansi256.rgb = function(e) {
  if (e >= 232) {
    const a = (e - 232) * 10 + 8;
    return [a, a, a];
  }
  e -= 16;
  let t;
  const n = Math.floor(e / 36) / 5 * 255, r = Math.floor((t = e % 36) / 6) / 5 * 255, i = t % 6 / 5 * 255;
  return [n, r, i];
};
ye.rgb.hex = function(e) {
  const n = (((Math.round(e[0]) & 255) << 16) + ((Math.round(e[1]) & 255) << 8) + (Math.round(e[2]) & 255)).toString(16).toUpperCase();
  return "000000".substring(n.length) + n;
};
ye.hex.rgb = function(e) {
  const t = e.toString(16).match(/[a-f0-9]{6}|[a-f0-9]{3}/i);
  if (!t)
    return [0, 0, 0];
  let n = t[0];
  t[0].length === 3 && (n = n.split("").map((o) => o + o).join(""));
  const r = parseInt(n, 16), i = r >> 16 & 255, a = r >> 8 & 255, s = r & 255;
  return [i, a, s];
};
ye.rgb.hcg = function(e) {
  const t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.max(Math.max(t, n), r), a = Math.min(Math.min(t, n), r), s = i - a;
  let o, c;
  return s < 1 ? o = a / (1 - s) : o = 0, s <= 0 ? c = 0 : i === t ? c = (n - r) / s % 6 : i === n ? c = 2 + (r - t) / s : c = 4 + (t - n) / s, c /= 6, c %= 1, [c * 360, s * 100, o * 100];
};
ye.hsl.hcg = function(e) {
  const t = e[1] / 100, n = e[2] / 100, r = n < 0.5 ? 2 * t * n : 2 * t * (1 - n);
  let i = 0;
  return r < 1 && (i = (n - 0.5 * r) / (1 - r)), [e[0], r * 100, i * 100];
};
ye.hsv.hcg = function(e) {
  const t = e[1] / 100, n = e[2] / 100, r = t * n;
  let i = 0;
  return r < 1 && (i = (n - r) / (1 - r)), [e[0], r * 100, i * 100];
};
ye.hcg.rgb = function(e) {
  const t = e[0] / 360, n = e[1] / 100, r = e[2] / 100;
  if (n === 0)
    return [r * 255, r * 255, r * 255];
  const i = [0, 0, 0], a = t % 1 * 6, s = a % 1, o = 1 - s;
  let c = 0;
  switch (Math.floor(a)) {
    case 0:
      i[0] = 1, i[1] = s, i[2] = 0;
      break;
    case 1:
      i[0] = o, i[1] = 1, i[2] = 0;
      break;
    case 2:
      i[0] = 0, i[1] = 1, i[2] = s;
      break;
    case 3:
      i[0] = 0, i[1] = o, i[2] = 1;
      break;
    case 4:
      i[0] = s, i[1] = 0, i[2] = 1;
      break;
    default:
      i[0] = 1, i[1] = 0, i[2] = o;
  }
  return c = (1 - n) * r, [
    (n * i[0] + c) * 255,
    (n * i[1] + c) * 255,
    (n * i[2] + c) * 255
  ];
};
ye.hcg.hsv = function(e) {
  const t = e[1] / 100, n = e[2] / 100, r = t + n * (1 - t);
  let i = 0;
  return r > 0 && (i = t / r), [e[0], i * 100, r * 100];
};
ye.hcg.hsl = function(e) {
  const t = e[1] / 100, r = e[2] / 100 * (1 - t) + 0.5 * t;
  let i = 0;
  return r > 0 && r < 0.5 ? i = t / (2 * r) : r >= 0.5 && r < 1 && (i = t / (2 * (1 - r))), [e[0], i * 100, r * 100];
};
ye.hcg.hwb = function(e) {
  const t = e[1] / 100, n = e[2] / 100, r = t + n * (1 - t);
  return [e[0], (r - t) * 100, (1 - r) * 100];
};
ye.hwb.hcg = function(e) {
  const t = e[1] / 100, r = 1 - e[2] / 100, i = r - t;
  let a = 0;
  return i < 1 && (a = (r - i) / (1 - i)), [e[0], i * 100, a * 100];
};
ye.apple.rgb = function(e) {
  return [e[0] / 65535 * 255, e[1] / 65535 * 255, e[2] / 65535 * 255];
};
ye.rgb.apple = function(e) {
  return [e[0] / 255 * 65535, e[1] / 255 * 65535, e[2] / 255 * 65535];
};
ye.gray.rgb = function(e) {
  return [e[0] / 100 * 255, e[0] / 100 * 255, e[0] / 100 * 255];
};
ye.gray.hsl = function(e) {
  return [0, 0, e[0]];
};
ye.gray.hsv = ye.gray.hsl;
ye.gray.hwb = function(e) {
  return [0, 100, e[0]];
};
ye.gray.cmyk = function(e) {
  return [0, 0, 0, e[0]];
};
ye.gray.lab = function(e) {
  return [e[0], 0, 0];
};
ye.gray.hex = function(e) {
  const t = Math.round(e[0] / 100 * 255) & 255, r = ((t << 16) + (t << 8) + t).toString(16).toUpperCase();
  return "000000".substring(r.length) + r;
};
ye.rgb.gray = function(e) {
  return [(e[0] + e[1] + e[2]) / 3 / 255 * 100];
};
const Vi = Pf;
function vy() {
  const e = {}, t = Object.keys(Vi);
  for (let n = t.length, r = 0; r < n; r++)
    e[t[r]] = {
      // http://jsperf.com/1-vs-infinity
      // micro-opt, but this is simple.
      distance: -1,
      parent: null
    };
  return e;
}
function wy(e) {
  const t = vy(), n = [e];
  for (t[e].distance = 0; n.length; ) {
    const r = n.pop(), i = Object.keys(Vi[r]);
    for (let a = i.length, s = 0; s < a; s++) {
      const o = i[s], c = t[o];
      c.distance === -1 && (c.distance = t[r].distance + 1, c.parent = r, n.unshift(o));
    }
  }
  return t;
}
function xy(e, t) {
  return function(n) {
    return t(e(n));
  };
}
function Dy(e, t) {
  const n = [t[e].parent, e];
  let r = Vi[t[e].parent][e], i = t[e].parent;
  for (; t[i].parent; )
    n.unshift(t[i].parent), r = xy(Vi[t[i].parent][i], r), i = t[i].parent;
  return r.conversion = n, r;
}
var _y = function(e) {
  const t = wy(e), n = {}, r = Object.keys(t);
  for (let i = r.length, a = 0; a < i; a++) {
    const s = r[a];
    t[s].parent !== null && (n[s] = Dy(s, t));
  }
  return n;
};
const bc = Pf, Ty = _y, er = {}, Ey = Object.keys(bc);
function Ay(e) {
  const t = function(...n) {
    const r = n[0];
    return r == null ? r : (r.length > 1 && (n = r), e(n));
  };
  return "conversion" in e && (t.conversion = e.conversion), t;
}
function Uy(e) {
  const t = function(...n) {
    const r = n[0];
    if (r == null)
      return r;
    r.length > 1 && (n = r);
    const i = e(n);
    if (typeof i == "object")
      for (let a = i.length, s = 0; s < a; s++)
        i[s] = Math.round(i[s]);
    return i;
  };
  return "conversion" in e && (t.conversion = e.conversion), t;
}
Ey.forEach((e) => {
  er[e] = {}, Object.defineProperty(er[e], "channels", { value: bc[e].channels }), Object.defineProperty(er[e], "labels", { value: bc[e].labels });
  const t = Ty(e);
  Object.keys(t).forEach((r) => {
    const i = t[r];
    er[e][r] = Uy(i), er[e][r].raw = Ay(i);
  });
});
var Cy = er;
const tr = yy, wt = Cy, Mf = [
  // To be honest, I don't really feel like keyword belongs in color convert, but eh.
  "keyword",
  // Gray conflicts with some method names, and has its own method defined.
  "gray",
  // Shouldn't really be in color-convert either...
  "hex"
], vc = {};
for (const e of Object.keys(wt))
  vc[[...wt[e].labels].sort().join("")] = e;
const Gi = {};
function $e(e, t) {
  if (!(this instanceof $e))
    return new $e(e, t);
  if (t && t in Mf && (t = null), t && !(t in wt))
    throw new Error("Unknown model: " + t);
  let n, r;
  if (e == null)
    this.model = "rgb", this.color = [0, 0, 0], this.valpha = 1;
  else if (e instanceof $e)
    this.model = e.model, this.color = [...e.color], this.valpha = e.valpha;
  else if (typeof e == "string") {
    const i = tr.get(e);
    if (i === null)
      throw new Error("Unable to parse color from string: " + e);
    this.model = i.model, r = wt[this.model].channels, this.color = i.value.slice(0, r), this.valpha = typeof i.value[r] == "number" ? i.value[r] : 1;
  } else if (e.length > 0) {
    this.model = t || "rgb", r = wt[this.model].channels;
    const i = Array.prototype.slice.call(e, 0, r);
    this.color = wc(i, r), this.valpha = typeof e[r] == "number" ? e[r] : 1;
  } else if (typeof e == "number")
    this.model = "rgb", this.color = [
      e >> 16 & 255,
      e >> 8 & 255,
      e & 255
    ], this.valpha = 1;
  else {
    this.valpha = 1;
    const i = Object.keys(e);
    "alpha" in e && (i.splice(i.indexOf("alpha"), 1), this.valpha = typeof e.alpha == "number" ? e.alpha : 0);
    const a = i.sort().join("");
    if (!(a in vc))
      throw new Error("Unable to parse color from object: " + JSON.stringify(e));
    this.model = vc[a];
    const { labels: s } = wt[this.model], o = [];
    for (n = 0; n < s.length; n++)
      o.push(e[s[n]]);
    this.color = wc(o);
  }
  if (Gi[this.model])
    for (r = wt[this.model].channels, n = 0; n < r; n++) {
      const i = Gi[this.model][n];
      i && (this.color[n] = i(this.color[n]));
    }
  this.valpha = Math.max(0, Math.min(1, this.valpha)), Object.freeze && Object.freeze(this);
}
$e.prototype = {
  toString() {
    return this.string();
  },
  toJSON() {
    return this[this.model]();
  },
  string(e) {
    let t = this.model in tr.to ? this : this.rgb();
    t = t.round(typeof e == "number" ? e : 1);
    const n = t.valpha === 1 ? t.color : [...t.color, this.valpha];
    return tr.to[t.model](n);
  },
  percentString(e) {
    const t = this.rgb().round(typeof e == "number" ? e : 1), n = t.valpha === 1 ? t.color : [...t.color, this.valpha];
    return tr.to.rgb.percent(n);
  },
  array() {
    return this.valpha === 1 ? [...this.color] : [...this.color, this.valpha];
  },
  object() {
    const e = {}, { channels: t } = wt[this.model], { labels: n } = wt[this.model];
    for (let r = 0; r < t; r++)
      e[n[r]] = this.color[r];
    return this.valpha !== 1 && (e.alpha = this.valpha), e;
  },
  unitArray() {
    const e = this.rgb().color;
    return e[0] /= 255, e[1] /= 255, e[2] /= 255, this.valpha !== 1 && e.push(this.valpha), e;
  },
  unitObject() {
    const e = this.rgb().object();
    return e.r /= 255, e.g /= 255, e.b /= 255, this.valpha !== 1 && (e.alpha = this.valpha), e;
  },
  round(e) {
    return e = Math.max(e || 0, 0), new $e([...this.color.map(Fy(e)), this.valpha], this.model);
  },
  alpha(e) {
    return e !== void 0 ? new $e([...this.color, Math.max(0, Math.min(1, e))], this.model) : this.valpha;
  },
  // Rgb
  red: Le("rgb", 0, Ge(255)),
  green: Le("rgb", 1, Ge(255)),
  blue: Le("rgb", 2, Ge(255)),
  hue: Le(["hsl", "hsv", "hsl", "hwb", "hcg"], 0, (e) => (e % 360 + 360) % 360),
  saturationl: Le("hsl", 1, Ge(100)),
  lightness: Le("hsl", 2, Ge(100)),
  saturationv: Le("hsv", 1, Ge(100)),
  value: Le("hsv", 2, Ge(100)),
  chroma: Le("hcg", 1, Ge(100)),
  gray: Le("hcg", 2, Ge(100)),
  white: Le("hwb", 1, Ge(100)),
  wblack: Le("hwb", 2, Ge(100)),
  cyan: Le("cmyk", 0, Ge(100)),
  magenta: Le("cmyk", 1, Ge(100)),
  yellow: Le("cmyk", 2, Ge(100)),
  black: Le("cmyk", 3, Ge(100)),
  x: Le("xyz", 0, Ge(95.047)),
  y: Le("xyz", 1, Ge(100)),
  z: Le("xyz", 2, Ge(108.833)),
  l: Le("lab", 0, Ge(100)),
  a: Le("lab", 1),
  b: Le("lab", 2),
  keyword(e) {
    return e !== void 0 ? new $e(e) : wt[this.model].keyword(this.color);
  },
  hex(e) {
    return e !== void 0 ? new $e(e) : tr.to.hex(this.rgb().round().color);
  },
  hexa(e) {
    if (e !== void 0)
      return new $e(e);
    const t = this.rgb().round().color;
    let n = Math.round(this.valpha * 255).toString(16).toUpperCase();
    return n.length === 1 && (n = "0" + n), tr.to.hex(t) + n;
  },
  rgbNumber() {
    const e = this.rgb().color;
    return (e[0] & 255) << 16 | (e[1] & 255) << 8 | e[2] & 255;
  },
  luminosity() {
    const e = this.rgb().color, t = [];
    for (const [n, r] of e.entries()) {
      const i = r / 255;
      t[n] = i <= 0.04045 ? i / 12.92 : ((i + 0.055) / 1.055) ** 2.4;
    }
    return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  },
  contrast(e) {
    const t = this.luminosity(), n = e.luminosity();
    return t > n ? (t + 0.05) / (n + 0.05) : (n + 0.05) / (t + 0.05);
  },
  level(e) {
    const t = this.contrast(e);
    return t >= 7 ? "AAA" : t >= 4.5 ? "AA" : "";
  },
  isDark() {
    const e = this.rgb().color;
    return (e[0] * 2126 + e[1] * 7152 + e[2] * 722) / 1e4 < 128;
  },
  isLight() {
    return !this.isDark();
  },
  negate() {
    const e = this.rgb();
    for (let t = 0; t < 3; t++)
      e.color[t] = 255 - e.color[t];
    return e;
  },
  lighten(e) {
    const t = this.hsl();
    return t.color[2] += t.color[2] * e, t;
  },
  darken(e) {
    const t = this.hsl();
    return t.color[2] -= t.color[2] * e, t;
  },
  saturate(e) {
    const t = this.hsl();
    return t.color[1] += t.color[1] * e, t;
  },
  desaturate(e) {
    const t = this.hsl();
    return t.color[1] -= t.color[1] * e, t;
  },
  whiten(e) {
    const t = this.hwb();
    return t.color[1] += t.color[1] * e, t;
  },
  blacken(e) {
    const t = this.hwb();
    return t.color[2] += t.color[2] * e, t;
  },
  grayscale() {
    const e = this.rgb().color, t = e[0] * 0.3 + e[1] * 0.59 + e[2] * 0.11;
    return $e.rgb(t, t, t);
  },
  fade(e) {
    return this.alpha(this.valpha - this.valpha * e);
  },
  opaquer(e) {
    return this.alpha(this.valpha + this.valpha * e);
  },
  rotate(e) {
    const t = this.hsl();
    let n = t.color[0];
    return n = (n + e) % 360, n = n < 0 ? 360 + n : n, t.color[0] = n, t;
  },
  mix(e, t) {
    if (!e || !e.rgb)
      throw new Error('Argument to "mix" was not a Color instance, but rather an instance of ' + typeof e);
    const n = e.rgb(), r = this.rgb(), i = t === void 0 ? 0.5 : t, a = 2 * i - 1, s = n.alpha() - r.alpha(), o = ((a * s === -1 ? a : (a + s) / (1 + a * s)) + 1) / 2, c = 1 - o;
    return $e.rgb(
      o * n.red() + c * r.red(),
      o * n.green() + c * r.green(),
      o * n.blue() + c * r.blue(),
      n.alpha() * i + r.alpha() * (1 - i)
    );
  }
};
for (const e of Object.keys(wt)) {
  if (Mf.includes(e))
    continue;
  const { channels: t } = wt[e];
  $e.prototype[e] = function(...n) {
    return this.model === e ? new $e(this) : n.length > 0 ? new $e(n, e) : new $e([...ky(wt[this.model][e].raw(this.color)), this.valpha], e);
  }, $e[e] = function(...n) {
    let r = n[0];
    return typeof r == "number" && (r = wc(n, t)), new $e(r, e);
  };
}
function Sy(e, t) {
  return Number(e.toFixed(t));
}
function Fy(e) {
  return function(t) {
    return Sy(t, e);
  };
}
function Le(e, t, n) {
  e = Array.isArray(e) ? e : [e];
  for (const r of e)
    (Gi[r] || (Gi[r] = []))[t] = n;
  return e = e[0], function(r) {
    let i;
    return r !== void 0 ? (n && (r = n(r)), i = this[e](), i.color[t] = r, i) : (i = this[e]().color[t], n && (i = n(i)), i);
  };
}
function Ge(e) {
  return function(t) {
    return Math.max(0, Math.min(e, t));
  };
}
function ky(e) {
  return Array.isArray(e) ? e : [e];
}
function wc(e, t) {
  for (let n = 0; n < t; n++)
    typeof e[n] != "number" && (e[n] = 0);
  return e;
}
var By = $e;
const xc = /* @__PURE__ */ ly(By);
var Ry = Object.defineProperty, Iy = Object.defineProperties, Ny = Object.getOwnPropertyDescriptors, _l = Object.getOwnPropertySymbols, Oy = Object.prototype.hasOwnProperty, Wy = Object.prototype.propertyIsEnumerable, Dc = (e, t, n) => t in e ? Ry(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : e[t] = n, Te = (e, t) => {
  for (var n in t || (t = {}))
    Oy.call(t, n) && Dc(e, n, t[n]);
  if (_l)
    for (var n of _l(t))
      Wy.call(t, n) && Dc(e, n, t[n]);
  return e;
}, bn = (e, t) => Iy(e, Ny(t)), le = (e, t, n) => (Dc(e, typeof t != "symbol" ? t + "" : t, n), n), vi = (e, t, n) => new Promise((r, i) => {
  var a = (c) => {
    try {
      o(n.next(c));
    } catch (u) {
      i(u);
    }
  }, s = (c) => {
    try {
      o(n.throw(c));
    } catch (u) {
      i(u);
    }
  }, o = (c) => c.done ? r(c.value) : Promise.resolve(c.value).then(a, s);
  o((n = n.apply(e, t)).next());
});
class Xi {
  constructor(t) {
    le(this, "rootKey"), this.rootKey = t;
  }
}
const Ly = Object.seal({});
class ue extends Xi {
  constructor(t) {
    super(t), le(this, "root"), this.root = new Array();
  }
  // This method is called by the formatter to get the XML representation of this component.
  // It is called recursively for all child components.
  // It is a serializer to be used in the xml library.
  // https://www.npmjs.com/package/xml
  // Child components can override this method to customize the XML representation, or execute side effects.
  prepForXml(t) {
    var n;
    t.stack.push(this);
    const r = this.root.map((i) => i instanceof Xi ? i.prepForXml(t) : i).filter((i) => i !== void 0);
    return t.stack.pop(), {
      [this.rootKey]: r.length ? r.length === 1 && ((n = r[0]) != null && n._attr) ? r[0] : r : Ly
    };
  }
  /**
   * @deprecated Do not use this method. It is only used internally by the library. It will be removed in a future version.
   */
  addChildElement(t) {
    return this.root.push(t), this;
  }
}
class sn extends ue {
  prepForXml(t) {
    const n = super.prepForXml(t);
    if (n && (typeof n[this.rootKey] != "object" || Object.keys(n[this.rootKey]).length))
      return n;
  }
}
class me extends Xi {
  constructor(t) {
    super("_attr"), le(this, "xmlKeys"), this.root = t;
  }
  prepForXml(t) {
    const n = {};
    return Object.keys(this.root).forEach((r) => {
      const i = this.root[r];
      if (i !== void 0) {
        const a = this.xmlKeys && this.xmlKeys[r] || r;
        n[a] = i;
      }
    }), { _attr: n };
  }
}
class cn extends Xi {
  constructor(t) {
    super("_attr"), this.root = t;
  }
  prepForXml(t) {
    return { _attr: Object.values(this.root).filter(({ value: r }) => r !== void 0).reduce((r, { key: i, value: a }) => bn(Te({}, r), { [i]: a }), {}) };
  }
}
class We extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      val: "w:val",
      color: "w:color",
      fill: "w:fill",
      space: "w:space",
      sz: "w:sz",
      type: "w:type",
      rsidR: "w:rsidR",
      rsidRPr: "w:rsidRPr",
      rsidSect: "w:rsidSect",
      w: "w:w",
      h: "w:h",
      top: "w:top",
      right: "w:right",
      bottom: "w:bottom",
      left: "w:left",
      header: "w:header",
      footer: "w:footer",
      gutter: "w:gutter",
      linePitch: "w:linePitch",
      pos: "w:pos"
    });
  }
}
var jt = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function zf(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var jf = {}, Wc = { exports: {} }, ir = typeof Reflect == "object" ? Reflect : null, Tl = ir && typeof ir.apply == "function" ? ir.apply : function(t, n, r) {
  return Function.prototype.apply.call(t, n, r);
}, Mi;
ir && typeof ir.ownKeys == "function" ? Mi = ir.ownKeys : Object.getOwnPropertySymbols ? Mi = function(t) {
  return Object.getOwnPropertyNames(t).concat(Object.getOwnPropertySymbols(t));
} : Mi = function(t) {
  return Object.getOwnPropertyNames(t);
};
function Py(e) {
  console && console.warn && console.warn(e);
}
var qf = Number.isNaN || function(t) {
  return t !== t;
};
function Re() {
  Re.init.call(this);
}
Wc.exports = Re;
Wc.exports.once = qy;
Re.EventEmitter = Re;
Re.prototype._events = void 0;
Re.prototype._eventsCount = 0;
Re.prototype._maxListeners = void 0;
var El = 10;
function ca(e) {
  if (typeof e != "function")
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof e);
}
Object.defineProperty(Re, "defaultMaxListeners", {
  enumerable: !0,
  get: function() {
    return El;
  },
  set: function(e) {
    if (typeof e != "number" || e < 0 || qf(e))
      throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + e + ".");
    El = e;
  }
});
Re.init = function() {
  (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) && (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0), this._maxListeners = this._maxListeners || void 0;
};
Re.prototype.setMaxListeners = function(t) {
  if (typeof t != "number" || t < 0 || qf(t))
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + t + ".");
  return this._maxListeners = t, this;
};
function Hf(e) {
  return e._maxListeners === void 0 ? Re.defaultMaxListeners : e._maxListeners;
}
Re.prototype.getMaxListeners = function() {
  return Hf(this);
};
Re.prototype.emit = function(t) {
  for (var n = [], r = 1; r < arguments.length; r++)
    n.push(arguments[r]);
  var i = t === "error", a = this._events;
  if (a !== void 0)
    i = i && a.error === void 0;
  else if (!i)
    return !1;
  if (i) {
    var s;
    if (n.length > 0 && (s = n[0]), s instanceof Error)
      throw s;
    var o = new Error("Unhandled error." + (s ? " (" + s.message + ")" : ""));
    throw o.context = s, o;
  }
  var c = a[t];
  if (c === void 0)
    return !1;
  if (typeof c == "function")
    Tl(c, this, n);
  else
    for (var u = c.length, h = Kf(c, u), r = 0; r < u; ++r)
      Tl(h[r], this, n);
  return !0;
};
function Vf(e, t, n, r) {
  var i, a, s;
  if (ca(n), a = e._events, a === void 0 ? (a = e._events = /* @__PURE__ */ Object.create(null), e._eventsCount = 0) : (a.newListener !== void 0 && (e.emit(
    "newListener",
    t,
    n.listener ? n.listener : n
  ), a = e._events), s = a[t]), s === void 0)
    s = a[t] = n, ++e._eventsCount;
  else if (typeof s == "function" ? s = a[t] = r ? [n, s] : [s, n] : r ? s.unshift(n) : s.push(n), i = Hf(e), i > 0 && s.length > i && !s.warned) {
    s.warned = !0;
    var o = new Error("Possible EventEmitter memory leak detected. " + s.length + " " + String(t) + " listeners added. Use emitter.setMaxListeners() to increase limit");
    o.name = "MaxListenersExceededWarning", o.emitter = e, o.type = t, o.count = s.length, Py(o);
  }
  return e;
}
Re.prototype.addListener = function(t, n) {
  return Vf(this, t, n, !1);
};
Re.prototype.on = Re.prototype.addListener;
Re.prototype.prependListener = function(t, n) {
  return Vf(this, t, n, !0);
};
function My() {
  if (!this.fired)
    return this.target.removeListener(this.type, this.wrapFn), this.fired = !0, arguments.length === 0 ? this.listener.call(this.target) : this.listener.apply(this.target, arguments);
}
function Gf(e, t, n) {
  var r = { fired: !1, wrapFn: void 0, target: e, type: t, listener: n }, i = My.bind(r);
  return i.listener = n, r.wrapFn = i, i;
}
Re.prototype.once = function(t, n) {
  return ca(n), this.on(t, Gf(this, t, n)), this;
};
Re.prototype.prependOnceListener = function(t, n) {
  return ca(n), this.prependListener(t, Gf(this, t, n)), this;
};
Re.prototype.removeListener = function(t, n) {
  var r, i, a, s, o;
  if (ca(n), i = this._events, i === void 0)
    return this;
  if (r = i[t], r === void 0)
    return this;
  if (r === n || r.listener === n)
    --this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : (delete i[t], i.removeListener && this.emit("removeListener", t, r.listener || n));
  else if (typeof r != "function") {
    for (a = -1, s = r.length - 1; s >= 0; s--)
      if (r[s] === n || r[s].listener === n) {
        o = r[s].listener, a = s;
        break;
      }
    if (a < 0)
      return this;
    a === 0 ? r.shift() : zy(r, a), r.length === 1 && (i[t] = r[0]), i.removeListener !== void 0 && this.emit("removeListener", t, o || n);
  }
  return this;
};
Re.prototype.off = Re.prototype.removeListener;
Re.prototype.removeAllListeners = function(t) {
  var n, r, i;
  if (r = this._events, r === void 0)
    return this;
  if (r.removeListener === void 0)
    return arguments.length === 0 ? (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0) : r[t] !== void 0 && (--this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : delete r[t]), this;
  if (arguments.length === 0) {
    var a = Object.keys(r), s;
    for (i = 0; i < a.length; ++i)
      s = a[i], s !== "removeListener" && this.removeAllListeners(s);
    return this.removeAllListeners("removeListener"), this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0, this;
  }
  if (n = r[t], typeof n == "function")
    this.removeListener(t, n);
  else if (n !== void 0)
    for (i = n.length - 1; i >= 0; i--)
      this.removeListener(t, n[i]);
  return this;
};
function Xf(e, t, n) {
  var r = e._events;
  if (r === void 0)
    return [];
  var i = r[t];
  return i === void 0 ? [] : typeof i == "function" ? n ? [i.listener || i] : [i] : n ? jy(i) : Kf(i, i.length);
}
Re.prototype.listeners = function(t) {
  return Xf(this, t, !0);
};
Re.prototype.rawListeners = function(t) {
  return Xf(this, t, !1);
};
Re.listenerCount = function(e, t) {
  return typeof e.listenerCount == "function" ? e.listenerCount(t) : $f.call(e, t);
};
Re.prototype.listenerCount = $f;
function $f(e) {
  var t = this._events;
  if (t !== void 0) {
    var n = t[e];
    if (typeof n == "function")
      return 1;
    if (n !== void 0)
      return n.length;
  }
  return 0;
}
Re.prototype.eventNames = function() {
  return this._eventsCount > 0 ? Mi(this._events) : [];
};
function Kf(e, t) {
  for (var n = new Array(t), r = 0; r < t; ++r)
    n[r] = e[r];
  return n;
}
function zy(e, t) {
  for (; t + 1 < e.length; t++)
    e[t] = e[t + 1];
  e.pop();
}
function jy(e) {
  for (var t = new Array(e.length), n = 0; n < t.length; ++n)
    t[n] = e[n].listener || e[n];
  return t;
}
function qy(e, t) {
  return new Promise(function(n, r) {
    function i(s) {
      e.removeListener(t, a), r(s);
    }
    function a() {
      typeof e.removeListener == "function" && e.removeListener("error", i), n([].slice.call(arguments));
    }
    Zf(e, t, a, { once: !0 }), t !== "error" && Hy(e, i, { once: !0 });
  });
}
function Hy(e, t, n) {
  typeof e.on == "function" && Zf(e, "error", t, n);
}
function Zf(e, t, n, r) {
  if (typeof e.on == "function")
    r.once ? e.once(t, n) : e.on(t, n);
  else if (typeof e.addEventListener == "function")
    e.addEventListener(t, function i(a) {
      r.once && e.removeEventListener(t, i), n(a);
    });
  else
    throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof e);
}
var Lc = Wc.exports, _c = { exports: {} };
typeof Object.create == "function" ? _c.exports = function(t, n) {
  n && (t.super_ = n, t.prototype = Object.create(n.prototype, {
    constructor: {
      value: t,
      enumerable: !1,
      writable: !0,
      configurable: !0
    }
  }));
} : _c.exports = function(t, n) {
  if (n) {
    t.super_ = n;
    var r = function() {
    };
    r.prototype = n.prototype, t.prototype = new r(), t.prototype.constructor = t;
  }
};
var Ln = _c.exports;
function Vy(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var Yf = { exports: {} }, je = Yf.exports = {}, Wt, Lt;
function Tc() {
  throw new Error("setTimeout has not been defined");
}
function Ec() {
  throw new Error("clearTimeout has not been defined");
}
(function() {
  try {
    typeof setTimeout == "function" ? Wt = setTimeout : Wt = Tc;
  } catch {
    Wt = Tc;
  }
  try {
    typeof clearTimeout == "function" ? Lt = clearTimeout : Lt = Ec;
  } catch {
    Lt = Ec;
  }
})();
function Jf(e) {
  if (Wt === setTimeout)
    return setTimeout(e, 0);
  if ((Wt === Tc || !Wt) && setTimeout)
    return Wt = setTimeout, setTimeout(e, 0);
  try {
    return Wt(e, 0);
  } catch {
    try {
      return Wt.call(null, e, 0);
    } catch {
      return Wt.call(this, e, 0);
    }
  }
}
function Gy(e) {
  if (Lt === clearTimeout)
    return clearTimeout(e);
  if ((Lt === Ec || !Lt) && clearTimeout)
    return Lt = clearTimeout, clearTimeout(e);
  try {
    return Lt(e);
  } catch {
    try {
      return Lt.call(null, e);
    } catch {
      return Lt.call(this, e);
    }
  }
}
var en = [], ar = !1, Fn, zi = -1;
function Xy() {
  !ar || !Fn || (ar = !1, Fn.length ? en = Fn.concat(en) : zi = -1, en.length && Qf());
}
function Qf() {
  if (!ar) {
    var e = Jf(Xy);
    ar = !0;
    for (var t = en.length; t; ) {
      for (Fn = en, en = []; ++zi < t; )
        Fn && Fn[zi].run();
      zi = -1, t = en.length;
    }
    Fn = null, ar = !1, Gy(e);
  }
}
je.nextTick = function(e) {
  var t = new Array(arguments.length - 1);
  if (arguments.length > 1)
    for (var n = 1; n < arguments.length; n++)
      t[n - 1] = arguments[n];
  en.push(new ep(e, t)), en.length === 1 && !ar && Jf(Qf);
};
function ep(e, t) {
  this.fun = e, this.array = t;
}
ep.prototype.run = function() {
  this.fun.apply(null, this.array);
};
je.title = "browser";
je.browser = !0;
je.env = {};
je.argv = [];
je.version = "";
je.versions = {};
function un() {
}
je.on = un;
je.addListener = un;
je.once = un;
je.off = un;
je.removeListener = un;
je.removeAllListeners = un;
je.emit = un;
je.prependListener = un;
je.prependOnceListener = un;
je.listeners = function(e) {
  return [];
};
je.binding = function(e) {
  throw new Error("process.binding is not supported");
};
je.cwd = function() {
  return "/";
};
je.chdir = function(e) {
  throw new Error("process.chdir is not supported");
};
je.umask = function() {
  return 0;
};
var $y = Yf.exports;
const _e = /* @__PURE__ */ Vy($y);
var lo, Al;
function tp() {
  return Al || (Al = 1, lo = Lc.EventEmitter), lo;
}
var ho = {}, Nr = {}, Ul;
function Ky() {
  if (Ul)
    return Nr;
  Ul = 1, Nr.byteLength = o, Nr.toByteArray = u, Nr.fromByteArray = w;
  for (var e = [], t = [], n = typeof Uint8Array < "u" ? Uint8Array : Array, r = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", i = 0, a = r.length; i < a; ++i)
    e[i] = r[i], t[r.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62, t["_".charCodeAt(0)] = 63;
  function s(p) {
    var x = p.length;
    if (x % 4 > 0)
      throw new Error("Invalid string. Length must be a multiple of 4");
    var d = p.indexOf("=");
    d === -1 && (d = x);
    var v = d === x ? 0 : 4 - d % 4;
    return [d, v];
  }
  function o(p) {
    var x = s(p), d = x[0], v = x[1];
    return (d + v) * 3 / 4 - v;
  }
  function c(p, x, d) {
    return (x + d) * 3 / 4 - d;
  }
  function u(p) {
    var x, d = s(p), v = d[0], l = d[1], b = new n(c(p, v, l)), _ = 0, E = l > 0 ? v - 4 : v, C;
    for (C = 0; C < E; C += 4)
      x = t[p.charCodeAt(C)] << 18 | t[p.charCodeAt(C + 1)] << 12 | t[p.charCodeAt(C + 2)] << 6 | t[p.charCodeAt(C + 3)], b[_++] = x >> 16 & 255, b[_++] = x >> 8 & 255, b[_++] = x & 255;
    return l === 2 && (x = t[p.charCodeAt(C)] << 2 | t[p.charCodeAt(C + 1)] >> 4, b[_++] = x & 255), l === 1 && (x = t[p.charCodeAt(C)] << 10 | t[p.charCodeAt(C + 1)] << 4 | t[p.charCodeAt(C + 2)] >> 2, b[_++] = x >> 8 & 255, b[_++] = x & 255), b;
  }
  function h(p) {
    return e[p >> 18 & 63] + e[p >> 12 & 63] + e[p >> 6 & 63] + e[p & 63];
  }
  function y(p, x, d) {
    for (var v, l = [], b = x; b < d; b += 3)
      v = (p[b] << 16 & 16711680) + (p[b + 1] << 8 & 65280) + (p[b + 2] & 255), l.push(h(v));
    return l.join("");
  }
  function w(p) {
    for (var x, d = p.length, v = d % 3, l = [], b = 16383, _ = 0, E = d - v; _ < E; _ += b)
      l.push(y(p, _, _ + b > E ? E : _ + b));
    return v === 1 ? (x = p[d - 1], l.push(
      e[x >> 2] + e[x << 4 & 63] + "=="
    )) : v === 2 && (x = (p[d - 2] << 8) + p[d - 1], l.push(
      e[x >> 10] + e[x >> 4 & 63] + e[x << 2 & 63] + "="
    )), l.join("");
  }
  return Nr;
}
var wi = {};
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
var Cl;
function Zy() {
  return Cl || (Cl = 1, wi.read = function(e, t, n, r, i) {
    var a, s, o = i * 8 - r - 1, c = (1 << o) - 1, u = c >> 1, h = -7, y = n ? i - 1 : 0, w = n ? -1 : 1, p = e[t + y];
    for (y += w, a = p & (1 << -h) - 1, p >>= -h, h += o; h > 0; a = a * 256 + e[t + y], y += w, h -= 8)
      ;
    for (s = a & (1 << -h) - 1, a >>= -h, h += r; h > 0; s = s * 256 + e[t + y], y += w, h -= 8)
      ;
    if (a === 0)
      a = 1 - u;
    else {
      if (a === c)
        return s ? NaN : (p ? -1 : 1) * (1 / 0);
      s = s + Math.pow(2, r), a = a - u;
    }
    return (p ? -1 : 1) * s * Math.pow(2, a - r);
  }, wi.write = function(e, t, n, r, i, a) {
    var s, o, c, u = a * 8 - i - 1, h = (1 << u) - 1, y = h >> 1, w = i === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0, p = r ? 0 : a - 1, x = r ? 1 : -1, d = t < 0 || t === 0 && 1 / t < 0 ? 1 : 0;
    for (t = Math.abs(t), isNaN(t) || t === 1 / 0 ? (o = isNaN(t) ? 1 : 0, s = h) : (s = Math.floor(Math.log(t) / Math.LN2), t * (c = Math.pow(2, -s)) < 1 && (s--, c *= 2), s + y >= 1 ? t += w / c : t += w * Math.pow(2, 1 - y), t * c >= 2 && (s++, c /= 2), s + y >= h ? (o = 0, s = h) : s + y >= 1 ? (o = (t * c - 1) * Math.pow(2, i), s = s + y) : (o = t * Math.pow(2, y - 1) * Math.pow(2, i), s = 0)); i >= 8; e[n + p] = o & 255, p += x, o /= 256, i -= 8)
      ;
    for (s = s << i | o, u += i; u > 0; e[n + p] = s & 255, p += x, s /= 256, u -= 8)
      ;
    e[n + p - x] |= d * 128;
  }), wi;
}
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
var Sl;
function ua() {
  return Sl || (Sl = 1, function(e) {
    var t = Ky(), n = Zy(), r = typeof Symbol == "function" && typeof Symbol.for == "function" ? Symbol.for("nodejs.util.inspect.custom") : null;
    e.Buffer = o, e.SlowBuffer = b, e.INSPECT_MAX_BYTES = 50;
    var i = 2147483647;
    e.kMaxLength = i, o.TYPED_ARRAY_SUPPORT = a(), !o.TYPED_ARRAY_SUPPORT && typeof console < "u" && typeof console.error == "function" && console.error(
      "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
    );
    function a() {
      try {
        var U = new Uint8Array(1), f = { foo: function() {
          return 42;
        } };
        return Object.setPrototypeOf(f, Uint8Array.prototype), Object.setPrototypeOf(U, f), U.foo() === 42;
      } catch {
        return !1;
      }
    }
    Object.defineProperty(o.prototype, "parent", {
      enumerable: !0,
      get: function() {
        if (o.isBuffer(this))
          return this.buffer;
      }
    }), Object.defineProperty(o.prototype, "offset", {
      enumerable: !0,
      get: function() {
        if (o.isBuffer(this))
          return this.byteOffset;
      }
    });
    function s(U) {
      if (U > i)
        throw new RangeError('The value "' + U + '" is invalid for option "size"');
      var f = new Uint8Array(U);
      return Object.setPrototypeOf(f, o.prototype), f;
    }
    function o(U, f, g) {
      if (typeof U == "number") {
        if (typeof f == "string")
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        return y(U);
      }
      return c(U, f, g);
    }
    o.poolSize = 8192;
    function c(U, f, g) {
      if (typeof U == "string")
        return w(U, f);
      if (ArrayBuffer.isView(U))
        return x(U);
      if (U == null)
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof U
        );
      if (oe(U, ArrayBuffer) || U && oe(U.buffer, ArrayBuffer) || typeof SharedArrayBuffer < "u" && (oe(U, SharedArrayBuffer) || U && oe(U.buffer, SharedArrayBuffer)))
        return d(U, f, g);
      if (typeof U == "number")
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      var T = U.valueOf && U.valueOf();
      if (T != null && T !== U)
        return o.from(T, f, g);
      var L = v(U);
      if (L)
        return L;
      if (typeof Symbol < "u" && Symbol.toPrimitive != null && typeof U[Symbol.toPrimitive] == "function")
        return o.from(
          U[Symbol.toPrimitive]("string"),
          f,
          g
        );
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof U
      );
    }
    o.from = function(U, f, g) {
      return c(U, f, g);
    }, Object.setPrototypeOf(o.prototype, Uint8Array.prototype), Object.setPrototypeOf(o, Uint8Array);
    function u(U) {
      if (typeof U != "number")
        throw new TypeError('"size" argument must be of type number');
      if (U < 0)
        throw new RangeError('The value "' + U + '" is invalid for option "size"');
    }
    function h(U, f, g) {
      return u(U), U <= 0 ? s(U) : f !== void 0 ? typeof g == "string" ? s(U).fill(f, g) : s(U).fill(f) : s(U);
    }
    o.alloc = function(U, f, g) {
      return h(U, f, g);
    };
    function y(U) {
      return u(U), s(U < 0 ? 0 : l(U) | 0);
    }
    o.allocUnsafe = function(U) {
      return y(U);
    }, o.allocUnsafeSlow = function(U) {
      return y(U);
    };
    function w(U, f) {
      if ((typeof f != "string" || f === "") && (f = "utf8"), !o.isEncoding(f))
        throw new TypeError("Unknown encoding: " + f);
      var g = _(U, f) | 0, T = s(g), L = T.write(U, f);
      return L !== g && (T = T.slice(0, L)), T;
    }
    function p(U) {
      for (var f = U.length < 0 ? 0 : l(U.length) | 0, g = s(f), T = 0; T < f; T += 1)
        g[T] = U[T] & 255;
      return g;
    }
    function x(U) {
      if (oe(U, Uint8Array)) {
        var f = new Uint8Array(U);
        return d(f.buffer, f.byteOffset, f.byteLength);
      }
      return p(U);
    }
    function d(U, f, g) {
      if (f < 0 || U.byteLength < f)
        throw new RangeError('"offset" is outside of buffer bounds');
      if (U.byteLength < f + (g || 0))
        throw new RangeError('"length" is outside of buffer bounds');
      var T;
      return f === void 0 && g === void 0 ? T = new Uint8Array(U) : g === void 0 ? T = new Uint8Array(U, f) : T = new Uint8Array(U, f, g), Object.setPrototypeOf(T, o.prototype), T;
    }
    function v(U) {
      if (o.isBuffer(U)) {
        var f = l(U.length) | 0, g = s(f);
        return g.length === 0 || U.copy(g, 0, 0, f), g;
      }
      if (U.length !== void 0)
        return typeof U.length != "number" || m(U.length) ? s(0) : p(U);
      if (U.type === "Buffer" && Array.isArray(U.data))
        return p(U.data);
    }
    function l(U) {
      if (U >= i)
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + i.toString(16) + " bytes");
      return U | 0;
    }
    function b(U) {
      return +U != U && (U = 0), o.alloc(+U);
    }
    o.isBuffer = function(f) {
      return f != null && f._isBuffer === !0 && f !== o.prototype;
    }, o.compare = function(f, g) {
      if (oe(f, Uint8Array) && (f = o.from(f, f.offset, f.byteLength)), oe(g, Uint8Array) && (g = o.from(g, g.offset, g.byteLength)), !o.isBuffer(f) || !o.isBuffer(g))
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      if (f === g)
        return 0;
      for (var T = f.length, L = g.length, K = 0, W = Math.min(T, L); K < W; ++K)
        if (f[K] !== g[K]) {
          T = f[K], L = g[K];
          break;
        }
      return T < L ? -1 : L < T ? 1 : 0;
    }, o.isEncoding = function(f) {
      switch (String(f).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return !0;
        default:
          return !1;
      }
    }, o.concat = function(f, g) {
      if (!Array.isArray(f))
        throw new TypeError('"list" argument must be an Array of Buffers');
      if (f.length === 0)
        return o.alloc(0);
      var T;
      if (g === void 0)
        for (g = 0, T = 0; T < f.length; ++T)
          g += f[T].length;
      var L = o.allocUnsafe(g), K = 0;
      for (T = 0; T < f.length; ++T) {
        var W = f[T];
        if (oe(W, Uint8Array))
          K + W.length > L.length ? o.from(W).copy(L, K) : Uint8Array.prototype.set.call(
            L,
            W,
            K
          );
        else if (o.isBuffer(W))
          W.copy(L, K);
        else
          throw new TypeError('"list" argument must be an Array of Buffers');
        K += W.length;
      }
      return L;
    };
    function _(U, f) {
      if (o.isBuffer(U))
        return U.length;
      if (ArrayBuffer.isView(U) || oe(U, ArrayBuffer))
        return U.byteLength;
      if (typeof U != "string")
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof U
        );
      var g = U.length, T = arguments.length > 2 && arguments[2] === !0;
      if (!T && g === 0)
        return 0;
      for (var L = !1; ; )
        switch (f) {
          case "ascii":
          case "latin1":
          case "binary":
            return g;
          case "utf8":
          case "utf-8":
            return k(U).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return g * 2;
          case "hex":
            return g >>> 1;
          case "base64":
            return V(U).length;
          default:
            if (L)
              return T ? -1 : k(U).length;
            f = ("" + f).toLowerCase(), L = !0;
        }
    }
    o.byteLength = _;
    function E(U, f, g) {
      var T = !1;
      if ((f === void 0 || f < 0) && (f = 0), f > this.length || ((g === void 0 || g > this.length) && (g = this.length), g <= 0) || (g >>>= 0, f >>>= 0, g <= f))
        return "";
      for (U || (U = "utf8"); ; )
        switch (U) {
          case "hex":
            return z(this, f, g);
          case "utf8":
          case "utf-8":
            return D(this, f, g);
          case "ascii":
            return P(this, f, g);
          case "latin1":
          case "binary":
            return Z(this, f, g);
          case "base64":
            return M(this, f, g);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ae(this, f, g);
          default:
            if (T)
              throw new TypeError("Unknown encoding: " + U);
            U = (U + "").toLowerCase(), T = !0;
        }
    }
    o.prototype._isBuffer = !0;
    function C(U, f, g) {
      var T = U[f];
      U[f] = U[g], U[g] = T;
    }
    o.prototype.swap16 = function() {
      var f = this.length;
      if (f % 2 !== 0)
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      for (var g = 0; g < f; g += 2)
        C(this, g, g + 1);
      return this;
    }, o.prototype.swap32 = function() {
      var f = this.length;
      if (f % 4 !== 0)
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      for (var g = 0; g < f; g += 4)
        C(this, g, g + 3), C(this, g + 1, g + 2);
      return this;
    }, o.prototype.swap64 = function() {
      var f = this.length;
      if (f % 8 !== 0)
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      for (var g = 0; g < f; g += 8)
        C(this, g, g + 7), C(this, g + 1, g + 6), C(this, g + 2, g + 5), C(this, g + 3, g + 4);
      return this;
    }, o.prototype.toString = function() {
      var f = this.length;
      return f === 0 ? "" : arguments.length === 0 ? D(this, 0, f) : E.apply(this, arguments);
    }, o.prototype.toLocaleString = o.prototype.toString, o.prototype.equals = function(f) {
      if (!o.isBuffer(f))
        throw new TypeError("Argument must be a Buffer");
      return this === f ? !0 : o.compare(this, f) === 0;
    }, o.prototype.inspect = function() {
      var f = "", g = e.INSPECT_MAX_BYTES;
      return f = this.toString("hex", 0, g).replace(/(.{2})/g, "$1 ").trim(), this.length > g && (f += " ... "), "<Buffer " + f + ">";
    }, r && (o.prototype[r] = o.prototype.inspect), o.prototype.compare = function(f, g, T, L, K) {
      if (oe(f, Uint8Array) && (f = o.from(f, f.offset, f.byteLength)), !o.isBuffer(f))
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof f
        );
      if (g === void 0 && (g = 0), T === void 0 && (T = f ? f.length : 0), L === void 0 && (L = 0), K === void 0 && (K = this.length), g < 0 || T > f.length || L < 0 || K > this.length)
        throw new RangeError("out of range index");
      if (L >= K && g >= T)
        return 0;
      if (L >= K)
        return -1;
      if (g >= T)
        return 1;
      if (g >>>= 0, T >>>= 0, L >>>= 0, K >>>= 0, this === f)
        return 0;
      for (var W = K - L, j = T - g, Y = Math.min(W, j), ee = this.slice(L, K), se = f.slice(g, T), he = 0; he < Y; ++he)
        if (ee[he] !== se[he]) {
          W = ee[he], j = se[he];
          break;
        }
      return W < j ? -1 : j < W ? 1 : 0;
    };
    function R(U, f, g, T, L) {
      if (U.length === 0)
        return -1;
      if (typeof g == "string" ? (T = g, g = 0) : g > 2147483647 ? g = 2147483647 : g < -2147483648 && (g = -2147483648), g = +g, m(g) && (g = L ? 0 : U.length - 1), g < 0 && (g = U.length + g), g >= U.length) {
        if (L)
          return -1;
        g = U.length - 1;
      } else if (g < 0)
        if (L)
          g = 0;
        else
          return -1;
      if (typeof f == "string" && (f = o.from(f, T)), o.isBuffer(f))
        return f.length === 0 ? -1 : I(U, f, g, T, L);
      if (typeof f == "number")
        return f = f & 255, typeof Uint8Array.prototype.indexOf == "function" ? L ? Uint8Array.prototype.indexOf.call(U, f, g) : Uint8Array.prototype.lastIndexOf.call(U, f, g) : I(U, [f], g, T, L);
      throw new TypeError("val must be string, number or Buffer");
    }
    function I(U, f, g, T, L) {
      var K = 1, W = U.length, j = f.length;
      if (T !== void 0 && (T = String(T).toLowerCase(), T === "ucs2" || T === "ucs-2" || T === "utf16le" || T === "utf-16le")) {
        if (U.length < 2 || f.length < 2)
          return -1;
        K = 2, W /= 2, j /= 2, g /= 2;
      }
      function Y(ve, be) {
        return K === 1 ? ve[be] : ve.readUInt16BE(be * K);
      }
      var ee;
      if (L) {
        var se = -1;
        for (ee = g; ee < W; ee++)
          if (Y(U, ee) === Y(f, se === -1 ? 0 : ee - se)) {
            if (se === -1 && (se = ee), ee - se + 1 === j)
              return se * K;
          } else
            se !== -1 && (ee -= ee - se), se = -1;
      } else
        for (g + j > W && (g = W - j), ee = g; ee >= 0; ee--) {
          for (var he = !0, fe = 0; fe < j; fe++)
            if (Y(U, ee + fe) !== Y(f, fe)) {
              he = !1;
              break;
            }
          if (he)
            return ee;
        }
      return -1;
    }
    o.prototype.includes = function(f, g, T) {
      return this.indexOf(f, g, T) !== -1;
    }, o.prototype.indexOf = function(f, g, T) {
      return R(this, f, g, T, !0);
    }, o.prototype.lastIndexOf = function(f, g, T) {
      return R(this, f, g, T, !1);
    };
    function q(U, f, g, T) {
      g = Number(g) || 0;
      var L = U.length - g;
      T ? (T = Number(T), T > L && (T = L)) : T = L;
      var K = f.length;
      T > K / 2 && (T = K / 2);
      for (var W = 0; W < T; ++W) {
        var j = parseInt(f.substr(W * 2, 2), 16);
        if (m(j))
          return W;
        U[g + W] = j;
      }
      return W;
    }
    function F(U, f, g, T) {
      return N(k(f, U.length - g), U, g, T);
    }
    function ie(U, f, g, T) {
      return N(ne(f), U, g, T);
    }
    function ce(U, f, g, T) {
      return N(V(f), U, g, T);
    }
    function S(U, f, g, T) {
      return N(te(f, U.length - g), U, g, T);
    }
    o.prototype.write = function(f, g, T, L) {
      if (g === void 0)
        L = "utf8", T = this.length, g = 0;
      else if (T === void 0 && typeof g == "string")
        L = g, T = this.length, g = 0;
      else if (isFinite(g))
        g = g >>> 0, isFinite(T) ? (T = T >>> 0, L === void 0 && (L = "utf8")) : (L = T, T = void 0);
      else
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      var K = this.length - g;
      if ((T === void 0 || T > K) && (T = K), f.length > 0 && (T < 0 || g < 0) || g > this.length)
        throw new RangeError("Attempt to write outside buffer bounds");
      L || (L = "utf8");
      for (var W = !1; ; )
        switch (L) {
          case "hex":
            return q(this, f, g, T);
          case "utf8":
          case "utf-8":
            return F(this, f, g, T);
          case "ascii":
          case "latin1":
          case "binary":
            return ie(this, f, g, T);
          case "base64":
            return ce(this, f, g, T);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return S(this, f, g, T);
          default:
            if (W)
              throw new TypeError("Unknown encoding: " + L);
            L = ("" + L).toLowerCase(), W = !0;
        }
    }, o.prototype.toJSON = function() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function M(U, f, g) {
      return f === 0 && g === U.length ? t.fromByteArray(U) : t.fromByteArray(U.slice(f, g));
    }
    function D(U, f, g) {
      g = Math.min(U.length, g);
      for (var T = [], L = f; L < g; ) {
        var K = U[L], W = null, j = K > 239 ? 4 : K > 223 ? 3 : K > 191 ? 2 : 1;
        if (L + j <= g) {
          var Y, ee, se, he;
          switch (j) {
            case 1:
              K < 128 && (W = K);
              break;
            case 2:
              Y = U[L + 1], (Y & 192) === 128 && (he = (K & 31) << 6 | Y & 63, he > 127 && (W = he));
              break;
            case 3:
              Y = U[L + 1], ee = U[L + 2], (Y & 192) === 128 && (ee & 192) === 128 && (he = (K & 15) << 12 | (Y & 63) << 6 | ee & 63, he > 2047 && (he < 55296 || he > 57343) && (W = he));
              break;
            case 4:
              Y = U[L + 1], ee = U[L + 2], se = U[L + 3], (Y & 192) === 128 && (ee & 192) === 128 && (se & 192) === 128 && (he = (K & 15) << 18 | (Y & 63) << 12 | (ee & 63) << 6 | se & 63, he > 65535 && he < 1114112 && (W = he));
          }
        }
        W === null ? (W = 65533, j = 1) : W > 65535 && (W -= 65536, T.push(W >>> 10 & 1023 | 55296), W = 56320 | W & 1023), T.push(W), L += j;
      }
      return H(T);
    }
    var X = 4096;
    function H(U) {
      var f = U.length;
      if (f <= X)
        return String.fromCharCode.apply(String, U);
      for (var g = "", T = 0; T < f; )
        g += String.fromCharCode.apply(
          String,
          U.slice(T, T += X)
        );
      return g;
    }
    function P(U, f, g) {
      var T = "";
      g = Math.min(U.length, g);
      for (var L = f; L < g; ++L)
        T += String.fromCharCode(U[L] & 127);
      return T;
    }
    function Z(U, f, g) {
      var T = "";
      g = Math.min(U.length, g);
      for (var L = f; L < g; ++L)
        T += String.fromCharCode(U[L]);
      return T;
    }
    function z(U, f, g) {
      var T = U.length;
      (!f || f < 0) && (f = 0), (!g || g < 0 || g > T) && (g = T);
      for (var L = "", K = f; K < g; ++K)
        L += $[U[K]];
      return L;
    }
    function ae(U, f, g) {
      for (var T = U.slice(f, g), L = "", K = 0; K < T.length - 1; K += 2)
        L += String.fromCharCode(T[K] + T[K + 1] * 256);
      return L;
    }
    o.prototype.slice = function(f, g) {
      var T = this.length;
      f = ~~f, g = g === void 0 ? T : ~~g, f < 0 ? (f += T, f < 0 && (f = 0)) : f > T && (f = T), g < 0 ? (g += T, g < 0 && (g = 0)) : g > T && (g = T), g < f && (g = f);
      var L = this.subarray(f, g);
      return Object.setPrototypeOf(L, o.prototype), L;
    };
    function O(U, f, g) {
      if (U % 1 !== 0 || U < 0)
        throw new RangeError("offset is not uint");
      if (U + f > g)
        throw new RangeError("Trying to access beyond buffer length");
    }
    o.prototype.readUintLE = o.prototype.readUIntLE = function(f, g, T) {
      f = f >>> 0, g = g >>> 0, T || O(f, g, this.length);
      for (var L = this[f], K = 1, W = 0; ++W < g && (K *= 256); )
        L += this[f + W] * K;
      return L;
    }, o.prototype.readUintBE = o.prototype.readUIntBE = function(f, g, T) {
      f = f >>> 0, g = g >>> 0, T || O(f, g, this.length);
      for (var L = this[f + --g], K = 1; g > 0 && (K *= 256); )
        L += this[f + --g] * K;
      return L;
    }, o.prototype.readUint8 = o.prototype.readUInt8 = function(f, g) {
      return f = f >>> 0, g || O(f, 1, this.length), this[f];
    }, o.prototype.readUint16LE = o.prototype.readUInt16LE = function(f, g) {
      return f = f >>> 0, g || O(f, 2, this.length), this[f] | this[f + 1] << 8;
    }, o.prototype.readUint16BE = o.prototype.readUInt16BE = function(f, g) {
      return f = f >>> 0, g || O(f, 2, this.length), this[f] << 8 | this[f + 1];
    }, o.prototype.readUint32LE = o.prototype.readUInt32LE = function(f, g) {
      return f = f >>> 0, g || O(f, 4, this.length), (this[f] | this[f + 1] << 8 | this[f + 2] << 16) + this[f + 3] * 16777216;
    }, o.prototype.readUint32BE = o.prototype.readUInt32BE = function(f, g) {
      return f = f >>> 0, g || O(f, 4, this.length), this[f] * 16777216 + (this[f + 1] << 16 | this[f + 2] << 8 | this[f + 3]);
    }, o.prototype.readIntLE = function(f, g, T) {
      f = f >>> 0, g = g >>> 0, T || O(f, g, this.length);
      for (var L = this[f], K = 1, W = 0; ++W < g && (K *= 256); )
        L += this[f + W] * K;
      return K *= 128, L >= K && (L -= Math.pow(2, 8 * g)), L;
    }, o.prototype.readIntBE = function(f, g, T) {
      f = f >>> 0, g = g >>> 0, T || O(f, g, this.length);
      for (var L = g, K = 1, W = this[f + --L]; L > 0 && (K *= 256); )
        W += this[f + --L] * K;
      return K *= 128, W >= K && (W -= Math.pow(2, 8 * g)), W;
    }, o.prototype.readInt8 = function(f, g) {
      return f = f >>> 0, g || O(f, 1, this.length), this[f] & 128 ? (255 - this[f] + 1) * -1 : this[f];
    }, o.prototype.readInt16LE = function(f, g) {
      f = f >>> 0, g || O(f, 2, this.length);
      var T = this[f] | this[f + 1] << 8;
      return T & 32768 ? T | 4294901760 : T;
    }, o.prototype.readInt16BE = function(f, g) {
      f = f >>> 0, g || O(f, 2, this.length);
      var T = this[f + 1] | this[f] << 8;
      return T & 32768 ? T | 4294901760 : T;
    }, o.prototype.readInt32LE = function(f, g) {
      return f = f >>> 0, g || O(f, 4, this.length), this[f] | this[f + 1] << 8 | this[f + 2] << 16 | this[f + 3] << 24;
    }, o.prototype.readInt32BE = function(f, g) {
      return f = f >>> 0, g || O(f, 4, this.length), this[f] << 24 | this[f + 1] << 16 | this[f + 2] << 8 | this[f + 3];
    }, o.prototype.readFloatLE = function(f, g) {
      return f = f >>> 0, g || O(f, 4, this.length), n.read(this, f, !0, 23, 4);
    }, o.prototype.readFloatBE = function(f, g) {
      return f = f >>> 0, g || O(f, 4, this.length), n.read(this, f, !1, 23, 4);
    }, o.prototype.readDoubleLE = function(f, g) {
      return f = f >>> 0, g || O(f, 8, this.length), n.read(this, f, !0, 52, 8);
    }, o.prototype.readDoubleBE = function(f, g) {
      return f = f >>> 0, g || O(f, 8, this.length), n.read(this, f, !1, 52, 8);
    };
    function A(U, f, g, T, L, K) {
      if (!o.isBuffer(U))
        throw new TypeError('"buffer" argument must be a Buffer instance');
      if (f > L || f < K)
        throw new RangeError('"value" argument is out of bounds');
      if (g + T > U.length)
        throw new RangeError("Index out of range");
    }
    o.prototype.writeUintLE = o.prototype.writeUIntLE = function(f, g, T, L) {
      if (f = +f, g = g >>> 0, T = T >>> 0, !L) {
        var K = Math.pow(2, 8 * T) - 1;
        A(this, f, g, T, K, 0);
      }
      var W = 1, j = 0;
      for (this[g] = f & 255; ++j < T && (W *= 256); )
        this[g + j] = f / W & 255;
      return g + T;
    }, o.prototype.writeUintBE = o.prototype.writeUIntBE = function(f, g, T, L) {
      if (f = +f, g = g >>> 0, T = T >>> 0, !L) {
        var K = Math.pow(2, 8 * T) - 1;
        A(this, f, g, T, K, 0);
      }
      var W = T - 1, j = 1;
      for (this[g + W] = f & 255; --W >= 0 && (j *= 256); )
        this[g + W] = f / j & 255;
      return g + T;
    }, o.prototype.writeUint8 = o.prototype.writeUInt8 = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 1, 255, 0), this[g] = f & 255, g + 1;
    }, o.prototype.writeUint16LE = o.prototype.writeUInt16LE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 2, 65535, 0), this[g] = f & 255, this[g + 1] = f >>> 8, g + 2;
    }, o.prototype.writeUint16BE = o.prototype.writeUInt16BE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 2, 65535, 0), this[g] = f >>> 8, this[g + 1] = f & 255, g + 2;
    }, o.prototype.writeUint32LE = o.prototype.writeUInt32LE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 4, 4294967295, 0), this[g + 3] = f >>> 24, this[g + 2] = f >>> 16, this[g + 1] = f >>> 8, this[g] = f & 255, g + 4;
    }, o.prototype.writeUint32BE = o.prototype.writeUInt32BE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 4, 4294967295, 0), this[g] = f >>> 24, this[g + 1] = f >>> 16, this[g + 2] = f >>> 8, this[g + 3] = f & 255, g + 4;
    }, o.prototype.writeIntLE = function(f, g, T, L) {
      if (f = +f, g = g >>> 0, !L) {
        var K = Math.pow(2, 8 * T - 1);
        A(this, f, g, T, K - 1, -K);
      }
      var W = 0, j = 1, Y = 0;
      for (this[g] = f & 255; ++W < T && (j *= 256); )
        f < 0 && Y === 0 && this[g + W - 1] !== 0 && (Y = 1), this[g + W] = (f / j >> 0) - Y & 255;
      return g + T;
    }, o.prototype.writeIntBE = function(f, g, T, L) {
      if (f = +f, g = g >>> 0, !L) {
        var K = Math.pow(2, 8 * T - 1);
        A(this, f, g, T, K - 1, -K);
      }
      var W = T - 1, j = 1, Y = 0;
      for (this[g + W] = f & 255; --W >= 0 && (j *= 256); )
        f < 0 && Y === 0 && this[g + W + 1] !== 0 && (Y = 1), this[g + W] = (f / j >> 0) - Y & 255;
      return g + T;
    }, o.prototype.writeInt8 = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 1, 127, -128), f < 0 && (f = 255 + f + 1), this[g] = f & 255, g + 1;
    }, o.prototype.writeInt16LE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 2, 32767, -32768), this[g] = f & 255, this[g + 1] = f >>> 8, g + 2;
    }, o.prototype.writeInt16BE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 2, 32767, -32768), this[g] = f >>> 8, this[g + 1] = f & 255, g + 2;
    }, o.prototype.writeInt32LE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 4, 2147483647, -2147483648), this[g] = f & 255, this[g + 1] = f >>> 8, this[g + 2] = f >>> 16, this[g + 3] = f >>> 24, g + 4;
    }, o.prototype.writeInt32BE = function(f, g, T) {
      return f = +f, g = g >>> 0, T || A(this, f, g, 4, 2147483647, -2147483648), f < 0 && (f = 4294967295 + f + 1), this[g] = f >>> 24, this[g + 1] = f >>> 16, this[g + 2] = f >>> 8, this[g + 3] = f & 255, g + 4;
    };
    function G(U, f, g, T, L, K) {
      if (g + T > U.length)
        throw new RangeError("Index out of range");
      if (g < 0)
        throw new RangeError("Index out of range");
    }
    function J(U, f, g, T, L) {
      return f = +f, g = g >>> 0, L || G(U, f, g, 4), n.write(U, f, g, T, 23, 4), g + 4;
    }
    o.prototype.writeFloatLE = function(f, g, T) {
      return J(this, f, g, !0, T);
    }, o.prototype.writeFloatBE = function(f, g, T) {
      return J(this, f, g, !1, T);
    };
    function re(U, f, g, T, L) {
      return f = +f, g = g >>> 0, L || G(U, f, g, 8), n.write(U, f, g, T, 52, 8), g + 8;
    }
    o.prototype.writeDoubleLE = function(f, g, T) {
      return re(this, f, g, !0, T);
    }, o.prototype.writeDoubleBE = function(f, g, T) {
      return re(this, f, g, !1, T);
    }, o.prototype.copy = function(f, g, T, L) {
      if (!o.isBuffer(f))
        throw new TypeError("argument should be a Buffer");
      if (T || (T = 0), !L && L !== 0 && (L = this.length), g >= f.length && (g = f.length), g || (g = 0), L > 0 && L < T && (L = T), L === T || f.length === 0 || this.length === 0)
        return 0;
      if (g < 0)
        throw new RangeError("targetStart out of bounds");
      if (T < 0 || T >= this.length)
        throw new RangeError("Index out of range");
      if (L < 0)
        throw new RangeError("sourceEnd out of bounds");
      L > this.length && (L = this.length), f.length - g < L - T && (L = f.length - g + T);
      var K = L - T;
      return this === f && typeof Uint8Array.prototype.copyWithin == "function" ? this.copyWithin(g, T, L) : Uint8Array.prototype.set.call(
        f,
        this.subarray(T, L),
        g
      ), K;
    }, o.prototype.fill = function(f, g, T, L) {
      if (typeof f == "string") {
        if (typeof g == "string" ? (L = g, g = 0, T = this.length) : typeof T == "string" && (L = T, T = this.length), L !== void 0 && typeof L != "string")
          throw new TypeError("encoding must be a string");
        if (typeof L == "string" && !o.isEncoding(L))
          throw new TypeError("Unknown encoding: " + L);
        if (f.length === 1) {
          var K = f.charCodeAt(0);
          (L === "utf8" && K < 128 || L === "latin1") && (f = K);
        }
      } else
        typeof f == "number" ? f = f & 255 : typeof f == "boolean" && (f = Number(f));
      if (g < 0 || this.length < g || this.length < T)
        throw new RangeError("Out of range index");
      if (T <= g)
        return this;
      g = g >>> 0, T = T === void 0 ? this.length : T >>> 0, f || (f = 0);
      var W;
      if (typeof f == "number")
        for (W = g; W < T; ++W)
          this[W] = f;
      else {
        var j = o.isBuffer(f) ? f : o.from(f, L), Y = j.length;
        if (Y === 0)
          throw new TypeError('The value "' + f + '" is invalid for argument "value"');
        for (W = 0; W < T - g; ++W)
          this[W + g] = j[W % Y];
      }
      return this;
    };
    var Q = /[^+/0-9A-Za-z-_]/g;
    function B(U) {
      if (U = U.split("=")[0], U = U.trim().replace(Q, ""), U.length < 2)
        return "";
      for (; U.length % 4 !== 0; )
        U = U + "=";
      return U;
    }
    function k(U, f) {
      f = f || 1 / 0;
      for (var g, T = U.length, L = null, K = [], W = 0; W < T; ++W) {
        if (g = U.charCodeAt(W), g > 55295 && g < 57344) {
          if (!L) {
            if (g > 56319) {
              (f -= 3) > -1 && K.push(239, 191, 189);
              continue;
            } else if (W + 1 === T) {
              (f -= 3) > -1 && K.push(239, 191, 189);
              continue;
            }
            L = g;
            continue;
          }
          if (g < 56320) {
            (f -= 3) > -1 && K.push(239, 191, 189), L = g;
            continue;
          }
          g = (L - 55296 << 10 | g - 56320) + 65536;
        } else
          L && (f -= 3) > -1 && K.push(239, 191, 189);
        if (L = null, g < 128) {
          if ((f -= 1) < 0)
            break;
          K.push(g);
        } else if (g < 2048) {
          if ((f -= 2) < 0)
            break;
          K.push(
            g >> 6 | 192,
            g & 63 | 128
          );
        } else if (g < 65536) {
          if ((f -= 3) < 0)
            break;
          K.push(
            g >> 12 | 224,
            g >> 6 & 63 | 128,
            g & 63 | 128
          );
        } else if (g < 1114112) {
          if ((f -= 4) < 0)
            break;
          K.push(
            g >> 18 | 240,
            g >> 12 & 63 | 128,
            g >> 6 & 63 | 128,
            g & 63 | 128
          );
        } else
          throw new Error("Invalid code point");
      }
      return K;
    }
    function ne(U) {
      for (var f = [], g = 0; g < U.length; ++g)
        f.push(U.charCodeAt(g) & 255);
      return f;
    }
    function te(U, f) {
      for (var g, T, L, K = [], W = 0; W < U.length && !((f -= 2) < 0); ++W)
        g = U.charCodeAt(W), T = g >> 8, L = g % 256, K.push(L), K.push(T);
      return K;
    }
    function V(U) {
      return t.toByteArray(B(U));
    }
    function N(U, f, g, T) {
      for (var L = 0; L < T && !(L + g >= f.length || L >= U.length); ++L)
        f[L + g] = U[L];
      return L;
    }
    function oe(U, f) {
      return U instanceof f || U != null && U.constructor != null && U.constructor.name != null && U.constructor.name === f.name;
    }
    function m(U) {
      return U !== U;
    }
    var $ = function() {
      for (var U = "0123456789abcdef", f = new Array(256), g = 0; g < 16; ++g)
        for (var T = g * 16, L = 0; L < 16; ++L)
          f[T + L] = U[g] + U[L];
      return f;
    }();
  }(ho)), ho;
}
var fo = {}, po = {}, go, Fl;
function np() {
  return Fl || (Fl = 1, go = function() {
    if (typeof Symbol != "function" || typeof Object.getOwnPropertySymbols != "function")
      return !1;
    if (typeof Symbol.iterator == "symbol")
      return !0;
    var t = {}, n = Symbol("test"), r = Object(n);
    if (typeof n == "string" || Object.prototype.toString.call(n) !== "[object Symbol]" || Object.prototype.toString.call(r) !== "[object Symbol]")
      return !1;
    var i = 42;
    t[n] = i;
    for (n in t)
      return !1;
    if (typeof Object.keys == "function" && Object.keys(t).length !== 0 || typeof Object.getOwnPropertyNames == "function" && Object.getOwnPropertyNames(t).length !== 0)
      return !1;
    var a = Object.getOwnPropertySymbols(t);
    if (a.length !== 1 || a[0] !== n || !Object.prototype.propertyIsEnumerable.call(t, n))
      return !1;
    if (typeof Object.getOwnPropertyDescriptor == "function") {
      var s = Object.getOwnPropertyDescriptor(t, n);
      if (s.value !== i || s.enumerable !== !0)
        return !1;
    }
    return !0;
  }), go;
}
var mo, kl;
function Pc() {
  if (kl)
    return mo;
  kl = 1;
  var e = np();
  return mo = function() {
    return e() && !!Symbol.toStringTag;
  }, mo;
}
var yo, Bl;
function Yy() {
  if (Bl)
    return yo;
  Bl = 1;
  var e = typeof Symbol < "u" && Symbol, t = np();
  return yo = function() {
    return typeof e != "function" || typeof Symbol != "function" || typeof e("foo") != "symbol" || typeof Symbol("bar") != "symbol" ? !1 : t();
  }, yo;
}
var bo, Rl;
function Jy() {
  if (Rl)
    return bo;
  Rl = 1;
  var e = {
    foo: {}
  }, t = Object;
  return bo = function() {
    return { __proto__: e }.foo === e.foo && !({ __proto__: null } instanceof t);
  }, bo;
}
var vo, Il;
function Qy() {
  if (Il)
    return vo;
  Il = 1;
  var e = "Function.prototype.bind called on incompatible ", t = Object.prototype.toString, n = Math.max, r = "[object Function]", i = function(c, u) {
    for (var h = [], y = 0; y < c.length; y += 1)
      h[y] = c[y];
    for (var w = 0; w < u.length; w += 1)
      h[w + c.length] = u[w];
    return h;
  }, a = function(c, u) {
    for (var h = [], y = u || 0, w = 0; y < c.length; y += 1, w += 1)
      h[w] = c[y];
    return h;
  }, s = function(o, c) {
    for (var u = "", h = 0; h < o.length; h += 1)
      u += o[h], h + 1 < o.length && (u += c);
    return u;
  };
  return vo = function(c) {
    var u = this;
    if (typeof u != "function" || t.apply(u) !== r)
      throw new TypeError(e + u);
    for (var h = a(arguments, 1), y, w = function() {
      if (this instanceof y) {
        var l = u.apply(
          this,
          i(h, arguments)
        );
        return Object(l) === l ? l : this;
      }
      return u.apply(
        c,
        i(h, arguments)
      );
    }, p = n(0, u.length - h.length), x = [], d = 0; d < p; d++)
      x[d] = "$" + d;
    if (y = Function("binder", "return function (" + s(x, ",") + "){ return binder.apply(this,arguments); }")(w), u.prototype) {
      var v = function() {
      };
      v.prototype = u.prototype, y.prototype = new v(), v.prototype = null;
    }
    return y;
  }, vo;
}
var wo, Nl;
function Mc() {
  if (Nl)
    return wo;
  Nl = 1;
  var e = Qy();
  return wo = Function.prototype.bind || e, wo;
}
var xo, Ol;
function eb() {
  if (Ol)
    return xo;
  Ol = 1;
  var e = Function.prototype.call, t = Object.prototype.hasOwnProperty, n = Mc();
  return xo = n.call(e, t), xo;
}
var Do, Wl;
function Tr() {
  if (Wl)
    return Do;
  Wl = 1;
  var e, t = SyntaxError, n = Function, r = TypeError, i = function(S) {
    try {
      return n('"use strict"; return (' + S + ").constructor;")();
    } catch {
    }
  }, a = Object.getOwnPropertyDescriptor;
  if (a)
    try {
      a({}, "");
    } catch {
      a = null;
    }
  var s = function() {
    throw new r();
  }, o = a ? function() {
    try {
      return arguments.callee, s;
    } catch {
      try {
        return a(arguments, "callee").get;
      } catch {
        return s;
      }
    }
  }() : s, c = Yy()(), u = Jy()(), h = Object.getPrototypeOf || (u ? function(S) {
    return S.__proto__;
  } : null), y = {}, w = typeof Uint8Array > "u" || !h ? e : h(Uint8Array), p = {
    "%AggregateError%": typeof AggregateError > "u" ? e : AggregateError,
    "%Array%": Array,
    "%ArrayBuffer%": typeof ArrayBuffer > "u" ? e : ArrayBuffer,
    "%ArrayIteratorPrototype%": c && h ? h([][Symbol.iterator]()) : e,
    "%AsyncFromSyncIteratorPrototype%": e,
    "%AsyncFunction%": y,
    "%AsyncGenerator%": y,
    "%AsyncGeneratorFunction%": y,
    "%AsyncIteratorPrototype%": y,
    "%Atomics%": typeof Atomics > "u" ? e : Atomics,
    "%BigInt%": typeof BigInt > "u" ? e : BigInt,
    "%BigInt64Array%": typeof BigInt64Array > "u" ? e : BigInt64Array,
    "%BigUint64Array%": typeof BigUint64Array > "u" ? e : BigUint64Array,
    "%Boolean%": Boolean,
    "%DataView%": typeof DataView > "u" ? e : DataView,
    "%Date%": Date,
    "%decodeURI%": decodeURI,
    "%decodeURIComponent%": decodeURIComponent,
    "%encodeURI%": encodeURI,
    "%encodeURIComponent%": encodeURIComponent,
    "%Error%": Error,
    "%eval%": eval,
    // eslint-disable-line no-eval
    "%EvalError%": EvalError,
    "%Float32Array%": typeof Float32Array > "u" ? e : Float32Array,
    "%Float64Array%": typeof Float64Array > "u" ? e : Float64Array,
    "%FinalizationRegistry%": typeof FinalizationRegistry > "u" ? e : FinalizationRegistry,
    "%Function%": n,
    "%GeneratorFunction%": y,
    "%Int8Array%": typeof Int8Array > "u" ? e : Int8Array,
    "%Int16Array%": typeof Int16Array > "u" ? e : Int16Array,
    "%Int32Array%": typeof Int32Array > "u" ? e : Int32Array,
    "%isFinite%": isFinite,
    "%isNaN%": isNaN,
    "%IteratorPrototype%": c && h ? h(h([][Symbol.iterator]())) : e,
    "%JSON%": typeof JSON == "object" ? JSON : e,
    "%Map%": typeof Map > "u" ? e : Map,
    "%MapIteratorPrototype%": typeof Map > "u" || !c || !h ? e : h((/* @__PURE__ */ new Map())[Symbol.iterator]()),
    "%Math%": Math,
    "%Number%": Number,
    "%Object%": Object,
    "%parseFloat%": parseFloat,
    "%parseInt%": parseInt,
    "%Promise%": typeof Promise > "u" ? e : Promise,
    "%Proxy%": typeof Proxy > "u" ? e : Proxy,
    "%RangeError%": RangeError,
    "%ReferenceError%": ReferenceError,
    "%Reflect%": typeof Reflect > "u" ? e : Reflect,
    "%RegExp%": RegExp,
    "%Set%": typeof Set > "u" ? e : Set,
    "%SetIteratorPrototype%": typeof Set > "u" || !c || !h ? e : h((/* @__PURE__ */ new Set())[Symbol.iterator]()),
    "%SharedArrayBuffer%": typeof SharedArrayBuffer > "u" ? e : SharedArrayBuffer,
    "%String%": String,
    "%StringIteratorPrototype%": c && h ? h(""[Symbol.iterator]()) : e,
    "%Symbol%": c ? Symbol : e,
    "%SyntaxError%": t,
    "%ThrowTypeError%": o,
    "%TypedArray%": w,
    "%TypeError%": r,
    "%Uint8Array%": typeof Uint8Array > "u" ? e : Uint8Array,
    "%Uint8ClampedArray%": typeof Uint8ClampedArray > "u" ? e : Uint8ClampedArray,
    "%Uint16Array%": typeof Uint16Array > "u" ? e : Uint16Array,
    "%Uint32Array%": typeof Uint32Array > "u" ? e : Uint32Array,
    "%URIError%": URIError,
    "%WeakMap%": typeof WeakMap > "u" ? e : WeakMap,
    "%WeakRef%": typeof WeakRef > "u" ? e : WeakRef,
    "%WeakSet%": typeof WeakSet > "u" ? e : WeakSet
  };
  if (h)
    try {
      null.error;
    } catch (S) {
      var x = h(h(S));
      p["%Error.prototype%"] = x;
    }
  var d = function S(M) {
    var D;
    if (M === "%AsyncFunction%")
      D = i("async function () {}");
    else if (M === "%GeneratorFunction%")
      D = i("function* () {}");
    else if (M === "%AsyncGeneratorFunction%")
      D = i("async function* () {}");
    else if (M === "%AsyncGenerator%") {
      var X = S("%AsyncGeneratorFunction%");
      X && (D = X.prototype);
    } else if (M === "%AsyncIteratorPrototype%") {
      var H = S("%AsyncGenerator%");
      H && h && (D = h(H.prototype));
    }
    return p[M] = D, D;
  }, v = {
    "%ArrayBufferPrototype%": ["ArrayBuffer", "prototype"],
    "%ArrayPrototype%": ["Array", "prototype"],
    "%ArrayProto_entries%": ["Array", "prototype", "entries"],
    "%ArrayProto_forEach%": ["Array", "prototype", "forEach"],
    "%ArrayProto_keys%": ["Array", "prototype", "keys"],
    "%ArrayProto_values%": ["Array", "prototype", "values"],
    "%AsyncFunctionPrototype%": ["AsyncFunction", "prototype"],
    "%AsyncGenerator%": ["AsyncGeneratorFunction", "prototype"],
    "%AsyncGeneratorPrototype%": ["AsyncGeneratorFunction", "prototype", "prototype"],
    "%BooleanPrototype%": ["Boolean", "prototype"],
    "%DataViewPrototype%": ["DataView", "prototype"],
    "%DatePrototype%": ["Date", "prototype"],
    "%ErrorPrototype%": ["Error", "prototype"],
    "%EvalErrorPrototype%": ["EvalError", "prototype"],
    "%Float32ArrayPrototype%": ["Float32Array", "prototype"],
    "%Float64ArrayPrototype%": ["Float64Array", "prototype"],
    "%FunctionPrototype%": ["Function", "prototype"],
    "%Generator%": ["GeneratorFunction", "prototype"],
    "%GeneratorPrototype%": ["GeneratorFunction", "prototype", "prototype"],
    "%Int8ArrayPrototype%": ["Int8Array", "prototype"],
    "%Int16ArrayPrototype%": ["Int16Array", "prototype"],
    "%Int32ArrayPrototype%": ["Int32Array", "prototype"],
    "%JSONParse%": ["JSON", "parse"],
    "%JSONStringify%": ["JSON", "stringify"],
    "%MapPrototype%": ["Map", "prototype"],
    "%NumberPrototype%": ["Number", "prototype"],
    "%ObjectPrototype%": ["Object", "prototype"],
    "%ObjProto_toString%": ["Object", "prototype", "toString"],
    "%ObjProto_valueOf%": ["Object", "prototype", "valueOf"],
    "%PromisePrototype%": ["Promise", "prototype"],
    "%PromiseProto_then%": ["Promise", "prototype", "then"],
    "%Promise_all%": ["Promise", "all"],
    "%Promise_reject%": ["Promise", "reject"],
    "%Promise_resolve%": ["Promise", "resolve"],
    "%RangeErrorPrototype%": ["RangeError", "prototype"],
    "%ReferenceErrorPrototype%": ["ReferenceError", "prototype"],
    "%RegExpPrototype%": ["RegExp", "prototype"],
    "%SetPrototype%": ["Set", "prototype"],
    "%SharedArrayBufferPrototype%": ["SharedArrayBuffer", "prototype"],
    "%StringPrototype%": ["String", "prototype"],
    "%SymbolPrototype%": ["Symbol", "prototype"],
    "%SyntaxErrorPrototype%": ["SyntaxError", "prototype"],
    "%TypedArrayPrototype%": ["TypedArray", "prototype"],
    "%TypeErrorPrototype%": ["TypeError", "prototype"],
    "%Uint8ArrayPrototype%": ["Uint8Array", "prototype"],
    "%Uint8ClampedArrayPrototype%": ["Uint8ClampedArray", "prototype"],
    "%Uint16ArrayPrototype%": ["Uint16Array", "prototype"],
    "%Uint32ArrayPrototype%": ["Uint32Array", "prototype"],
    "%URIErrorPrototype%": ["URIError", "prototype"],
    "%WeakMapPrototype%": ["WeakMap", "prototype"],
    "%WeakSetPrototype%": ["WeakSet", "prototype"]
  }, l = Mc(), b = eb(), _ = l.call(Function.call, Array.prototype.concat), E = l.call(Function.apply, Array.prototype.splice), C = l.call(Function.call, String.prototype.replace), R = l.call(Function.call, String.prototype.slice), I = l.call(Function.call, RegExp.prototype.exec), q = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g, F = /\\(\\)?/g, ie = function(M) {
    var D = R(M, 0, 1), X = R(M, -1);
    if (D === "%" && X !== "%")
      throw new t("invalid intrinsic syntax, expected closing `%`");
    if (X === "%" && D !== "%")
      throw new t("invalid intrinsic syntax, expected opening `%`");
    var H = [];
    return C(M, q, function(P, Z, z, ae) {
      H[H.length] = z ? C(ae, F, "$1") : Z || P;
    }), H;
  }, ce = function(M, D) {
    var X = M, H;
    if (b(v, X) && (H = v[X], X = "%" + H[0] + "%"), b(p, X)) {
      var P = p[X];
      if (P === y && (P = d(X)), typeof P > "u" && !D)
        throw new r("intrinsic " + M + " exists, but is not available. Please file an issue!");
      return {
        alias: H,
        name: X,
        value: P
      };
    }
    throw new t("intrinsic " + M + " does not exist!");
  };
  return Do = function(M, D) {
    if (typeof M != "string" || M.length === 0)
      throw new r("intrinsic name must be a non-empty string");
    if (arguments.length > 1 && typeof D != "boolean")
      throw new r('"allowMissing" argument must be a boolean');
    if (I(/^%?[^%]*%?$/, M) === null)
      throw new t("`%` may not be present anywhere but at the beginning and end of the intrinsic name");
    var X = ie(M), H = X.length > 0 ? X[0] : "", P = ce("%" + H + "%", D), Z = P.name, z = P.value, ae = !1, O = P.alias;
    O && (H = O[0], E(X, _([0, 1], O)));
    for (var A = 1, G = !0; A < X.length; A += 1) {
      var J = X[A], re = R(J, 0, 1), Q = R(J, -1);
      if ((re === '"' || re === "'" || re === "`" || Q === '"' || Q === "'" || Q === "`") && re !== Q)
        throw new t("property names with quotes must have matching quotes");
      if ((J === "constructor" || !G) && (ae = !0), H += "." + J, Z = "%" + H + "%", b(p, Z))
        z = p[Z];
      else if (z != null) {
        if (!(J in z)) {
          if (!D)
            throw new r("base intrinsic for " + M + " exists, but the property is not available.");
          return;
        }
        if (a && A + 1 >= X.length) {
          var B = a(z, J);
          G = !!B, G && "get" in B && !("originalValue" in B.get) ? z = B.get : z = z[J];
        } else
          G = b(z, J), z = z[J];
        G && !ae && (p[Z] = z);
      }
    }
    return z;
  }, Do;
}
var _o = { exports: {} }, To, Ll;
function rp() {
  if (Ll)
    return To;
  Ll = 1;
  var e = Tr(), t = e("%Object.defineProperty%", !0), n = function() {
    if (t)
      try {
        return t({}, "a", { value: 1 }), !0;
      } catch {
        return !1;
      }
    return !1;
  };
  return n.hasArrayLengthDefineBug = function() {
    if (!n())
      return null;
    try {
      return t([], "length", { value: 1 }).length !== 1;
    } catch {
      return !0;
    }
  }, To = n, To;
}
var Eo, Pl;
function zc() {
  if (Pl)
    return Eo;
  Pl = 1;
  var e = Tr(), t = e("%Object.getOwnPropertyDescriptor%", !0);
  if (t)
    try {
      t([], "length");
    } catch {
      t = null;
    }
  return Eo = t, Eo;
}
var Ao, Ml;
function tb() {
  if (Ml)
    return Ao;
  Ml = 1;
  var e = rp()(), t = Tr(), n = e && t("%Object.defineProperty%", !0);
  if (n)
    try {
      n({}, "a", { value: 1 });
    } catch {
      n = !1;
    }
  var r = t("%SyntaxError%"), i = t("%TypeError%"), a = zc();
  return Ao = function(o, c, u) {
    if (!o || typeof o != "object" && typeof o != "function")
      throw new i("`obj` must be an object or a function`");
    if (typeof c != "string" && typeof c != "symbol")
      throw new i("`property` must be a string or a symbol`");
    if (arguments.length > 3 && typeof arguments[3] != "boolean" && arguments[3] !== null)
      throw new i("`nonEnumerable`, if provided, must be a boolean or null");
    if (arguments.length > 4 && typeof arguments[4] != "boolean" && arguments[4] !== null)
      throw new i("`nonWritable`, if provided, must be a boolean or null");
    if (arguments.length > 5 && typeof arguments[5] != "boolean" && arguments[5] !== null)
      throw new i("`nonConfigurable`, if provided, must be a boolean or null");
    if (arguments.length > 6 && typeof arguments[6] != "boolean")
      throw new i("`loose`, if provided, must be a boolean");
    var h = arguments.length > 3 ? arguments[3] : null, y = arguments.length > 4 ? arguments[4] : null, w = arguments.length > 5 ? arguments[5] : null, p = arguments.length > 6 ? arguments[6] : !1, x = !!a && a(o, c);
    if (n)
      n(o, c, {
        configurable: w === null && x ? x.configurable : !w,
        enumerable: h === null && x ? x.enumerable : !h,
        value: u,
        writable: y === null && x ? x.writable : !y
      });
    else if (p || !h && !y && !w)
      o[c] = u;
    else
      throw new r("This environment does not support defining a property as non-configurable, non-writable, or non-enumerable.");
  }, Ao;
}
var Uo, zl;
function nb() {
  if (zl)
    return Uo;
  zl = 1;
  var e = Tr(), t = tb(), n = rp()(), r = zc(), i = e("%TypeError%"), a = e("%Math.floor%");
  return Uo = function(o, c) {
    if (typeof o != "function")
      throw new i("`fn` is not a function");
    if (typeof c != "number" || c < 0 || c > 4294967295 || a(c) !== c)
      throw new i("`length` must be a positive 32-bit integer");
    var u = arguments.length > 2 && !!arguments[2], h = !0, y = !0;
    if ("length" in o && r) {
      var w = r(o, "length");
      w && !w.configurable && (h = !1), w && !w.writable && (y = !1);
    }
    return (h || y || !u) && (n ? t(o, "length", c, !0, !0) : t(o, "length", c)), o;
  }, Uo;
}
var jl;
function ip() {
  return jl || (jl = 1, function(e) {
    var t = Mc(), n = Tr(), r = nb(), i = n("%TypeError%"), a = n("%Function.prototype.apply%"), s = n("%Function.prototype.call%"), o = n("%Reflect.apply%", !0) || t.call(s, a), c = n("%Object.defineProperty%", !0), u = n("%Math.max%");
    if (c)
      try {
        c({}, "a", { value: 1 });
      } catch {
        c = null;
      }
    e.exports = function(w) {
      if (typeof w != "function")
        throw new i("a function is required");
      var p = o(t, s, arguments);
      return r(
        p,
        1 + u(0, w.length - (arguments.length - 1)),
        !0
      );
    };
    var h = function() {
      return o(t, a, arguments);
    };
    c ? c(e.exports, "apply", { value: h }) : e.exports.apply = h;
  }(_o)), _o.exports;
}
var Co, ql;
function ap() {
  if (ql)
    return Co;
  ql = 1;
  var e = Tr(), t = ip(), n = t(e("String.prototype.indexOf"));
  return Co = function(i, a) {
    var s = e(i, !!a);
    return typeof s == "function" && n(i, ".prototype.") > -1 ? t(s) : s;
  }, Co;
}
var So, Hl;
function rb() {
  if (Hl)
    return So;
  Hl = 1;
  var e = Pc()(), t = ap(), n = t("Object.prototype.toString"), r = function(o) {
    return e && o && typeof o == "object" && Symbol.toStringTag in o ? !1 : n(o) === "[object Arguments]";
  }, i = function(o) {
    return r(o) ? !0 : o !== null && typeof o == "object" && typeof o.length == "number" && o.length >= 0 && n(o) !== "[object Array]" && n(o.callee) === "[object Function]";
  }, a = function() {
    return r(arguments);
  }();
  return r.isLegacyArguments = i, So = a ? r : i, So;
}
var Fo, Vl;
function ib() {
  if (Vl)
    return Fo;
  Vl = 1;
  var e = Object.prototype.toString, t = Function.prototype.toString, n = /^\s*(?:function)?\*/, r = Pc()(), i = Object.getPrototypeOf, a = function() {
    if (!r)
      return !1;
    try {
      return Function("return function*() {}")();
    } catch {
    }
  }, s;
  return Fo = function(c) {
    if (typeof c != "function")
      return !1;
    if (n.test(t.call(c)))
      return !0;
    if (!r) {
      var u = e.call(c);
      return u === "[object GeneratorFunction]";
    }
    if (!i)
      return !1;
    if (typeof s > "u") {
      var h = a();
      s = h ? i(h) : !1;
    }
    return i(c) === s;
  }, Fo;
}
var ko, Gl;
function ab() {
  if (Gl)
    return ko;
  Gl = 1;
  var e = Function.prototype.toString, t = typeof Reflect == "object" && Reflect !== null && Reflect.apply, n, r;
  if (typeof t == "function" && typeof Object.defineProperty == "function")
    try {
      n = Object.defineProperty({}, "length", {
        get: function() {
          throw r;
        }
      }), r = {}, t(function() {
        throw 42;
      }, null, n);
    } catch (b) {
      b !== r && (t = null);
    }
  else
    t = null;
  var i = /^\s*class\b/, a = function(_) {
    try {
      var E = e.call(_);
      return i.test(E);
    } catch {
      return !1;
    }
  }, s = function(_) {
    try {
      return a(_) ? !1 : (e.call(_), !0);
    } catch {
      return !1;
    }
  }, o = Object.prototype.toString, c = "[object Object]", u = "[object Function]", h = "[object GeneratorFunction]", y = "[object HTMLAllCollection]", w = "[object HTML document.all class]", p = "[object HTMLCollection]", x = typeof Symbol == "function" && !!Symbol.toStringTag, d = !(0 in [,]), v = function() {
    return !1;
  };
  if (typeof document == "object") {
    var l = document.all;
    o.call(l) === o.call(document.all) && (v = function(_) {
      if ((d || !_) && (typeof _ > "u" || typeof _ == "object"))
        try {
          var E = o.call(_);
          return (E === y || E === w || E === p || E === c) && _("") == null;
        } catch {
        }
      return !1;
    });
  }
  return ko = t ? function(_) {
    if (v(_))
      return !0;
    if (!_ || typeof _ != "function" && typeof _ != "object")
      return !1;
    try {
      t(_, null, n);
    } catch (E) {
      if (E !== r)
        return !1;
    }
    return !a(_) && s(_);
  } : function(_) {
    if (v(_))
      return !0;
    if (!_ || typeof _ != "function" && typeof _ != "object")
      return !1;
    if (x)
      return s(_);
    if (a(_))
      return !1;
    var E = o.call(_);
    return E !== u && E !== h && !/^\[object HTML/.test(E) ? !1 : s(_);
  }, ko;
}
var Bo, Xl;
function ob() {
  if (Xl)
    return Bo;
  Xl = 1;
  var e = ab(), t = Object.prototype.toString, n = Object.prototype.hasOwnProperty, r = function(c, u, h) {
    for (var y = 0, w = c.length; y < w; y++)
      n.call(c, y) && (h == null ? u(c[y], y, c) : u.call(h, c[y], y, c));
  }, i = function(c, u, h) {
    for (var y = 0, w = c.length; y < w; y++)
      h == null ? u(c.charAt(y), y, c) : u.call(h, c.charAt(y), y, c);
  }, a = function(c, u, h) {
    for (var y in c)
      n.call(c, y) && (h == null ? u(c[y], y, c) : u.call(h, c[y], y, c));
  }, s = function(c, u, h) {
    if (!e(u))
      throw new TypeError("iterator must be a function");
    var y;
    arguments.length >= 3 && (y = h), t.call(c) === "[object Array]" ? r(c, u, y) : typeof c == "string" ? i(c, u, y) : a(c, u, y);
  };
  return Bo = s, Bo;
}
var Ro, $l;
function sb() {
  if ($l)
    return Ro;
  $l = 1;
  var e = [
    "BigInt64Array",
    "BigUint64Array",
    "Float32Array",
    "Float64Array",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray"
  ], t = typeof globalThis > "u" ? jt : globalThis;
  return Ro = function() {
    for (var r = [], i = 0; i < e.length; i++)
      typeof t[e[i]] == "function" && (r[r.length] = e[i]);
    return r;
  }, Ro;
}
var Io, Kl;
function op() {
  if (Kl)
    return Io;
  Kl = 1;
  var e = ob(), t = sb(), n = ip(), r = ap(), i = zc(), a = r("Object.prototype.toString"), s = Pc()(), o = typeof globalThis > "u" ? jt : globalThis, c = t(), u = r("String.prototype.slice"), h = Object.getPrototypeOf, y = r("Array.prototype.indexOf", !0) || function(v, l) {
    for (var b = 0; b < v.length; b += 1)
      if (v[b] === l)
        return b;
    return -1;
  }, w = { __proto__: null };
  s && i && h ? e(c, function(d) {
    var v = new o[d]();
    if (Symbol.toStringTag in v) {
      var l = h(v), b = i(l, Symbol.toStringTag);
      if (!b) {
        var _ = h(l);
        b = i(_, Symbol.toStringTag);
      }
      w["$" + d] = n(b.get);
    }
  }) : e(c, function(d) {
    var v = new o[d](), l = v.slice || v.set;
    l && (w["$" + d] = n(l));
  });
  var p = function(v) {
    var l = !1;
    return e(w, function(b, _) {
      if (!l)
        try {
          "$" + b(v) === _ && (l = u(_, 1));
        } catch {
        }
    }), l;
  }, x = function(v) {
    var l = !1;
    return e(w, function(b, _) {
      if (!l)
        try {
          b(v), l = u(_, 1);
        } catch {
        }
    }), l;
  };
  return Io = function(v) {
    if (!v || typeof v != "object")
      return !1;
    if (!s) {
      var l = u(a(v), 8, -1);
      return y(c, l) > -1 ? l : l !== "Object" ? !1 : x(v);
    }
    return i ? p(v) : null;
  }, Io;
}
var No, Zl;
function cb() {
  if (Zl)
    return No;
  Zl = 1;
  var e = op();
  return No = function(n) {
    return !!e(n);
  }, No;
}
var Yl;
function ub() {
  return Yl || (Yl = 1, function(e) {
    var t = rb(), n = ib(), r = op(), i = cb();
    function a(T) {
      return T.call.bind(T);
    }
    var s = typeof BigInt < "u", o = typeof Symbol < "u", c = a(Object.prototype.toString), u = a(Number.prototype.valueOf), h = a(String.prototype.valueOf), y = a(Boolean.prototype.valueOf);
    if (s)
      var w = a(BigInt.prototype.valueOf);
    if (o)
      var p = a(Symbol.prototype.valueOf);
    function x(T, L) {
      if (typeof T != "object")
        return !1;
      try {
        return L(T), !0;
      } catch {
        return !1;
      }
    }
    e.isArgumentsObject = t, e.isGeneratorFunction = n, e.isTypedArray = i;
    function d(T) {
      return typeof Promise < "u" && T instanceof Promise || T !== null && typeof T == "object" && typeof T.then == "function" && typeof T.catch == "function";
    }
    e.isPromise = d;
    function v(T) {
      return typeof ArrayBuffer < "u" && ArrayBuffer.isView ? ArrayBuffer.isView(T) : i(T) || G(T);
    }
    e.isArrayBufferView = v;
    function l(T) {
      return r(T) === "Uint8Array";
    }
    e.isUint8Array = l;
    function b(T) {
      return r(T) === "Uint8ClampedArray";
    }
    e.isUint8ClampedArray = b;
    function _(T) {
      return r(T) === "Uint16Array";
    }
    e.isUint16Array = _;
    function E(T) {
      return r(T) === "Uint32Array";
    }
    e.isUint32Array = E;
    function C(T) {
      return r(T) === "Int8Array";
    }
    e.isInt8Array = C;
    function R(T) {
      return r(T) === "Int16Array";
    }
    e.isInt16Array = R;
    function I(T) {
      return r(T) === "Int32Array";
    }
    e.isInt32Array = I;
    function q(T) {
      return r(T) === "Float32Array";
    }
    e.isFloat32Array = q;
    function F(T) {
      return r(T) === "Float64Array";
    }
    e.isFloat64Array = F;
    function ie(T) {
      return r(T) === "BigInt64Array";
    }
    e.isBigInt64Array = ie;
    function ce(T) {
      return r(T) === "BigUint64Array";
    }
    e.isBigUint64Array = ce;
    function S(T) {
      return c(T) === "[object Map]";
    }
    S.working = typeof Map < "u" && S(/* @__PURE__ */ new Map());
    function M(T) {
      return typeof Map > "u" ? !1 : S.working ? S(T) : T instanceof Map;
    }
    e.isMap = M;
    function D(T) {
      return c(T) === "[object Set]";
    }
    D.working = typeof Set < "u" && D(/* @__PURE__ */ new Set());
    function X(T) {
      return typeof Set > "u" ? !1 : D.working ? D(T) : T instanceof Set;
    }
    e.isSet = X;
    function H(T) {
      return c(T) === "[object WeakMap]";
    }
    H.working = typeof WeakMap < "u" && H(/* @__PURE__ */ new WeakMap());
    function P(T) {
      return typeof WeakMap > "u" ? !1 : H.working ? H(T) : T instanceof WeakMap;
    }
    e.isWeakMap = P;
    function Z(T) {
      return c(T) === "[object WeakSet]";
    }
    Z.working = typeof WeakSet < "u" && Z(/* @__PURE__ */ new WeakSet());
    function z(T) {
      return Z(T);
    }
    e.isWeakSet = z;
    function ae(T) {
      return c(T) === "[object ArrayBuffer]";
    }
    ae.working = typeof ArrayBuffer < "u" && ae(new ArrayBuffer());
    function O(T) {
      return typeof ArrayBuffer > "u" ? !1 : ae.working ? ae(T) : T instanceof ArrayBuffer;
    }
    e.isArrayBuffer = O;
    function A(T) {
      return c(T) === "[object DataView]";
    }
    A.working = typeof ArrayBuffer < "u" && typeof DataView < "u" && A(new DataView(new ArrayBuffer(1), 0, 1));
    function G(T) {
      return typeof DataView > "u" ? !1 : A.working ? A(T) : T instanceof DataView;
    }
    e.isDataView = G;
    var J = typeof SharedArrayBuffer < "u" ? SharedArrayBuffer : void 0;
    function re(T) {
      return c(T) === "[object SharedArrayBuffer]";
    }
    function Q(T) {
      return typeof J > "u" ? !1 : (typeof re.working > "u" && (re.working = re(new J())), re.working ? re(T) : T instanceof J);
    }
    e.isSharedArrayBuffer = Q;
    function B(T) {
      return c(T) === "[object AsyncFunction]";
    }
    e.isAsyncFunction = B;
    function k(T) {
      return c(T) === "[object Map Iterator]";
    }
    e.isMapIterator = k;
    function ne(T) {
      return c(T) === "[object Set Iterator]";
    }
    e.isSetIterator = ne;
    function te(T) {
      return c(T) === "[object Generator]";
    }
    e.isGeneratorObject = te;
    function V(T) {
      return c(T) === "[object WebAssembly.Module]";
    }
    e.isWebAssemblyCompiledModule = V;
    function N(T) {
      return x(T, u);
    }
    e.isNumberObject = N;
    function oe(T) {
      return x(T, h);
    }
    e.isStringObject = oe;
    function m(T) {
      return x(T, y);
    }
    e.isBooleanObject = m;
    function $(T) {
      return s && x(T, w);
    }
    e.isBigIntObject = $;
    function U(T) {
      return o && x(T, p);
    }
    e.isSymbolObject = U;
    function f(T) {
      return N(T) || oe(T) || m(T) || $(T) || U(T);
    }
    e.isBoxedPrimitive = f;
    function g(T) {
      return typeof Uint8Array < "u" && (O(T) || Q(T));
    }
    e.isAnyArrayBuffer = g, ["isProxy", "isExternal", "isModuleNamespaceObject"].forEach(function(T) {
      Object.defineProperty(e, T, {
        enumerable: !1,
        value: function() {
          throw new Error(T + " is not supported in userland");
        }
      });
    });
  }(po)), po;
}
var Oo, Jl;
function lb() {
  return Jl || (Jl = 1, Oo = function(t) {
    return t && typeof t == "object" && typeof t.copy == "function" && typeof t.fill == "function" && typeof t.readUInt8 == "function";
  }), Oo;
}
var Ql;
function sp() {
  return Ql || (Ql = 1, function(e) {
    var t = Object.getOwnPropertyDescriptors || function(G) {
      for (var J = Object.keys(G), re = {}, Q = 0; Q < J.length; Q++)
        re[J[Q]] = Object.getOwnPropertyDescriptor(G, J[Q]);
      return re;
    }, n = /%[sdj%]/g;
    e.format = function(A) {
      if (!C(A)) {
        for (var G = [], J = 0; J < arguments.length; J++)
          G.push(s(arguments[J]));
        return G.join(" ");
      }
      for (var J = 1, re = arguments, Q = re.length, B = String(A).replace(n, function(ne) {
        if (ne === "%%")
          return "%";
        if (J >= Q)
          return ne;
        switch (ne) {
          case "%s":
            return String(re[J++]);
          case "%d":
            return Number(re[J++]);
          case "%j":
            try {
              return JSON.stringify(re[J++]);
            } catch {
              return "[Circular]";
            }
          default:
            return ne;
        }
      }), k = re[J]; J < Q; k = re[++J])
        b(k) || !F(k) ? B += " " + k : B += " " + s(k);
      return B;
    }, e.deprecate = function(A, G) {
      if (typeof _e < "u" && _e.noDeprecation === !0)
        return A;
      if (typeof _e > "u")
        return function() {
          return e.deprecate(A, G).apply(this, arguments);
        };
      var J = !1;
      function re() {
        if (!J) {
          if (_e.throwDeprecation)
            throw new Error(G);
          _e.traceDeprecation ? console.trace(G) : console.error(G), J = !0;
        }
        return A.apply(this, arguments);
      }
      return re;
    };
    var r = {}, i = /^$/;
    if (_e.env.NODE_DEBUG) {
      var a = _e.env.NODE_DEBUG;
      a = a.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*").replace(/,/g, "$|^").toUpperCase(), i = new RegExp("^" + a + "$", "i");
    }
    e.debuglog = function(A) {
      if (A = A.toUpperCase(), !r[A])
        if (i.test(A)) {
          var G = _e.pid;
          r[A] = function() {
            var J = e.format.apply(e, arguments);
            console.error("%s %d: %s", A, G, J);
          };
        } else
          r[A] = function() {
          };
      return r[A];
    };
    function s(A, G) {
      var J = {
        seen: [],
        stylize: c
      };
      return arguments.length >= 3 && (J.depth = arguments[2]), arguments.length >= 4 && (J.colors = arguments[3]), l(G) ? J.showHidden = G : G && e._extend(J, G), I(J.showHidden) && (J.showHidden = !1), I(J.depth) && (J.depth = 2), I(J.colors) && (J.colors = !1), I(J.customInspect) && (J.customInspect = !0), J.colors && (J.stylize = o), h(J, A, J.depth);
    }
    e.inspect = s, s.colors = {
      bold: [1, 22],
      italic: [3, 23],
      underline: [4, 24],
      inverse: [7, 27],
      white: [37, 39],
      grey: [90, 39],
      black: [30, 39],
      blue: [34, 39],
      cyan: [36, 39],
      green: [32, 39],
      magenta: [35, 39],
      red: [31, 39],
      yellow: [33, 39]
    }, s.styles = {
      special: "cyan",
      number: "yellow",
      boolean: "yellow",
      undefined: "grey",
      null: "bold",
      string: "green",
      date: "magenta",
      // "name": intentionally not styling
      regexp: "red"
    };
    function o(A, G) {
      var J = s.styles[G];
      return J ? "\x1B[" + s.colors[J][0] + "m" + A + "\x1B[" + s.colors[J][1] + "m" : A;
    }
    function c(A, G) {
      return A;
    }
    function u(A) {
      var G = {};
      return A.forEach(function(J, re) {
        G[J] = !0;
      }), G;
    }
    function h(A, G, J) {
      if (A.customInspect && G && S(G.inspect) && // Filter out the util module, it's inspect function is special
      G.inspect !== e.inspect && // Also filter out any prototype objects using the circular check.
      !(G.constructor && G.constructor.prototype === G)) {
        var re = G.inspect(J, A);
        return C(re) || (re = h(A, re, J)), re;
      }
      var Q = y(A, G);
      if (Q)
        return Q;
      var B = Object.keys(G), k = u(B);
      if (A.showHidden && (B = Object.getOwnPropertyNames(G)), ce(G) && (B.indexOf("message") >= 0 || B.indexOf("description") >= 0))
        return w(G);
      if (B.length === 0) {
        if (S(G)) {
          var ne = G.name ? ": " + G.name : "";
          return A.stylize("[Function" + ne + "]", "special");
        }
        if (q(G))
          return A.stylize(RegExp.prototype.toString.call(G), "regexp");
        if (ie(G))
          return A.stylize(Date.prototype.toString.call(G), "date");
        if (ce(G))
          return w(G);
      }
      var te = "", V = !1, N = ["{", "}"];
      if (v(G) && (V = !0, N = ["[", "]"]), S(G)) {
        var oe = G.name ? ": " + G.name : "";
        te = " [Function" + oe + "]";
      }
      if (q(G) && (te = " " + RegExp.prototype.toString.call(G)), ie(G) && (te = " " + Date.prototype.toUTCString.call(G)), ce(G) && (te = " " + w(G)), B.length === 0 && (!V || G.length == 0))
        return N[0] + te + N[1];
      if (J < 0)
        return q(G) ? A.stylize(RegExp.prototype.toString.call(G), "regexp") : A.stylize("[Object]", "special");
      A.seen.push(G);
      var m;
      return V ? m = p(A, G, J, k, B) : m = B.map(function($) {
        return x(A, G, J, k, $, V);
      }), A.seen.pop(), d(m, te, N);
    }
    function y(A, G) {
      if (I(G))
        return A.stylize("undefined", "undefined");
      if (C(G)) {
        var J = "'" + JSON.stringify(G).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
        return A.stylize(J, "string");
      }
      if (E(G))
        return A.stylize("" + G, "number");
      if (l(G))
        return A.stylize("" + G, "boolean");
      if (b(G))
        return A.stylize("null", "null");
    }
    function w(A) {
      return "[" + Error.prototype.toString.call(A) + "]";
    }
    function p(A, G, J, re, Q) {
      for (var B = [], k = 0, ne = G.length; k < ne; ++k)
        Z(G, String(k)) ? B.push(x(
          A,
          G,
          J,
          re,
          String(k),
          !0
        )) : B.push("");
      return Q.forEach(function(te) {
        te.match(/^\d+$/) || B.push(x(
          A,
          G,
          J,
          re,
          te,
          !0
        ));
      }), B;
    }
    function x(A, G, J, re, Q, B) {
      var k, ne, te;
      if (te = Object.getOwnPropertyDescriptor(G, Q) || { value: G[Q] }, te.get ? te.set ? ne = A.stylize("[Getter/Setter]", "special") : ne = A.stylize("[Getter]", "special") : te.set && (ne = A.stylize("[Setter]", "special")), Z(re, Q) || (k = "[" + Q + "]"), ne || (A.seen.indexOf(te.value) < 0 ? (b(J) ? ne = h(A, te.value, null) : ne = h(A, te.value, J - 1), ne.indexOf(`
`) > -1 && (B ? ne = ne.split(`
`).map(function(V) {
        return "  " + V;
      }).join(`
`).slice(2) : ne = `
` + ne.split(`
`).map(function(V) {
        return "   " + V;
      }).join(`
`))) : ne = A.stylize("[Circular]", "special")), I(k)) {
        if (B && Q.match(/^\d+$/))
          return ne;
        k = JSON.stringify("" + Q), k.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/) ? (k = k.slice(1, -1), k = A.stylize(k, "name")) : (k = k.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'"), k = A.stylize(k, "string"));
      }
      return k + ": " + ne;
    }
    function d(A, G, J) {
      var re = A.reduce(function(Q, B) {
        return B.indexOf(`
`) >= 0, Q + B.replace(/\u001b\[\d\d?m/g, "").length + 1;
      }, 0);
      return re > 60 ? J[0] + (G === "" ? "" : G + `
 `) + " " + A.join(`,
  `) + " " + J[1] : J[0] + G + " " + A.join(", ") + " " + J[1];
    }
    e.types = ub();
    function v(A) {
      return Array.isArray(A);
    }
    e.isArray = v;
    function l(A) {
      return typeof A == "boolean";
    }
    e.isBoolean = l;
    function b(A) {
      return A === null;
    }
    e.isNull = b;
    function _(A) {
      return A == null;
    }
    e.isNullOrUndefined = _;
    function E(A) {
      return typeof A == "number";
    }
    e.isNumber = E;
    function C(A) {
      return typeof A == "string";
    }
    e.isString = C;
    function R(A) {
      return typeof A == "symbol";
    }
    e.isSymbol = R;
    function I(A) {
      return A === void 0;
    }
    e.isUndefined = I;
    function q(A) {
      return F(A) && D(A) === "[object RegExp]";
    }
    e.isRegExp = q, e.types.isRegExp = q;
    function F(A) {
      return typeof A == "object" && A !== null;
    }
    e.isObject = F;
    function ie(A) {
      return F(A) && D(A) === "[object Date]";
    }
    e.isDate = ie, e.types.isDate = ie;
    function ce(A) {
      return F(A) && (D(A) === "[object Error]" || A instanceof Error);
    }
    e.isError = ce, e.types.isNativeError = ce;
    function S(A) {
      return typeof A == "function";
    }
    e.isFunction = S;
    function M(A) {
      return A === null || typeof A == "boolean" || typeof A == "number" || typeof A == "string" || typeof A == "symbol" || // ES6 symbol
      typeof A > "u";
    }
    e.isPrimitive = M, e.isBuffer = lb();
    function D(A) {
      return Object.prototype.toString.call(A);
    }
    function X(A) {
      return A < 10 ? "0" + A.toString(10) : A.toString(10);
    }
    var H = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ];
    function P() {
      var A = /* @__PURE__ */ new Date(), G = [
        X(A.getHours()),
        X(A.getMinutes()),
        X(A.getSeconds())
      ].join(":");
      return [A.getDate(), H[A.getMonth()], G].join(" ");
    }
    e.log = function() {
      console.log("%s - %s", P(), e.format.apply(e, arguments));
    }, e.inherits = Ln, e._extend = function(A, G) {
      if (!G || !F(G))
        return A;
      for (var J = Object.keys(G), re = J.length; re--; )
        A[J[re]] = G[J[re]];
      return A;
    };
    function Z(A, G) {
      return Object.prototype.hasOwnProperty.call(A, G);
    }
    var z = typeof Symbol < "u" ? Symbol("util.promisify.custom") : void 0;
    e.promisify = function(G) {
      if (typeof G != "function")
        throw new TypeError('The "original" argument must be of type Function');
      if (z && G[z]) {
        var J = G[z];
        if (typeof J != "function")
          throw new TypeError('The "util.promisify.custom" argument must be of type Function');
        return Object.defineProperty(J, z, {
          value: J,
          enumerable: !1,
          writable: !1,
          configurable: !0
        }), J;
      }
      function J() {
        for (var re, Q, B = new Promise(function(te, V) {
          re = te, Q = V;
        }), k = [], ne = 0; ne < arguments.length; ne++)
          k.push(arguments[ne]);
        k.push(function(te, V) {
          te ? Q(te) : re(V);
        });
        try {
          G.apply(this, k);
        } catch (te) {
          Q(te);
        }
        return B;
      }
      return Object.setPrototypeOf(J, Object.getPrototypeOf(G)), z && Object.defineProperty(J, z, {
        value: J,
        enumerable: !1,
        writable: !1,
        configurable: !0
      }), Object.defineProperties(
        J,
        t(G)
      );
    }, e.promisify.custom = z;
    function ae(A, G) {
      if (!A) {
        var J = new Error("Promise was rejected with a falsy value");
        J.reason = A, A = J;
      }
      return G(A);
    }
    function O(A) {
      if (typeof A != "function")
        throw new TypeError('The "original" argument must be of type Function');
      function G() {
        for (var J = [], re = 0; re < arguments.length; re++)
          J.push(arguments[re]);
        var Q = J.pop();
        if (typeof Q != "function")
          throw new TypeError("The last argument must be of type Function");
        var B = this, k = function() {
          return Q.apply(B, arguments);
        };
        A.apply(this, J).then(
          function(ne) {
            _e.nextTick(k.bind(null, null, ne));
          },
          function(ne) {
            _e.nextTick(ae.bind(null, ne, k));
          }
        );
      }
      return Object.setPrototypeOf(G, Object.getPrototypeOf(A)), Object.defineProperties(
        G,
        t(A)
      ), G;
    }
    e.callbackify = O;
  }(fo)), fo;
}
var Wo, ed;
function db() {
  if (ed)
    return Wo;
  ed = 1;
  function e(w, p) {
    var x = Object.keys(w);
    if (Object.getOwnPropertySymbols) {
      var d = Object.getOwnPropertySymbols(w);
      p && (d = d.filter(function(v) {
        return Object.getOwnPropertyDescriptor(w, v).enumerable;
      })), x.push.apply(x, d);
    }
    return x;
  }
  function t(w) {
    for (var p = 1; p < arguments.length; p++) {
      var x = arguments[p] != null ? arguments[p] : {};
      p % 2 ? e(Object(x), !0).forEach(function(d) {
        n(w, d, x[d]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(w, Object.getOwnPropertyDescriptors(x)) : e(Object(x)).forEach(function(d) {
        Object.defineProperty(w, d, Object.getOwnPropertyDescriptor(x, d));
      });
    }
    return w;
  }
  function n(w, p, x) {
    return p in w ? Object.defineProperty(w, p, { value: x, enumerable: !0, configurable: !0, writable: !0 }) : w[p] = x, w;
  }
  function r(w, p) {
    if (!(w instanceof p))
      throw new TypeError("Cannot call a class as a function");
  }
  function i(w, p) {
    for (var x = 0; x < p.length; x++) {
      var d = p[x];
      d.enumerable = d.enumerable || !1, d.configurable = !0, "value" in d && (d.writable = !0), Object.defineProperty(w, d.key, d);
    }
  }
  function a(w, p, x) {
    return p && i(w.prototype, p), x && i(w, x), w;
  }
  var s = ua(), o = s.Buffer, c = sp(), u = c.inspect, h = u && u.custom || "inspect";
  function y(w, p, x) {
    o.prototype.copy.call(w, p, x);
  }
  return Wo = /* @__PURE__ */ function() {
    function w() {
      r(this, w), this.head = null, this.tail = null, this.length = 0;
    }
    return a(w, [{
      key: "push",
      value: function(x) {
        var d = {
          data: x,
          next: null
        };
        this.length > 0 ? this.tail.next = d : this.head = d, this.tail = d, ++this.length;
      }
    }, {
      key: "unshift",
      value: function(x) {
        var d = {
          data: x,
          next: this.head
        };
        this.length === 0 && (this.tail = d), this.head = d, ++this.length;
      }
    }, {
      key: "shift",
      value: function() {
        if (this.length !== 0) {
          var x = this.head.data;
          return this.length === 1 ? this.head = this.tail = null : this.head = this.head.next, --this.length, x;
        }
      }
    }, {
      key: "clear",
      value: function() {
        this.head = this.tail = null, this.length = 0;
      }
    }, {
      key: "join",
      value: function(x) {
        if (this.length === 0)
          return "";
        for (var d = this.head, v = "" + d.data; d = d.next; )
          v += x + d.data;
        return v;
      }
    }, {
      key: "concat",
      value: function(x) {
        if (this.length === 0)
          return o.alloc(0);
        for (var d = o.allocUnsafe(x >>> 0), v = this.head, l = 0; v; )
          y(v.data, d, l), l += v.data.length, v = v.next;
        return d;
      }
      // Consumes a specified amount of bytes or characters from the buffered data.
    }, {
      key: "consume",
      value: function(x, d) {
        var v;
        return x < this.head.data.length ? (v = this.head.data.slice(0, x), this.head.data = this.head.data.slice(x)) : x === this.head.data.length ? v = this.shift() : v = d ? this._getString(x) : this._getBuffer(x), v;
      }
    }, {
      key: "first",
      value: function() {
        return this.head.data;
      }
      // Consumes a specified amount of characters from the buffered data.
    }, {
      key: "_getString",
      value: function(x) {
        var d = this.head, v = 1, l = d.data;
        for (x -= l.length; d = d.next; ) {
          var b = d.data, _ = x > b.length ? b.length : x;
          if (_ === b.length ? l += b : l += b.slice(0, x), x -= _, x === 0) {
            _ === b.length ? (++v, d.next ? this.head = d.next : this.head = this.tail = null) : (this.head = d, d.data = b.slice(_));
            break;
          }
          ++v;
        }
        return this.length -= v, l;
      }
      // Consumes a specified amount of bytes from the buffered data.
    }, {
      key: "_getBuffer",
      value: function(x) {
        var d = o.allocUnsafe(x), v = this.head, l = 1;
        for (v.data.copy(d), x -= v.data.length; v = v.next; ) {
          var b = v.data, _ = x > b.length ? b.length : x;
          if (b.copy(d, d.length - x, 0, _), x -= _, x === 0) {
            _ === b.length ? (++l, v.next ? this.head = v.next : this.head = this.tail = null) : (this.head = v, v.data = b.slice(_));
            break;
          }
          ++l;
        }
        return this.length -= l, d;
      }
      // Make sure the linked list only shows the minimal necessary information.
    }, {
      key: h,
      value: function(x, d) {
        return u(this, t({}, d, {
          // Only inspect one level.
          depth: 0,
          // It should not recurse.
          customInspect: !1
        }));
      }
    }]), w;
  }(), Wo;
}
var Lo, td;
function cp() {
  if (td)
    return Lo;
  td = 1;
  function e(s, o) {
    var c = this, u = this._readableState && this._readableState.destroyed, h = this._writableState && this._writableState.destroyed;
    return u || h ? (o ? o(s) : s && (this._writableState ? this._writableState.errorEmitted || (this._writableState.errorEmitted = !0, _e.nextTick(i, this, s)) : _e.nextTick(i, this, s)), this) : (this._readableState && (this._readableState.destroyed = !0), this._writableState && (this._writableState.destroyed = !0), this._destroy(s || null, function(y) {
      !o && y ? c._writableState ? c._writableState.errorEmitted ? _e.nextTick(n, c) : (c._writableState.errorEmitted = !0, _e.nextTick(t, c, y)) : _e.nextTick(t, c, y) : o ? (_e.nextTick(n, c), o(y)) : _e.nextTick(n, c);
    }), this);
  }
  function t(s, o) {
    i(s, o), n(s);
  }
  function n(s) {
    s._writableState && !s._writableState.emitClose || s._readableState && !s._readableState.emitClose || s.emit("close");
  }
  function r() {
    this._readableState && (this._readableState.destroyed = !1, this._readableState.reading = !1, this._readableState.ended = !1, this._readableState.endEmitted = !1), this._writableState && (this._writableState.destroyed = !1, this._writableState.ended = !1, this._writableState.ending = !1, this._writableState.finalCalled = !1, this._writableState.prefinished = !1, this._writableState.finished = !1, this._writableState.errorEmitted = !1);
  }
  function i(s, o) {
    s.emit("error", o);
  }
  function a(s, o) {
    var c = s._readableState, u = s._writableState;
    c && c.autoDestroy || u && u.autoDestroy ? s.destroy(o) : s.emit("error", o);
  }
  return Lo = {
    destroy: e,
    undestroy: r,
    errorOrDestroy: a
  }, Lo;
}
var Po = {}, nd;
function Er() {
  if (nd)
    return Po;
  nd = 1;
  function e(o, c) {
    o.prototype = Object.create(c.prototype), o.prototype.constructor = o, o.__proto__ = c;
  }
  var t = {};
  function n(o, c, u) {
    u || (u = Error);
    function h(w, p, x) {
      return typeof c == "string" ? c : c(w, p, x);
    }
    var y = /* @__PURE__ */ function(w) {
      e(p, w);
      function p(x, d, v) {
        return w.call(this, h(x, d, v)) || this;
      }
      return p;
    }(u);
    y.prototype.name = u.name, y.prototype.code = o, t[o] = y;
  }
  function r(o, c) {
    if (Array.isArray(o)) {
      var u = o.length;
      return o = o.map(function(h) {
        return String(h);
      }), u > 2 ? "one of ".concat(c, " ").concat(o.slice(0, u - 1).join(", "), ", or ") + o[u - 1] : u === 2 ? "one of ".concat(c, " ").concat(o[0], " or ").concat(o[1]) : "of ".concat(c, " ").concat(o[0]);
    } else
      return "of ".concat(c, " ").concat(String(o));
  }
  function i(o, c, u) {
    return o.substr(!u || u < 0 ? 0 : +u, c.length) === c;
  }
  function a(o, c, u) {
    return (u === void 0 || u > o.length) && (u = o.length), o.substring(u - c.length, u) === c;
  }
  function s(o, c, u) {
    return typeof u != "number" && (u = 0), u + c.length > o.length ? !1 : o.indexOf(c, u) !== -1;
  }
  return n("ERR_INVALID_OPT_VALUE", function(o, c) {
    return 'The value "' + c + '" is invalid for option "' + o + '"';
  }, TypeError), n("ERR_INVALID_ARG_TYPE", function(o, c, u) {
    var h;
    typeof c == "string" && i(c, "not ") ? (h = "must not be", c = c.replace(/^not /, "")) : h = "must be";
    var y;
    if (a(o, " argument"))
      y = "The ".concat(o, " ").concat(h, " ").concat(r(c, "type"));
    else {
      var w = s(o, ".") ? "property" : "argument";
      y = 'The "'.concat(o, '" ').concat(w, " ").concat(h, " ").concat(r(c, "type"));
    }
    return y += ". Received type ".concat(typeof u), y;
  }, TypeError), n("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF"), n("ERR_METHOD_NOT_IMPLEMENTED", function(o) {
    return "The " + o + " method is not implemented";
  }), n("ERR_STREAM_PREMATURE_CLOSE", "Premature close"), n("ERR_STREAM_DESTROYED", function(o) {
    return "Cannot call " + o + " after a stream was destroyed";
  }), n("ERR_MULTIPLE_CALLBACK", "Callback called multiple times"), n("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable"), n("ERR_STREAM_WRITE_AFTER_END", "write after end"), n("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError), n("ERR_UNKNOWN_ENCODING", function(o) {
    return "Unknown encoding: " + o;
  }, TypeError), n("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event"), Po.codes = t, Po;
}
var Mo, rd;
function up() {
  if (rd)
    return Mo;
  rd = 1;
  var e = Er().codes.ERR_INVALID_OPT_VALUE;
  function t(r, i, a) {
    return r.highWaterMark != null ? r.highWaterMark : i ? r[a] : null;
  }
  function n(r, i, a, s) {
    var o = t(i, s, a);
    if (o != null) {
      if (!(isFinite(o) && Math.floor(o) === o) || o < 0) {
        var c = s ? a : "highWaterMark";
        throw new e(c, o);
      }
      return Math.floor(o);
    }
    return r.objectMode ? 16 : 16 * 1024;
  }
  return Mo = {
    getHighWaterMark: n
  }, Mo;
}
var zo, id;
function hb() {
  if (id)
    return zo;
  id = 1, zo = e;
  function e(n, r) {
    if (t("noDeprecation"))
      return n;
    var i = !1;
    function a() {
      if (!i) {
        if (t("throwDeprecation"))
          throw new Error(r);
        t("traceDeprecation") ? console.trace(r) : console.warn(r), i = !0;
      }
      return n.apply(this, arguments);
    }
    return a;
  }
  function t(n) {
    try {
      if (!jt.localStorage)
        return !1;
    } catch {
      return !1;
    }
    var r = jt.localStorage[n];
    return r == null ? !1 : String(r).toLowerCase() === "true";
  }
  return zo;
}
var jo, ad;
function lp() {
  if (ad)
    return jo;
  ad = 1, jo = q;
  function e(Q) {
    var B = this;
    this.next = null, this.entry = null, this.finish = function() {
      re(B, Q);
    };
  }
  var t;
  q.WritableState = R;
  var n = {
    deprecate: hb()
  }, r = tp(), i = ua().Buffer, a = jt.Uint8Array || function() {
  };
  function s(Q) {
    return i.from(Q);
  }
  function o(Q) {
    return i.isBuffer(Q) || Q instanceof a;
  }
  var c = cp(), u = up(), h = u.getHighWaterMark, y = Er().codes, w = y.ERR_INVALID_ARG_TYPE, p = y.ERR_METHOD_NOT_IMPLEMENTED, x = y.ERR_MULTIPLE_CALLBACK, d = y.ERR_STREAM_CANNOT_PIPE, v = y.ERR_STREAM_DESTROYED, l = y.ERR_STREAM_NULL_VALUES, b = y.ERR_STREAM_WRITE_AFTER_END, _ = y.ERR_UNKNOWN_ENCODING, E = c.errorOrDestroy;
  Ln(q, r);
  function C() {
  }
  function R(Q, B, k) {
    t = t || hr(), Q = Q || {}, typeof k != "boolean" && (k = B instanceof t), this.objectMode = !!Q.objectMode, k && (this.objectMode = this.objectMode || !!Q.writableObjectMode), this.highWaterMark = h(this, Q, "writableHighWaterMark", k), this.finalCalled = !1, this.needDrain = !1, this.ending = !1, this.ended = !1, this.finished = !1, this.destroyed = !1;
    var ne = Q.decodeStrings === !1;
    this.decodeStrings = !ne, this.defaultEncoding = Q.defaultEncoding || "utf8", this.length = 0, this.writing = !1, this.corked = 0, this.sync = !0, this.bufferProcessing = !1, this.onwrite = function(te) {
      H(B, te);
    }, this.writecb = null, this.writelen = 0, this.bufferedRequest = null, this.lastBufferedRequest = null, this.pendingcb = 0, this.prefinished = !1, this.errorEmitted = !1, this.emitClose = Q.emitClose !== !1, this.autoDestroy = !!Q.autoDestroy, this.bufferedRequestCount = 0, this.corkedRequestsFree = new e(this);
  }
  R.prototype.getBuffer = function() {
    for (var B = this.bufferedRequest, k = []; B; )
      k.push(B), B = B.next;
    return k;
  }, function() {
    try {
      Object.defineProperty(R.prototype, "buffer", {
        get: n.deprecate(function() {
          return this.getBuffer();
        }, "_writableState.buffer is deprecated. Use _writableState.getBuffer instead.", "DEP0003")
      });
    } catch {
    }
  }();
  var I;
  typeof Symbol == "function" && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] == "function" ? (I = Function.prototype[Symbol.hasInstance], Object.defineProperty(q, Symbol.hasInstance, {
    value: function(B) {
      return I.call(this, B) ? !0 : this !== q ? !1 : B && B._writableState instanceof R;
    }
  })) : I = function(B) {
    return B instanceof this;
  };
  function q(Q) {
    t = t || hr();
    var B = this instanceof t;
    if (!B && !I.call(q, this))
      return new q(Q);
    this._writableState = new R(Q, this, B), this.writable = !0, Q && (typeof Q.write == "function" && (this._write = Q.write), typeof Q.writev == "function" && (this._writev = Q.writev), typeof Q.destroy == "function" && (this._destroy = Q.destroy), typeof Q.final == "function" && (this._final = Q.final)), r.call(this);
  }
  q.prototype.pipe = function() {
    E(this, new d());
  };
  function F(Q, B) {
    var k = new b();
    E(Q, k), _e.nextTick(B, k);
  }
  function ie(Q, B, k, ne) {
    var te;
    return k === null ? te = new l() : typeof k != "string" && !B.objectMode && (te = new w("chunk", ["string", "Buffer"], k)), te ? (E(Q, te), _e.nextTick(ne, te), !1) : !0;
  }
  q.prototype.write = function(Q, B, k) {
    var ne = this._writableState, te = !1, V = !ne.objectMode && o(Q);
    return V && !i.isBuffer(Q) && (Q = s(Q)), typeof B == "function" && (k = B, B = null), V ? B = "buffer" : B || (B = ne.defaultEncoding), typeof k != "function" && (k = C), ne.ending ? F(this, k) : (V || ie(this, ne, Q, k)) && (ne.pendingcb++, te = S(this, ne, V, Q, B, k)), te;
  }, q.prototype.cork = function() {
    this._writableState.corked++;
  }, q.prototype.uncork = function() {
    var Q = this._writableState;
    Q.corked && (Q.corked--, !Q.writing && !Q.corked && !Q.bufferProcessing && Q.bufferedRequest && z(this, Q));
  }, q.prototype.setDefaultEncoding = function(B) {
    if (typeof B == "string" && (B = B.toLowerCase()), !(["hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw"].indexOf((B + "").toLowerCase()) > -1))
      throw new _(B);
    return this._writableState.defaultEncoding = B, this;
  }, Object.defineProperty(q.prototype, "writableBuffer", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  function ce(Q, B, k) {
    return !Q.objectMode && Q.decodeStrings !== !1 && typeof B == "string" && (B = i.from(B, k)), B;
  }
  Object.defineProperty(q.prototype, "writableHighWaterMark", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState.highWaterMark;
    }
  });
  function S(Q, B, k, ne, te, V) {
    if (!k) {
      var N = ce(B, ne, te);
      ne !== N && (k = !0, te = "buffer", ne = N);
    }
    var oe = B.objectMode ? 1 : ne.length;
    B.length += oe;
    var m = B.length < B.highWaterMark;
    if (m || (B.needDrain = !0), B.writing || B.corked) {
      var $ = B.lastBufferedRequest;
      B.lastBufferedRequest = {
        chunk: ne,
        encoding: te,
        isBuf: k,
        callback: V,
        next: null
      }, $ ? $.next = B.lastBufferedRequest : B.bufferedRequest = B.lastBufferedRequest, B.bufferedRequestCount += 1;
    } else
      M(Q, B, !1, oe, ne, te, V);
    return m;
  }
  function M(Q, B, k, ne, te, V, N) {
    B.writelen = ne, B.writecb = N, B.writing = !0, B.sync = !0, B.destroyed ? B.onwrite(new v("write")) : k ? Q._writev(te, B.onwrite) : Q._write(te, V, B.onwrite), B.sync = !1;
  }
  function D(Q, B, k, ne, te) {
    --B.pendingcb, k ? (_e.nextTick(te, ne), _e.nextTick(G, Q, B), Q._writableState.errorEmitted = !0, E(Q, ne)) : (te(ne), Q._writableState.errorEmitted = !0, E(Q, ne), G(Q, B));
  }
  function X(Q) {
    Q.writing = !1, Q.writecb = null, Q.length -= Q.writelen, Q.writelen = 0;
  }
  function H(Q, B) {
    var k = Q._writableState, ne = k.sync, te = k.writecb;
    if (typeof te != "function")
      throw new x();
    if (X(k), B)
      D(Q, k, ne, B, te);
    else {
      var V = ae(k) || Q.destroyed;
      !V && !k.corked && !k.bufferProcessing && k.bufferedRequest && z(Q, k), ne ? _e.nextTick(P, Q, k, V, te) : P(Q, k, V, te);
    }
  }
  function P(Q, B, k, ne) {
    k || Z(Q, B), B.pendingcb--, ne(), G(Q, B);
  }
  function Z(Q, B) {
    B.length === 0 && B.needDrain && (B.needDrain = !1, Q.emit("drain"));
  }
  function z(Q, B) {
    B.bufferProcessing = !0;
    var k = B.bufferedRequest;
    if (Q._writev && k && k.next) {
      var ne = B.bufferedRequestCount, te = new Array(ne), V = B.corkedRequestsFree;
      V.entry = k;
      for (var N = 0, oe = !0; k; )
        te[N] = k, k.isBuf || (oe = !1), k = k.next, N += 1;
      te.allBuffers = oe, M(Q, B, !0, B.length, te, "", V.finish), B.pendingcb++, B.lastBufferedRequest = null, V.next ? (B.corkedRequestsFree = V.next, V.next = null) : B.corkedRequestsFree = new e(B), B.bufferedRequestCount = 0;
    } else {
      for (; k; ) {
        var m = k.chunk, $ = k.encoding, U = k.callback, f = B.objectMode ? 1 : m.length;
        if (M(Q, B, !1, f, m, $, U), k = k.next, B.bufferedRequestCount--, B.writing)
          break;
      }
      k === null && (B.lastBufferedRequest = null);
    }
    B.bufferedRequest = k, B.bufferProcessing = !1;
  }
  q.prototype._write = function(Q, B, k) {
    k(new p("_write()"));
  }, q.prototype._writev = null, q.prototype.end = function(Q, B, k) {
    var ne = this._writableState;
    return typeof Q == "function" ? (k = Q, Q = null, B = null) : typeof B == "function" && (k = B, B = null), Q != null && this.write(Q, B), ne.corked && (ne.corked = 1, this.uncork()), ne.ending || J(this, ne, k), this;
  }, Object.defineProperty(q.prototype, "writableLength", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState.length;
    }
  });
  function ae(Q) {
    return Q.ending && Q.length === 0 && Q.bufferedRequest === null && !Q.finished && !Q.writing;
  }
  function O(Q, B) {
    Q._final(function(k) {
      B.pendingcb--, k && E(Q, k), B.prefinished = !0, Q.emit("prefinish"), G(Q, B);
    });
  }
  function A(Q, B) {
    !B.prefinished && !B.finalCalled && (typeof Q._final == "function" && !B.destroyed ? (B.pendingcb++, B.finalCalled = !0, _e.nextTick(O, Q, B)) : (B.prefinished = !0, Q.emit("prefinish")));
  }
  function G(Q, B) {
    var k = ae(B);
    if (k && (A(Q, B), B.pendingcb === 0 && (B.finished = !0, Q.emit("finish"), B.autoDestroy))) {
      var ne = Q._readableState;
      (!ne || ne.autoDestroy && ne.endEmitted) && Q.destroy();
    }
    return k;
  }
  function J(Q, B, k) {
    B.ending = !0, G(Q, B), k && (B.finished ? _e.nextTick(k) : Q.once("finish", k)), B.ended = !0, Q.writable = !1;
  }
  function re(Q, B, k) {
    var ne = Q.entry;
    for (Q.entry = null; ne; ) {
      var te = ne.callback;
      B.pendingcb--, te(k), ne = ne.next;
    }
    B.corkedRequestsFree.next = Q;
  }
  return Object.defineProperty(q.prototype, "destroyed", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState === void 0 ? !1 : this._writableState.destroyed;
    },
    set: function(B) {
      this._writableState && (this._writableState.destroyed = B);
    }
  }), q.prototype.destroy = c.destroy, q.prototype._undestroy = c.undestroy, q.prototype._destroy = function(Q, B) {
    B(Q);
  }, jo;
}
var qo, od;
function hr() {
  if (od)
    return qo;
  od = 1;
  var e = Object.keys || function(u) {
    var h = [];
    for (var y in u)
      h.push(y);
    return h;
  };
  qo = s;
  var t = dp(), n = lp();
  Ln(s, t);
  for (var r = e(n.prototype), i = 0; i < r.length; i++) {
    var a = r[i];
    s.prototype[a] || (s.prototype[a] = n.prototype[a]);
  }
  function s(u) {
    if (!(this instanceof s))
      return new s(u);
    t.call(this, u), n.call(this, u), this.allowHalfOpen = !0, u && (u.readable === !1 && (this.readable = !1), u.writable === !1 && (this.writable = !1), u.allowHalfOpen === !1 && (this.allowHalfOpen = !1, this.once("end", o)));
  }
  Object.defineProperty(s.prototype, "writableHighWaterMark", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState.highWaterMark;
    }
  }), Object.defineProperty(s.prototype, "writableBuffer", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState && this._writableState.getBuffer();
    }
  }), Object.defineProperty(s.prototype, "writableLength", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._writableState.length;
    }
  });
  function o() {
    this._writableState.ended || _e.nextTick(c, this);
  }
  function c(u) {
    u.end();
  }
  return Object.defineProperty(s.prototype, "destroyed", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._readableState === void 0 || this._writableState === void 0 ? !1 : this._readableState.destroyed && this._writableState.destroyed;
    },
    set: function(h) {
      this._readableState === void 0 || this._writableState === void 0 || (this._readableState.destroyed = h, this._writableState.destroyed = h);
    }
  }), qo;
}
var Ho = {}, xi = { exports: {} }, sd;
function fb() {
  return sd || (sd = 1, function(e, t) {
    var n = ua(), r = n.Buffer;
    function i(s, o) {
      for (var c in s)
        o[c] = s[c];
    }
    r.from && r.alloc && r.allocUnsafe && r.allocUnsafeSlow ? e.exports = n : (i(n, t), t.Buffer = a);
    function a(s, o, c) {
      return r(s, o, c);
    }
    i(r, a), a.from = function(s, o, c) {
      if (typeof s == "number")
        throw new TypeError("Argument must not be a number");
      return r(s, o, c);
    }, a.alloc = function(s, o, c) {
      if (typeof s != "number")
        throw new TypeError("Argument must be a number");
      var u = r(s);
      return o !== void 0 ? typeof c == "string" ? u.fill(o, c) : u.fill(o) : u.fill(0), u;
    }, a.allocUnsafe = function(s) {
      if (typeof s != "number")
        throw new TypeError("Argument must be a number");
      return r(s);
    }, a.allocUnsafeSlow = function(s) {
      if (typeof s != "number")
        throw new TypeError("Argument must be a number");
      return n.SlowBuffer(s);
    };
  }(xi, xi.exports)), xi.exports;
}
var cd;
function Ac() {
  if (cd)
    return Ho;
  cd = 1;
  var e = fb().Buffer, t = e.isEncoding || function(l) {
    switch (l = "" + l, l && l.toLowerCase()) {
      case "hex":
      case "utf8":
      case "utf-8":
      case "ascii":
      case "binary":
      case "base64":
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
      case "raw":
        return !0;
      default:
        return !1;
    }
  };
  function n(l) {
    if (!l)
      return "utf8";
    for (var b; ; )
      switch (l) {
        case "utf8":
        case "utf-8":
          return "utf8";
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return "utf16le";
        case "latin1":
        case "binary":
          return "latin1";
        case "base64":
        case "ascii":
        case "hex":
          return l;
        default:
          if (b)
            return;
          l = ("" + l).toLowerCase(), b = !0;
      }
  }
  function r(l) {
    var b = n(l);
    if (typeof b != "string" && (e.isEncoding === t || !t(l)))
      throw new Error("Unknown encoding: " + l);
    return b || l;
  }
  Ho.StringDecoder = i;
  function i(l) {
    this.encoding = r(l);
    var b;
    switch (this.encoding) {
      case "utf16le":
        this.text = y, this.end = w, b = 4;
        break;
      case "utf8":
        this.fillLast = c, b = 4;
        break;
      case "base64":
        this.text = p, this.end = x, b = 3;
        break;
      default:
        this.write = d, this.end = v;
        return;
    }
    this.lastNeed = 0, this.lastTotal = 0, this.lastChar = e.allocUnsafe(b);
  }
  i.prototype.write = function(l) {
    if (l.length === 0)
      return "";
    var b, _;
    if (this.lastNeed) {
      if (b = this.fillLast(l), b === void 0)
        return "";
      _ = this.lastNeed, this.lastNeed = 0;
    } else
      _ = 0;
    return _ < l.length ? b ? b + this.text(l, _) : this.text(l, _) : b || "";
  }, i.prototype.end = h, i.prototype.text = u, i.prototype.fillLast = function(l) {
    if (this.lastNeed <= l.length)
      return l.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed), this.lastChar.toString(this.encoding, 0, this.lastTotal);
    l.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, l.length), this.lastNeed -= l.length;
  };
  function a(l) {
    return l <= 127 ? 0 : l >> 5 === 6 ? 2 : l >> 4 === 14 ? 3 : l >> 3 === 30 ? 4 : l >> 6 === 2 ? -1 : -2;
  }
  function s(l, b, _) {
    var E = b.length - 1;
    if (E < _)
      return 0;
    var C = a(b[E]);
    return C >= 0 ? (C > 0 && (l.lastNeed = C - 1), C) : --E < _ || C === -2 ? 0 : (C = a(b[E]), C >= 0 ? (C > 0 && (l.lastNeed = C - 2), C) : --E < _ || C === -2 ? 0 : (C = a(b[E]), C >= 0 ? (C > 0 && (C === 2 ? C = 0 : l.lastNeed = C - 3), C) : 0));
  }
  function o(l, b, _) {
    if ((b[0] & 192) !== 128)
      return l.lastNeed = 0, "�";
    if (l.lastNeed > 1 && b.length > 1) {
      if ((b[1] & 192) !== 128)
        return l.lastNeed = 1, "�";
      if (l.lastNeed > 2 && b.length > 2 && (b[2] & 192) !== 128)
        return l.lastNeed = 2, "�";
    }
  }
  function c(l) {
    var b = this.lastTotal - this.lastNeed, _ = o(this, l);
    if (_ !== void 0)
      return _;
    if (this.lastNeed <= l.length)
      return l.copy(this.lastChar, b, 0, this.lastNeed), this.lastChar.toString(this.encoding, 0, this.lastTotal);
    l.copy(this.lastChar, b, 0, l.length), this.lastNeed -= l.length;
  }
  function u(l, b) {
    var _ = s(this, l, b);
    if (!this.lastNeed)
      return l.toString("utf8", b);
    this.lastTotal = _;
    var E = l.length - (_ - this.lastNeed);
    return l.copy(this.lastChar, 0, E), l.toString("utf8", b, E);
  }
  function h(l) {
    var b = l && l.length ? this.write(l) : "";
    return this.lastNeed ? b + "�" : b;
  }
  function y(l, b) {
    if ((l.length - b) % 2 === 0) {
      var _ = l.toString("utf16le", b);
      if (_) {
        var E = _.charCodeAt(_.length - 1);
        if (E >= 55296 && E <= 56319)
          return this.lastNeed = 2, this.lastTotal = 4, this.lastChar[0] = l[l.length - 2], this.lastChar[1] = l[l.length - 1], _.slice(0, -1);
      }
      return _;
    }
    return this.lastNeed = 1, this.lastTotal = 2, this.lastChar[0] = l[l.length - 1], l.toString("utf16le", b, l.length - 1);
  }
  function w(l) {
    var b = l && l.length ? this.write(l) : "";
    if (this.lastNeed) {
      var _ = this.lastTotal - this.lastNeed;
      return b + this.lastChar.toString("utf16le", 0, _);
    }
    return b;
  }
  function p(l, b) {
    var _ = (l.length - b) % 3;
    return _ === 0 ? l.toString("base64", b) : (this.lastNeed = 3 - _, this.lastTotal = 3, _ === 1 ? this.lastChar[0] = l[l.length - 1] : (this.lastChar[0] = l[l.length - 2], this.lastChar[1] = l[l.length - 1]), l.toString("base64", b, l.length - _));
  }
  function x(l) {
    var b = l && l.length ? this.write(l) : "";
    return this.lastNeed ? b + this.lastChar.toString("base64", 0, 3 - this.lastNeed) : b;
  }
  function d(l) {
    return l.toString(this.encoding);
  }
  function v(l) {
    return l && l.length ? this.write(l) : "";
  }
  return Ho;
}
var Vo, ud;
function jc() {
  if (ud)
    return Vo;
  ud = 1;
  var e = Er().codes.ERR_STREAM_PREMATURE_CLOSE;
  function t(a) {
    var s = !1;
    return function() {
      if (!s) {
        s = !0;
        for (var o = arguments.length, c = new Array(o), u = 0; u < o; u++)
          c[u] = arguments[u];
        a.apply(this, c);
      }
    };
  }
  function n() {
  }
  function r(a) {
    return a.setHeader && typeof a.abort == "function";
  }
  function i(a, s, o) {
    if (typeof s == "function")
      return i(a, null, s);
    s || (s = {}), o = t(o || n);
    var c = s.readable || s.readable !== !1 && a.readable, u = s.writable || s.writable !== !1 && a.writable, h = function() {
      a.writable || w();
    }, y = a._writableState && a._writableState.finished, w = function() {
      u = !1, y = !0, c || o.call(a);
    }, p = a._readableState && a._readableState.endEmitted, x = function() {
      c = !1, p = !0, u || o.call(a);
    }, d = function(_) {
      o.call(a, _);
    }, v = function() {
      var _;
      if (c && !p)
        return (!a._readableState || !a._readableState.ended) && (_ = new e()), o.call(a, _);
      if (u && !y)
        return (!a._writableState || !a._writableState.ended) && (_ = new e()), o.call(a, _);
    }, l = function() {
      a.req.on("finish", w);
    };
    return r(a) ? (a.on("complete", w), a.on("abort", v), a.req ? l() : a.on("request", l)) : u && !a._writableState && (a.on("end", h), a.on("close", h)), a.on("end", x), a.on("finish", w), s.error !== !1 && a.on("error", d), a.on("close", v), function() {
      a.removeListener("complete", w), a.removeListener("abort", v), a.removeListener("request", l), a.req && a.req.removeListener("finish", w), a.removeListener("end", h), a.removeListener("close", h), a.removeListener("finish", w), a.removeListener("end", x), a.removeListener("error", d), a.removeListener("close", v);
    };
  }
  return Vo = i, Vo;
}
var Go, ld;
function pb() {
  if (ld)
    return Go;
  ld = 1;
  var e;
  function t(l, b, _) {
    return b in l ? Object.defineProperty(l, b, { value: _, enumerable: !0, configurable: !0, writable: !0 }) : l[b] = _, l;
  }
  var n = jc(), r = Symbol("lastResolve"), i = Symbol("lastReject"), a = Symbol("error"), s = Symbol("ended"), o = Symbol("lastPromise"), c = Symbol("handlePromise"), u = Symbol("stream");
  function h(l, b) {
    return {
      value: l,
      done: b
    };
  }
  function y(l) {
    var b = l[r];
    if (b !== null) {
      var _ = l[u].read();
      _ !== null && (l[o] = null, l[r] = null, l[i] = null, b(h(_, !1)));
    }
  }
  function w(l) {
    _e.nextTick(y, l);
  }
  function p(l, b) {
    return function(_, E) {
      l.then(function() {
        if (b[s]) {
          _(h(void 0, !0));
          return;
        }
        b[c](_, E);
      }, E);
    };
  }
  var x = Object.getPrototypeOf(function() {
  }), d = Object.setPrototypeOf((e = {
    get stream() {
      return this[u];
    },
    next: function() {
      var b = this, _ = this[a];
      if (_ !== null)
        return Promise.reject(_);
      if (this[s])
        return Promise.resolve(h(void 0, !0));
      if (this[u].destroyed)
        return new Promise(function(I, q) {
          _e.nextTick(function() {
            b[a] ? q(b[a]) : I(h(void 0, !0));
          });
        });
      var E = this[o], C;
      if (E)
        C = new Promise(p(E, this));
      else {
        var R = this[u].read();
        if (R !== null)
          return Promise.resolve(h(R, !1));
        C = new Promise(this[c]);
      }
      return this[o] = C, C;
    }
  }, t(e, Symbol.asyncIterator, function() {
    return this;
  }), t(e, "return", function() {
    var b = this;
    return new Promise(function(_, E) {
      b[u].destroy(null, function(C) {
        if (C) {
          E(C);
          return;
        }
        _(h(void 0, !0));
      });
    });
  }), e), x), v = function(b) {
    var _, E = Object.create(d, (_ = {}, t(_, u, {
      value: b,
      writable: !0
    }), t(_, r, {
      value: null,
      writable: !0
    }), t(_, i, {
      value: null,
      writable: !0
    }), t(_, a, {
      value: null,
      writable: !0
    }), t(_, s, {
      value: b._readableState.endEmitted,
      writable: !0
    }), t(_, c, {
      value: function(R, I) {
        var q = E[u].read();
        q ? (E[o] = null, E[r] = null, E[i] = null, R(h(q, !1))) : (E[r] = R, E[i] = I);
      },
      writable: !0
    }), _));
    return E[o] = null, n(b, function(C) {
      if (C && C.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        var R = E[i];
        R !== null && (E[o] = null, E[r] = null, E[i] = null, R(C)), E[a] = C;
        return;
      }
      var I = E[r];
      I !== null && (E[o] = null, E[r] = null, E[i] = null, I(h(void 0, !0))), E[s] = !0;
    }), b.on("readable", w.bind(null, E)), E;
  };
  return Go = v, Go;
}
var Xo, dd;
function gb() {
  return dd || (dd = 1, Xo = function() {
    throw new Error("Readable.from is not available in the browser");
  }), Xo;
}
var $o, hd;
function dp() {
  if (hd)
    return $o;
  hd = 1, $o = F;
  var e;
  F.ReadableState = q, Lc.EventEmitter;
  var t = function(N, oe) {
    return N.listeners(oe).length;
  }, n = tp(), r = ua().Buffer, i = jt.Uint8Array || function() {
  };
  function a(V) {
    return r.from(V);
  }
  function s(V) {
    return r.isBuffer(V) || V instanceof i;
  }
  var o = sp(), c;
  o && o.debuglog ? c = o.debuglog("stream") : c = function() {
  };
  var u = db(), h = cp(), y = up(), w = y.getHighWaterMark, p = Er().codes, x = p.ERR_INVALID_ARG_TYPE, d = p.ERR_STREAM_PUSH_AFTER_EOF, v = p.ERR_METHOD_NOT_IMPLEMENTED, l = p.ERR_STREAM_UNSHIFT_AFTER_END_EVENT, b, _, E;
  Ln(F, n);
  var C = h.errorOrDestroy, R = ["error", "close", "destroy", "pause", "resume"];
  function I(V, N, oe) {
    if (typeof V.prependListener == "function")
      return V.prependListener(N, oe);
    !V._events || !V._events[N] ? V.on(N, oe) : Array.isArray(V._events[N]) ? V._events[N].unshift(oe) : V._events[N] = [oe, V._events[N]];
  }
  function q(V, N, oe) {
    e = e || hr(), V = V || {}, typeof oe != "boolean" && (oe = N instanceof e), this.objectMode = !!V.objectMode, oe && (this.objectMode = this.objectMode || !!V.readableObjectMode), this.highWaterMark = w(this, V, "readableHighWaterMark", oe), this.buffer = new u(), this.length = 0, this.pipes = null, this.pipesCount = 0, this.flowing = null, this.ended = !1, this.endEmitted = !1, this.reading = !1, this.sync = !0, this.needReadable = !1, this.emittedReadable = !1, this.readableListening = !1, this.resumeScheduled = !1, this.paused = !0, this.emitClose = V.emitClose !== !1, this.autoDestroy = !!V.autoDestroy, this.destroyed = !1, this.defaultEncoding = V.defaultEncoding || "utf8", this.awaitDrain = 0, this.readingMore = !1, this.decoder = null, this.encoding = null, V.encoding && (b || (b = Ac().StringDecoder), this.decoder = new b(V.encoding), this.encoding = V.encoding);
  }
  function F(V) {
    if (e = e || hr(), !(this instanceof F))
      return new F(V);
    var N = this instanceof e;
    this._readableState = new q(V, this, N), this.readable = !0, V && (typeof V.read == "function" && (this._read = V.read), typeof V.destroy == "function" && (this._destroy = V.destroy)), n.call(this);
  }
  Object.defineProperty(F.prototype, "destroyed", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._readableState === void 0 ? !1 : this._readableState.destroyed;
    },
    set: function(N) {
      this._readableState && (this._readableState.destroyed = N);
    }
  }), F.prototype.destroy = h.destroy, F.prototype._undestroy = h.undestroy, F.prototype._destroy = function(V, N) {
    N(V);
  }, F.prototype.push = function(V, N) {
    var oe = this._readableState, m;
    return oe.objectMode ? m = !0 : typeof V == "string" && (N = N || oe.defaultEncoding, N !== oe.encoding && (V = r.from(V, N), N = ""), m = !0), ie(this, V, N, !1, m);
  }, F.prototype.unshift = function(V) {
    return ie(this, V, null, !0, !1);
  };
  function ie(V, N, oe, m, $) {
    c("readableAddChunk", N);
    var U = V._readableState;
    if (N === null)
      U.reading = !1, H(V, U);
    else {
      var f;
      if ($ || (f = S(U, N)), f)
        C(V, f);
      else if (U.objectMode || N && N.length > 0)
        if (typeof N != "string" && !U.objectMode && Object.getPrototypeOf(N) !== r.prototype && (N = a(N)), m)
          U.endEmitted ? C(V, new l()) : ce(V, U, N, !0);
        else if (U.ended)
          C(V, new d());
        else {
          if (U.destroyed)
            return !1;
          U.reading = !1, U.decoder && !oe ? (N = U.decoder.write(N), U.objectMode || N.length !== 0 ? ce(V, U, N, !1) : z(V, U)) : ce(V, U, N, !1);
        }
      else
        m || (U.reading = !1, z(V, U));
    }
    return !U.ended && (U.length < U.highWaterMark || U.length === 0);
  }
  function ce(V, N, oe, m) {
    N.flowing && N.length === 0 && !N.sync ? (N.awaitDrain = 0, V.emit("data", oe)) : (N.length += N.objectMode ? 1 : oe.length, m ? N.buffer.unshift(oe) : N.buffer.push(oe), N.needReadable && P(V)), z(V, N);
  }
  function S(V, N) {
    var oe;
    return !s(N) && typeof N != "string" && N !== void 0 && !V.objectMode && (oe = new x("chunk", ["string", "Buffer", "Uint8Array"], N)), oe;
  }
  F.prototype.isPaused = function() {
    return this._readableState.flowing === !1;
  }, F.prototype.setEncoding = function(V) {
    b || (b = Ac().StringDecoder);
    var N = new b(V);
    this._readableState.decoder = N, this._readableState.encoding = this._readableState.decoder.encoding;
    for (var oe = this._readableState.buffer.head, m = ""; oe !== null; )
      m += N.write(oe.data), oe = oe.next;
    return this._readableState.buffer.clear(), m !== "" && this._readableState.buffer.push(m), this._readableState.length = m.length, this;
  };
  var M = 1073741824;
  function D(V) {
    return V >= M ? V = M : (V--, V |= V >>> 1, V |= V >>> 2, V |= V >>> 4, V |= V >>> 8, V |= V >>> 16, V++), V;
  }
  function X(V, N) {
    return V <= 0 || N.length === 0 && N.ended ? 0 : N.objectMode ? 1 : V !== V ? N.flowing && N.length ? N.buffer.head.data.length : N.length : (V > N.highWaterMark && (N.highWaterMark = D(V)), V <= N.length ? V : N.ended ? N.length : (N.needReadable = !0, 0));
  }
  F.prototype.read = function(V) {
    c("read", V), V = parseInt(V, 10);
    var N = this._readableState, oe = V;
    if (V !== 0 && (N.emittedReadable = !1), V === 0 && N.needReadable && ((N.highWaterMark !== 0 ? N.length >= N.highWaterMark : N.length > 0) || N.ended))
      return c("read: emitReadable", N.length, N.ended), N.length === 0 && N.ended ? k(this) : P(this), null;
    if (V = X(V, N), V === 0 && N.ended)
      return N.length === 0 && k(this), null;
    var m = N.needReadable;
    c("need readable", m), (N.length === 0 || N.length - V < N.highWaterMark) && (m = !0, c("length less than watermark", m)), N.ended || N.reading ? (m = !1, c("reading or ended", m)) : m && (c("do read"), N.reading = !0, N.sync = !0, N.length === 0 && (N.needReadable = !0), this._read(N.highWaterMark), N.sync = !1, N.reading || (V = X(oe, N)));
    var $;
    return V > 0 ? $ = B(V, N) : $ = null, $ === null ? (N.needReadable = N.length <= N.highWaterMark, V = 0) : (N.length -= V, N.awaitDrain = 0), N.length === 0 && (N.ended || (N.needReadable = !0), oe !== V && N.ended && k(this)), $ !== null && this.emit("data", $), $;
  };
  function H(V, N) {
    if (c("onEofChunk"), !N.ended) {
      if (N.decoder) {
        var oe = N.decoder.end();
        oe && oe.length && (N.buffer.push(oe), N.length += N.objectMode ? 1 : oe.length);
      }
      N.ended = !0, N.sync ? P(V) : (N.needReadable = !1, N.emittedReadable || (N.emittedReadable = !0, Z(V)));
    }
  }
  function P(V) {
    var N = V._readableState;
    c("emitReadable", N.needReadable, N.emittedReadable), N.needReadable = !1, N.emittedReadable || (c("emitReadable", N.flowing), N.emittedReadable = !0, _e.nextTick(Z, V));
  }
  function Z(V) {
    var N = V._readableState;
    c("emitReadable_", N.destroyed, N.length, N.ended), !N.destroyed && (N.length || N.ended) && (V.emit("readable"), N.emittedReadable = !1), N.needReadable = !N.flowing && !N.ended && N.length <= N.highWaterMark, Q(V);
  }
  function z(V, N) {
    N.readingMore || (N.readingMore = !0, _e.nextTick(ae, V, N));
  }
  function ae(V, N) {
    for (; !N.reading && !N.ended && (N.length < N.highWaterMark || N.flowing && N.length === 0); ) {
      var oe = N.length;
      if (c("maybeReadMore read 0"), V.read(0), oe === N.length)
        break;
    }
    N.readingMore = !1;
  }
  F.prototype._read = function(V) {
    C(this, new v("_read()"));
  }, F.prototype.pipe = function(V, N) {
    var oe = this, m = this._readableState;
    switch (m.pipesCount) {
      case 0:
        m.pipes = V;
        break;
      case 1:
        m.pipes = [m.pipes, V];
        break;
      default:
        m.pipes.push(V);
        break;
    }
    m.pipesCount += 1, c("pipe count=%d opts=%j", m.pipesCount, N);
    var $ = (!N || N.end !== !1) && V !== _e.stdout && V !== _e.stderr, U = $ ? g : se;
    m.endEmitted ? _e.nextTick(U) : oe.once("end", U), V.on("unpipe", f);
    function f(he, fe) {
      c("onunpipe"), he === oe && fe && fe.hasUnpiped === !1 && (fe.hasUnpiped = !0, K());
    }
    function g() {
      c("onend"), V.end();
    }
    var T = O(oe);
    V.on("drain", T);
    var L = !1;
    function K() {
      c("cleanup"), V.removeListener("close", Y), V.removeListener("finish", ee), V.removeListener("drain", T), V.removeListener("error", j), V.removeListener("unpipe", f), oe.removeListener("end", g), oe.removeListener("end", se), oe.removeListener("data", W), L = !0, m.awaitDrain && (!V._writableState || V._writableState.needDrain) && T();
    }
    oe.on("data", W);
    function W(he) {
      c("ondata");
      var fe = V.write(he);
      c("dest.write", fe), fe === !1 && ((m.pipesCount === 1 && m.pipes === V || m.pipesCount > 1 && te(m.pipes, V) !== -1) && !L && (c("false write response, pause", m.awaitDrain), m.awaitDrain++), oe.pause());
    }
    function j(he) {
      c("onerror", he), se(), V.removeListener("error", j), t(V, "error") === 0 && C(V, he);
    }
    I(V, "error", j);
    function Y() {
      V.removeListener("finish", ee), se();
    }
    V.once("close", Y);
    function ee() {
      c("onfinish"), V.removeListener("close", Y), se();
    }
    V.once("finish", ee);
    function se() {
      c("unpipe"), oe.unpipe(V);
    }
    return V.emit("pipe", oe), m.flowing || (c("pipe resume"), oe.resume()), V;
  };
  function O(V) {
    return function() {
      var oe = V._readableState;
      c("pipeOnDrain", oe.awaitDrain), oe.awaitDrain && oe.awaitDrain--, oe.awaitDrain === 0 && t(V, "data") && (oe.flowing = !0, Q(V));
    };
  }
  F.prototype.unpipe = function(V) {
    var N = this._readableState, oe = {
      hasUnpiped: !1
    };
    if (N.pipesCount === 0)
      return this;
    if (N.pipesCount === 1)
      return V && V !== N.pipes ? this : (V || (V = N.pipes), N.pipes = null, N.pipesCount = 0, N.flowing = !1, V && V.emit("unpipe", this, oe), this);
    if (!V) {
      var m = N.pipes, $ = N.pipesCount;
      N.pipes = null, N.pipesCount = 0, N.flowing = !1;
      for (var U = 0; U < $; U++)
        m[U].emit("unpipe", this, {
          hasUnpiped: !1
        });
      return this;
    }
    var f = te(N.pipes, V);
    return f === -1 ? this : (N.pipes.splice(f, 1), N.pipesCount -= 1, N.pipesCount === 1 && (N.pipes = N.pipes[0]), V.emit("unpipe", this, oe), this);
  }, F.prototype.on = function(V, N) {
    var oe = n.prototype.on.call(this, V, N), m = this._readableState;
    return V === "data" ? (m.readableListening = this.listenerCount("readable") > 0, m.flowing !== !1 && this.resume()) : V === "readable" && !m.endEmitted && !m.readableListening && (m.readableListening = m.needReadable = !0, m.flowing = !1, m.emittedReadable = !1, c("on readable", m.length, m.reading), m.length ? P(this) : m.reading || _e.nextTick(G, this)), oe;
  }, F.prototype.addListener = F.prototype.on, F.prototype.removeListener = function(V, N) {
    var oe = n.prototype.removeListener.call(this, V, N);
    return V === "readable" && _e.nextTick(A, this), oe;
  }, F.prototype.removeAllListeners = function(V) {
    var N = n.prototype.removeAllListeners.apply(this, arguments);
    return (V === "readable" || V === void 0) && _e.nextTick(A, this), N;
  };
  function A(V) {
    var N = V._readableState;
    N.readableListening = V.listenerCount("readable") > 0, N.resumeScheduled && !N.paused ? N.flowing = !0 : V.listenerCount("data") > 0 && V.resume();
  }
  function G(V) {
    c("readable nexttick read 0"), V.read(0);
  }
  F.prototype.resume = function() {
    var V = this._readableState;
    return V.flowing || (c("resume"), V.flowing = !V.readableListening, J(this, V)), V.paused = !1, this;
  };
  function J(V, N) {
    N.resumeScheduled || (N.resumeScheduled = !0, _e.nextTick(re, V, N));
  }
  function re(V, N) {
    c("resume", N.reading), N.reading || V.read(0), N.resumeScheduled = !1, V.emit("resume"), Q(V), N.flowing && !N.reading && V.read(0);
  }
  F.prototype.pause = function() {
    return c("call pause flowing=%j", this._readableState.flowing), this._readableState.flowing !== !1 && (c("pause"), this._readableState.flowing = !1, this.emit("pause")), this._readableState.paused = !0, this;
  };
  function Q(V) {
    var N = V._readableState;
    for (c("flow", N.flowing); N.flowing && V.read() !== null; )
      ;
  }
  F.prototype.wrap = function(V) {
    var N = this, oe = this._readableState, m = !1;
    V.on("end", function() {
      if (c("wrapped end"), oe.decoder && !oe.ended) {
        var f = oe.decoder.end();
        f && f.length && N.push(f);
      }
      N.push(null);
    }), V.on("data", function(f) {
      if (c("wrapped data"), oe.decoder && (f = oe.decoder.write(f)), !(oe.objectMode && f == null) && !(!oe.objectMode && (!f || !f.length))) {
        var g = N.push(f);
        g || (m = !0, V.pause());
      }
    });
    for (var $ in V)
      this[$] === void 0 && typeof V[$] == "function" && (this[$] = /* @__PURE__ */ function(g) {
        return function() {
          return V[g].apply(V, arguments);
        };
      }($));
    for (var U = 0; U < R.length; U++)
      V.on(R[U], this.emit.bind(this, R[U]));
    return this._read = function(f) {
      c("wrapped _read", f), m && (m = !1, V.resume());
    }, this;
  }, typeof Symbol == "function" && (F.prototype[Symbol.asyncIterator] = function() {
    return _ === void 0 && (_ = pb()), _(this);
  }), Object.defineProperty(F.prototype, "readableHighWaterMark", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._readableState.highWaterMark;
    }
  }), Object.defineProperty(F.prototype, "readableBuffer", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._readableState && this._readableState.buffer;
    }
  }), Object.defineProperty(F.prototype, "readableFlowing", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._readableState.flowing;
    },
    set: function(N) {
      this._readableState && (this._readableState.flowing = N);
    }
  }), F._fromList = B, Object.defineProperty(F.prototype, "readableLength", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: !1,
    get: function() {
      return this._readableState.length;
    }
  });
  function B(V, N) {
    if (N.length === 0)
      return null;
    var oe;
    return N.objectMode ? oe = N.buffer.shift() : !V || V >= N.length ? (N.decoder ? oe = N.buffer.join("") : N.buffer.length === 1 ? oe = N.buffer.first() : oe = N.buffer.concat(N.length), N.buffer.clear()) : oe = N.buffer.consume(V, N.decoder), oe;
  }
  function k(V) {
    var N = V._readableState;
    c("endReadable", N.endEmitted), N.endEmitted || (N.ended = !0, _e.nextTick(ne, N, V));
  }
  function ne(V, N) {
    if (c("endReadableNT", V.endEmitted, V.length), !V.endEmitted && V.length === 0 && (V.endEmitted = !0, N.readable = !1, N.emit("end"), V.autoDestroy)) {
      var oe = N._writableState;
      (!oe || oe.autoDestroy && oe.finished) && N.destroy();
    }
  }
  typeof Symbol == "function" && (F.from = function(V, N) {
    return E === void 0 && (E = gb()), E(F, V, N);
  });
  function te(V, N) {
    for (var oe = 0, m = V.length; oe < m; oe++)
      if (V[oe] === N)
        return oe;
    return -1;
  }
  return $o;
}
var Ko, fd;
function hp() {
  if (fd)
    return Ko;
  fd = 1, Ko = o;
  var e = Er().codes, t = e.ERR_METHOD_NOT_IMPLEMENTED, n = e.ERR_MULTIPLE_CALLBACK, r = e.ERR_TRANSFORM_ALREADY_TRANSFORMING, i = e.ERR_TRANSFORM_WITH_LENGTH_0, a = hr();
  Ln(o, a);
  function s(h, y) {
    var w = this._transformState;
    w.transforming = !1;
    var p = w.writecb;
    if (p === null)
      return this.emit("error", new n());
    w.writechunk = null, w.writecb = null, y != null && this.push(y), p(h);
    var x = this._readableState;
    x.reading = !1, (x.needReadable || x.length < x.highWaterMark) && this._read(x.highWaterMark);
  }
  function o(h) {
    if (!(this instanceof o))
      return new o(h);
    a.call(this, h), this._transformState = {
      afterTransform: s.bind(this),
      needTransform: !1,
      transforming: !1,
      writecb: null,
      writechunk: null,
      writeencoding: null
    }, this._readableState.needReadable = !0, this._readableState.sync = !1, h && (typeof h.transform == "function" && (this._transform = h.transform), typeof h.flush == "function" && (this._flush = h.flush)), this.on("prefinish", c);
  }
  function c() {
    var h = this;
    typeof this._flush == "function" && !this._readableState.destroyed ? this._flush(function(y, w) {
      u(h, y, w);
    }) : u(this, null, null);
  }
  o.prototype.push = function(h, y) {
    return this._transformState.needTransform = !1, a.prototype.push.call(this, h, y);
  }, o.prototype._transform = function(h, y, w) {
    w(new t("_transform()"));
  }, o.prototype._write = function(h, y, w) {
    var p = this._transformState;
    if (p.writecb = w, p.writechunk = h, p.writeencoding = y, !p.transforming) {
      var x = this._readableState;
      (p.needTransform || x.needReadable || x.length < x.highWaterMark) && this._read(x.highWaterMark);
    }
  }, o.prototype._read = function(h) {
    var y = this._transformState;
    y.writechunk !== null && !y.transforming ? (y.transforming = !0, this._transform(y.writechunk, y.writeencoding, y.afterTransform)) : y.needTransform = !0;
  }, o.prototype._destroy = function(h, y) {
    a.prototype._destroy.call(this, h, function(w) {
      y(w);
    });
  };
  function u(h, y, w) {
    if (y)
      return h.emit("error", y);
    if (w != null && h.push(w), h._writableState.length)
      throw new i();
    if (h._transformState.transforming)
      throw new r();
    return h.push(null);
  }
  return Ko;
}
var Zo, pd;
function mb() {
  if (pd)
    return Zo;
  pd = 1, Zo = t;
  var e = hp();
  Ln(t, e);
  function t(n) {
    if (!(this instanceof t))
      return new t(n);
    e.call(this, n);
  }
  return t.prototype._transform = function(n, r, i) {
    i(null, n);
  }, Zo;
}
var Yo, gd;
function yb() {
  if (gd)
    return Yo;
  gd = 1;
  var e;
  function t(w) {
    var p = !1;
    return function() {
      p || (p = !0, w.apply(void 0, arguments));
    };
  }
  var n = Er().codes, r = n.ERR_MISSING_ARGS, i = n.ERR_STREAM_DESTROYED;
  function a(w) {
    if (w)
      throw w;
  }
  function s(w) {
    return w.setHeader && typeof w.abort == "function";
  }
  function o(w, p, x, d) {
    d = t(d);
    var v = !1;
    w.on("close", function() {
      v = !0;
    }), e === void 0 && (e = jc()), e(w, {
      readable: p,
      writable: x
    }, function(b) {
      if (b)
        return d(b);
      v = !0, d();
    });
    var l = !1;
    return function(b) {
      if (!v && !l) {
        if (l = !0, s(w))
          return w.abort();
        if (typeof w.destroy == "function")
          return w.destroy();
        d(b || new i("pipe"));
      }
    };
  }
  function c(w) {
    w();
  }
  function u(w, p) {
    return w.pipe(p);
  }
  function h(w) {
    return !w.length || typeof w[w.length - 1] != "function" ? a : w.pop();
  }
  function y() {
    for (var w = arguments.length, p = new Array(w), x = 0; x < w; x++)
      p[x] = arguments[x];
    var d = h(p);
    if (Array.isArray(p[0]) && (p = p[0]), p.length < 2)
      throw new r("streams");
    var v, l = p.map(function(b, _) {
      var E = _ < p.length - 1, C = _ > 0;
      return o(b, E, C, function(R) {
        v || (v = R), R && l.forEach(c), !E && (l.forEach(c), d(v));
      });
    });
    return p.reduce(u);
  }
  return Yo = y, Yo;
}
var qc = Ft, Hc = Lc.EventEmitter, bb = Ln;
bb(Ft, Hc);
Ft.Readable = dp();
Ft.Writable = lp();
Ft.Duplex = hr();
Ft.Transform = hp();
Ft.PassThrough = mb();
Ft.finished = jc();
Ft.pipeline = yb();
Ft.Stream = Ft;
function Ft() {
  Hc.call(this);
}
Ft.prototype.pipe = function(e, t) {
  var n = this;
  function r(h) {
    e.writable && e.write(h) === !1 && n.pause && n.pause();
  }
  n.on("data", r);
  function i() {
    n.readable && n.resume && n.resume();
  }
  e.on("drain", i), !e._isStdio && (!t || t.end !== !1) && (n.on("end", s), n.on("close", o));
  var a = !1;
  function s() {
    a || (a = !0, e.end());
  }
  function o() {
    a || (a = !0, typeof e.destroy == "function" && e.destroy());
  }
  function c(h) {
    if (u(), Hc.listenerCount(this, "error") === 0)
      throw h;
  }
  n.on("error", c), e.on("error", c);
  function u() {
    n.removeListener("data", r), e.removeListener("drain", i), n.removeListener("end", s), n.removeListener("close", o), n.removeListener("error", c), e.removeListener("error", c), n.removeListener("end", u), n.removeListener("close", u), e.removeListener("close", u);
  }
  return n.on("end", u), n.on("close", u), e.on("close", u), e.emit("pipe", n), e;
};
(function(e) {
  (function(t) {
    t.parser = function(B, k) {
      return new r(B, k);
    }, t.SAXParser = r, t.SAXStream = h, t.createStream = u, t.MAX_BUFFER_LENGTH = 64 * 1024;
    var n = [
      "comment",
      "sgmlDecl",
      "textNode",
      "tagName",
      "doctype",
      "procInstName",
      "procInstBody",
      "entity",
      "attribName",
      "attribValue",
      "cdata",
      "script"
    ];
    t.EVENTS = [
      "text",
      "processinginstruction",
      "sgmldeclaration",
      "doctype",
      "comment",
      "opentagstart",
      "attribute",
      "opentag",
      "closetag",
      "opencdata",
      "cdata",
      "closecdata",
      "error",
      "end",
      "ready",
      "script",
      "opennamespace",
      "closenamespace"
    ];
    function r(B, k) {
      if (!(this instanceof r))
        return new r(B, k);
      var ne = this;
      a(ne), ne.q = ne.c = "", ne.bufferCheckPosition = t.MAX_BUFFER_LENGTH, ne.opt = k || {}, ne.opt.lowercase = ne.opt.lowercase || ne.opt.lowercasetags, ne.looseCase = ne.opt.lowercase ? "toLowerCase" : "toUpperCase", ne.tags = [], ne.closed = ne.closedRoot = ne.sawRoot = !1, ne.tag = ne.error = null, ne.strict = !!B, ne.noscript = !!(B || ne.opt.noscript), ne.state = F.BEGIN, ne.strictEntities = ne.opt.strictEntities, ne.ENTITIES = ne.strictEntities ? Object.create(t.XML_ENTITIES) : Object.create(t.ENTITIES), ne.attribList = [], ne.opt.xmlns && (ne.ns = Object.create(d)), ne.trackPosition = ne.opt.position !== !1, ne.trackPosition && (ne.position = ne.line = ne.column = 0), ce(ne, "onready");
    }
    Object.create || (Object.create = function(B) {
      function k() {
      }
      k.prototype = B;
      var ne = new k();
      return ne;
    }), Object.keys || (Object.keys = function(B) {
      var k = [];
      for (var ne in B)
        B.hasOwnProperty(ne) && k.push(ne);
      return k;
    });
    function i(B) {
      for (var k = Math.max(t.MAX_BUFFER_LENGTH, 10), ne = 0, te = 0, V = n.length; te < V; te++) {
        var N = B[n[te]].length;
        if (N > k)
          switch (n[te]) {
            case "textNode":
              M(B);
              break;
            case "cdata":
              S(B, "oncdata", B.cdata), B.cdata = "";
              break;
            case "script":
              S(B, "onscript", B.script), B.script = "";
              break;
            default:
              X(B, "Max buffer length exceeded: " + n[te]);
          }
        ne = Math.max(ne, N);
      }
      var oe = t.MAX_BUFFER_LENGTH - ne;
      B.bufferCheckPosition = oe + B.position;
    }
    function a(B) {
      for (var k = 0, ne = n.length; k < ne; k++)
        B[n[k]] = "";
    }
    function s(B) {
      M(B), B.cdata !== "" && (S(B, "oncdata", B.cdata), B.cdata = ""), B.script !== "" && (S(B, "onscript", B.script), B.script = "");
    }
    r.prototype = {
      end: function() {
        H(this);
      },
      write: Q,
      resume: function() {
        return this.error = null, this;
      },
      close: function() {
        return this.write(null);
      },
      flush: function() {
        s(this);
      }
    };
    var o;
    try {
      o = qc.Stream;
    } catch {
      o = function() {
      };
    }
    var c = t.EVENTS.filter(function(B) {
      return B !== "error" && B !== "end";
    });
    function u(B, k) {
      return new h(B, k);
    }
    function h(B, k) {
      if (!(this instanceof h))
        return new h(B, k);
      o.apply(this), this._parser = new r(B, k), this.writable = !0, this.readable = !0;
      var ne = this;
      this._parser.onend = function() {
        ne.emit("end");
      }, this._parser.onerror = function(te) {
        ne.emit("error", te), ne._parser.error = null;
      }, this._decoder = null, c.forEach(function(te) {
        Object.defineProperty(ne, "on" + te, {
          get: function() {
            return ne._parser["on" + te];
          },
          set: function(V) {
            if (!V)
              return ne.removeAllListeners(te), ne._parser["on" + te] = V, V;
            ne.on(te, V);
          },
          enumerable: !0,
          configurable: !1
        });
      });
    }
    h.prototype = Object.create(o.prototype, {
      constructor: {
        value: h
      }
    }), h.prototype.write = function(B) {
      if (typeof Buffer == "function" && typeof Buffer.isBuffer == "function" && Buffer.isBuffer(B)) {
        if (!this._decoder) {
          var k = Ac().StringDecoder;
          this._decoder = new k("utf8");
        }
        B = this._decoder.write(B);
      }
      return this._parser.write(B.toString()), this.emit("data", B), !0;
    }, h.prototype.end = function(B) {
      return B && B.length && this.write(B), this._parser.end(), !0;
    }, h.prototype.on = function(B, k) {
      var ne = this;
      return !ne._parser["on" + B] && c.indexOf(B) !== -1 && (ne._parser["on" + B] = function() {
        var te = arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments);
        te.splice(0, 0, B), ne.emit.apply(ne, te);
      }), o.prototype.on.call(ne, B, k);
    };
    var y = "[CDATA[", w = "DOCTYPE", p = "http://www.w3.org/XML/1998/namespace", x = "http://www.w3.org/2000/xmlns/", d = { xml: p, xmlns: x }, v = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/, l = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/, b = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/, _ = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;
    function E(B) {
      return B === " " || B === `
` || B === "\r" || B === "	";
    }
    function C(B) {
      return B === '"' || B === "'";
    }
    function R(B) {
      return B === ">" || E(B);
    }
    function I(B, k) {
      return B.test(k);
    }
    function q(B, k) {
      return !I(B, k);
    }
    var F = 0;
    t.STATE = {
      BEGIN: F++,
      // leading byte order mark or whitespace
      BEGIN_WHITESPACE: F++,
      // leading whitespace
      TEXT: F++,
      // general stuff
      TEXT_ENTITY: F++,
      // &amp and such.
      OPEN_WAKA: F++,
      // <
      SGML_DECL: F++,
      // <!BLARG
      SGML_DECL_QUOTED: F++,
      // <!BLARG foo "bar
      DOCTYPE: F++,
      // <!DOCTYPE
      DOCTYPE_QUOTED: F++,
      // <!DOCTYPE "//blah
      DOCTYPE_DTD: F++,
      // <!DOCTYPE "//blah" [ ...
      DOCTYPE_DTD_QUOTED: F++,
      // <!DOCTYPE "//blah" [ "foo
      COMMENT_STARTING: F++,
      // <!-
      COMMENT: F++,
      // <!--
      COMMENT_ENDING: F++,
      // <!-- blah -
      COMMENT_ENDED: F++,
      // <!-- blah --
      CDATA: F++,
      // <![CDATA[ something
      CDATA_ENDING: F++,
      // ]
      CDATA_ENDING_2: F++,
      // ]]
      PROC_INST: F++,
      // <?hi
      PROC_INST_BODY: F++,
      // <?hi there
      PROC_INST_ENDING: F++,
      // <?hi "there" ?
      OPEN_TAG: F++,
      // <strong
      OPEN_TAG_SLASH: F++,
      // <strong /
      ATTRIB: F++,
      // <a
      ATTRIB_NAME: F++,
      // <a foo
      ATTRIB_NAME_SAW_WHITE: F++,
      // <a foo _
      ATTRIB_VALUE: F++,
      // <a foo=
      ATTRIB_VALUE_QUOTED: F++,
      // <a foo="bar
      ATTRIB_VALUE_CLOSED: F++,
      // <a foo="bar"
      ATTRIB_VALUE_UNQUOTED: F++,
      // <a foo=bar
      ATTRIB_VALUE_ENTITY_Q: F++,
      // <foo bar="&quot;"
      ATTRIB_VALUE_ENTITY_U: F++,
      // <foo bar=&quot
      CLOSE_TAG: F++,
      // </a
      CLOSE_TAG_SAW_WHITE: F++,
      // </a   >
      SCRIPT: F++,
      // <script> ...
      SCRIPT_ENDING: F++
      // <script> ... <
    }, t.XML_ENTITIES = {
      amp: "&",
      gt: ">",
      lt: "<",
      quot: '"',
      apos: "'"
    }, t.ENTITIES = {
      amp: "&",
      gt: ">",
      lt: "<",
      quot: '"',
      apos: "'",
      AElig: 198,
      Aacute: 193,
      Acirc: 194,
      Agrave: 192,
      Aring: 197,
      Atilde: 195,
      Auml: 196,
      Ccedil: 199,
      ETH: 208,
      Eacute: 201,
      Ecirc: 202,
      Egrave: 200,
      Euml: 203,
      Iacute: 205,
      Icirc: 206,
      Igrave: 204,
      Iuml: 207,
      Ntilde: 209,
      Oacute: 211,
      Ocirc: 212,
      Ograve: 210,
      Oslash: 216,
      Otilde: 213,
      Ouml: 214,
      THORN: 222,
      Uacute: 218,
      Ucirc: 219,
      Ugrave: 217,
      Uuml: 220,
      Yacute: 221,
      aacute: 225,
      acirc: 226,
      aelig: 230,
      agrave: 224,
      aring: 229,
      atilde: 227,
      auml: 228,
      ccedil: 231,
      eacute: 233,
      ecirc: 234,
      egrave: 232,
      eth: 240,
      euml: 235,
      iacute: 237,
      icirc: 238,
      igrave: 236,
      iuml: 239,
      ntilde: 241,
      oacute: 243,
      ocirc: 244,
      ograve: 242,
      oslash: 248,
      otilde: 245,
      ouml: 246,
      szlig: 223,
      thorn: 254,
      uacute: 250,
      ucirc: 251,
      ugrave: 249,
      uuml: 252,
      yacute: 253,
      yuml: 255,
      copy: 169,
      reg: 174,
      nbsp: 160,
      iexcl: 161,
      cent: 162,
      pound: 163,
      curren: 164,
      yen: 165,
      brvbar: 166,
      sect: 167,
      uml: 168,
      ordf: 170,
      laquo: 171,
      not: 172,
      shy: 173,
      macr: 175,
      deg: 176,
      plusmn: 177,
      sup1: 185,
      sup2: 178,
      sup3: 179,
      acute: 180,
      micro: 181,
      para: 182,
      middot: 183,
      cedil: 184,
      ordm: 186,
      raquo: 187,
      frac14: 188,
      frac12: 189,
      frac34: 190,
      iquest: 191,
      times: 215,
      divide: 247,
      OElig: 338,
      oelig: 339,
      Scaron: 352,
      scaron: 353,
      Yuml: 376,
      fnof: 402,
      circ: 710,
      tilde: 732,
      Alpha: 913,
      Beta: 914,
      Gamma: 915,
      Delta: 916,
      Epsilon: 917,
      Zeta: 918,
      Eta: 919,
      Theta: 920,
      Iota: 921,
      Kappa: 922,
      Lambda: 923,
      Mu: 924,
      Nu: 925,
      Xi: 926,
      Omicron: 927,
      Pi: 928,
      Rho: 929,
      Sigma: 931,
      Tau: 932,
      Upsilon: 933,
      Phi: 934,
      Chi: 935,
      Psi: 936,
      Omega: 937,
      alpha: 945,
      beta: 946,
      gamma: 947,
      delta: 948,
      epsilon: 949,
      zeta: 950,
      eta: 951,
      theta: 952,
      iota: 953,
      kappa: 954,
      lambda: 955,
      mu: 956,
      nu: 957,
      xi: 958,
      omicron: 959,
      pi: 960,
      rho: 961,
      sigmaf: 962,
      sigma: 963,
      tau: 964,
      upsilon: 965,
      phi: 966,
      chi: 967,
      psi: 968,
      omega: 969,
      thetasym: 977,
      upsih: 978,
      piv: 982,
      ensp: 8194,
      emsp: 8195,
      thinsp: 8201,
      zwnj: 8204,
      zwj: 8205,
      lrm: 8206,
      rlm: 8207,
      ndash: 8211,
      mdash: 8212,
      lsquo: 8216,
      rsquo: 8217,
      sbquo: 8218,
      ldquo: 8220,
      rdquo: 8221,
      bdquo: 8222,
      dagger: 8224,
      Dagger: 8225,
      bull: 8226,
      hellip: 8230,
      permil: 8240,
      prime: 8242,
      Prime: 8243,
      lsaquo: 8249,
      rsaquo: 8250,
      oline: 8254,
      frasl: 8260,
      euro: 8364,
      image: 8465,
      weierp: 8472,
      real: 8476,
      trade: 8482,
      alefsym: 8501,
      larr: 8592,
      uarr: 8593,
      rarr: 8594,
      darr: 8595,
      harr: 8596,
      crarr: 8629,
      lArr: 8656,
      uArr: 8657,
      rArr: 8658,
      dArr: 8659,
      hArr: 8660,
      forall: 8704,
      part: 8706,
      exist: 8707,
      empty: 8709,
      nabla: 8711,
      isin: 8712,
      notin: 8713,
      ni: 8715,
      prod: 8719,
      sum: 8721,
      minus: 8722,
      lowast: 8727,
      radic: 8730,
      prop: 8733,
      infin: 8734,
      ang: 8736,
      and: 8743,
      or: 8744,
      cap: 8745,
      cup: 8746,
      int: 8747,
      there4: 8756,
      sim: 8764,
      cong: 8773,
      asymp: 8776,
      ne: 8800,
      equiv: 8801,
      le: 8804,
      ge: 8805,
      sub: 8834,
      sup: 8835,
      nsub: 8836,
      sube: 8838,
      supe: 8839,
      oplus: 8853,
      otimes: 8855,
      perp: 8869,
      sdot: 8901,
      lceil: 8968,
      rceil: 8969,
      lfloor: 8970,
      rfloor: 8971,
      lang: 9001,
      rang: 9002,
      loz: 9674,
      spades: 9824,
      clubs: 9827,
      hearts: 9829,
      diams: 9830
    }, Object.keys(t.ENTITIES).forEach(function(B) {
      var k = t.ENTITIES[B], ne = typeof k == "number" ? String.fromCharCode(k) : k;
      t.ENTITIES[B] = ne;
    });
    for (var ie in t.STATE)
      t.STATE[t.STATE[ie]] = ie;
    F = t.STATE;
    function ce(B, k, ne) {
      B[k] && B[k](ne);
    }
    function S(B, k, ne) {
      B.textNode && M(B), ce(B, k, ne);
    }
    function M(B) {
      B.textNode = D(B.opt, B.textNode), B.textNode && ce(B, "ontext", B.textNode), B.textNode = "";
    }
    function D(B, k) {
      return B.trim && (k = k.trim()), B.normalize && (k = k.replace(/\s+/g, " ")), k;
    }
    function X(B, k) {
      return M(B), B.trackPosition && (k += `
Line: ` + B.line + `
Column: ` + B.column + `
Char: ` + B.c), k = new Error(k), B.error = k, ce(B, "onerror", k), B;
    }
    function H(B) {
      return B.sawRoot && !B.closedRoot && P(B, "Unclosed root tag"), B.state !== F.BEGIN && B.state !== F.BEGIN_WHITESPACE && B.state !== F.TEXT && X(B, "Unexpected end"), M(B), B.c = "", B.closed = !0, ce(B, "onend"), r.call(B, B.strict, B.opt), B;
    }
    function P(B, k) {
      if (typeof B != "object" || !(B instanceof r))
        throw new Error("bad call to strictFail");
      B.strict && X(B, k);
    }
    function Z(B) {
      B.strict || (B.tagName = B.tagName[B.looseCase]());
      var k = B.tags[B.tags.length - 1] || B, ne = B.tag = { name: B.tagName, attributes: {} };
      B.opt.xmlns && (ne.ns = k.ns), B.attribList.length = 0, S(B, "onopentagstart", ne);
    }
    function z(B, k) {
      var ne = B.indexOf(":"), te = ne < 0 ? ["", B] : B.split(":"), V = te[0], N = te[1];
      return k && B === "xmlns" && (V = "xmlns", N = ""), { prefix: V, local: N };
    }
    function ae(B) {
      if (B.strict || (B.attribName = B.attribName[B.looseCase]()), B.attribList.indexOf(B.attribName) !== -1 || B.tag.attributes.hasOwnProperty(B.attribName)) {
        B.attribName = B.attribValue = "";
        return;
      }
      if (B.opt.xmlns) {
        var k = z(B.attribName, !0), ne = k.prefix, te = k.local;
        if (ne === "xmlns")
          if (te === "xml" && B.attribValue !== p)
            P(
              B,
              "xml: prefix must be bound to " + p + `
Actual: ` + B.attribValue
            );
          else if (te === "xmlns" && B.attribValue !== x)
            P(
              B,
              "xmlns: prefix must be bound to " + x + `
Actual: ` + B.attribValue
            );
          else {
            var V = B.tag, N = B.tags[B.tags.length - 1] || B;
            V.ns === N.ns && (V.ns = Object.create(N.ns)), V.ns[te] = B.attribValue;
          }
        B.attribList.push([B.attribName, B.attribValue]);
      } else
        B.tag.attributes[B.attribName] = B.attribValue, S(B, "onattribute", {
          name: B.attribName,
          value: B.attribValue
        });
      B.attribName = B.attribValue = "";
    }
    function O(B, k) {
      if (B.opt.xmlns) {
        var ne = B.tag, te = z(B.tagName);
        ne.prefix = te.prefix, ne.local = te.local, ne.uri = ne.ns[te.prefix] || "", ne.prefix && !ne.uri && (P(B, "Unbound namespace prefix: " + JSON.stringify(B.tagName)), ne.uri = te.prefix);
        var V = B.tags[B.tags.length - 1] || B;
        ne.ns && V.ns !== ne.ns && Object.keys(ne.ns).forEach(function(W) {
          S(B, "onopennamespace", {
            prefix: W,
            uri: ne.ns[W]
          });
        });
        for (var N = 0, oe = B.attribList.length; N < oe; N++) {
          var m = B.attribList[N], $ = m[0], U = m[1], f = z($, !0), g = f.prefix, T = f.local, L = g === "" ? "" : ne.ns[g] || "", K = {
            name: $,
            value: U,
            prefix: g,
            local: T,
            uri: L
          };
          g && g !== "xmlns" && !L && (P(B, "Unbound namespace prefix: " + JSON.stringify(g)), K.uri = g), B.tag.attributes[$] = K, S(B, "onattribute", K);
        }
        B.attribList.length = 0;
      }
      B.tag.isSelfClosing = !!k, B.sawRoot = !0, B.tags.push(B.tag), S(B, "onopentag", B.tag), k || (!B.noscript && B.tagName.toLowerCase() === "script" ? B.state = F.SCRIPT : B.state = F.TEXT, B.tag = null, B.tagName = ""), B.attribName = B.attribValue = "", B.attribList.length = 0;
    }
    function A(B) {
      if (!B.tagName) {
        P(B, "Weird empty close tag."), B.textNode += "</>", B.state = F.TEXT;
        return;
      }
      if (B.script) {
        if (B.tagName !== "script") {
          B.script += "</" + B.tagName + ">", B.tagName = "", B.state = F.SCRIPT;
          return;
        }
        S(B, "onscript", B.script), B.script = "";
      }
      var k = B.tags.length, ne = B.tagName;
      B.strict || (ne = ne[B.looseCase]());
      for (var te = ne; k--; ) {
        var V = B.tags[k];
        if (V.name !== te)
          P(B, "Unexpected close tag");
        else
          break;
      }
      if (k < 0) {
        P(B, "Unmatched closing tag: " + B.tagName), B.textNode += "</" + B.tagName + ">", B.state = F.TEXT;
        return;
      }
      B.tagName = ne;
      for (var N = B.tags.length; N-- > k; ) {
        var oe = B.tag = B.tags.pop();
        B.tagName = B.tag.name, S(B, "onclosetag", B.tagName);
        var m = {};
        for (var $ in oe.ns)
          m[$] = oe.ns[$];
        var U = B.tags[B.tags.length - 1] || B;
        B.opt.xmlns && oe.ns !== U.ns && Object.keys(oe.ns).forEach(function(f) {
          var g = oe.ns[f];
          S(B, "onclosenamespace", { prefix: f, uri: g });
        });
      }
      k === 0 && (B.closedRoot = !0), B.tagName = B.attribValue = B.attribName = "", B.attribList.length = 0, B.state = F.TEXT;
    }
    function G(B) {
      var k = B.entity, ne = k.toLowerCase(), te, V = "";
      return B.ENTITIES[k] ? B.ENTITIES[k] : B.ENTITIES[ne] ? B.ENTITIES[ne] : (k = ne, k.charAt(0) === "#" && (k.charAt(1) === "x" ? (k = k.slice(2), te = parseInt(k, 16), V = te.toString(16)) : (k = k.slice(1), te = parseInt(k, 10), V = te.toString(10))), k = k.replace(/^0+/, ""), isNaN(te) || V.toLowerCase() !== k ? (P(B, "Invalid character entity"), "&" + B.entity + ";") : String.fromCodePoint(te));
    }
    function J(B, k) {
      k === "<" ? (B.state = F.OPEN_WAKA, B.startTagPosition = B.position) : E(k) || (P(B, "Non-whitespace before first tag."), B.textNode = k, B.state = F.TEXT);
    }
    function re(B, k) {
      var ne = "";
      return k < B.length && (ne = B.charAt(k)), ne;
    }
    function Q(B) {
      var k = this;
      if (this.error)
        throw this.error;
      if (k.closed)
        return X(
          k,
          "Cannot write after close. Assign an onready handler."
        );
      if (B === null)
        return H(k);
      typeof B == "object" && (B = B.toString());
      for (var ne = 0, te = ""; te = re(B, ne++), k.c = te, !!te; )
        switch (k.trackPosition && (k.position++, te === `
` ? (k.line++, k.column = 0) : k.column++), k.state) {
          case F.BEGIN:
            if (k.state = F.BEGIN_WHITESPACE, te === "\uFEFF")
              continue;
            J(k, te);
            continue;
          case F.BEGIN_WHITESPACE:
            J(k, te);
            continue;
          case F.TEXT:
            if (k.sawRoot && !k.closedRoot) {
              for (var V = ne - 1; te && te !== "<" && te !== "&"; )
                te = re(B, ne++), te && k.trackPosition && (k.position++, te === `
` ? (k.line++, k.column = 0) : k.column++);
              k.textNode += B.substring(V, ne - 1);
            }
            te === "<" && !(k.sawRoot && k.closedRoot && !k.strict) ? (k.state = F.OPEN_WAKA, k.startTagPosition = k.position) : (!E(te) && (!k.sawRoot || k.closedRoot) && P(k, "Text data outside of root node."), te === "&" ? k.state = F.TEXT_ENTITY : k.textNode += te);
            continue;
          case F.SCRIPT:
            te === "<" ? k.state = F.SCRIPT_ENDING : k.script += te;
            continue;
          case F.SCRIPT_ENDING:
            te === "/" ? k.state = F.CLOSE_TAG : (k.script += "<" + te, k.state = F.SCRIPT);
            continue;
          case F.OPEN_WAKA:
            if (te === "!")
              k.state = F.SGML_DECL, k.sgmlDecl = "";
            else if (!E(te))
              if (I(v, te))
                k.state = F.OPEN_TAG, k.tagName = te;
              else if (te === "/")
                k.state = F.CLOSE_TAG, k.tagName = "";
              else if (te === "?")
                k.state = F.PROC_INST, k.procInstName = k.procInstBody = "";
              else {
                if (P(k, "Unencoded <"), k.startTagPosition + 1 < k.position) {
                  var N = k.position - k.startTagPosition;
                  te = new Array(N).join(" ") + te;
                }
                k.textNode += "<" + te, k.state = F.TEXT;
              }
            continue;
          case F.SGML_DECL:
            (k.sgmlDecl + te).toUpperCase() === y ? (S(k, "onopencdata"), k.state = F.CDATA, k.sgmlDecl = "", k.cdata = "") : k.sgmlDecl + te === "--" ? (k.state = F.COMMENT, k.comment = "", k.sgmlDecl = "") : (k.sgmlDecl + te).toUpperCase() === w ? (k.state = F.DOCTYPE, (k.doctype || k.sawRoot) && P(
              k,
              "Inappropriately located doctype declaration"
            ), k.doctype = "", k.sgmlDecl = "") : te === ">" ? (S(k, "onsgmldeclaration", k.sgmlDecl), k.sgmlDecl = "", k.state = F.TEXT) : (C(te) && (k.state = F.SGML_DECL_QUOTED), k.sgmlDecl += te);
            continue;
          case F.SGML_DECL_QUOTED:
            te === k.q && (k.state = F.SGML_DECL, k.q = ""), k.sgmlDecl += te;
            continue;
          case F.DOCTYPE:
            te === ">" ? (k.state = F.TEXT, S(k, "ondoctype", k.doctype), k.doctype = !0) : (k.doctype += te, te === "[" ? k.state = F.DOCTYPE_DTD : C(te) && (k.state = F.DOCTYPE_QUOTED, k.q = te));
            continue;
          case F.DOCTYPE_QUOTED:
            k.doctype += te, te === k.q && (k.q = "", k.state = F.DOCTYPE);
            continue;
          case F.DOCTYPE_DTD:
            k.doctype += te, te === "]" ? k.state = F.DOCTYPE : C(te) && (k.state = F.DOCTYPE_DTD_QUOTED, k.q = te);
            continue;
          case F.DOCTYPE_DTD_QUOTED:
            k.doctype += te, te === k.q && (k.state = F.DOCTYPE_DTD, k.q = "");
            continue;
          case F.COMMENT:
            te === "-" ? k.state = F.COMMENT_ENDING : k.comment += te;
            continue;
          case F.COMMENT_ENDING:
            te === "-" ? (k.state = F.COMMENT_ENDED, k.comment = D(k.opt, k.comment), k.comment && S(k, "oncomment", k.comment), k.comment = "") : (k.comment += "-" + te, k.state = F.COMMENT);
            continue;
          case F.COMMENT_ENDED:
            te !== ">" ? (P(k, "Malformed comment"), k.comment += "--" + te, k.state = F.COMMENT) : k.state = F.TEXT;
            continue;
          case F.CDATA:
            te === "]" ? k.state = F.CDATA_ENDING : k.cdata += te;
            continue;
          case F.CDATA_ENDING:
            te === "]" ? k.state = F.CDATA_ENDING_2 : (k.cdata += "]" + te, k.state = F.CDATA);
            continue;
          case F.CDATA_ENDING_2:
            te === ">" ? (k.cdata && S(k, "oncdata", k.cdata), S(k, "onclosecdata"), k.cdata = "", k.state = F.TEXT) : te === "]" ? k.cdata += "]" : (k.cdata += "]]" + te, k.state = F.CDATA);
            continue;
          case F.PROC_INST:
            te === "?" ? k.state = F.PROC_INST_ENDING : E(te) ? k.state = F.PROC_INST_BODY : k.procInstName += te;
            continue;
          case F.PROC_INST_BODY:
            if (!k.procInstBody && E(te))
              continue;
            te === "?" ? k.state = F.PROC_INST_ENDING : k.procInstBody += te;
            continue;
          case F.PROC_INST_ENDING:
            te === ">" ? (S(k, "onprocessinginstruction", {
              name: k.procInstName,
              body: k.procInstBody
            }), k.procInstName = k.procInstBody = "", k.state = F.TEXT) : (k.procInstBody += "?" + te, k.state = F.PROC_INST_BODY);
            continue;
          case F.OPEN_TAG:
            I(l, te) ? k.tagName += te : (Z(k), te === ">" ? O(k) : te === "/" ? k.state = F.OPEN_TAG_SLASH : (E(te) || P(k, "Invalid character in tag name"), k.state = F.ATTRIB));
            continue;
          case F.OPEN_TAG_SLASH:
            te === ">" ? (O(k, !0), A(k)) : (P(k, "Forward-slash in opening tag not followed by >"), k.state = F.ATTRIB);
            continue;
          case F.ATTRIB:
            if (E(te))
              continue;
            te === ">" ? O(k) : te === "/" ? k.state = F.OPEN_TAG_SLASH : I(v, te) ? (k.attribName = te, k.attribValue = "", k.state = F.ATTRIB_NAME) : P(k, "Invalid attribute name");
            continue;
          case F.ATTRIB_NAME:
            te === "=" ? k.state = F.ATTRIB_VALUE : te === ">" ? (P(k, "Attribute without value"), k.attribValue = k.attribName, ae(k), O(k)) : E(te) ? k.state = F.ATTRIB_NAME_SAW_WHITE : I(l, te) ? k.attribName += te : P(k, "Invalid attribute name");
            continue;
          case F.ATTRIB_NAME_SAW_WHITE:
            if (te === "=")
              k.state = F.ATTRIB_VALUE;
            else {
              if (E(te))
                continue;
              P(k, "Attribute without value"), k.tag.attributes[k.attribName] = "", k.attribValue = "", S(k, "onattribute", {
                name: k.attribName,
                value: ""
              }), k.attribName = "", te === ">" ? O(k) : I(v, te) ? (k.attribName = te, k.state = F.ATTRIB_NAME) : (P(k, "Invalid attribute name"), k.state = F.ATTRIB);
            }
            continue;
          case F.ATTRIB_VALUE:
            if (E(te))
              continue;
            C(te) ? (k.q = te, k.state = F.ATTRIB_VALUE_QUOTED) : (P(k, "Unquoted attribute value"), k.state = F.ATTRIB_VALUE_UNQUOTED, k.attribValue = te);
            continue;
          case F.ATTRIB_VALUE_QUOTED:
            if (te !== k.q) {
              te === "&" ? k.state = F.ATTRIB_VALUE_ENTITY_Q : k.attribValue += te;
              continue;
            }
            ae(k), k.q = "", k.state = F.ATTRIB_VALUE_CLOSED;
            continue;
          case F.ATTRIB_VALUE_CLOSED:
            E(te) ? k.state = F.ATTRIB : te === ">" ? O(k) : te === "/" ? k.state = F.OPEN_TAG_SLASH : I(v, te) ? (P(k, "No whitespace between attributes"), k.attribName = te, k.attribValue = "", k.state = F.ATTRIB_NAME) : P(k, "Invalid attribute name");
            continue;
          case F.ATTRIB_VALUE_UNQUOTED:
            if (!R(te)) {
              te === "&" ? k.state = F.ATTRIB_VALUE_ENTITY_U : k.attribValue += te;
              continue;
            }
            ae(k), te === ">" ? O(k) : k.state = F.ATTRIB;
            continue;
          case F.CLOSE_TAG:
            if (k.tagName)
              te === ">" ? A(k) : I(l, te) ? k.tagName += te : k.script ? (k.script += "</" + k.tagName, k.tagName = "", k.state = F.SCRIPT) : (E(te) || P(k, "Invalid tagname in closing tag"), k.state = F.CLOSE_TAG_SAW_WHITE);
            else {
              if (E(te))
                continue;
              q(v, te) ? k.script ? (k.script += "</" + te, k.state = F.SCRIPT) : P(k, "Invalid tagname in closing tag.") : k.tagName = te;
            }
            continue;
          case F.CLOSE_TAG_SAW_WHITE:
            if (E(te))
              continue;
            te === ">" ? A(k) : P(k, "Invalid characters in closing tag");
            continue;
          case F.TEXT_ENTITY:
          case F.ATTRIB_VALUE_ENTITY_Q:
          case F.ATTRIB_VALUE_ENTITY_U:
            var oe, m;
            switch (k.state) {
              case F.TEXT_ENTITY:
                oe = F.TEXT, m = "textNode";
                break;
              case F.ATTRIB_VALUE_ENTITY_Q:
                oe = F.ATTRIB_VALUE_QUOTED, m = "attribValue";
                break;
              case F.ATTRIB_VALUE_ENTITY_U:
                oe = F.ATTRIB_VALUE_UNQUOTED, m = "attribValue";
                break;
            }
            te === ";" ? (k[m] += G(k), k.entity = "", k.state = oe) : I(k.entity.length ? _ : b, te) ? k.entity += te : (P(k, "Invalid character in entity name"), k[m] += "&" + k.entity + te, k.entity = "", k.state = oe);
            continue;
          default:
            throw new Error(k, "Unknown state: " + k.state);
        }
      return k.position >= k.bufferCheckPosition && i(k), k;
    }
    /*! http://mths.be/fromcodepoint v0.1.0 by @mathias */
    String.fromCodePoint || function() {
      var B = String.fromCharCode, k = Math.floor, ne = function() {
        var te = 16384, V = [], N, oe, m = -1, $ = arguments.length;
        if (!$)
          return "";
        for (var U = ""; ++m < $; ) {
          var f = Number(arguments[m]);
          if (!isFinite(f) || // `NaN`, `+Infinity`, or `-Infinity`
          f < 0 || // not a valid Unicode code point
          f > 1114111 || // not a valid Unicode code point
          k(f) !== f)
            throw RangeError("Invalid code point: " + f);
          f <= 65535 ? V.push(f) : (f -= 65536, N = (f >> 10) + 55296, oe = f % 1024 + 56320, V.push(N, oe)), (m + 1 === $ || V.length > te) && (U += B.apply(null, V), V.length = 0);
        }
        return U;
      };
      Object.defineProperty ? Object.defineProperty(String, "fromCodePoint", {
        value: ne,
        configurable: !0,
        writable: !0
      }) : String.fromCodePoint = ne;
    }();
  })(e);
})(jf);
var Vc = {
  isArray: function(e) {
    return Array.isArray ? Array.isArray(e) : Object.prototype.toString.call(e) === "[object Array]";
  }
}, vb = Vc.isArray, Gc = {
  copyOptions: function(e) {
    var t, n = {};
    for (t in e)
      e.hasOwnProperty(t) && (n[t] = e[t]);
    return n;
  },
  ensureFlagExists: function(e, t) {
    (!(e in t) || typeof t[e] != "boolean") && (t[e] = !1);
  },
  ensureSpacesExists: function(e) {
    (!("spaces" in e) || typeof e.spaces != "number" && typeof e.spaces != "string") && (e.spaces = 0);
  },
  ensureAlwaysArrayExists: function(e) {
    (!("alwaysArray" in e) || typeof e.alwaysArray != "boolean" && !vb(e.alwaysArray)) && (e.alwaysArray = !1);
  },
  ensureKeyExists: function(e, t) {
    (!(e + "Key" in t) || typeof t[e + "Key"] != "string") && (t[e + "Key"] = t.compact ? "_" + e : e);
  },
  checkFnExists: function(e, t) {
    return e + "Fn" in t;
  }
}, wb = jf, Fe = Gc, or = Vc.isArray, de, De;
function xb(e) {
  return de = Fe.copyOptions(e), Fe.ensureFlagExists("ignoreDeclaration", de), Fe.ensureFlagExists("ignoreInstruction", de), Fe.ensureFlagExists("ignoreAttributes", de), Fe.ensureFlagExists("ignoreText", de), Fe.ensureFlagExists("ignoreComment", de), Fe.ensureFlagExists("ignoreCdata", de), Fe.ensureFlagExists("ignoreDoctype", de), Fe.ensureFlagExists("compact", de), Fe.ensureFlagExists("alwaysChildren", de), Fe.ensureFlagExists("addParent", de), Fe.ensureFlagExists("trim", de), Fe.ensureFlagExists("nativeType", de), Fe.ensureFlagExists("nativeTypeAttributes", de), Fe.ensureFlagExists("sanitize", de), Fe.ensureFlagExists("instructionHasAttributes", de), Fe.ensureFlagExists("captureSpacesBetweenElements", de), Fe.ensureAlwaysArrayExists(de), Fe.ensureKeyExists("declaration", de), Fe.ensureKeyExists("instruction", de), Fe.ensureKeyExists("attributes", de), Fe.ensureKeyExists("text", de), Fe.ensureKeyExists("comment", de), Fe.ensureKeyExists("cdata", de), Fe.ensureKeyExists("doctype", de), Fe.ensureKeyExists("type", de), Fe.ensureKeyExists("name", de), Fe.ensureKeyExists("elements", de), Fe.ensureKeyExists("parent", de), de;
}
function fp(e) {
  var t = Number(e);
  if (!isNaN(t))
    return t;
  var n = e.toLowerCase();
  return n === "true" ? !0 : n === "false" ? !1 : e;
}
function si(e, t) {
  var n;
  if (de.compact) {
    if (!De[de[e + "Key"]] && (or(de.alwaysArray) ? de.alwaysArray.indexOf(de[e + "Key"]) !== -1 : de.alwaysArray) && (De[de[e + "Key"]] = []), De[de[e + "Key"]] && !or(De[de[e + "Key"]]) && (De[de[e + "Key"]] = [De[de[e + "Key"]]]), e + "Fn" in de && typeof t == "string" && (t = de[e + "Fn"](t, De)), e === "instruction" && ("instructionFn" in de || "instructionNameFn" in de)) {
      for (n in t)
        if (t.hasOwnProperty(n))
          if ("instructionFn" in de)
            t[n] = de.instructionFn(t[n], n, De);
          else {
            var r = t[n];
            delete t[n], t[de.instructionNameFn(n, r, De)] = r;
          }
    }
    or(De[de[e + "Key"]]) ? De[de[e + "Key"]].push(t) : De[de[e + "Key"]] = t;
  } else {
    De[de.elementsKey] || (De[de.elementsKey] = []);
    var i = {};
    if (i[de.typeKey] = e, e === "instruction") {
      for (n in t)
        if (t.hasOwnProperty(n))
          break;
      i[de.nameKey] = "instructionNameFn" in de ? de.instructionNameFn(n, t, De) : n, de.instructionHasAttributes ? (i[de.attributesKey] = t[n][de.attributesKey], "instructionFn" in de && (i[de.attributesKey] = de.instructionFn(i[de.attributesKey], n, De))) : ("instructionFn" in de && (t[n] = de.instructionFn(t[n], n, De)), i[de.instructionKey] = t[n]);
    } else
      e + "Fn" in de && (t = de[e + "Fn"](t, De)), i[de[e + "Key"]] = t;
    de.addParent && (i[de.parentKey] = De), De[de.elementsKey].push(i);
  }
}
function pp(e) {
  if ("attributesFn" in de && e && (e = de.attributesFn(e, De)), (de.trim || "attributeValueFn" in de || "attributeNameFn" in de || de.nativeTypeAttributes) && e) {
    var t;
    for (t in e)
      if (e.hasOwnProperty(t) && (de.trim && (e[t] = e[t].trim()), de.nativeTypeAttributes && (e[t] = fp(e[t])), "attributeValueFn" in de && (e[t] = de.attributeValueFn(e[t], t, De)), "attributeNameFn" in de)) {
        var n = e[t];
        delete e[t], e[de.attributeNameFn(t, e[t], De)] = n;
      }
  }
  return e;
}
function Db(e) {
  var t = {};
  if (e.body && (e.name.toLowerCase() === "xml" || de.instructionHasAttributes)) {
    for (var n = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\w+))\s*/g, r; (r = n.exec(e.body)) !== null; )
      t[r[1]] = r[2] || r[3] || r[4];
    t = pp(t);
  }
  if (e.name.toLowerCase() === "xml") {
    if (de.ignoreDeclaration)
      return;
    De[de.declarationKey] = {}, Object.keys(t).length && (De[de.declarationKey][de.attributesKey] = t), de.addParent && (De[de.declarationKey][de.parentKey] = De);
  } else {
    if (de.ignoreInstruction)
      return;
    de.trim && (e.body = e.body.trim());
    var i = {};
    de.instructionHasAttributes && Object.keys(t).length ? (i[e.name] = {}, i[e.name][de.attributesKey] = t) : i[e.name] = e.body, si("instruction", i);
  }
}
function _b(e, t) {
  var n;
  if (typeof e == "object" && (t = e.attributes, e = e.name), t = pp(t), "elementNameFn" in de && (e = de.elementNameFn(e, De)), de.compact) {
    if (n = {}, !de.ignoreAttributes && t && Object.keys(t).length) {
      n[de.attributesKey] = {};
      var r;
      for (r in t)
        t.hasOwnProperty(r) && (n[de.attributesKey][r] = t[r]);
    }
    !(e in De) && (or(de.alwaysArray) ? de.alwaysArray.indexOf(e) !== -1 : de.alwaysArray) && (De[e] = []), De[e] && !or(De[e]) && (De[e] = [De[e]]), or(De[e]) ? De[e].push(n) : De[e] = n;
  } else
    De[de.elementsKey] || (De[de.elementsKey] = []), n = {}, n[de.typeKey] = "element", n[de.nameKey] = e, !de.ignoreAttributes && t && Object.keys(t).length && (n[de.attributesKey] = t), de.alwaysChildren && (n[de.elementsKey] = []), De[de.elementsKey].push(n);
  n[de.parentKey] = De, De = n;
}
function Tb(e) {
  de.ignoreText || !e.trim() && !de.captureSpacesBetweenElements || (de.trim && (e = e.trim()), de.nativeType && (e = fp(e)), de.sanitize && (e = e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")), si("text", e));
}
function Eb(e) {
  de.ignoreComment || (de.trim && (e = e.trim()), si("comment", e));
}
function Ab(e) {
  var t = De[de.parentKey];
  de.addParent || delete De[de.parentKey], De = t;
}
function Ub(e) {
  de.ignoreCdata || (de.trim && (e = e.trim()), si("cdata", e));
}
function Cb(e) {
  de.ignoreDoctype || (e = e.replace(/^ /, ""), de.trim && (e = e.trim()), si("doctype", e));
}
function Sb(e) {
  e.note = e;
}
var gp = function(e, t) {
  var n = wb.parser(!0, {}), r = {};
  if (De = r, de = xb(t), n.opt = { strictEntities: !0 }, n.onopentag = _b, n.ontext = Tb, n.oncomment = Eb, n.onclosetag = Ab, n.onerror = Sb, n.oncdata = Ub, n.ondoctype = Cb, n.onprocessinginstruction = Db, n.write(e).close(), r[de.elementsKey]) {
    var i = r[de.elementsKey];
    delete r[de.elementsKey], r[de.elementsKey] = i, delete r.text;
  }
  return r;
}, md = Gc, Fb = gp;
function kb(e) {
  var t = md.copyOptions(e);
  return md.ensureSpacesExists(t), t;
}
var Bb = function(e, t) {
  var n, r, i, a;
  return n = kb(t), r = Fb(e, n), a = "compact" in n && n.compact ? "_parent" : "parent", "addParent" in n && n.addParent ? i = JSON.stringify(r, function(s, o) {
    return s === a ? "_" : o;
  }, n.spaces) : i = JSON.stringify(r, null, n.spaces), i.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}, Ie = Gc, Rb = Vc.isArray, rt, it;
function Ib(e) {
  var t = Ie.copyOptions(e);
  return Ie.ensureFlagExists("ignoreDeclaration", t), Ie.ensureFlagExists("ignoreInstruction", t), Ie.ensureFlagExists("ignoreAttributes", t), Ie.ensureFlagExists("ignoreText", t), Ie.ensureFlagExists("ignoreComment", t), Ie.ensureFlagExists("ignoreCdata", t), Ie.ensureFlagExists("ignoreDoctype", t), Ie.ensureFlagExists("compact", t), Ie.ensureFlagExists("indentText", t), Ie.ensureFlagExists("indentCdata", t), Ie.ensureFlagExists("indentAttributes", t), Ie.ensureFlagExists("indentInstruction", t), Ie.ensureFlagExists("fullTagEmptyElement", t), Ie.ensureFlagExists("noQuotesForNativeAttributes", t), Ie.ensureSpacesExists(t), typeof t.spaces == "number" && (t.spaces = Array(t.spaces + 1).join(" ")), Ie.ensureKeyExists("declaration", t), Ie.ensureKeyExists("instruction", t), Ie.ensureKeyExists("attributes", t), Ie.ensureKeyExists("text", t), Ie.ensureKeyExists("comment", t), Ie.ensureKeyExists("cdata", t), Ie.ensureKeyExists("doctype", t), Ie.ensureKeyExists("type", t), Ie.ensureKeyExists("name", t), Ie.ensureKeyExists("elements", t), t;
}
function Pt(e, t, n) {
  return (!n && e.spaces ? `
` : "") + Array(t + 1).join(e.spaces);
}
function la(e, t, n) {
  if (t.ignoreAttributes)
    return "";
  "attributesFn" in t && (e = t.attributesFn(e, it, rt));
  var r, i, a, s, o = [];
  for (r in e)
    e.hasOwnProperty(r) && e[r] !== null && e[r] !== void 0 && (s = t.noQuotesForNativeAttributes && typeof e[r] != "string" ? "" : '"', i = "" + e[r], i = i.replace(/"/g, "&quot;"), a = "attributeNameFn" in t ? t.attributeNameFn(r, i, it, rt) : r, o.push(t.spaces && t.indentAttributes ? Pt(t, n + 1, !1) : " "), o.push(a + "=" + s + ("attributeValueFn" in t ? t.attributeValueFn(i, r, it, rt) : i) + s));
  return e && Object.keys(e).length && t.spaces && t.indentAttributes && o.push(Pt(t, n, !1)), o.join("");
}
function mp(e, t, n) {
  return rt = e, it = "xml", t.ignoreDeclaration ? "" : "<?xml" + la(e[t.attributesKey], t, n) + "?>";
}
function yp(e, t, n) {
  if (t.ignoreInstruction)
    return "";
  var r;
  for (r in e)
    if (e.hasOwnProperty(r))
      break;
  var i = "instructionNameFn" in t ? t.instructionNameFn(r, e[r], it, rt) : r;
  if (typeof e[r] == "object")
    return rt = e, it = i, "<?" + i + la(e[r][t.attributesKey], t, n) + "?>";
  var a = e[r] ? e[r] : "";
  return "instructionFn" in t && (a = t.instructionFn(a, r, it, rt)), "<?" + i + (a ? " " + a : "") + "?>";
}
function bp(e, t) {
  return t.ignoreComment ? "" : "<!--" + ("commentFn" in t ? t.commentFn(e, it, rt) : e) + "-->";
}
function vp(e, t) {
  return t.ignoreCdata ? "" : "<![CDATA[" + ("cdataFn" in t ? t.cdataFn(e, it, rt) : e.replace("]]>", "]]]]><![CDATA[>")) + "]]>";
}
function wp(e, t) {
  return t.ignoreDoctype ? "" : "<!DOCTYPE " + ("doctypeFn" in t ? t.doctypeFn(e, it, rt) : e) + ">";
}
function Xc(e, t) {
  return t.ignoreText ? "" : (e = "" + e, e = e.replace(/&amp;/g, "&"), e = e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), "textFn" in t ? t.textFn(e, it, rt) : e);
}
function Nb(e, t) {
  var n;
  if (e.elements && e.elements.length)
    for (n = 0; n < e.elements.length; ++n)
      switch (e.elements[n][t.typeKey]) {
        case "text":
          if (t.indentText)
            return !0;
          break;
        case "cdata":
          if (t.indentCdata)
            return !0;
          break;
        case "instruction":
          if (t.indentInstruction)
            return !0;
          break;
        case "doctype":
        case "comment":
        case "element":
          return !0;
        default:
          return !0;
      }
  return !1;
}
function Ob(e, t, n) {
  rt = e, it = e.name;
  var r = [], i = "elementNameFn" in t ? t.elementNameFn(e.name, e) : e.name;
  r.push("<" + i), e[t.attributesKey] && r.push(la(e[t.attributesKey], t, n));
  var a = e[t.elementsKey] && e[t.elementsKey].length || e[t.attributesKey] && e[t.attributesKey]["xml:space"] === "preserve";
  return a || ("fullTagEmptyElementFn" in t ? a = t.fullTagEmptyElementFn(e.name, e) : a = t.fullTagEmptyElement), a ? (r.push(">"), e[t.elementsKey] && e[t.elementsKey].length && (r.push(xp(e[t.elementsKey], t, n + 1)), rt = e, it = e.name), r.push(t.spaces && Nb(e, t) ? `
` + Array(n + 1).join(t.spaces) : ""), r.push("</" + i + ">")) : r.push("/>"), r.join("");
}
function xp(e, t, n, r) {
  return e.reduce(function(i, a) {
    var s = Pt(t, n, r && !i);
    switch (a.type) {
      case "element":
        return i + s + Ob(a, t, n);
      case "comment":
        return i + s + bp(a[t.commentKey], t);
      case "doctype":
        return i + s + wp(a[t.doctypeKey], t);
      case "cdata":
        return i + (t.indentCdata ? s : "") + vp(a[t.cdataKey], t);
      case "text":
        return i + (t.indentText ? s : "") + Xc(a[t.textKey], t);
      case "instruction":
        var o = {};
        return o[a[t.nameKey]] = a[t.attributesKey] ? a : a[t.instructionKey], i + (t.indentInstruction ? s : "") + yp(o, t, n);
    }
  }, "");
}
function Dp(e, t, n) {
  var r;
  for (r in e)
    if (e.hasOwnProperty(r))
      switch (r) {
        case t.parentKey:
        case t.attributesKey:
          break;
        case t.textKey:
          if (t.indentText || n)
            return !0;
          break;
        case t.cdataKey:
          if (t.indentCdata || n)
            return !0;
          break;
        case t.instructionKey:
          if (t.indentInstruction || n)
            return !0;
          break;
        case t.doctypeKey:
        case t.commentKey:
          return !0;
        default:
          return !0;
      }
  return !1;
}
function Wb(e, t, n, r, i) {
  rt = e, it = t;
  var a = "elementNameFn" in n ? n.elementNameFn(t, e) : t;
  if (typeof e > "u" || e === null || e === "")
    return "fullTagEmptyElementFn" in n && n.fullTagEmptyElementFn(t, e) || n.fullTagEmptyElement ? "<" + a + "></" + a + ">" : "<" + a + "/>";
  var s = [];
  if (t) {
    if (s.push("<" + a), typeof e != "object")
      return s.push(">" + Xc(e, n) + "</" + a + ">"), s.join("");
    e[n.attributesKey] && s.push(la(e[n.attributesKey], n, r));
    var o = Dp(e, n, !0) || e[n.attributesKey] && e[n.attributesKey]["xml:space"] === "preserve";
    if (o || ("fullTagEmptyElementFn" in n ? o = n.fullTagEmptyElementFn(t, e) : o = n.fullTagEmptyElement), o)
      s.push(">");
    else
      return s.push("/>"), s.join("");
  }
  return s.push(_p(e, n, r + 1, !1)), rt = e, it = t, t && s.push((i ? Pt(n, r, !1) : "") + "</" + a + ">"), s.join("");
}
function _p(e, t, n, r) {
  var i, a, s, o = [];
  for (a in e)
    if (e.hasOwnProperty(a))
      for (s = Rb(e[a]) ? e[a] : [e[a]], i = 0; i < s.length; ++i) {
        switch (a) {
          case t.declarationKey:
            o.push(mp(s[i], t, n));
            break;
          case t.instructionKey:
            o.push((t.indentInstruction ? Pt(t, n, r) : "") + yp(s[i], t, n));
            break;
          case t.attributesKey:
          case t.parentKey:
            break;
          case t.textKey:
            o.push((t.indentText ? Pt(t, n, r) : "") + Xc(s[i], t));
            break;
          case t.cdataKey:
            o.push((t.indentCdata ? Pt(t, n, r) : "") + vp(s[i], t));
            break;
          case t.doctypeKey:
            o.push(Pt(t, n, r) + wp(s[i], t));
            break;
          case t.commentKey:
            o.push(Pt(t, n, r) + bp(s[i], t));
            break;
          default:
            o.push(Pt(t, n, r) + Wb(s[i], a, t, n, Dp(s[i], t)));
        }
        r = r && !o.length;
      }
  return o.join("");
}
var Tp = function(e, t) {
  t = Ib(t);
  var n = [];
  return rt = e, it = "_root_", t.compact ? n.push(_p(e, t, 0, !0)) : (e[t.declarationKey] && n.push(mp(e[t.declarationKey], t, 0)), e[t.elementsKey] && e[t.elementsKey].length && n.push(xp(e[t.elementsKey], t, 0, !n.length))), n.join("");
}, Lb = Tp, Pb = function(e, t) {
  e instanceof Buffer && (e = e.toString());
  var n = null;
  if (typeof e == "string")
    try {
      n = JSON.parse(e);
    } catch {
      throw new Error("The JSON structure is invalid");
    }
  else
    n = e;
  return Lb(n, t);
}, Mb = gp, zb = Bb, jb = Tp, qb = Pb, Ep = {
  xml2js: Mb,
  xml2json: zb,
  js2xml: jb,
  json2xml: qb
};
const $c = (e) => {
  switch (e.type) {
    case void 0:
    case "element":
      const t = new Vb(e.name, e.attributes), n = e.elements || [];
      for (const r of n) {
        const i = $c(r);
        i !== void 0 && t.push(i);
      }
      return t;
    case "text":
      return e.text;
    default:
      return;
  }
};
class Hb extends me {
  // noop
}
class Vb extends ue {
  /**
   * Converts the xml string to a XmlComponent tree.
   *
   * @param importedContent xml content of the imported component
   */
  static fromXmlString(t) {
    const n = Ep.xml2js(t, { compact: !1 });
    return $c(n);
  }
  /**
   * Converts the xml string to a XmlComponent tree.
   *
   * @param importedContent xml content of the imported component
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(t, n) {
    super(t), n && this.root.push(new Hb(n));
  }
  push(t) {
    this.root.push(t);
  }
}
class Gb extends ue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(t) {
    super(""), this._attr = t;
  }
  prepForXml(t) {
    return {
      _attr: this._attr
    };
  }
}
class Ap extends ue {
  constructor(t, n) {
    super(t), n && (this.root = n.root);
  }
}
const ot = (e) => {
  if (isNaN(e))
    throw new Error(`Invalid value '${e}' specified. Must be an integer.`);
  return Math.floor(e);
}, da = (e) => {
  const t = ot(e);
  if (t < 0)
    throw new Error(`Invalid value '${e}' specified. Must be a positive integer.`);
  return t;
}, Kc = (e, t) => {
  const n = t * 2;
  if (e.length !== n || isNaN(+`0x${e}`))
    throw new Error(`Invalid hex value '${e}'. Expected ${n} digit hex value`);
  return e;
}, Xb = (e) => Kc(e, 2), yd = (e) => Kc(e, 1), Zc = (e) => {
  const t = e.slice(-2), n = e.substring(0, e.length - 2);
  return `${Number(n)}${t}`;
}, Up = (e) => {
  const t = Zc(e);
  if (parseFloat(t) < 0)
    throw new Error(`Invalid value '${t}' specified. Expected a positive number.`);
  return t;
}, fr = (e) => {
  if (e === "auto")
    return e;
  const t = e.charAt(0) === "#" ? e.substring(1) : e;
  return Kc(t, 3);
}, tn = (e) => typeof e == "string" ? Zc(e) : ot(e), $b = (e) => typeof e == "string" ? Up(e) : da(e), Ye = (e) => typeof e == "string" ? Up(e) : da(e), Kb = (e) => {
  const t = e.substring(0, e.length - 1);
  return `${Number(t)}%`;
}, Zb = (e) => typeof e == "number" ? ot(e) : e.slice(-1) === "%" ? Kb(e) : Zc(e), Yb = da, Jb = da, Qb = (e) => e.toISOString();
class ge extends ue {
  constructor(t, n = !0) {
    super(t), n !== !0 && this.root.push(new We({ val: n }));
  }
}
class Jo extends ue {
  constructor(t, n) {
    super(t), this.root.push(new We({ val: $b(n) }));
  }
}
class e0 extends ue {
}
class mn extends ue {
  constructor(t, n) {
    super(t), this.root.push(new We({ val: n }));
  }
}
const Or = (e, t) => new He({
  name: e,
  attributes: {
    value: { key: "w:val", value: t }
  }
});
class Yc extends ue {
  constructor(t, n) {
    super(t), this.root.push(new We({ val: n }));
  }
}
class t0 extends ue {
  constructor(t, n) {
    super(t), this.root.push(new We({ val: n }));
  }
}
class Un extends ue {
  constructor(t, n) {
    super(t), this.root.push(n);
  }
}
class He extends ue {
  constructor({
    name: t,
    attributes: n,
    children: r
  }) {
    super(t), n && this.root.push(new cn(n)), r && this.root.push(...r);
  }
}
const dt = {
  /** Align Start */
  START: "start",
  /** Align Center */
  CENTER: "center",
  /** End */
  END: "end",
  /** Justified */
  BOTH: "both",
  /** Medium Kashida Length */
  MEDIUM_KASHIDA: "mediumKashida",
  /** Distribute All Characters Equally */
  DISTRIBUTE: "distribute",
  /** Align to List Tab */
  NUM_TAB: "numTab",
  /** Widest Kashida Length */
  HIGH_KASHIDA: "highKashida",
  /** Low Kashida Length */
  LOW_KASHIDA: "lowKashida",
  /** Thai Language Justification */
  THAI_DISTRIBUTE: "thaiDistribute",
  /** Align Left */
  LEFT: "left",
  /** Align Right */
  RIGHT: "right",
  /** Justified */
  JUSTIFIED: "both"
};
class n0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class Cp extends ue {
  constructor(t) {
    super("w:jc"), this.root.push(new n0({ val: t }));
  }
}
class Be extends ue {
  constructor(t, { color: n, size: r, space: i, style: a }) {
    super(t), this.root.push(
      new r0({
        style: a,
        color: n === void 0 ? void 0 : fr(n),
        size: r === void 0 ? void 0 : Yb(r),
        space: i === void 0 ? void 0 : Jb(i)
      })
    );
  }
}
class r0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      style: "w:val",
      color: "w:color",
      size: "w:sz",
      space: "w:space"
    });
  }
}
const Rn = {
  SINGLE: "single",
  DASH_DOT_STROKED: "dashDotStroked",
  DASHED: "dashed",
  DASH_SMALL_GAP: "dashSmallGap",
  DOT_DASH: "dotDash",
  DOT_DOT_DASH: "dotDotDash",
  DOTTED: "dotted",
  DOUBLE: "double",
  DOUBLE_WAVE: "doubleWave",
  INSET: "inset",
  NIL: "nil",
  NONE: "none",
  OUTSET: "outset",
  THICK: "thick",
  THICK_THIN_LARGE_GAP: "thickThinLargeGap",
  THICK_THIN_MEDIUM_GAP: "thickThinMediumGap",
  THICK_THIN_SMALL_GAP: "thickThinSmallGap",
  THIN_THICK_LARGE_GAP: "thinThickLargeGap",
  THIN_THICK_MEDIUM_GAP: "thinThickMediumGap",
  THIN_THICK_SMALL_GAP: "thinThickSmallGap",
  THIN_THICK_THIN_LARGE_GAP: "thinThickThinLargeGap",
  THIN_THICK_THIN_MEDIUM_GAP: "thinThickThinMediumGap",
  THIN_THICK_THIN_SMALL_GAP: "thinThickThinSmallGap",
  THREE_D_EMBOSS: "threeDEmboss",
  THREE_D_ENGRAVE: "threeDEngrave",
  TRIPLE: "triple",
  WAVE: "wave"
};
class i0 extends sn {
  constructor(t) {
    super("w:pBdr"), t.top && this.root.push(new Be("w:top", t.top)), t.bottom && this.root.push(new Be("w:bottom", t.bottom)), t.left && this.root.push(new Be("w:left", t.left)), t.right && this.root.push(new Be("w:right", t.right));
  }
}
class a0 extends ue {
  constructor() {
    super("w:pBdr");
    const t = new Be("w:bottom", {
      color: "auto",
      space: 1,
      style: Rn.SINGLE,
      size: 6
    });
    this.root.push(t);
  }
}
class o0 extends ue {
  constructor({ start: t, end: n, left: r, right: i, hanging: a, firstLine: s }) {
    super("w:ind"), this.root.push(
      new cn({
        start: {
          key: "w:start",
          value: t === void 0 ? void 0 : tn(t)
        },
        end: {
          key: "w:end",
          value: n === void 0 ? void 0 : tn(n)
        },
        left: {
          key: "w:left",
          value: r === void 0 ? void 0 : tn(r)
        },
        right: {
          key: "w:right",
          value: i === void 0 ? void 0 : tn(i)
        },
        hanging: {
          key: "w:hanging",
          value: a === void 0 ? void 0 : Ye(a)
        },
        firstLine: {
          key: "w:firstLine",
          value: s === void 0 ? void 0 : Ye(s)
        }
      })
    );
  }
}
let s0 = class extends ue {
  constructor() {
    super("w:br");
  }
};
const Jc = {
  BEGIN: "begin",
  END: "end",
  SEPARATE: "separate"
};
class Qc extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { type: "w:fldCharType", dirty: "w:dirty" });
  }
}
class Di extends ue {
  constructor(t) {
    super("w:fldChar"), this.root.push(new Qc({ type: Jc.BEGIN, dirty: t }));
  }
}
class _i extends ue {
  constructor(t) {
    super("w:fldChar"), this.root.push(new Qc({ type: Jc.SEPARATE, dirty: t }));
  }
}
class Ti extends ue {
  constructor(t) {
    super("w:fldChar"), this.root.push(new Qc({ type: Jc.END, dirty: t }));
  }
}
const pr = {
  DEFAULT: "default",
  PRESERVE: "preserve"
};
class gr extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { space: "xml:space" });
  }
}
class c0 extends ue {
  constructor() {
    super("w:instrText"), this.root.push(new gr({ space: pr.PRESERVE })), this.root.push("PAGE");
  }
}
class u0 extends ue {
  constructor() {
    super("w:instrText"), this.root.push(new gr({ space: pr.PRESERVE })), this.root.push("NUMPAGES");
  }
}
class l0 extends ue {
  constructor() {
    super("w:instrText"), this.root.push(new gr({ space: pr.PRESERVE })), this.root.push("SECTIONPAGES");
  }
}
class d0 extends ue {
  constructor() {
    super("w:instrText"), this.root.push(new gr({ space: pr.PRESERVE })), this.root.push("SECTION");
  }
}
class h0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      fill: "w:fill",
      color: "w:color",
      type: "w:val"
    });
  }
}
class ha extends ue {
  constructor({ fill: t, color: n, type: r }) {
    super("w:shd"), this.root.push(
      new h0({
        fill: t === void 0 ? void 0 : fr(t),
        color: n === void 0 ? void 0 : fr(n),
        type: r
      })
    );
  }
}
class f0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      id: "w:id",
      author: "w:author",
      date: "w:date"
    });
  }
}
const p0 = {
  DOT: "dot"
};
class g0 extends ue {
  constructor(t) {
    super("w:em"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class m0 extends g0 {
  constructor(t = p0.DOT) {
    super(t);
  }
}
class y0 extends ue {
  constructor(t) {
    super("w:spacing"), this.root.push(
      new We({
        val: tn(t)
      })
    );
  }
}
class b0 extends ue {
  constructor(t) {
    super("w:color"), this.root.push(
      new We({
        val: fr(t)
      })
    );
  }
}
class v0 extends ue {
  constructor(t) {
    super("w:highlight"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class w0 extends ue {
  constructor(t) {
    super("w:highlightCs"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
const x0 = (e) => new He({
  name: "w:lang",
  attributes: {
    value: {
      key: "w:val",
      value: e.value
    },
    eastAsia: {
      key: "w:eastAsia",
      value: e.eastAsia
    },
    bidirectional: {
      key: "w:bidi",
      value: e.bidirectional
    }
  }
});
class bd extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      ascii: "w:ascii",
      cs: "w:cs",
      eastAsia: "w:eastAsia",
      hAnsi: "w:hAnsi",
      hint: "w:hint"
    });
  }
}
class Qo extends ue {
  constructor(t, n) {
    if (super("w:rFonts"), typeof t == "string") {
      const r = t;
      this.root.push(
        new bd({
          ascii: r,
          cs: r,
          eastAsia: r,
          hAnsi: r,
          hint: n
        })
      );
    } else {
      const r = t;
      this.root.push(new bd(r));
    }
  }
}
let Sp = class extends ue {
  constructor(t) {
    super("w:vertAlign"), this.root.push(
      new We({
        val: t
      })
    );
  }
};
class D0 extends Sp {
  constructor() {
    super("superscript");
  }
}
class _0 extends Sp {
  constructor() {
    super("subscript");
  }
}
const Fp = {
  SINGLE: "single",
  WORDS: "words",
  DOUBLE: "double",
  THICK: "thick",
  DOTTED: "dotted",
  DOTTEDHEAVY: "dottedHeavy",
  DASH: "dash",
  DASHEDHEAVY: "dashedHeavy",
  DASHLONG: "dashLong",
  DASHLONGHEAVY: "dashLongHeavy",
  DOTDASH: "dotDash",
  DASHDOTHEAVY: "dashDotHeavy",
  DOTDOTDASH: "dotDotDash",
  DASHDOTDOTHEAVY: "dashDotDotHeavy",
  WAVE: "wave",
  WAVYHEAVY: "wavyHeavy",
  WAVYDOUBLE: "wavyDouble",
  NONE: "none"
};
class T0 extends ue {
  constructor(t = Fp.SINGLE, n) {
    super("w:u"), this.root.push(
      new We({
        val: t,
        color: n === void 0 ? void 0 : fr(n)
      })
    );
  }
}
class Pn extends sn {
  constructor(t) {
    var n, r;
    if (super("w:rPr"), !t)
      return;
    t.noProof !== void 0 && this.push(new ge("w:noProof", t.noProof)), t.bold !== void 0 && this.push(new ge("w:b", t.bold)), (t.boldComplexScript === void 0 && t.bold !== void 0 || t.boldComplexScript) && this.push(new ge("w:bCs", (n = t.boldComplexScript) != null ? n : t.bold)), t.italics !== void 0 && this.push(new ge("w:i", t.italics)), (t.italicsComplexScript === void 0 && t.italics !== void 0 || t.italicsComplexScript) && this.push(new ge("w:iCs", (r = t.italicsComplexScript) != null ? r : t.italics)), t.underline && this.push(new T0(t.underline.type, t.underline.color)), t.effect && this.push(new mn("w:effect", t.effect)), t.emphasisMark && this.push(new m0(t.emphasisMark.type)), t.color && this.push(new b0(t.color)), t.kern && this.push(new Jo("w:kern", t.kern)), t.position && this.push(new mn("w:position", t.position)), t.size !== void 0 && this.push(new Jo("w:sz", t.size));
    const i = t.sizeComplexScript === void 0 || t.sizeComplexScript === !0 ? t.size : t.sizeComplexScript;
    i && this.push(new Jo("w:szCs", i)), t.rightToLeft !== void 0 && this.push(new ge("w:rtl", t.rightToLeft)), t.smallCaps !== void 0 ? this.push(new ge("w:smallCaps", t.smallCaps)) : t.allCaps !== void 0 && this.push(new ge("w:caps", t.allCaps)), t.strike !== void 0 && this.push(new ge("w:strike", t.strike)), t.doubleStrike !== void 0 && this.push(new ge("w:dstrike", t.doubleStrike)), t.subScript && this.push(new _0()), t.superScript && this.push(new D0()), t.style && this.push(new mn("w:rStyle", t.style)), t.font && (typeof t.font == "string" ? this.push(new Qo(t.font)) : "name" in t.font ? this.push(new Qo(t.font.name, t.font.hint)) : this.push(new Qo(t.font))), t.highlight && this.push(new v0(t.highlight));
    const a = t.highlightComplexScript === void 0 || t.highlightComplexScript === !0 ? t.highlight : t.highlightComplexScript;
    a && this.push(new w0(a)), t.characterSpacing && this.push(new y0(t.characterSpacing)), t.emboss !== void 0 && this.push(new ge("w:emboss", t.emboss)), t.imprint !== void 0 && this.push(new ge("w:imprint", t.imprint)), t.shading && this.push(new ha(t.shading)), t.revision && this.push(new E0(t.revision)), t.border && this.push(new Be("w:bdr", t.border)), t.snapToGrid !== void 0 && this.push(new ge("w:snapToGrid", t.snapToGrid)), t.vanish && this.push(new ge("w:vanish", t.vanish)), t.specVanish && this.push(new ge("w:specVanish", t.vanish)), t.scale !== void 0 && this.push(new Yc("w:w", t.scale)), t.language && this.push(x0(t.language)), t.math && this.push(new ge("w:oMath", t.math));
  }
  push(t) {
    this.root.push(t);
  }
}
class E0 extends ue {
  constructor(t) {
    super("w:rPrChange"), this.root.push(
      new f0({
        id: t.id,
        author: t.author,
        date: t.date
      })
    ), this.addChildElement(new Pn(t));
  }
}
let Uc = class extends ue {
  constructor(t) {
    var n;
    super("w:t"), typeof t == "string" ? (this.root.push(new gr({ space: pr.PRESERVE })), this.root.push(t)) : (this.root.push(new gr({ space: (n = t.space) != null ? n : pr.DEFAULT })), this.root.push(t.text));
  }
};
const Ei = {
  CURRENT: "CURRENT",
  TOTAL_PAGES: "TOTAL_PAGES",
  TOTAL_PAGES_IN_SECTION: "TOTAL_PAGES_IN_SECTION",
  CURRENT_SECTION: "SECTION"
};
let Mn = class extends ue {
  constructor(t) {
    if (super("w:r"), le(this, "properties"), this.properties = new Pn(t), this.root.push(this.properties), t.break)
      for (let n = 0; n < t.break; n++)
        this.root.push(new s0());
    if (t.children)
      for (const n of t.children) {
        if (typeof n == "string") {
          switch (n) {
            case Ei.CURRENT:
              this.root.push(new Di()), this.root.push(new c0()), this.root.push(new _i()), this.root.push(new Ti());
              break;
            case Ei.TOTAL_PAGES:
              this.root.push(new Di()), this.root.push(new u0()), this.root.push(new _i()), this.root.push(new Ti());
              break;
            case Ei.TOTAL_PAGES_IN_SECTION:
              this.root.push(new Di()), this.root.push(new l0()), this.root.push(new _i()), this.root.push(new Ti());
              break;
            case Ei.CURRENT_SECTION:
              this.root.push(new Di()), this.root.push(new d0()), this.root.push(new _i()), this.root.push(new Ti());
              break;
            default:
              this.root.push(new Uc(n));
              break;
          }
          continue;
        }
        this.root.push(n);
      }
    else
      t.text && this.root.push(new Uc(t.text));
  }
};
class sr extends Mn {
  constructor(t) {
    if (typeof t == "string")
      return super({}), this.root.push(new Uc(t)), this;
    super(t);
  }
}
class A0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      char: "w:char",
      symbolfont: "w:font"
    });
  }
}
let vd = class extends ue {
  constructor(t = "", n = "Wingdings") {
    super("w:sym"), this.root.push(new A0({ char: t, symbolfont: n }));
  }
};
class U0 extends Mn {
  constructor(t) {
    if (typeof t == "string")
      return super({}), this.root.push(new vd(t)), this;
    super(t), this.root.push(new vd(t.char, t.symbolfont));
  }
}
let C0 = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict", S0 = (e, t = 21) => (n = t) => {
  let r = "", i = n;
  for (; i--; )
    r += e[Math.random() * e.length | 0];
  return r;
}, F0 = (e = 21) => {
  let t = "", n = e;
  for (; n--; )
    t += C0[Math.random() * 64 | 0];
  return t;
};
const Bt = (e) => Math.floor(e * 72 * 20), fa = (e = 0) => {
  let t = e;
  return () => ++t;
}, k0 = () => fa(), B0 = () => fa(1), R0 = () => fa(), I0 = () => fa(), Cc = () => F0().toLowerCase(), Wr = (e) => S0("1234567890abcdef", e)(), N0 = () => `${Wr(8)}-${Wr(4)}-${Wr(4)}-${Wr(4)}-${Wr(12)}`, O0 = {
  CHARACTER: "character",
  COLUMN: "column",
  INSIDE_MARGIN: "insideMargin",
  LEFT_MARGIN: "leftMargin",
  MARGIN: "margin",
  OUTSIDE_MARGIN: "outsideMargin",
  PAGE: "page",
  RIGHT_MARGIN: "rightMargin"
}, W0 = {
  BOTTOM_MARGIN: "bottomMargin",
  INSIDE_MARGIN: "insideMargin",
  LINE: "line",
  MARGIN: "margin",
  OUTSIDE_MARGIN: "outsideMargin",
  PAGE: "page",
  PARAGRAPH: "paragraph",
  TOP_MARGIN: "topMargin"
};
class L0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      x: "x",
      y: "y"
    });
  }
}
class P0 extends ue {
  constructor() {
    super("wp:simplePos"), this.root.push(
      new L0({
        x: 0,
        y: 0
      })
    );
  }
}
class kp extends ue {
  constructor(t) {
    super("wp:align"), this.root.push(t);
  }
}
class Bp extends ue {
  constructor(t) {
    super("wp:posOffset"), this.root.push(t.toString());
  }
}
class M0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      relativeFrom: "relativeFrom"
    });
  }
}
class z0 extends ue {
  constructor(t) {
    if (super("wp:positionH"), this.root.push(
      new M0({
        relativeFrom: t.relative || O0.PAGE
      })
    ), t.align)
      this.root.push(new kp(t.align));
    else if (t.offset !== void 0)
      this.root.push(new Bp(t.offset));
    else
      throw new Error("There is no configuration provided for floating position (Align or offset)");
  }
}
class j0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      relativeFrom: "relativeFrom"
    });
  }
}
class q0 extends ue {
  constructor(t) {
    if (super("wp:positionV"), this.root.push(
      new j0({
        relativeFrom: t.relative || W0.PAGE
      })
    ), t.align)
      this.root.push(new kp(t.align));
    else if (t.offset !== void 0)
      this.root.push(new Bp(t.offset));
    else
      throw new Error("There is no configuration provided for floating position (Align or offset)");
  }
}
class H0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      uri: "uri"
    });
  }
}
const V0 = (e) => new He({
  name: "asvg:svgBlip",
  attributes: {
    asvg: {
      key: "xmlns:asvg",
      value: "http://schemas.microsoft.com/office/drawing/2016/SVG/main"
    },
    embed: {
      key: "r:embed",
      value: `rId{${e.fileName}}`
    }
  }
}), G0 = (e) => new He({
  name: "a:ext",
  attributes: {
    uri: {
      key: "uri",
      value: "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"
    }
  },
  children: [V0(e)]
}), X0 = (e) => new He({
  name: "a:extLst",
  children: [G0(e)]
}), $0 = (e) => new He({
  name: "a:blip",
  attributes: {
    embed: {
      key: "r:embed",
      value: `rId{${e.type === "svg" ? e.fallback.fileName : e.fileName}}`
    },
    cstate: {
      key: "cstate",
      value: "none"
    }
  },
  children: e.type === "svg" ? [X0(e)] : []
});
class K0 extends ue {
  constructor() {
    super("a:srcRect");
  }
}
class Z0 extends ue {
  constructor() {
    super("a:fillRect");
  }
}
class Y0 extends ue {
  constructor() {
    super("a:stretch"), this.root.push(new Z0());
  }
}
class J0 extends ue {
  constructor(t) {
    super("pic:blipFill"), this.root.push($0(t)), this.root.push(new K0()), this.root.push(new Y0());
  }
}
class Q0 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      noChangeAspect: "noChangeAspect",
      noChangeArrowheads: "noChangeArrowheads"
    });
  }
}
class ev extends ue {
  constructor() {
    super("a:picLocks"), this.root.push(
      new Q0({
        noChangeAspect: 1,
        noChangeArrowheads: 1
      })
    );
  }
}
class tv extends ue {
  constructor() {
    super("pic:cNvPicPr"), this.root.push(new ev());
  }
}
const Rp = (e, t) => new He({
  name: "a:hlinkClick",
  attributes: bn(Te({}, t ? {
    xmlns: {
      key: "xmlns:a",
      value: "http://schemas.openxmlformats.org/drawingml/2006/main"
    }
  } : {}), {
    id: {
      key: "r:id",
      value: `rId${e}`
    }
  })
});
class nv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      id: "id",
      name: "name",
      descr: "descr"
    });
  }
}
class rv extends ue {
  constructor() {
    super("pic:cNvPr"), this.root.push(
      new nv({
        id: 0,
        name: "",
        descr: ""
      })
    );
  }
  prepForXml(t) {
    for (let n = t.stack.length - 1; n >= 0; n--) {
      const r = t.stack[n];
      if (r instanceof eu) {
        this.root.push(Rp(r.linkId, !1));
        break;
      }
    }
    return super.prepForXml(t);
  }
}
class iv extends ue {
  constructor() {
    super("pic:nvPicPr"), this.root.push(new rv()), this.root.push(new tv());
  }
}
class av extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      xmlns: "xmlns:pic"
    });
  }
}
class ov extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      cx: "cx",
      cy: "cy"
    });
  }
}
class sv extends ue {
  constructor(t, n) {
    super("a:ext"), le(this, "attributes"), this.attributes = new ov({
      cx: t,
      cy: n
    }), this.root.push(this.attributes);
  }
}
class cv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      x: "x",
      y: "y"
    });
  }
}
class uv extends ue {
  constructor() {
    super("a:off"), this.root.push(
      new cv({
        x: 0,
        y: 0
      })
    );
  }
}
class lv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      flipVertical: "flipV",
      flipHorizontal: "flipH",
      rotation: "rot"
    });
  }
}
class dv extends ue {
  constructor(t) {
    var n, r;
    super("a:xfrm"), le(this, "extents"), this.root.push(
      new lv({
        flipVertical: (n = t.flip) == null ? void 0 : n.vertical,
        flipHorizontal: (r = t.flip) == null ? void 0 : r.horizontal,
        rotation: t.rotation
      })
    ), this.extents = new sv(t.emus.x, t.emus.y), this.root.push(new uv()), this.root.push(this.extents);
  }
}
const Ip = () => new He({ name: "a:noFill" }), hv = (e) => new He({
  name: "a:schemeClr",
  attributes: {
    value: {
      key: "val",
      value: e.value
    }
  }
}), fv = (e) => new He({
  name: "a:srgbClr",
  attributes: {
    value: {
      key: "val",
      value: e.value
    }
  }
}), wd = (e) => new He({
  name: "a:solidFill",
  children: [e.type === "rgb" ? fv(e) : hv(e)]
}), pv = (e) => new He({
  name: "a:ln",
  attributes: {
    width: {
      key: "w",
      value: e.width
    },
    cap: {
      key: "cap",
      value: e.cap
    },
    compoundLine: {
      key: "cmpd",
      value: e.compoundLine
    },
    align: {
      key: "algn",
      value: e.align
    }
  },
  children: [
    e.type === "noFill" ? Ip() : e.solidFillType === "rgb" ? wd({
      type: "rgb",
      value: e.value
    }) : wd({
      type: "scheme",
      value: e.value
    })
  ]
});
class gv extends ue {
  constructor() {
    super("a:avLst");
  }
}
class mv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      prst: "prst"
    });
  }
}
class yv extends ue {
  constructor() {
    super("a:prstGeom"), this.root.push(
      new mv({
        prst: "rect"
      })
    ), this.root.push(new gv());
  }
}
class bv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      bwMode: "bwMode"
    });
  }
}
class vv extends ue {
  constructor({ outline: t, transform: n }) {
    super("pic:spPr"), le(this, "form"), this.root.push(
      new bv({
        bwMode: "auto"
      })
    ), this.form = new dv(n), this.root.push(this.form), this.root.push(new yv()), t && (this.root.push(Ip()), this.root.push(pv(t)));
  }
}
class wv extends ue {
  constructor({
    mediaData: t,
    transform: n,
    outline: r
  }) {
    super("pic:pic"), this.root.push(
      new av({
        xmlns: "http://schemas.openxmlformats.org/drawingml/2006/picture"
      })
    ), this.root.push(new iv()), this.root.push(new J0(t)), this.root.push(new vv({ transform: n, outline: r }));
  }
}
class xv extends ue {
  constructor({
    mediaData: t,
    transform: n,
    outline: r
  }) {
    super("a:graphicData"), le(this, "pic"), this.root.push(
      new H0({
        uri: "http://schemas.openxmlformats.org/drawingml/2006/picture"
      })
    ), this.pic = new wv({ mediaData: t, transform: n, outline: r }), this.root.push(this.pic);
  }
}
class Dv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      a: "xmlns:a"
    });
  }
}
class Np extends ue {
  constructor({
    mediaData: t,
    transform: n,
    outline: r
  }) {
    super("a:graphic"), le(this, "data"), this.root.push(
      new Dv({
        a: "http://schemas.openxmlformats.org/drawingml/2006/main"
      })
    ), this.data = new xv({ mediaData: t, transform: n, outline: r }), this.root.push(this.data);
  }
}
const Ai = {
  NONE: 0,
  SQUARE: 1,
  TIGHT: 2,
  TOP_AND_BOTTOM: 3
}, _v = {
  BOTH_SIDES: "bothSides",
  LEFT: "left",
  RIGHT: "right",
  LARGEST: "largest"
};
class xd extends ue {
  constructor() {
    super("wp:wrapNone");
  }
}
class Tv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      distT: "distT",
      distB: "distB",
      distL: "distL",
      distR: "distR",
      wrapText: "wrapText"
    });
  }
}
class Ev extends ue {
  constructor(t, n = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  }) {
    super("wp:wrapSquare"), this.root.push(
      new Tv({
        wrapText: t.side || _v.BOTH_SIDES,
        distT: n.top,
        distB: n.bottom,
        distL: n.left,
        distR: n.right
      })
    );
  }
}
class Av extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      distT: "distT",
      distB: "distB"
    });
  }
}
class Uv extends ue {
  constructor(t = {
    top: 0,
    bottom: 0
  }) {
    super("wp:wrapTight"), this.root.push(
      new Av({
        distT: t.top,
        distB: t.bottom
      })
    );
  }
}
class Cv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      distT: "distT",
      distB: "distB"
    });
  }
}
class Sv extends ue {
  constructor(t = {
    top: 0,
    bottom: 0
  }) {
    super("wp:wrapTopAndBottom"), this.root.push(
      new Cv({
        distT: t.top,
        distB: t.bottom
      })
    );
  }
}
class Op extends ue {
  constructor({ name: t, description: n, title: r } = { name: "", description: "", title: "" }) {
    super("wp:docPr"), le(this, "docPropertiesUniqueNumericId", R0()), this.root.push(
      new cn({
        id: {
          key: "id",
          value: this.docPropertiesUniqueNumericId()
        },
        name: {
          key: "name",
          value: t
        },
        description: {
          key: "descr",
          value: n
        },
        title: {
          key: "title",
          value: r
        }
      })
    );
  }
  prepForXml(t) {
    for (let n = t.stack.length - 1; n >= 0; n--) {
      const r = t.stack[n];
      if (r instanceof eu) {
        this.root.push(Rp(r.linkId, !0));
        break;
      }
    }
    return super.prepForXml(t);
  }
}
const Wp = ({ top: e, right: t, bottom: n, left: r }) => new He({
  name: "wp:effectExtent",
  attributes: {
    top: {
      key: "t",
      value: e
    },
    right: {
      key: "r",
      value: t
    },
    bottom: {
      key: "b",
      value: n
    },
    left: {
      key: "l",
      value: r
    }
  }
});
class Fv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      cx: "cx",
      cy: "cy"
    });
  }
}
class Lp extends ue {
  constructor(t, n) {
    super("wp:extent"), le(this, "attributes"), this.attributes = new Fv({
      cx: t,
      cy: n
    }), this.root.push(this.attributes);
  }
}
class kv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      xmlns: "xmlns:a",
      noChangeAspect: "noChangeAspect"
    });
  }
}
class Bv extends ue {
  constructor() {
    super("a:graphicFrameLocks"), this.root.push(
      new kv({
        xmlns: "http://schemas.openxmlformats.org/drawingml/2006/main",
        noChangeAspect: 1
      })
    );
  }
}
class Pp extends ue {
  constructor() {
    super("wp:cNvGraphicFramePr"), this.root.push(new Bv());
  }
}
class Rv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      distT: "distT",
      distB: "distB",
      distL: "distL",
      distR: "distR",
      allowOverlap: "allowOverlap",
      behindDoc: "behindDoc",
      layoutInCell: "layoutInCell",
      locked: "locked",
      relativeHeight: "relativeHeight",
      simplePos: "simplePos"
    });
  }
}
class Iv extends ue {
  constructor({
    mediaData: t,
    transform: n,
    drawingOptions: r
  }) {
    super("wp:anchor");
    const i = Te({
      allowOverlap: !0,
      behindDocument: !1,
      lockAnchor: !1,
      layoutInCell: !0,
      verticalPosition: {},
      horizontalPosition: {}
    }, r.floating);
    if (this.root.push(
      new Rv({
        distT: i.margins && i.margins.top || 0,
        distB: i.margins && i.margins.bottom || 0,
        distL: i.margins && i.margins.left || 0,
        distR: i.margins && i.margins.right || 0,
        simplePos: "0",
        // note: word doesn't fully support - so we use 0
        allowOverlap: i.allowOverlap === !0 ? "1" : "0",
        behindDoc: i.behindDocument === !0 ? "1" : "0",
        locked: i.lockAnchor === !0 ? "1" : "0",
        layoutInCell: i.layoutInCell === !0 ? "1" : "0",
        relativeHeight: i.zIndex ? i.zIndex : n.emus.y
      })
    ), this.root.push(new P0()), this.root.push(new z0(i.horizontalPosition)), this.root.push(new q0(i.verticalPosition)), this.root.push(new Lp(n.emus.x, n.emus.y)), this.root.push(Wp({ top: 0, right: 0, bottom: 0, left: 0 })), r.floating !== void 0 && r.floating.wrap !== void 0)
      switch (r.floating.wrap.type) {
        case Ai.SQUARE:
          this.root.push(new Ev(r.floating.wrap, r.floating.margins));
          break;
        case Ai.TIGHT:
          this.root.push(new Uv(r.floating.margins));
          break;
        case Ai.TOP_AND_BOTTOM:
          this.root.push(new Sv(r.floating.margins));
          break;
        case Ai.NONE:
        default:
          this.root.push(new xd());
      }
    else
      this.root.push(new xd());
    this.root.push(new Op(r.docProperties)), this.root.push(new Pp()), this.root.push(new Np({ mediaData: t, transform: n, outline: r.outline }));
  }
}
const Nv = ({ mediaData: e, transform: t, docProperties: n, outline: r }) => {
  var i, a, s, o;
  return new He({
    name: "wp:inline",
    attributes: {
      distanceTop: {
        key: "distT",
        value: 0
      },
      distanceBottom: {
        key: "distB",
        value: 0
      },
      distanceLeft: {
        key: "distL",
        value: 0
      },
      distanceRight: {
        key: "distR",
        value: 0
      }
    },
    children: [
      new Lp(t.emus.x, t.emus.y),
      Wp(
        r ? {
          top: ((i = r.width) != null ? i : 9525) * 2,
          right: ((a = r.width) != null ? a : 9525) * 2,
          bottom: ((s = r.width) != null ? s : 9525) * 2,
          left: ((o = r.width) != null ? o : 9525) * 2
        } : { top: 0, right: 0, bottom: 0, left: 0 }
      ),
      new Op(n),
      new Pp(),
      new Np({ mediaData: e, transform: t, outline: r })
    ]
  });
};
class Ov extends ue {
  constructor(t, n = {}) {
    super("w:drawing"), n.floating ? this.root.push(new Iv({ mediaData: t, transform: t.transformation, drawingOptions: n })) : this.root.push(
      Nv({
        mediaData: t,
        transform: t.transformation,
        docProperties: n.docProperties,
        outline: n.outline
      })
    );
  }
}
const Wv = (e) => {
  if (typeof atob == "function") {
    const t = ";base64,", n = e.indexOf(t), r = n === -1 ? 0 : n + t.length;
    return new Uint8Array(
      atob(e.substring(r)).split("").map((i) => i.charCodeAt(0))
    );
  } else {
    const t = require("buffer");
    return new t.Buffer(e, "base64");
  }
}, Lv = (e) => typeof e == "string" ? Wv(e) : e, es = (e, t) => ({
  data: Lv(e.data),
  fileName: t,
  transformation: {
    pixels: {
      x: Math.round(e.transformation.width),
      y: Math.round(e.transformation.height)
    },
    emus: {
      x: Math.round(e.transformation.width * 9525),
      y: Math.round(e.transformation.height * 9525)
    },
    flip: e.transformation.flip,
    rotation: e.transformation.rotation ? e.transformation.rotation * 6e4 : void 0
  }
});
class Pv extends Mn {
  constructor(t) {
    super({}), le(this, "key"), le(this, "fallbackKey", `${Cc()}.png`), le(this, "imageData"), this.key = `${Cc()}.${t.type}`, this.imageData = t.type === "svg" ? bn(Te({
      type: t.type
    }, es(t, this.key)), {
      fallback: Te({
        type: t.fallback.type
      }, es(
        bn(Te({}, t.fallback), {
          transformation: t.transformation
        }),
        this.fallbackKey
      ))
    }) : Te({
      type: t.type
    }, es(t, this.key));
    const n = new Ov(this.imageData, {
      floating: t.floating,
      docProperties: t.altText,
      outline: t.outline
    });
    this.root.push(n);
  }
  prepForXml(t) {
    return t.file.Media.addImage(this.key, this.imageData), this.imageData.type === "svg" && t.file.Media.addImage(this.fallbackKey, this.imageData.fallback), super.prepForXml(t);
  }
}
class Mv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { id: "w:id", initials: "w:initials", author: "w:author", date: "w:date" });
  }
}
class zv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      "xmlns:cx": "xmlns:cx",
      "xmlns:cx1": "xmlns:cx1",
      "xmlns:cx2": "xmlns:cx2",
      "xmlns:cx3": "xmlns:cx3",
      "xmlns:cx4": "xmlns:cx4",
      "xmlns:cx5": "xmlns:cx5",
      "xmlns:cx6": "xmlns:cx6",
      "xmlns:cx7": "xmlns:cx7",
      "xmlns:cx8": "xmlns:cx8",
      "xmlns:mc": "xmlns:mc",
      "xmlns:aink": "xmlns:aink",
      "xmlns:am3d": "xmlns:am3d",
      "xmlns:o": "xmlns:o",
      "xmlns:r": "xmlns:r",
      "xmlns:m": "xmlns:m",
      "xmlns:v": "xmlns:v",
      "xmlns:wp14": "xmlns:wp14",
      "xmlns:wp": "xmlns:wp",
      "xmlns:w10": "xmlns:w10",
      "xmlns:w": "xmlns:w",
      "xmlns:w14": "xmlns:w14",
      "xmlns:w15": "xmlns:w15",
      "xmlns:w16cex": "xmlns:w16cex",
      "xmlns:w16cid": "xmlns:w16cid",
      "xmlns:w16": "xmlns:w16",
      "xmlns:w16sdtdh": "xmlns:w16sdtdh",
      "xmlns:w16se": "xmlns:w16se",
      "xmlns:wpg": "xmlns:wpg",
      "xmlns:wpi": "xmlns:wpi",
      "xmlns:wne": "xmlns:wne",
      "xmlns:wps": "xmlns:wps"
    });
  }
}
let jv = class extends ue {
  constructor({ id: t, initials: n, author: r, date: i = /* @__PURE__ */ new Date(), children: a }) {
    super("w:comment"), this.root.push(
      new Mv({
        id: t,
        initials: n,
        author: r,
        date: i.toISOString()
      })
    );
    for (const s of a)
      this.root.push(s);
  }
};
class qv extends ue {
  constructor({ children: t }) {
    super("w:comments"), this.root.push(
      new zv({
        "xmlns:cx": "http://schemas.microsoft.com/office/drawing/2014/chartex",
        "xmlns:cx1": "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex",
        "xmlns:cx2": "http://schemas.microsoft.com/office/drawing/2015/10/21/chartex",
        "xmlns:cx3": "http://schemas.microsoft.com/office/drawing/2016/5/9/chartex",
        "xmlns:cx4": "http://schemas.microsoft.com/office/drawing/2016/5/10/chartex",
        "xmlns:cx5": "http://schemas.microsoft.com/office/drawing/2016/5/11/chartex",
        "xmlns:cx6": "http://schemas.microsoft.com/office/drawing/2016/5/12/chartex",
        "xmlns:cx7": "http://schemas.microsoft.com/office/drawing/2016/5/13/chartex",
        "xmlns:cx8": "http://schemas.microsoft.com/office/drawing/2016/5/14/chartex",
        "xmlns:mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
        "xmlns:aink": "http://schemas.microsoft.com/office/drawing/2016/ink",
        "xmlns:am3d": "http://schemas.microsoft.com/office/drawing/2017/model3d",
        "xmlns:o": "urn:schemas-microsoft-com:office:office",
        "xmlns:r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "xmlns:m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
        "xmlns:v": "urn:schemas-microsoft-com:vml",
        "xmlns:wp14": "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        "xmlns:wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        "xmlns:w10": "urn:schemas-microsoft-com:office:word",
        "xmlns:w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "xmlns:w14": "http://schemas.microsoft.com/office/word/2010/wordml",
        "xmlns:w15": "http://schemas.microsoft.com/office/word/2012/wordml",
        "xmlns:w16cex": "http://schemas.microsoft.com/office/word/2018/wordml/cex",
        "xmlns:w16cid": "http://schemas.microsoft.com/office/word/2016/wordml/cid",
        "xmlns:w16": "http://schemas.microsoft.com/office/word/2018/wordml",
        "xmlns:w16sdtdh": "http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash",
        "xmlns:w16se": "http://schemas.microsoft.com/office/word/2015/wordml/symex",
        "xmlns:wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        "xmlns:wpi": "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        "xmlns:wne": "http://schemas.microsoft.com/office/word/2006/wordml",
        "xmlns:wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
      })
    );
    for (const n of t)
      this.root.push(new jv(n));
  }
}
let Hv = class extends e0 {
  constructor() {
    super("w:tab");
  }
};
const Vv = {
  COLUMN: "column",
  PAGE: "page"
  // textWrapping breaks are the default and already exposed via the "Run" class
};
class Gv extends ue {
  constructor(t) {
    super("w:br"), this.root.push(
      new We({
        type: t
      })
    );
  }
}
class Xv extends Mn {
  constructor() {
    super({}), this.root.push(new Gv(Vv.PAGE));
  }
}
class $v extends ue {
  constructor() {
    super("w:pageBreakBefore");
  }
}
const cr = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  AT_LEAST: "atLeast",
  EXACTLY: "exactly",
  EXACT: "exact",
  AUTO: "auto"
};
class Kv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      after: "w:after",
      before: "w:before",
      line: "w:line",
      lineRule: "w:lineRule"
    });
  }
}
class Zv extends ue {
  constructor(t) {
    super("w:spacing"), this.root.push(new Kv(t));
  }
}
const Hn = {
  HEADING_1: "Heading1",
  HEADING_2: "Heading2",
  HEADING_3: "Heading3",
  HEADING_4: "Heading4",
  HEADING_5: "Heading5",
  HEADING_6: "Heading6",
  TITLE: "Title"
};
let Ui = class extends ue {
  constructor(t) {
    super("w:pStyle"), this.root.push(
      new We({
        val: t
      })
    );
  }
};
class Yv extends ue {
  constructor(t) {
    super("w:tabs");
    for (const n of t)
      this.root.push(new Qv(n));
  }
}
const Dd = {
  LEFT: "left",
  RIGHT: "right",
  CENTER: "center",
  BAR: "bar",
  CLEAR: "clear",
  DECIMAL: "decimal",
  END: "end",
  NUM: "num",
  START: "start"
};
class Jv extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val", pos: "w:pos", leader: "w:leader" });
  }
}
class Qv extends ue {
  constructor({ type: t, position: n, leader: r }) {
    super("w:tab"), this.root.push(
      new Jv({
        val: t,
        pos: n,
        leader: r
      })
    );
  }
}
class ts extends ue {
  constructor(t, n) {
    super("w:numPr"), this.root.push(new e2(n)), this.root.push(new t2(t));
  }
}
class e2 extends ue {
  constructor(t) {
    if (super("w:ilvl"), t > 9)
      throw new Error(
        "Level cannot be greater than 9. Read more here: https://answers.microsoft.com/en-us/msoffice/forum/all/does-word-support-more-than-9-list-levels/d130fdcd-1781-446d-8c84-c6c79124e4d7"
      );
    this.root.push(
      new We({
        val: t
      })
    );
  }
}
class t2 extends ue {
  constructor(t) {
    super("w:numId"), this.root.push(
      new We({
        val: typeof t == "string" ? `{${t}}` : t
      })
    );
  }
}
class Mp extends ue {
  constructor() {
    super(...arguments), le(this, "fileChild", Symbol());
  }
}
class n2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      id: "Id",
      type: "Type",
      target: "Target",
      targetMode: "TargetMode"
    });
  }
}
const r2 = {
  EXTERNAL: "External"
};
class i2 extends ue {
  constructor(t, n, r, i) {
    super("Relationship"), this.root.push(
      new n2({
        id: t,
        type: n,
        target: r,
        targetMode: i
      })
    );
  }
}
class a2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      id: "r:id",
      history: "w:history",
      anchor: "w:anchor"
    });
  }
}
class eu extends ue {
  constructor(t, n, r) {
    super("w:hyperlink"), le(this, "linkId"), this.linkId = n;
    const i = {
      history: 1,
      anchor: r || void 0,
      id: r ? void 0 : `rId${this.linkId}`
    }, a = new a2(i);
    this.root.push(a), t.forEach((s) => {
      this.root.push(s);
    });
  }
}
class zp extends ue {
  constructor(t) {
    super("w:externalHyperlink"), this.options = t;
  }
}
class o2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      id: "w:id",
      name: "w:name"
    });
  }
}
class s2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      id: "w:id"
    });
  }
}
class c2 {
  constructor(t) {
    le(this, "bookmarkUniqueNumericId", I0()), le(this, "start"), le(this, "children"), le(this, "end");
    const n = this.bookmarkUniqueNumericId();
    this.start = new u2(t.id, n), this.children = t.children, this.end = new l2(n);
  }
}
let u2 = class extends ue {
  constructor(t, n) {
    super("w:bookmarkStart");
    const r = new o2({
      name: t,
      id: n
    });
    this.root.push(r);
  }
};
class l2 extends ue {
  constructor(t) {
    super("w:bookmarkEnd");
    const n = new s2({
      id: t
    });
    this.root.push(n);
  }
}
class d2 extends ue {
  constructor(t) {
    super("w:outlineLvl"), this.level = t, this.root.push(
      new We({
        val: t
      })
    );
  }
}
const ns = {
  BOTTOM: "bottom",
  CENTER: "center",
  TOP: "top"
};
class h2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      verticalAlign: "w:val"
    });
  }
}
class jp extends ue {
  constructor(t) {
    super("w:vAlign"), this.root.push(new h2({ verticalAlign: t }));
  }
}
const ur = {
  DEFAULT: "default",
  FIRST: "first",
  EVEN: "even"
};
class f2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      type: "w:type",
      id: "r:id"
    });
  }
}
const _d = {
  HEADER: "w:headerReference",
  FOOTER: "w:footerReference"
};
class rs extends ue {
  constructor(t, n) {
    super(t), this.root.push(
      new f2({
        type: n.type || ur.DEFAULT,
        id: `rId${n.id}`
      })
    );
  }
}
class p2 extends ue {
  constructor({ space: t, count: n, separate: r, equalWidth: i, children: a }) {
    super("w:cols"), this.root.push(
      new cn({
        space: { key: "w:space", value: t === void 0 ? void 0 : Ye(t) },
        count: { key: "w:num", value: n === void 0 ? void 0 : ot(n) },
        separate: { key: "w:sep", value: r },
        equalWidth: { key: "w:equalWidth", value: i }
      })
    ), !i && a && a.forEach((s) => this.addChildElement(s));
  }
}
class g2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      type: "w:type",
      linePitch: "w:linePitch",
      charSpace: "w:charSpace"
    });
  }
}
class m2 extends ue {
  constructor(t, n, r) {
    super("w:docGrid"), this.root.push(
      new g2({
        type: r,
        linePitch: ot(t),
        charSpace: n ? ot(n) : void 0
      })
    );
  }
}
const y2 = ({ countBy: e, start: t, restart: n, distance: r }) => new He({
  name: "w:lnNumType",
  attributes: {
    countBy: { key: "w:countBy", value: e === void 0 ? void 0 : ot(e) },
    start: { key: "w:start", value: t === void 0 ? void 0 : ot(t) },
    restart: { key: "w:restart", value: n },
    distance: {
      key: "w:distance",
      value: r === void 0 ? void 0 : Ye(r)
    }
  }
});
class Td extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      display: "w:display",
      offsetFrom: "w:offsetFrom",
      zOrder: "w:zOrder"
    });
  }
}
class b2 extends sn {
  constructor(t) {
    if (super("w:pgBorders"), !t)
      return this;
    t.pageBorders ? this.root.push(
      new Td({
        display: t.pageBorders.display,
        offsetFrom: t.pageBorders.offsetFrom,
        zOrder: t.pageBorders.zOrder
      })
    ) : this.root.push(new Td({})), t.pageBorderTop && this.root.push(new Be("w:top", t.pageBorderTop)), t.pageBorderLeft && this.root.push(new Be("w:left", t.pageBorderLeft)), t.pageBorderBottom && this.root.push(new Be("w:bottom", t.pageBorderBottom)), t.pageBorderRight && this.root.push(new Be("w:right", t.pageBorderRight));
  }
}
class v2 extends ue {
  constructor(t, n, r, i, a, s, o) {
    super("w:pgMar"), this.root.push(
      new cn({
        top: { key: "w:top", value: tn(t) },
        right: { key: "w:right", value: Ye(n) },
        bottom: { key: "w:bottom", value: tn(r) },
        left: { key: "w:left", value: Ye(i) },
        header: { key: "w:header", value: Ye(a) },
        footer: { key: "w:footer", value: Ye(s) },
        gutter: { key: "w:gutter", value: Ye(o) }
      })
    );
  }
}
class w2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      start: "w:start",
      formatType: "w:fmt",
      separator: "w:chapSep"
    });
  }
}
class x2 extends ue {
  constructor({ start: t, formatType: n, separator: r }) {
    super("w:pgNumType"), this.root.push(
      new w2({
        start: t === void 0 ? void 0 : ot(t),
        formatType: n,
        separator: r
      })
    );
  }
}
const qp = {
  PORTRAIT: "portrait",
  LANDSCAPE: "landscape"
};
class D2 extends ue {
  constructor(t, n, r) {
    super("w:pgSz");
    const i = r === qp.LANDSCAPE, a = Ye(t), s = Ye(n);
    this.root.push(
      new cn({
        width: { key: "w:w", value: i ? s : a },
        height: { key: "w:h", value: i ? a : s },
        orientation: { key: "w:orient", value: r }
      })
    );
  }
}
class _2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class T2 extends ue {
  constructor(t) {
    super("w:textDirection"), this.root.push(
      new _2({
        val: t
      })
    );
  }
}
class E2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      val: "w:val"
    });
  }
}
class A2 extends ue {
  constructor(t) {
    super("w:type"), this.root.push(new E2({ val: t }));
  }
}
const Cn = {
  TOP: 1440,
  RIGHT: 1440,
  BOTTOM: 1440,
  LEFT: 1440,
  HEADER: 708,
  FOOTER: 708,
  GUTTER: 0
}, is = {
  WIDTH: 11906,
  HEIGHT: 16838,
  ORIENTATION: qp.PORTRAIT
};
class U2 extends ue {
  constructor({
    page: {
      size: {
        width: t = is.WIDTH,
        height: n = is.HEIGHT,
        orientation: r = is.ORIENTATION
      } = {},
      margin: {
        top: i = Cn.TOP,
        right: a = Cn.RIGHT,
        bottom: s = Cn.BOTTOM,
        left: o = Cn.LEFT,
        header: c = Cn.HEADER,
        footer: u = Cn.FOOTER,
        gutter: h = Cn.GUTTER
      } = {},
      pageNumbers: y = {},
      borders: w,
      textDirection: p
    } = {},
    grid: { linePitch: x = 360, charSpace: d, type: v } = {},
    headerWrapperGroup: l = {},
    footerWrapperGroup: b = {},
    lineNumbers: _,
    titlePage: E,
    verticalAlign: C,
    column: R,
    type: I
  } = {}) {
    super("w:sectPr"), this.addHeaderFooterGroup(_d.HEADER, l), this.addHeaderFooterGroup(_d.FOOTER, b), I && this.root.push(new A2(I)), this.root.push(new D2(t, n, r)), this.root.push(new v2(i, a, s, o, c, u, h)), w && this.root.push(new b2(w)), _ && this.root.push(y2(_)), this.root.push(new x2(y)), R && this.root.push(new p2(R)), C && this.root.push(new jp(C)), E !== void 0 && this.root.push(new ge("w:titlePg", E)), p && this.root.push(new T2(p)), this.root.push(new m2(x, d, v));
  }
  addHeaderFooterGroup(t, n) {
    n.default && this.root.push(
      new rs(t, {
        type: ur.DEFAULT,
        id: n.default.View.ReferenceId
      })
    ), n.first && this.root.push(
      new rs(t, {
        type: ur.FIRST,
        id: n.first.View.ReferenceId
      })
    ), n.even && this.root.push(
      new rs(t, {
        type: ur.EVEN,
        id: n.even.View.ReferenceId
      })
    );
  }
}
class C2 extends ue {
  constructor() {
    super("w:body"), le(this, "sections", []);
  }
  /**
   * Adds new section properties.
   * Note: Previous section is created in paragraph after the current element, and then new section will be added.
   * The spec says:
   *  - section element should be in the last paragraph of the section
   *  - last section should be direct child of body
   *
   * @param options new section options
   */
  addSection(t) {
    const n = this.sections.pop();
    this.root.push(this.createSectionParagraph(n)), this.sections.push(new U2(t));
  }
  prepForXml(t) {
    return this.sections.length === 1 && (this.root.splice(0, 1), this.root.push(this.sections.pop())), super.prepForXml(t);
  }
  push(t) {
    this.root.push(t);
  }
  createSectionParagraph(t) {
    const n = new Mt({}), r = new mr({});
    return r.push(t), n.addChildElement(r), n;
  }
}
class ci extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      wpc: "xmlns:wpc",
      mc: "xmlns:mc",
      o: "xmlns:o",
      r: "xmlns:r",
      m: "xmlns:m",
      v: "xmlns:v",
      wp14: "xmlns:wp14",
      wp: "xmlns:wp",
      w10: "xmlns:w10",
      w: "xmlns:w",
      w14: "xmlns:w14",
      w15: "xmlns:w15",
      wpg: "xmlns:wpg",
      wpi: "xmlns:wpi",
      wne: "xmlns:wne",
      wps: "xmlns:wps",
      Ignorable: "mc:Ignorable",
      cp: "xmlns:cp",
      dc: "xmlns:dc",
      dcterms: "xmlns:dcterms",
      dcmitype: "xmlns:dcmitype",
      xsi: "xmlns:xsi",
      type: "xsi:type",
      cx: "xmlns:cx",
      cx1: "xmlns:cx1",
      cx2: "xmlns:cx2",
      cx3: "xmlns:cx3",
      cx4: "xmlns:cx4",
      cx5: "xmlns:cx5",
      cx6: "xmlns:cx6",
      cx7: "xmlns:cx7",
      cx8: "xmlns:cx8",
      aink: "xmlns:aink",
      am3d: "xmlns:am3d",
      w16cex: "xmlns:w16cex",
      w16cid: "xmlns:w16cid",
      w16: "xmlns:w16",
      w16sdtdh: "xmlns:w16sdtdh",
      w16se: "xmlns:w16se"
    });
  }
}
class S2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      color: "w:color",
      themeColor: "w:themeColor",
      themeShade: "w:themeShade",
      themeTint: "w:themeTint"
    });
  }
}
class F2 extends ue {
  constructor(t) {
    super("w:background"), this.root.push(
      new S2({
        color: t.color === void 0 ? void 0 : fr(t.color),
        themeColor: t.themeColor,
        themeShade: t.themeShade === void 0 ? void 0 : yd(t.themeShade),
        themeTint: t.themeTint === void 0 ? void 0 : yd(t.themeTint)
      })
    );
  }
}
let k2 = class extends ue {
  constructor(t) {
    super("w:document"), le(this, "body"), this.root.push(
      new ci({
        wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        o: "urn:schemas-microsoft-com:office:office",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
        v: "urn:schemas-microsoft-com:vml",
        wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        w10: "urn:schemas-microsoft-com:office:word",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        wne: "http://schemas.microsoft.com/office/word/2006/wordml",
        wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        cx: "http://schemas.microsoft.com/office/drawing/2014/chartex",
        cx1: "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex",
        cx2: "http://schemas.microsoft.com/office/drawing/2015/10/21/chartex",
        cx3: "http://schemas.microsoft.com/office/drawing/2016/5/9/chartex",
        cx4: "http://schemas.microsoft.com/office/drawing/2016/5/10/chartex",
        cx5: "http://schemas.microsoft.com/office/drawing/2016/5/11/chartex",
        cx6: "http://schemas.microsoft.com/office/drawing/2016/5/12/chartex",
        cx7: "http://schemas.microsoft.com/office/drawing/2016/5/13/chartex",
        cx8: "http://schemas.microsoft.com/office/drawing/2016/5/14/chartex",
        aink: "http://schemas.microsoft.com/office/drawing/2016/ink",
        am3d: "http://schemas.microsoft.com/office/drawing/2017/model3d",
        w16cex: "http://schemas.microsoft.com/office/word/2018/wordml/cex",
        w16cid: "http://schemas.microsoft.com/office/word/2016/wordml/cid",
        w16: "http://schemas.microsoft.com/office/word/2018/wordml",
        w16sdtdh: "http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash",
        w16se: "http://schemas.microsoft.com/office/word/2015/wordml/symex",
        Ignorable: "w14 w15 wp14"
      })
    ), this.body = new C2(), t.background && this.root.push(new F2(t.background)), this.root.push(this.body);
  }
  add(t) {
    return this.body.push(t), this;
  }
  get Body() {
    return this.body;
  }
};
class B2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      xmlns: "xmlns"
    });
  }
}
let Ar = class extends ue {
  constructor() {
    super("Relationships"), this.root.push(
      new B2({
        xmlns: "http://schemas.openxmlformats.org/package/2006/relationships"
      })
    );
  }
  createRelationship(t, n, r, i) {
    const a = new i2(`rId${t}`, n, r, i);
    return this.root.push(a), a;
  }
  get RelationshipCount() {
    return this.root.length - 1;
  }
};
class Hp {
  constructor(t) {
    le(this, "document"), le(this, "relationships"), this.document = new k2(t), this.relationships = new Ar();
  }
  get View() {
    return this.document;
  }
  get Relationships() {
    return this.relationships;
  }
}
class R2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class I2 extends ue {
  constructor() {
    super("w:wordWrap"), this.root.push(new R2({ val: 0 }));
  }
}
const N2 = (e) => {
  var t, n;
  return new He({
    name: "w:framePr",
    attributes: {
      anchorLock: {
        key: "w:anchorLock",
        value: e.anchorLock
      },
      dropCap: {
        key: "w:dropCap",
        value: e.dropCap
      },
      width: {
        key: "w:w",
        value: e.width
      },
      height: {
        key: "w:h",
        value: e.height
      },
      x: {
        key: "w:x",
        value: e.position ? e.position.x : void 0
      },
      y: {
        key: "w:y",
        value: e.position ? e.position.y : void 0
      },
      anchorHorizontal: {
        key: "w:hAnchor",
        value: e.anchor.horizontal
      },
      anchorVertical: {
        key: "w:vAnchor",
        value: e.anchor.vertical
      },
      spaceHorizontal: {
        key: "w:hSpace",
        value: (t = e.space) == null ? void 0 : t.horizontal
      },
      spaceVertical: {
        key: "w:vSpace",
        value: (n = e.space) == null ? void 0 : n.vertical
      },
      rule: {
        key: "w:hRule",
        value: e.rule
      },
      alignmentX: {
        key: "w:xAlign",
        value: e.alignment ? e.alignment.x : void 0
      },
      alignmentY: {
        key: "w:yAlign",
        value: e.alignment ? e.alignment.y : void 0
      },
      lines: {
        key: "w:lines",
        value: e.lines
      },
      wrap: {
        key: "w:wrap",
        value: e.wrap
      }
    }
  });
};
class mr extends sn {
  constructor(t) {
    var n, r;
    if (super("w:pPr"), le(this, "numberingReferences", []), !t)
      return this;
    t.heading && this.push(new Ui(t.heading)), t.bullet && this.push(new Ui("ListParagraph")), t.numbering && !t.style && !t.heading && (t.numbering.custom || this.push(new Ui("ListParagraph"))), t.style && this.push(new Ui(t.style)), t.keepNext !== void 0 && this.push(new ge("w:keepNext", t.keepNext)), t.keepLines !== void 0 && this.push(new ge("w:keepLines", t.keepLines)), t.pageBreakBefore && this.push(new $v()), t.frame && this.push(N2(t.frame)), t.widowControl !== void 0 && this.push(new ge("w:widowControl", t.widowControl)), t.bullet && this.push(new ts(1, t.bullet.level)), t.numbering ? (this.numberingReferences.push({
      reference: t.numbering.reference,
      instance: (n = t.numbering.instance) != null ? n : 0
    }), this.push(new ts(`${t.numbering.reference}-${(r = t.numbering.instance) != null ? r : 0}`, t.numbering.level))) : t.numbering === !1 && this.push(new ts(0, 0)), t.border && this.push(new i0(t.border)), t.thematicBreak && this.push(new a0()), t.shading && this.push(new ha(t.shading)), t.wordWrap && this.push(new I2()), t.overflowPunctuation && this.push(new ge("w:overflowPunct", t.overflowPunctuation));
    const i = [
      ...t.rightTabStop !== void 0 ? [{ type: Dd.RIGHT, position: t.rightTabStop }] : [],
      ...t.tabStops ? t.tabStops : [],
      ...t.leftTabStop !== void 0 ? [{ type: Dd.LEFT, position: t.leftTabStop }] : []
    ];
    i.length > 0 && this.push(new Yv(i)), t.bidirectional !== void 0 && this.push(new ge("w:bidi", t.bidirectional)), t.spacing && this.push(new Zv(t.spacing)), t.indent && this.push(new o0(t.indent)), t.contextualSpacing !== void 0 && this.push(new ge("w:contextualSpacing", t.contextualSpacing)), t.alignment && this.push(new Cp(t.alignment)), t.outlineLevel !== void 0 && this.push(new d2(t.outlineLevel)), t.suppressLineNumbers !== void 0 && this.push(new ge("w:suppressLineNumbers", t.suppressLineNumbers)), t.autoSpaceEastAsianText !== void 0 && this.push(new ge("w:autoSpaceDN", t.autoSpaceEastAsianText)), t.run && this.push(new Pn(t.run));
  }
  push(t) {
    this.root.push(t);
  }
  prepForXml(t) {
    if (t.viewWrapper instanceof Hp)
      for (const n of this.numberingReferences)
        t.file.Numbering.createConcreteNumberingInstance(n.reference, n.instance);
    return super.prepForXml(t);
  }
}
let Mt = class extends Mp {
  constructor(t) {
    if (super("w:p"), le(this, "properties"), typeof t == "string")
      return this.properties = new mr({}), this.root.push(this.properties), this.root.push(new sr(t)), this;
    if (this.properties = new mr(t), this.root.push(this.properties), t.text && this.root.push(new sr(t.text)), t.children)
      for (const n of t.children) {
        if (n instanceof c2) {
          this.root.push(n.start);
          for (const r of n.children)
            this.root.push(r);
          this.root.push(n.end);
          continue;
        }
        this.root.push(n);
      }
  }
  prepForXml(t) {
    for (const n of this.root)
      if (n instanceof zp) {
        const r = this.root.indexOf(n), i = new eu(n.options.children, Cc());
        t.viewWrapper.Relationships.createRelationship(
          i.linkId,
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
          n.options.link,
          r2.EXTERNAL
        ), this.root[r] = i;
      }
    return super.prepForXml(t);
  }
  addRunToFront(t) {
    return this.root.splice(1, 0, t), this;
  }
};
class O2 extends ue {
  constructor(t) {
    super("m:t"), this.root.push(t);
  }
}
class W2 extends ue {
  constructor(t) {
    super("m:r"), this.root.push(new O2(t));
  }
}
class L2 extends ue {
  constructor(t) {
    super("w:tblGrid");
    for (const n of t)
      this.root.push(new P2(n));
  }
}
class P2 extends ue {
  constructor(t) {
    super("w:gridCol"), t !== void 0 && this.root.push(
      new cn({
        width: { key: "w:w", value: Ye(t) }
      })
    );
  }
}
const Vp = {
  TABLE: "w:tblCellMar",
  // eslint-disable-next-line @typescript-eslint/naming-convention
  TABLE_CELL: "w:tcMar"
};
class Gp extends sn {
  constructor(t, { marginUnitType: n = Gr.DXA, top: r, left: i, bottom: a, right: s }) {
    super(t), r !== void 0 && this.root.push(new kn("w:top", { type: n, size: r })), i !== void 0 && this.root.push(new kn("w:left", { type: n, size: i })), a !== void 0 && this.root.push(new kn("w:bottom", { type: n, size: a })), s !== void 0 && this.root.push(new kn("w:right", { type: n, size: s }));
  }
}
const Gr = {
  /** Auto. */
  AUTO: "auto",
  /** Value is in twentieths of a point */
  DXA: "dxa",
  /** No (empty) value. */
  NIL: "nil",
  /** Value is in percentage. */
  PERCENTAGE: "pct"
};
class kn extends ue {
  constructor(t, { type: n = Gr.AUTO, size: r }) {
    super(t);
    let i = r;
    n === Gr.PERCENTAGE && typeof r == "number" && (i = `${r}%`), this.root.push(
      new cn({
        type: { key: "w:type", value: n },
        size: { key: "w:w", value: Zb(i) }
      })
    );
  }
}
class M2 extends sn {
  constructor(t) {
    super("w:tcBorders"), t.top && this.root.push(new Be("w:top", t.top)), t.start && this.root.push(new Be("w:start", t.start)), t.left && this.root.push(new Be("w:left", t.left)), t.bottom && this.root.push(new Be("w:bottom", t.bottom)), t.end && this.root.push(new Be("w:end", t.end)), t.right && this.root.push(new Be("w:right", t.right));
  }
}
class z2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class j2 extends ue {
  constructor(t) {
    super("w:gridSpan"), this.root.push(
      new z2({
        val: ot(t)
      })
    );
  }
}
const Xp = {
  /**
   * Cell that is merged with upper one.
   */
  CONTINUE: "continue",
  /**
   * Cell that is starting the vertical merge.
   */
  RESTART: "restart"
};
class q2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class Ed extends ue {
  constructor(t) {
    super("w:vMerge"), this.root.push(
      new q2({
        val: t
      })
    );
  }
}
class H2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class V2 extends ue {
  constructor(t) {
    super("w:textDirection"), this.root.push(
      new H2({
        val: t
      })
    );
  }
}
class G2 extends sn {
  constructor(t) {
    super("w:tcPr"), t.width && this.root.push(new kn("w:tcW", t.width)), t.columnSpan && this.root.push(new j2(t.columnSpan)), t.verticalMerge ? this.root.push(new Ed(t.verticalMerge)) : t.rowSpan && t.rowSpan > 1 && this.root.push(new Ed(Xp.RESTART)), t.borders && this.root.push(new M2(t.borders)), t.shading && this.root.push(new ha(t.shading)), t.margins && this.root.push(new Gp(Vp.TABLE_CELL, t.margins)), t.textDirection && this.root.push(new V2(t.textDirection)), t.verticalAlign && this.root.push(new jp(t.verticalAlign));
  }
}
let tu = class extends ue {
  constructor(t) {
    super("w:tc"), this.options = t, this.root.push(new G2(t));
    for (const n of t.children)
      this.root.push(n);
  }
  prepForXml(t) {
    return this.root[this.root.length - 1] instanceof Mt || this.root.push(new Mt({})), super.prepForXml(t);
  }
};
const Vn = {
  style: Rn.NONE,
  size: 0,
  color: "auto"
}, Gn = {
  style: Rn.SINGLE,
  size: 4,
  color: "auto"
};
class $p extends ue {
  constructor(t) {
    super("w:tblBorders"), t.top ? this.root.push(new Be("w:top", t.top)) : this.root.push(new Be("w:top", Gn)), t.left ? this.root.push(new Be("w:left", t.left)) : this.root.push(new Be("w:left", Gn)), t.bottom ? this.root.push(new Be("w:bottom", t.bottom)) : this.root.push(new Be("w:bottom", Gn)), t.right ? this.root.push(new Be("w:right", t.right)) : this.root.push(new Be("w:right", Gn)), t.insideHorizontal ? this.root.push(new Be("w:insideH", t.insideHorizontal)) : this.root.push(new Be("w:insideH", Gn)), t.insideVertical ? this.root.push(new Be("w:insideV", t.insideVertical)) : this.root.push(new Be("w:insideV", Gn));
  }
}
le($p, "NONE", {
  top: Vn,
  bottom: Vn,
  left: Vn,
  right: Vn,
  insideHorizontal: Vn,
  insideVertical: Vn
});
class X2 extends ue {
  constructor({
    horizontalAnchor: t,
    verticalAnchor: n,
    absoluteHorizontalPosition: r,
    relativeHorizontalPosition: i,
    absoluteVerticalPosition: a,
    relativeVerticalPosition: s,
    bottomFromText: o,
    topFromText: c,
    leftFromText: u,
    rightFromText: h,
    overlap: y
  }) {
    super("w:tblpPr"), this.root.push(
      new cn({
        leftFromText: {
          key: "w:leftFromText",
          value: u === void 0 ? void 0 : Ye(u)
        },
        rightFromText: {
          key: "w:rightFromText",
          value: h === void 0 ? void 0 : Ye(h)
        },
        topFromText: {
          key: "w:topFromText",
          value: c === void 0 ? void 0 : Ye(c)
        },
        bottomFromText: {
          key: "w:bottomFromText",
          value: o === void 0 ? void 0 : Ye(o)
        },
        absoluteHorizontalPosition: {
          key: "w:tblpX",
          value: r === void 0 ? void 0 : tn(r)
        },
        absoluteVerticalPosition: {
          key: "w:tblpY",
          value: a === void 0 ? void 0 : tn(a)
        },
        horizontalAnchor: {
          key: "w:horzAnchor",
          value: t === void 0 ? void 0 : t
        },
        relativeHorizontalPosition: {
          key: "w:tblpXSpec",
          value: i
        },
        relativeVerticalPosition: {
          key: "w:tblpYSpec",
          value: s
        },
        verticalAnchor: {
          key: "w:vertAnchor",
          value: n
        }
      })
    ), y && this.root.push(new t0("w:tblOverlap", y));
  }
}
class $2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { type: "w:type" });
  }
}
class K2 extends ue {
  constructor(t) {
    super("w:tblLayout"), this.root.push(new $2({ type: t }));
  }
}
class Z2 extends sn {
  constructor(t) {
    super("w:tblPr"), t.style && this.root.push(new mn("w:tblStyle", t.style)), t.float && this.root.push(new X2(t.float)), t.visuallyRightToLeft !== void 0 && this.root.push(new ge("w:bidiVisual", t.visuallyRightToLeft)), t.width && this.root.push(new kn("w:tblW", t.width)), t.alignment && this.root.push(new Cp(t.alignment)), t.indent && this.root.push(new kn("w:tblInd", t.indent)), t.borders && this.root.push(new $p(t.borders)), t.shading && this.root.push(new ha(t.shading)), t.layout && this.root.push(new K2(t.layout)), t.cellMargin && this.root.push(new Gp(Vp.TABLE, t.cellMargin));
  }
}
let Y2 = class extends Mp {
  constructor({
    rows: t,
    width: n,
    // eslint-disable-next-line functional/immutable-data
    columnWidths: r = Array(Math.max(...t.map((w) => w.CellCount))).fill(100),
    margins: i,
    indent: a,
    float: s,
    layout: o,
    style: c,
    borders: u,
    alignment: h,
    visuallyRightToLeft: y
  }) {
    super("w:tbl"), this.root.push(
      new Z2({
        borders: u ?? {},
        width: n ?? { size: 100 },
        indent: a,
        float: s,
        layout: o,
        style: c,
        alignment: h,
        cellMargin: i,
        visuallyRightToLeft: y
      })
    ), this.root.push(new L2(r));
    for (const w of t)
      this.root.push(w);
    t.forEach((w, p) => {
      if (p === t.length - 1)
        return;
      let x = 0;
      w.cells.forEach((d) => {
        if (d.options.rowSpan && d.options.rowSpan > 1) {
          const v = new tu({
            // the inserted CONTINUE cell has rowSpan, and will be handled when process the next row
            rowSpan: d.options.rowSpan - 1,
            columnSpan: d.options.columnSpan,
            borders: d.options.borders,
            children: [],
            verticalMerge: Xp.CONTINUE
          });
          t[p + 1].addCellToColumnIndex(v, x);
        }
        x += d.options.columnSpan || 1;
      });
    });
  }
};
const J2 = {
  /** Height is determined based on the content, so value is ignored. */
  AUTO: "auto",
  /** At least the value specified */
  ATLEAST: "atLeast",
  /** Exactly the value specified */
  EXACT: "exact"
};
class Q2 extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { value: "w:val", rule: "w:hRule" });
  }
}
class ew extends ue {
  constructor(t, n) {
    super("w:trHeight"), this.root.push(
      new Q2({
        value: Ye(t),
        rule: n
      })
    );
  }
}
class tw extends sn {
  constructor(t) {
    super("w:trPr"), t.cantSplit !== void 0 && this.root.push(new ge("w:cantSplit", t.cantSplit)), t.tableHeader !== void 0 && this.root.push(new ge("w:tblHeader", t.tableHeader)), t.height && this.root.push(new ew(t.height.value, t.height.rule));
  }
}
let nw = class extends ue {
  constructor(t) {
    super("w:tr"), this.options = t, this.root.push(new tw(t));
    for (const n of t.children)
      this.root.push(n);
  }
  get CellCount() {
    return this.options.children.length;
  }
  get cells() {
    return this.root.filter((t) => t instanceof tu);
  }
  addCellToIndex(t, n) {
    this.root.splice(n + 1, 0, t);
  }
  addCellToColumnIndex(t, n) {
    const r = this.columnIndexToRootIndex(n, !0);
    this.addCellToIndex(t, r - 1);
  }
  rootIndexToColumnIndex(t) {
    if (t < 1 || t >= this.root.length)
      throw new Error(`cell 'rootIndex' should between 1 to ${this.root.length - 1}`);
    let n = 0;
    for (let r = 1; r < t; r++) {
      const i = this.root[r];
      n += i.options.columnSpan || 1;
    }
    return n;
  }
  columnIndexToRootIndex(t, n = !1) {
    if (t < 0)
      throw new Error("cell 'columnIndex' should not less than zero");
    let r = 0, i = 1;
    for (; r <= t; ) {
      if (i >= this.root.length) {
        if (n)
          return this.root.length;
        throw new Error(`cell 'columnIndex' should not great than ${r - 1}`);
      }
      const a = this.root[i];
      i += 1, r += a && a.options.columnSpan || 1;
    }
    return i - 1;
  }
};
class rw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      xmlns: "xmlns",
      vt: "xmlns:vt"
    });
  }
}
class iw extends ue {
  constructor() {
    super("Properties"), this.root.push(
      new rw({
        xmlns: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
        vt: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
      })
    );
  }
}
class aw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      xmlns: "xmlns"
    });
  }
}
class ow extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      contentType: "ContentType",
      extension: "Extension"
    });
  }
}
class Kt extends ue {
  constructor(t, n) {
    super("Default"), this.root.push(
      new ow({
        contentType: t,
        extension: n
      })
    );
  }
}
class sw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      contentType: "ContentType",
      partName: "PartName"
    });
  }
}
class Tt extends ue {
  constructor(t, n) {
    super("Override"), this.root.push(
      new sw({
        contentType: t,
        partName: n
      })
    );
  }
}
class cw extends ue {
  constructor() {
    super("Types"), this.root.push(
      new aw({
        xmlns: "http://schemas.openxmlformats.org/package/2006/content-types"
      })
    ), this.root.push(new Kt("image/png", "png")), this.root.push(new Kt("image/jpeg", "jpeg")), this.root.push(new Kt("image/jpeg", "jpg")), this.root.push(new Kt("image/bmp", "bmp")), this.root.push(new Kt("image/gif", "gif")), this.root.push(new Kt("image/svg+xml", "svg")), this.root.push(new Kt("application/vnd.openxmlformats-package.relationships+xml", "rels")), this.root.push(new Kt("application/xml", "xml")), this.root.push(new Kt("application/vnd.openxmlformats-officedocument.obfuscatedFont", "odttf")), this.root.push(
      new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", "/word/document.xml")
    ), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml", "/word/styles.xml")), this.root.push(new Tt("application/vnd.openxmlformats-package.core-properties+xml", "/docProps/core.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.custom-properties+xml", "/docProps/custom.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.extended-properties+xml", "/docProps/app.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml", "/word/numbering.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml", "/word/footnotes.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml", "/word/settings.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml", "/word/comments.xml")), this.root.push(new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml", "/word/fontTable.xml"));
  }
  addFooter(t) {
    this.root.push(
      new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml", `/word/footer${t}.xml`)
    );
  }
  addHeader(t) {
    this.root.push(
      new Tt("application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml", `/word/header${t}.xml`)
    );
  }
}
class uw extends ue {
  constructor(t) {
    super("cp:coreProperties"), this.root.push(
      new ci({
        cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
        dc: "http://purl.org/dc/elements/1.1/",
        dcterms: "http://purl.org/dc/terms/",
        dcmitype: "http://purl.org/dc/dcmitype/",
        xsi: "http://www.w3.org/2001/XMLSchema-instance"
      })
    ), t.title && this.root.push(new Un("dc:title", t.title)), t.subject && this.root.push(new Un("dc:subject", t.subject)), t.creator && this.root.push(new Un("dc:creator", t.creator)), t.keywords && this.root.push(new Un("cp:keywords", t.keywords)), t.description && this.root.push(new Un("dc:description", t.description)), t.lastModifiedBy && this.root.push(new Un("cp:lastModifiedBy", t.lastModifiedBy)), t.revision && this.root.push(new Un("cp:revision", String(t.revision))), this.root.push(new Ad("dcterms:created")), this.root.push(new Ad("dcterms:modified"));
  }
}
class Ad extends ue {
  constructor(t) {
    super(t), this.root.push(
      new ci({
        type: "dcterms:W3CDTF"
      })
    ), this.root.push(Qb(/* @__PURE__ */ new Date()));
  }
}
class lw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      xmlns: "xmlns",
      vt: "xmlns:vt"
    });
  }
}
class dw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      fmtid: "fmtid",
      pid: "pid",
      name: "name"
    });
  }
}
class hw extends ue {
  constructor(t, n) {
    super("property"), this.root.push(
      new dw({
        fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}",
        pid: t.toString(),
        name: n.name
      })
    ), this.root.push(new fw(n.value));
  }
}
class fw extends ue {
  constructor(t) {
    super("vt:lpwstr"), this.root.push(t);
  }
}
class pw extends ue {
  constructor(t) {
    super("Properties"), le(this, "nextId"), le(this, "properties", []), this.root.push(
      new lw({
        xmlns: "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
        vt: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
      })
    ), this.nextId = 2;
    for (const n of t)
      this.addCustomProperty(n);
  }
  prepForXml(t) {
    return this.properties.forEach((n) => this.root.push(n)), super.prepForXml(t);
  }
  addCustomProperty(t) {
    this.properties.push(new hw(this.nextId++, t));
  }
}
class gw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      wpc: "xmlns:wpc",
      mc: "xmlns:mc",
      o: "xmlns:o",
      r: "xmlns:r",
      m: "xmlns:m",
      v: "xmlns:v",
      wp14: "xmlns:wp14",
      wp: "xmlns:wp",
      w10: "xmlns:w10",
      w: "xmlns:w",
      w14: "xmlns:w14",
      w15: "xmlns:w15",
      wpg: "xmlns:wpg",
      wpi: "xmlns:wpi",
      wne: "xmlns:wne",
      wps: "xmlns:wps",
      cp: "xmlns:cp",
      dc: "xmlns:dc",
      dcterms: "xmlns:dcterms",
      dcmitype: "xmlns:dcmitype",
      xsi: "xmlns:xsi",
      type: "xsi:type"
    });
  }
}
let mw = class extends Ap {
  constructor(t, n) {
    super("w:ftr", n), le(this, "refId"), this.refId = t, n || this.root.push(
      new gw({
        wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        o: "urn:schemas-microsoft-com:office:office",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
        v: "urn:schemas-microsoft-com:vml",
        wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        w10: "urn:schemas-microsoft-com:office:word",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        wne: "http://schemas.microsoft.com/office/word/2006/wordml",
        wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
      })
    );
  }
  get ReferenceId() {
    return this.refId;
  }
  add(t) {
    this.root.push(t);
  }
};
class yw {
  constructor(t, n, r) {
    le(this, "footer"), le(this, "relationships"), this.media = t, this.footer = new mw(n, r), this.relationships = new Ar();
  }
  add(t) {
    this.footer.add(t);
  }
  addChildElement(t) {
    this.footer.addChildElement(t);
  }
  get View() {
    return this.footer;
  }
  get Relationships() {
    return this.relationships;
  }
  get Media() {
    return this.media;
  }
}
class bw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      type: "w:type",
      id: "w:id"
    });
  }
}
class vw extends ue {
  constructor() {
    super("w:footnoteRef");
  }
}
class ww extends Mn {
  constructor() {
    super({
      style: "FootnoteReference"
    }), this.root.push(new vw());
  }
}
const Ud = {
  SEPERATOR: "separator",
  // eslint-disable-next-line @typescript-eslint/naming-convention
  CONTINUATION_SEPERATOR: "continuationSeparator"
};
class as extends ue {
  constructor(t) {
    super("w:footnote"), this.root.push(
      new bw({
        type: t.type,
        id: t.id
      })
    );
    for (let n = 0; n < t.children.length; n++) {
      const r = t.children[n];
      n === 0 && r.addRunToFront(new ww()), this.root.push(r);
    }
  }
}
class xw extends ue {
  constructor() {
    super("w:continuationSeparator");
  }
}
class Dw extends Mn {
  constructor() {
    super({}), this.root.push(new xw());
  }
}
class _w extends ue {
  constructor() {
    super("w:separator");
  }
}
class Tw extends Mn {
  constructor() {
    super({}), this.root.push(new _w());
  }
}
class Ew extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      wpc: "xmlns:wpc",
      mc: "xmlns:mc",
      o: "xmlns:o",
      r: "xmlns:r",
      m: "xmlns:m",
      v: "xmlns:v",
      wp14: "xmlns:wp14",
      wp: "xmlns:wp",
      w10: "xmlns:w10",
      w: "xmlns:w",
      w14: "xmlns:w14",
      w15: "xmlns:w15",
      wpg: "xmlns:wpg",
      wpi: "xmlns:wpi",
      wne: "xmlns:wne",
      wps: "xmlns:wps",
      Ignorable: "mc:Ignorable"
    });
  }
}
class Aw extends ue {
  constructor() {
    super("w:footnotes"), this.root.push(
      new Ew({
        wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        o: "urn:schemas-microsoft-com:office:office",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
        v: "urn:schemas-microsoft-com:vml",
        wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        w10: "urn:schemas-microsoft-com:office:word",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        wne: "http://schemas.microsoft.com/office/word/2006/wordml",
        wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        Ignorable: "w14 w15 wp14"
      })
    );
    const t = new as({
      id: -1,
      type: Ud.SEPERATOR,
      children: [
        new Mt({
          spacing: {
            after: 0,
            line: 240,
            lineRule: cr.AUTO
          },
          children: [new Tw()]
        })
      ]
    });
    this.root.push(t);
    const n = new as({
      id: 0,
      type: Ud.CONTINUATION_SEPERATOR,
      children: [
        new Mt({
          spacing: {
            after: 0,
            line: 240,
            lineRule: cr.AUTO
          },
          children: [new Dw()]
        })
      ]
    });
    this.root.push(n);
  }
  createFootNote(t, n) {
    const r = new as({
      id: t,
      children: n
    });
    this.root.push(r);
  }
}
class Uw {
  constructor() {
    le(this, "footnotess"), le(this, "relationships"), this.footnotess = new Aw(), this.relationships = new Ar();
  }
  get View() {
    return this.footnotess;
  }
  get Relationships() {
    return this.relationships;
  }
}
class Cw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      wpc: "xmlns:wpc",
      mc: "xmlns:mc",
      o: "xmlns:o",
      r: "xmlns:r",
      m: "xmlns:m",
      v: "xmlns:v",
      wp14: "xmlns:wp14",
      wp: "xmlns:wp",
      w10: "xmlns:w10",
      w: "xmlns:w",
      w14: "xmlns:w14",
      w15: "xmlns:w15",
      wpg: "xmlns:wpg",
      wpi: "xmlns:wpi",
      wne: "xmlns:wne",
      wps: "xmlns:wps",
      cp: "xmlns:cp",
      dc: "xmlns:dc",
      dcterms: "xmlns:dcterms",
      dcmitype: "xmlns:dcmitype",
      xsi: "xmlns:xsi",
      type: "xsi:type",
      cx: "xmlns:cx",
      cx1: "xmlns:cx1",
      cx2: "xmlns:cx2",
      cx3: "xmlns:cx3",
      cx4: "xmlns:cx4",
      cx5: "xmlns:cx5",
      cx6: "xmlns:cx6",
      cx7: "xmlns:cx7",
      cx8: "xmlns:cx8",
      w16cid: "xmlns:w16cid",
      w16se: "xmlns:w16se"
    });
  }
}
let Sw = class extends Ap {
  constructor(t, n) {
    super("w:hdr", n), le(this, "refId"), this.refId = t, n || this.root.push(
      new Cw({
        wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        o: "urn:schemas-microsoft-com:office:office",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
        v: "urn:schemas-microsoft-com:vml",
        wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        w10: "urn:schemas-microsoft-com:office:word",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        wne: "http://schemas.microsoft.com/office/word/2006/wordml",
        wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        cx: "http://schemas.microsoft.com/office/drawing/2014/chartex",
        cx1: "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex",
        cx2: "http://schemas.microsoft.com/office/drawing/2015/10/21/chartex",
        cx3: "http://schemas.microsoft.com/office/drawing/2016/5/9/chartex",
        cx4: "http://schemas.microsoft.com/office/drawing/2016/5/10/chartex",
        cx5: "http://schemas.microsoft.com/office/drawing/2016/5/11/chartex",
        cx6: "http://schemas.microsoft.com/office/drawing/2016/5/12/chartex",
        cx7: "http://schemas.microsoft.com/office/drawing/2016/5/13/chartex",
        cx8: "http://schemas.microsoft.com/office/drawing/2016/5/14/chartex",
        w16cid: "http://schemas.microsoft.com/office/word/2016/wordml/cid",
        w16se: "http://schemas.microsoft.com/office/word/2015/wordml/symex"
      })
    );
  }
  get ReferenceId() {
    return this.refId;
  }
  add(t) {
    this.root.push(t);
  }
};
class Fw {
  constructor(t, n, r) {
    le(this, "header"), le(this, "relationships"), this.media = t, this.header = new Sw(n, r), this.relationships = new Ar();
  }
  add(t) {
    return this.header.add(t), this;
  }
  addChildElement(t) {
    this.header.addChildElement(t);
  }
  get View() {
    return this.header;
  }
  get Relationships() {
    return this.relationships;
  }
  get Media() {
    return this.media;
  }
}
class kw {
  constructor() {
    le(this, "map"), this.map = /* @__PURE__ */ new Map();
  }
  addImage(t, n) {
    this.map.set(t, n);
  }
  get Array() {
    return Array.from(this.map.values());
  }
}
const Zt = {
  DECIMAL: "decimal",
  UPPER_ROMAN: "upperRoman",
  LOWER_ROMAN: "lowerRoman",
  UPPER_LETTER: "upperLetter",
  LOWER_LETTER: "lowerLetter",
  ORDINAL: "ordinal",
  CARDINAL_TEXT: "cardinalText",
  ORDINAL_TEXT: "ordinalText",
  HEX: "hex",
  CHICAGO: "chicago",
  IDEOGRAPH__DIGITAL: "ideographDigital",
  JAPANESE_COUNTING: "japaneseCounting",
  AIUEO: "aiueo",
  IROHA: "iroha",
  DECIMAL_FULL_WIDTH: "decimalFullWidth",
  DECIMAL_HALF_WIDTH: "decimalHalfWidth",
  JAPANESE_LEGAL: "japaneseLegal",
  JAPANESE_DIGITAL_TEN_THOUSAND: "japaneseDigitalTenThousand",
  DECIMAL_ENCLOSED_CIRCLE: "decimalEnclosedCircle",
  DECIMAL_FULL_WIDTH2: "decimalFullWidth2",
  AIUEO_FULL_WIDTH: "aiueoFullWidth",
  IROHA_FULL_WIDTH: "irohaFullWidth",
  DECIMAL_ZERO: "decimalZero",
  BULLET: "bullet",
  GANADA: "ganada",
  CHOSUNG: "chosung",
  DECIMAL_ENCLOSED_FULLSTOP: "decimalEnclosedFullstop",
  DECIMAL_ENCLOSED_PARENTHESES: "decimalEnclosedParen",
  DECIMAL_ENCLOSED_CIRCLE_CHINESE: "decimalEnclosedCircleChinese",
  IDEOGRAPH_ENCLOSED_CIRCLE: "ideographEnclosedCircle",
  IDEOGRAPH_TRADITIONAL: "ideographTraditional",
  IDEOGRAPH_ZODIAC: "ideographZodiac",
  IDEOGRAPH_ZODIAC_TRADITIONAL: "ideographZodiacTraditional",
  TAIWANESE_COUNTING: "taiwaneseCounting",
  IDEOGRAPH_LEGAL_TRADITIONAL: "ideographLegalTraditional",
  TAIWANESE_COUNTING_THOUSAND: "taiwaneseCountingThousand",
  TAIWANESE_DIGITAL: "taiwaneseDigital",
  CHINESE_COUNTING: "chineseCounting",
  CHINESE_LEGAL_SIMPLIFIED: "chineseLegalSimplified",
  CHINESE_COUNTING_THOUSAND: "chineseCountingThousand",
  KOREAN_DIGITAL: "koreanDigital",
  KOREAN_COUNTING: "koreanCounting",
  KOREAN_LEGAL: "koreanLegal",
  KOREAN_DIGITAL2: "koreanDigital2",
  VIETNAMESE_COUNTING: "vietnameseCounting",
  RUSSIAN_LOWER: "russianLower",
  RUSSIAN_UPPER: "russianUpper",
  NONE: "none",
  NUMBER_IN_DASH: "numberInDash",
  HEBREW1: "hebrew1",
  HEBREW2: "hebrew2",
  ARABIC_ALPHA: "arabicAlpha",
  ARABIC_ABJAD: "arabicAbjad",
  HINDI_VOWELS: "hindiVowels",
  HINDI_CONSONANTS: "hindiConsonants",
  HINDI_NUMBERS: "hindiNumbers",
  HINDI_COUNTING: "hindiCounting",
  THAI_LETTERS: "thaiLetters",
  THAI_NUMBERS: "thaiNumbers",
  THAI_COUNTING: "thaiCounting",
  BAHT_TEXT: "bahtText",
  DOLLAR_TEXT: "dollarText",
  CUSTOM: "custom"
};
class Bw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      ilvl: "w:ilvl",
      tentative: "w15:tentative"
    });
  }
}
class Rw extends ue {
  constructor(t) {
    super("w:numFmt"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class Iw extends ue {
  constructor(t) {
    super("w:lvlText"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class Nw extends ue {
  constructor(t) {
    super("w:lvlJc"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class Ow extends ue {
  constructor(t) {
    super("w:suff"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class Ww extends ue {
  constructor() {
    super("w:isLgl");
  }
}
class Lw extends ue {
  constructor({
    level: t,
    format: n,
    text: r,
    alignment: i = dt.START,
    start: a = 1,
    style: s,
    suffix: o,
    isLegalNumberingStyle: c
  }) {
    if (super("w:lvl"), le(this, "paragraphProperties"), le(this, "runProperties"), this.root.push(new Yc("w:start", ot(a))), n && this.root.push(new Rw(n)), o && this.root.push(new Ow(o)), c && this.root.push(new Ww()), r && this.root.push(new Iw(r)), this.root.push(new Nw(i)), this.paragraphProperties = new mr(s && s.paragraph), this.runProperties = new Pn(s && s.run), this.root.push(this.paragraphProperties), this.root.push(this.runProperties), t > 9)
      throw new Error(
        "Level cannot be greater than 9. Read more here: https://answers.microsoft.com/en-us/msoffice/forum/all/does-word-support-more-than-9-list-levels/d130fdcd-1781-446d-8c84-c6c79124e4d7"
      );
    this.root.push(
      new Bw({
        ilvl: ot(t),
        tentative: 1
      })
    );
  }
}
class Pw extends Lw {
  // This is the level that sits under abstractNum. We make a
  // handful of properties required
}
class Mw extends ue {
  constructor(t) {
    super("w:multiLevelType"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class zw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      abstractNumId: "w:abstractNumId",
      restartNumberingAfterBreak: "w15:restartNumberingAfterBreak"
    });
  }
}
class Cd extends ue {
  constructor(t, n) {
    super("w:abstractNum"), le(this, "id"), this.root.push(
      new zw({
        abstractNumId: ot(t),
        restartNumberingAfterBreak: 0
      })
    ), this.root.push(new Mw("hybridMultilevel")), this.id = t;
    for (const r of n)
      this.root.push(new Pw(r));
  }
}
class jw extends ue {
  constructor(t) {
    super("w:abstractNumId"), this.root.push(
      new We({
        val: t
      })
    );
  }
}
class qw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { numId: "w:numId" });
  }
}
class Sd extends ue {
  constructor(t) {
    if (super("w:num"), le(this, "numId"), le(this, "reference"), le(this, "instance"), this.numId = t.numId, this.reference = t.reference, this.instance = t.instance, this.root.push(
      new qw({
        numId: ot(t.numId)
      })
    ), this.root.push(new jw(ot(t.abstractNumId))), t.overrideLevels && t.overrideLevels.length)
      for (const n of t.overrideLevels)
        this.root.push(new Vw(n.num, n.start));
  }
}
class Hw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { ilvl: "w:ilvl" });
  }
}
class Vw extends ue {
  constructor(t, n) {
    super("w:lvlOverride"), this.root.push(new Hw({ ilvl: t })), n !== void 0 && this.root.push(new Xw(n));
  }
}
class Gw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class Xw extends ue {
  constructor(t) {
    super("w:startOverride"), this.root.push(new Gw({ val: t }));
  }
}
let $w = class extends ue {
  constructor(t) {
    super("w:numbering"), le(this, "abstractNumberingMap", /* @__PURE__ */ new Map()), le(this, "concreteNumberingMap", /* @__PURE__ */ new Map()), le(this, "referenceConfigMap", /* @__PURE__ */ new Map()), le(this, "abstractNumUniqueNumericId", k0()), le(this, "concreteNumUniqueNumericId", B0()), this.root.push(
      new ci({
        wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        o: "urn:schemas-microsoft-com:office:office",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
        v: "urn:schemas-microsoft-com:vml",
        wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        w10: "urn:schemas-microsoft-com:office:word",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        wne: "http://schemas.microsoft.com/office/word/2006/wordml",
        wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        Ignorable: "w14 w15 wp14"
      })
    );
    const n = new Cd(this.abstractNumUniqueNumericId(), [
      {
        level: 0,
        format: Zt.BULLET,
        text: "●",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: Bt(0.5), hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 1,
        format: Zt.BULLET,
        text: "○",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: Bt(1), hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 2,
        format: Zt.BULLET,
        text: "■",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 2160, hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 3,
        format: Zt.BULLET,
        text: "●",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 2880, hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 4,
        format: Zt.BULLET,
        text: "○",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 3600, hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 5,
        format: Zt.BULLET,
        text: "■",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 4320, hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 6,
        format: Zt.BULLET,
        text: "●",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 5040, hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 7,
        format: Zt.BULLET,
        text: "●",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 5760, hanging: Bt(0.25) }
          }
        }
      },
      {
        level: 8,
        format: Zt.BULLET,
        text: "●",
        alignment: dt.LEFT,
        style: {
          paragraph: {
            indent: { left: 6480, hanging: Bt(0.25) }
          }
        }
      }
    ]);
    this.concreteNumberingMap.set(
      "default-bullet-numbering",
      new Sd({
        numId: 1,
        abstractNumId: n.id,
        reference: "default-bullet-numbering",
        instance: 0,
        overrideLevels: [
          {
            num: 0,
            start: 1
          }
        ]
      })
    ), this.abstractNumberingMap.set("default-bullet-numbering", n);
    for (const r of t.config)
      this.abstractNumberingMap.set(r.reference, new Cd(this.abstractNumUniqueNumericId(), r.levels)), this.referenceConfigMap.set(r.reference, r.levels);
  }
  prepForXml(t) {
    for (const n of this.abstractNumberingMap.values())
      this.root.push(n);
    for (const n of this.concreteNumberingMap.values())
      this.root.push(n);
    return super.prepForXml(t);
  }
  createConcreteNumberingInstance(t, n) {
    const r = this.abstractNumberingMap.get(t);
    if (!r)
      return;
    const i = `${t}-${n}`;
    if (this.concreteNumberingMap.has(i))
      return;
    const a = this.referenceConfigMap.get(t), s = a && a[0].start, o = {
      numId: this.concreteNumUniqueNumericId(),
      abstractNumId: r.id,
      reference: t,
      instance: n,
      overrideLevels: [
        s && Number.isInteger(s) ? {
          num: 0,
          start: s
        } : {
          num: 0,
          start: 1
        }
      ]
    };
    this.concreteNumberingMap.set(i, new Sd(o));
  }
  get ConcreteNumbering() {
    return Array.from(this.concreteNumberingMap.values());
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get ReferenceConfig() {
    return Array.from(this.referenceConfigMap.values());
  }
};
class Kw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      version: "w:val",
      name: "w:name",
      uri: "w:uri"
    });
  }
}
class Zw extends ue {
  constructor(t) {
    super("w:compatSetting"), this.root.push(
      new Kw({
        version: t,
        uri: "http://schemas.microsoft.com/office/word",
        name: "compatibilityMode"
      })
    );
  }
}
class Yw extends ue {
  constructor(t) {
    super("w:compat"), t.version && this.root.push(new Zw(t.version)), t.useSingleBorderforContiguousCells && this.root.push(new ge("w:useSingleBorderforContiguousCells", t.useSingleBorderforContiguousCells)), t.wordPerfectJustification && this.root.push(new ge("w:wpJustification", t.wordPerfectJustification)), t.noTabStopForHangingIndent && this.root.push(new ge("w:noTabHangInd", t.noTabStopForHangingIndent)), t.noLeading && this.root.push(new ge("w:noLeading", t.noLeading)), t.spaceForUnderline && this.root.push(new ge("w:spaceForUL", t.spaceForUnderline)), t.noColumnBalance && this.root.push(new ge("w:noColumnBalance", t.noColumnBalance)), t.balanceSingleByteDoubleByteWidth && this.root.push(new ge("w:balanceSingleByteDoubleByteWidth", t.balanceSingleByteDoubleByteWidth)), t.noExtraLineSpacing && this.root.push(new ge("w:noExtraLineSpacing", t.noExtraLineSpacing)), t.doNotLeaveBackslashAlone && this.root.push(new ge("w:doNotLeaveBackslashAlone", t.doNotLeaveBackslashAlone)), t.underlineTrailingSpaces && this.root.push(new ge("w:ulTrailSpace", t.underlineTrailingSpaces)), t.doNotExpandShiftReturn && this.root.push(new ge("w:doNotExpandShiftReturn", t.doNotExpandShiftReturn)), t.spacingInWholePoints && this.root.push(new ge("w:spacingInWholePoints", t.spacingInWholePoints)), t.lineWrapLikeWord6 && this.root.push(new ge("w:lineWrapLikeWord6", t.lineWrapLikeWord6)), t.printBodyTextBeforeHeader && this.root.push(new ge("w:printBodyTextBeforeHeader", t.printBodyTextBeforeHeader)), t.printColorsBlack && this.root.push(new ge("w:printColBlack", t.printColorsBlack)), t.spaceWidth && this.root.push(new ge("w:wpSpaceWidth", t.spaceWidth)), t.showBreaksInFrames && this.root.push(new ge("w:showBreaksInFrames", t.showBreaksInFrames)), t.subFontBySize && this.root.push(new ge("w:subFontBySize", t.subFontBySize)), t.suppressBottomSpacing && this.root.push(new ge("w:suppressBottomSpacing", t.suppressBottomSpacing)), t.suppressTopSpacing && this.root.push(new ge("w:suppressTopSpacing", t.suppressTopSpacing)), t.suppressSpacingAtTopOfPage && this.root.push(new ge("w:suppressSpacingAtTopOfPage", t.suppressSpacingAtTopOfPage)), t.suppressTopSpacingWP && this.root.push(new ge("w:suppressTopSpacingWP", t.suppressTopSpacingWP)), t.suppressSpBfAfterPgBrk && this.root.push(new ge("w:suppressSpBfAfterPgBrk", t.suppressSpBfAfterPgBrk)), t.swapBordersFacingPages && this.root.push(new ge("w:swapBordersFacingPages", t.swapBordersFacingPages)), t.convertMailMergeEsc && this.root.push(new ge("w:convMailMergeEsc", t.convertMailMergeEsc)), t.truncateFontHeightsLikeWP6 && this.root.push(new ge("w:truncateFontHeightsLikeWP6", t.truncateFontHeightsLikeWP6)), t.macWordSmallCaps && this.root.push(new ge("w:mwSmallCaps", t.macWordSmallCaps)), t.usePrinterMetrics && this.root.push(new ge("w:usePrinterMetrics", t.usePrinterMetrics)), t.doNotSuppressParagraphBorders && this.root.push(new ge("w:doNotSuppressParagraphBorders", t.doNotSuppressParagraphBorders)), t.wrapTrailSpaces && this.root.push(new ge("w:wrapTrailSpaces", t.wrapTrailSpaces)), t.footnoteLayoutLikeWW8 && this.root.push(new ge("w:footnoteLayoutLikeWW8", t.footnoteLayoutLikeWW8)), t.shapeLayoutLikeWW8 && this.root.push(new ge("w:shapeLayoutLikeWW8", t.shapeLayoutLikeWW8)), t.alignTablesRowByRow && this.root.push(new ge("w:alignTablesRowByRow", t.alignTablesRowByRow)), t.forgetLastTabAlignment && this.root.push(new ge("w:forgetLastTabAlignment", t.forgetLastTabAlignment)), t.adjustLineHeightInTable && this.root.push(new ge("w:adjustLineHeightInTable", t.adjustLineHeightInTable)), t.autoSpaceLikeWord95 && this.root.push(new ge("w:autoSpaceLikeWord95", t.autoSpaceLikeWord95)), t.noSpaceRaiseLower && this.root.push(new ge("w:noSpaceRaiseLower", t.noSpaceRaiseLower)), t.doNotUseHTMLParagraphAutoSpacing && this.root.push(new ge("w:doNotUseHTMLParagraphAutoSpacing", t.doNotUseHTMLParagraphAutoSpacing)), t.layoutRawTableWidth && this.root.push(new ge("w:layoutRawTableWidth", t.layoutRawTableWidth)), t.layoutTableRowsApart && this.root.push(new ge("w:layoutTableRowsApart", t.layoutTableRowsApart)), t.useWord97LineBreakRules && this.root.push(new ge("w:useWord97LineBreakRules", t.useWord97LineBreakRules)), t.doNotBreakWrappedTables && this.root.push(new ge("w:doNotBreakWrappedTables", t.doNotBreakWrappedTables)), t.doNotSnapToGridInCell && this.root.push(new ge("w:doNotSnapToGridInCell", t.doNotSnapToGridInCell)), t.selectFieldWithFirstOrLastCharacter && this.root.push(new ge("w:selectFldWithFirstOrLastChar", t.selectFieldWithFirstOrLastCharacter)), t.applyBreakingRules && this.root.push(new ge("w:applyBreakingRules", t.applyBreakingRules)), t.doNotWrapTextWithPunctuation && this.root.push(new ge("w:doNotWrapTextWithPunct", t.doNotWrapTextWithPunctuation)), t.doNotUseEastAsianBreakRules && this.root.push(new ge("w:doNotUseEastAsianBreakRules", t.doNotUseEastAsianBreakRules)), t.useWord2002TableStyleRules && this.root.push(new ge("w:useWord2002TableStyleRules", t.useWord2002TableStyleRules)), t.growAutofit && this.root.push(new ge("w:growAutofit", t.growAutofit)), t.useFELayout && this.root.push(new ge("w:useFELayout", t.useFELayout)), t.useNormalStyleForList && this.root.push(new ge("w:useNormalStyleForList", t.useNormalStyleForList)), t.doNotUseIndentAsNumberingTabStop && this.root.push(new ge("w:doNotUseIndentAsNumberingTabStop", t.doNotUseIndentAsNumberingTabStop)), t.useAlternateEastAsianLineBreakRules && this.root.push(new ge("w:useAltKinsokuLineBreakRules", t.useAlternateEastAsianLineBreakRules)), t.allowSpaceOfSameStyleInTable && this.root.push(new ge("w:allowSpaceOfSameStyleInTable", t.allowSpaceOfSameStyleInTable)), t.doNotSuppressIndentation && this.root.push(new ge("w:doNotSuppressIndentation", t.doNotSuppressIndentation)), t.doNotAutofitConstrainedTables && this.root.push(new ge("w:doNotAutofitConstrainedTables", t.doNotAutofitConstrainedTables)), t.autofitToFirstFixedWidthCell && this.root.push(new ge("w:autofitToFirstFixedWidthCell", t.autofitToFirstFixedWidthCell)), t.underlineTabInNumberingList && this.root.push(new ge("w:underlineTabInNumList", t.underlineTabInNumberingList)), t.displayHangulFixedWidth && this.root.push(new ge("w:displayHangulFixedWidth", t.displayHangulFixedWidth)), t.splitPgBreakAndParaMark && this.root.push(new ge("w:splitPgBreakAndParaMark", t.splitPgBreakAndParaMark)), t.doNotVerticallyAlignCellWithSp && this.root.push(new ge("w:doNotVertAlignCellWithSp", t.doNotVerticallyAlignCellWithSp)), t.doNotBreakConstrainedForcedTable && this.root.push(new ge("w:doNotBreakConstrainedForcedTable", t.doNotBreakConstrainedForcedTable)), t.ignoreVerticalAlignmentInTextboxes && this.root.push(new ge("w:doNotVertAlignInTxbx", t.ignoreVerticalAlignmentInTextboxes)), t.useAnsiKerningPairs && this.root.push(new ge("w:useAnsiKerningPairs", t.useAnsiKerningPairs)), t.cachedColumnBalance && this.root.push(new ge("w:cachedColBalance", t.cachedColumnBalance));
  }
}
class Jw extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      wpc: "xmlns:wpc",
      mc: "xmlns:mc",
      o: "xmlns:o",
      r: "xmlns:r",
      m: "xmlns:m",
      v: "xmlns:v",
      wp14: "xmlns:wp14",
      wp: "xmlns:wp",
      w10: "xmlns:w10",
      w: "xmlns:w",
      w14: "xmlns:w14",
      w15: "xmlns:w15",
      wpg: "xmlns:wpg",
      wpi: "xmlns:wpi",
      wne: "xmlns:wne",
      wps: "xmlns:wps",
      Ignorable: "mc:Ignorable"
    });
  }
}
class Qw extends ue {
  constructor(t) {
    var n, r, i, a;
    super("w:settings"), this.root.push(
      new Jw({
        wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        o: "urn:schemas-microsoft-com:office:office",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
        v: "urn:schemas-microsoft-com:vml",
        wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        w10: "urn:schemas-microsoft-com:office:word",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        wpi: "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
        wne: "http://schemas.microsoft.com/office/word/2006/wordml",
        wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        Ignorable: "w14 w15 wp14"
      })
    ), this.root.push(new ge("w:displayBackgroundShape", !0)), t.trackRevisions !== void 0 && this.root.push(new ge("w:trackRevisions", t.trackRevisions)), t.evenAndOddHeaders !== void 0 && this.root.push(new ge("w:evenAndOddHeaders", t.evenAndOddHeaders)), t.updateFields !== void 0 && this.root.push(new ge("w:updateFields", t.updateFields)), t.defaultTabStop !== void 0 && this.root.push(new Yc("w:defaultTabStop", t.defaultTabStop)), this.root.push(
      new Yw(bn(Te({}, (n = t.compatibility) != null ? n : {}), {
        version: (a = (i = (r = t.compatibility) == null ? void 0 : r.version) != null ? i : t.compatibilityModeVersion) != null ? a : 15
      }))
    );
  }
}
class Kp extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", { val: "w:val" });
  }
}
class ex extends ue {
  constructor(t) {
    super("w:name"), this.root.push(new Kp({ val: t }));
  }
}
class tx extends ue {
  constructor(t) {
    super("w:uiPriority"), this.root.push(new Kp({ val: ot(t) }));
  }
}
class nx extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      type: "w:type",
      styleId: "w:styleId",
      default: "w:default",
      customStyle: "w:customStyle"
    });
  }
}
class Zp extends ue {
  constructor(t, n) {
    super("w:style"), this.root.push(new nx(t)), n.name && this.root.push(new ex(n.name)), n.basedOn && this.root.push(new mn("w:basedOn", n.basedOn)), n.next && this.root.push(new mn("w:next", n.next)), n.link && this.root.push(new mn("w:link", n.link)), n.uiPriority !== void 0 && this.root.push(new tx(n.uiPriority)), n.semiHidden !== void 0 && this.root.push(new ge("w:semiHidden", n.semiHidden)), n.unhideWhenUsed !== void 0 && this.root.push(new ge("w:unhideWhenUsed", n.unhideWhenUsed)), n.quickFormat !== void 0 && this.root.push(new ge("w:qFormat", n.quickFormat));
  }
}
class pa extends Zp {
  constructor(t) {
    super({ type: "paragraph", styleId: t.id }, t), le(this, "paragraphProperties"), le(this, "runProperties"), this.paragraphProperties = new mr(t.paragraph), this.runProperties = new Pn(t.run), this.root.push(this.paragraphProperties), this.root.push(this.runProperties);
  }
}
class ga extends Zp {
  constructor(t) {
    super(
      { type: "character", styleId: t.id },
      Te({
        uiPriority: 99,
        unhideWhenUsed: !0
      }, t)
    ), le(this, "runProperties"), this.runProperties = new Pn(t.run), this.root.push(this.runProperties);
  }
}
class xn extends pa {
  constructor(t) {
    super(Te({
      basedOn: "Normal",
      next: "Normal",
      quickFormat: !0
    }, t));
  }
}
class rx extends xn {
  constructor(t) {
    super(Te({
      id: "Title",
      name: "Title"
    }, t));
  }
}
class ix extends xn {
  constructor(t) {
    super(Te({
      id: "Heading1",
      name: "Heading 1"
    }, t));
  }
}
class ax extends xn {
  constructor(t) {
    super(Te({
      id: "Heading2",
      name: "Heading 2"
    }, t));
  }
}
class ox extends xn {
  constructor(t) {
    super(Te({
      id: "Heading3",
      name: "Heading 3"
    }, t));
  }
}
class sx extends xn {
  constructor(t) {
    super(Te({
      id: "Heading4",
      name: "Heading 4"
    }, t));
  }
}
class cx extends xn {
  constructor(t) {
    super(Te({
      id: "Heading5",
      name: "Heading 5"
    }, t));
  }
}
class ux extends xn {
  constructor(t) {
    super(Te({
      id: "Heading6",
      name: "Heading 6"
    }, t));
  }
}
class lx extends xn {
  constructor(t) {
    super(Te({
      id: "Strong",
      name: "Strong"
    }, t));
  }
}
class dx extends pa {
  constructor(t) {
    super(Te({
      id: "ListParagraph",
      name: "List Paragraph",
      basedOn: "Normal",
      quickFormat: !0
    }, t));
  }
}
class hx extends pa {
  constructor(t) {
    super(Te({
      id: "FootnoteText",
      name: "footnote text",
      link: "FootnoteTextChar",
      basedOn: "Normal",
      uiPriority: 99,
      semiHidden: !0,
      unhideWhenUsed: !0,
      paragraph: {
        spacing: {
          after: 0,
          line: 240,
          lineRule: cr.AUTO
        }
      },
      run: {
        size: 20
      }
    }, t));
  }
}
class fx extends ga {
  constructor(t) {
    super(Te({
      id: "FootnoteReference",
      name: "footnote reference",
      basedOn: "DefaultParagraphFont",
      semiHidden: !0,
      run: {
        superScript: !0
      }
    }, t));
  }
}
class px extends ga {
  constructor(t) {
    super(Te({
      id: "FootnoteTextChar",
      name: "Footnote Text Char",
      basedOn: "DefaultParagraphFont",
      link: "FootnoteText",
      semiHidden: !0,
      run: {
        size: 20
      }
    }, t));
  }
}
class gx extends ga {
  constructor(t) {
    super(Te({
      id: "Hyperlink",
      name: "Hyperlink",
      basedOn: "DefaultParagraphFont",
      run: {
        color: "0563C1",
        underline: {
          type: Fp.SINGLE
        }
      }
    }, t));
  }
}
let Sc = class extends ue {
  constructor(t) {
    if (super("w:styles"), t.initialStyles && this.root.push(t.initialStyles), t.importedStyles)
      for (const n of t.importedStyles)
        this.root.push(n);
    if (t.paragraphStyles)
      for (const n of t.paragraphStyles)
        this.root.push(new pa(n));
    if (t.characterStyles)
      for (const n of t.characterStyles)
        this.root.push(new ga(n));
  }
};
class mx extends ue {
  constructor(t) {
    super("w:pPrDefault"), this.root.push(new mr(t));
  }
}
class yx extends ue {
  constructor(t) {
    super("w:rPrDefault"), this.root.push(new Pn(t));
  }
}
class bx extends ue {
  constructor(t) {
    super("w:docDefaults"), le(this, "runPropertiesDefaults"), le(this, "paragraphPropertiesDefaults"), this.runPropertiesDefaults = new yx(t.run), this.paragraphPropertiesDefaults = new mx(t.paragraph), this.root.push(this.runPropertiesDefaults), this.root.push(this.paragraphPropertiesDefaults);
  }
}
class vx {
  /**
   * Creates new Style based on the given styles.
   * Parses the styles and convert them to XmlComponent.
   * Example content from styles.xml:
   * <?xml version="1.0">
   * <w:styles xmlns:mc="some schema" ...>
   *
   *   <w:style w:type="paragraph" w:styleId="Heading1">
   *           <w:name w:val="heading 1"/>
   *           .....
   *   </w:style>
   *
   *   <w:style w:type="paragraph" w:styleId="Heading2">
   *           <w:name w:val="heading 2"/>
   *           .....
   *   </w:style>
   *
   *   <w:docDefaults>Or any other element will be parsed to</w:docDefaults>
   *
   * </w:styles>
   *
   * @param externalStyles context from styles.xml
   */
  newInstance(t) {
    const n = Ep.xml2js(t, { compact: !1 });
    let r;
    for (const s of n.elements || [])
      s.name === "w:styles" && (r = s);
    if (r === void 0)
      throw new Error("can not find styles element");
    const i = r.elements || [];
    return new Sc({
      initialStyles: new Gb(r.attributes),
      importedStyles: i.map((s) => $c(s))
    });
  }
}
class Fd {
  newInstance(t = {}) {
    var n;
    return {
      initialStyles: new ci({
        mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
        r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        w14: "http://schemas.microsoft.com/office/word/2010/wordml",
        w15: "http://schemas.microsoft.com/office/word/2012/wordml",
        Ignorable: "w14 w15"
      }),
      importedStyles: [
        new bx((n = t.document) != null ? n : {}),
        new rx(Te({
          run: {
            size: 56
          }
        }, t.title)),
        new ix(Te({
          run: {
            color: "2E74B5",
            size: 32
          }
        }, t.heading1)),
        new ax(Te({
          run: {
            color: "2E74B5",
            size: 26
          }
        }, t.heading2)),
        new ox(Te({
          run: {
            color: "1F4D78",
            size: 24
          }
        }, t.heading3)),
        new sx(Te({
          run: {
            color: "2E74B5",
            italics: !0
          }
        }, t.heading4)),
        new cx(Te({
          run: {
            color: "2E74B5"
          }
        }, t.heading5)),
        new ux(Te({
          run: {
            color: "1F4D78"
          }
        }, t.heading6)),
        new lx(Te({
          run: {
            bold: !0
          }
        }, t.strong)),
        new dx(t.listParagraph || {}),
        new gx(t.hyperlink || {}),
        new fx(t.footnoteReference || {}),
        new hx(t.footnoteText || {}),
        new px(t.footnoteTextChar || {})
      ]
    };
  }
}
const Ci = ({ id: e, fontKey: t, subsetted: n }, r) => new He({
  name: r,
  attributes: Te({
    id: { key: "r:id", value: e }
  }, t ? { fontKey: { key: "w:fontKey", value: `{${t}}` } } : {}),
  children: [...n ? [new ge("w:subsetted", n)] : []]
}), wx = ({
  name: e,
  altName: t,
  panose1: n,
  charset: r,
  family: i,
  notTrueType: a,
  pitch: s,
  sig: o,
  embedRegular: c,
  embedBold: u,
  embedItalic: h,
  embedBoldItalic: y
}) => (
  // http://www.datypic.com/sc/ooxml/e-w_font-1.html
  new He({
    name: "w:font",
    attributes: {
      name: { key: "w:name", value: e }
    },
    children: [
      // http://www.datypic.com/sc/ooxml/e-w_altName-1.html
      ...t ? [Or("w:altName", t)] : [],
      // http://www.datypic.com/sc/ooxml/e-w_panose1-1.html
      ...n ? [Or("w:panose1", n)] : [],
      // http://www.datypic.com/sc/ooxml/e-w_charset-1.html
      ...r ? [Or("w:charset", r)] : [],
      // http://www.datypic.com/sc/ooxml/e-w_family-1.html
      ...i ? [Or("w:family", i)] : [],
      // http://www.datypic.com/sc/ooxml/e-w_notTrueType-1.html
      ...a ? [new ge("w:notTrueType", a)] : [],
      ...s ? [Or("w:pitch", s)] : [],
      // http://www.datypic.com/sc/ooxml/e-w_sig-1.html
      ...o ? [
        new He({
          name: "w:sig",
          attributes: {
            usb0: { key: "w:usb0", value: o.usb0 },
            usb1: { key: "w:usb1", value: o.usb1 },
            usb2: { key: "w:usb2", value: o.usb2 },
            usb3: { key: "w:usb3", value: o.usb3 },
            csb0: { key: "w:csb0", value: o.csb0 },
            csb1: { key: "w:csb1", value: o.csb1 }
          }
        })
      ] : [],
      // http://www.datypic.com/sc/ooxml/e-w_embedRegular-1.html
      ...c ? [Ci(c, "w:embedRegular")] : [],
      // http://www.datypic.com/sc/ooxml/e-w_embedBold-1.html
      ...u ? [Ci(u, "w:embedBold")] : [],
      // http://www.datypic.com/sc/ooxml/e-w_embedItalic-1.html
      ...h ? [Ci(h, "w:embedItalic")] : [],
      // http://www.datypic.com/sc/ooxml/e-w_embedBoldItalic-1.html
      ...y ? [Ci(y, "w:embedBoldItalic")] : []
    ]
  })
), xx = ({
  name: e,
  index: t,
  fontKey: n,
  characterSet: r
}) => wx({
  name: e,
  sig: {
    usb0: "E0002AFF",
    usb1: "C000247B",
    usb2: "00000009",
    usb3: "00000000",
    csb0: "000001FF",
    csb1: "00000000"
  },
  charset: r,
  family: "auto",
  pitch: "variable",
  embedRegular: {
    fontKey: n,
    id: `rId${t}`
  }
}), Dx = (e) => (
  // https://c-rex.net/projects/samples/ooxml/e1/Part4/OOXML_P4_DOCX_Font_topic_ID0ERNCU.html
  // http://www.datypic.com/sc/ooxml/e-w_fonts.html
  new He({
    name: "w:fonts",
    attributes: {
      mc: { key: "xmlns:mc", value: "http://schemas.openxmlformats.org/markup-compatibility/2006" },
      r: { key: "xmlns:r", value: "http://schemas.openxmlformats.org/officeDocument/2006/relationships" },
      w: { key: "xmlns:w", value: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
      w14: { key: "xmlns:w14", value: "http://schemas.microsoft.com/office/word/2010/wordml" },
      w15: { key: "xmlns:w15", value: "http://schemas.microsoft.com/office/word/2012/wordml" },
      w16cex: { key: "xmlns:w16cex", value: "http://schemas.microsoft.com/office/word/2018/wordml/cex" },
      w16cid: { key: "xmlns:w16cid", value: "http://schemas.microsoft.com/office/word/2016/wordml/cid" },
      w16: { key: "xmlns:w16", value: "http://schemas.microsoft.com/office/word/2018/wordml" },
      w16sdtdh: { key: "xmlns:w16sdtdh", value: "http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash" },
      w16se: { key: "xmlns:w16se", value: "http://schemas.microsoft.com/office/word/2015/wordml/symex" },
      Ignorable: { key: "mc:Ignorable", value: "w14 w15 w16se w16cid w16 w16cex w16sdtdh" }
    },
    children: e.map(
      (t, n) => xx({
        name: t.name,
        index: n + 1,
        fontKey: t.fontKey
      })
    )
  })
);
class _x {
  constructor(t) {
    le(this, "fontTable"), le(this, "relationships"), le(this, "fontOptionsWithKey", []), this.options = t, this.fontOptionsWithKey = t.map((n) => bn(Te({}, n), { fontKey: N0() })), this.fontTable = Dx(this.fontOptionsWithKey), this.relationships = new Ar();
    for (let n = 0; n < t.length; n++)
      this.relationships.createRelationship(
        n + 1,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font",
        `fonts/${t[n].name}.odttf`
      );
  }
  get View() {
    return this.fontTable;
  }
  get Relationships() {
    return this.relationships;
  }
}
class Tx {
  constructor(t) {
    le(this, "currentRelationshipId", 1), le(this, "documentWrapper"), le(this, "headers", []), le(this, "footers", []), le(this, "coreProperties"), le(this, "numbering"), le(this, "media"), le(this, "fileRelationships"), le(this, "footnotesWrapper"), le(this, "settings"), le(this, "contentTypes"), le(this, "customProperties"), le(this, "appProperties"), le(this, "styles"), le(this, "comments"), le(this, "fontWrapper");
    var n, r, i, a, s, o, c, u;
    if (this.coreProperties = new uw(bn(Te({}, t), {
      creator: (n = t.creator) != null ? n : "Un-named",
      revision: (r = t.revision) != null ? r : 1,
      lastModifiedBy: (i = t.lastModifiedBy) != null ? i : "Un-named"
    })), this.numbering = new $w(t.numbering ? t.numbering : { config: [] }), this.comments = new qv((a = t.comments) != null ? a : { children: [] }), this.fileRelationships = new Ar(), this.customProperties = new pw((s = t.customProperties) != null ? s : []), this.appProperties = new iw(), this.footnotesWrapper = new Uw(), this.contentTypes = new cw(), this.documentWrapper = new Hp({ background: t.background }), this.settings = new Qw({
      compatibilityModeVersion: t.compatabilityModeVersion,
      compatibility: t.compatibility,
      evenAndOddHeaders: !!t.evenAndOddHeaderAndFooters,
      trackRevisions: (o = t.features) == null ? void 0 : o.trackRevisions,
      updateFields: (c = t.features) == null ? void 0 : c.updateFields,
      defaultTabStop: t.defaultTabStop
    }), this.media = new kw(), t.externalStyles !== void 0) {
      const h = new vx();
      this.styles = h.newInstance(t.externalStyles);
    } else if (t.styles) {
      const y = new Fd().newInstance(t.styles.default);
      this.styles = new Sc(Te(Te({}, y), t.styles));
    } else {
      const h = new Fd();
      this.styles = new Sc(h.newInstance());
    }
    this.addDefaultRelationships();
    for (const h of t.sections)
      this.addSection(h);
    if (t.footnotes)
      for (const h in t.footnotes)
        this.footnotesWrapper.View.createFootNote(parseFloat(h), t.footnotes[h].children);
    this.fontWrapper = new _x((u = t.fonts) != null ? u : []);
  }
  addSection({ headers: t = {}, footers: n = {}, children: r, properties: i }) {
    this.documentWrapper.View.Body.addSection(bn(Te({}, i), {
      headerWrapperGroup: {
        default: t.default ? this.createHeader(t.default) : void 0,
        first: t.first ? this.createHeader(t.first) : void 0,
        even: t.even ? this.createHeader(t.even) : void 0
      },
      footerWrapperGroup: {
        default: n.default ? this.createFooter(n.default) : void 0,
        first: n.first ? this.createFooter(n.first) : void 0,
        even: n.even ? this.createFooter(n.even) : void 0
      }
    }));
    for (const a of r)
      this.documentWrapper.View.add(a);
  }
  createHeader(t) {
    const n = new Fw(this.media, this.currentRelationshipId++);
    for (const r of t.options.children)
      n.add(r);
    return this.addHeaderToDocument(n), n;
  }
  createFooter(t) {
    const n = new yw(this.media, this.currentRelationshipId++);
    for (const r of t.options.children)
      n.add(r);
    return this.addFooterToDocument(n), n;
  }
  addHeaderToDocument(t, n = ur.DEFAULT) {
    this.headers.push({ header: t, type: n }), this.documentWrapper.Relationships.createRelationship(
      t.View.ReferenceId,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
      `header${this.headers.length}.xml`
    ), this.contentTypes.addHeader(this.headers.length);
  }
  addFooterToDocument(t, n = ur.DEFAULT) {
    this.footers.push({ footer: t, type: n }), this.documentWrapper.Relationships.createRelationship(
      t.View.ReferenceId,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
      `footer${this.footers.length}.xml`
    ), this.contentTypes.addFooter(this.footers.length);
  }
  addDefaultRelationships() {
    this.fileRelationships.createRelationship(
      1,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
      "word/document.xml"
    ), this.fileRelationships.createRelationship(
      2,
      "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
      "docProps/core.xml"
    ), this.fileRelationships.createRelationship(
      3,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
      "docProps/app.xml"
    ), this.fileRelationships.createRelationship(
      4,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
      "docProps/custom.xml"
    ), this.documentWrapper.Relationships.createRelationship(
      // eslint-disable-next-line functional/immutable-data
      this.currentRelationshipId++,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
      "styles.xml"
    ), this.documentWrapper.Relationships.createRelationship(
      // eslint-disable-next-line functional/immutable-data
      this.currentRelationshipId++,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
      "numbering.xml"
    ), this.documentWrapper.Relationships.createRelationship(
      // eslint-disable-next-line functional/immutable-data
      this.currentRelationshipId++,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
      "footnotes.xml"
    ), this.documentWrapper.Relationships.createRelationship(
      // eslint-disable-next-line functional/immutable-data
      this.currentRelationshipId++,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
      "settings.xml"
    ), this.documentWrapper.Relationships.createRelationship(
      // eslint-disable-next-line functional/immutable-data
      this.currentRelationshipId++,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
      "comments.xml"
    );
  }
  get Document() {
    return this.documentWrapper;
  }
  get Styles() {
    return this.styles;
  }
  get CoreProperties() {
    return this.coreProperties;
  }
  get Numbering() {
    return this.numbering;
  }
  get Media() {
    return this.media;
  }
  get FileRelationships() {
    return this.fileRelationships;
  }
  get Headers() {
    return this.headers.map((t) => t.header);
  }
  get Footers() {
    return this.footers.map((t) => t.footer);
  }
  get ContentTypes() {
    return this.contentTypes;
  }
  get CustomProperties() {
    return this.customProperties;
  }
  get AppProperties() {
    return this.appProperties;
  }
  get FootNotes() {
    return this.footnotesWrapper;
  }
  get Settings() {
    return this.settings;
  }
  get Comments() {
    return this.comments;
  }
  get FontTable() {
    return this.fontWrapper;
  }
}
class Ex extends ue {
  constructor() {
    super("w:sdtContent");
  }
}
class Ax extends ue {
  constructor(t) {
    super("w:sdtPr"), t && this.root.push(new mn("w:alias", t));
  }
}
class Ux {
  constructor(t = { children: [] }) {
    le(this, "options"), this.options = t;
  }
}
class Cx {
  constructor(t = { children: [] }) {
    le(this, "options"), this.options = t;
  }
}
class kd extends me {
  constructor() {
    super(...arguments), le(this, "xmlKeys", {
      val: "w14:val",
      symbolfont: "w14:font"
    });
  }
}
class os extends ue {
  constructor(t, n, r) {
    super(t), r ? this.root.push(new kd({ val: Xb(n), symbolfont: r })) : this.root.push(new kd({ val: n }));
  }
}
class Sx extends ue {
  constructor(t) {
    var n, r, i, a, s, o, c, u;
    super("w14:checkbox"), le(this, "DEFAULT_UNCHECKED_SYMBOL", "2610"), le(this, "DEFAULT_CHECKED_SYMBOL", "2612"), le(this, "DEFAULT_FONT", "MS Gothic");
    const h = t != null && t.checked ? "1" : "0";
    let y, w;
    this.root.push(new os("w14:checked", h)), y = (n = t == null ? void 0 : t.checkedState) != null && n.value ? (r = t == null ? void 0 : t.checkedState) == null ? void 0 : r.value : this.DEFAULT_CHECKED_SYMBOL, w = (i = t == null ? void 0 : t.checkedState) != null && i.font ? (a = t == null ? void 0 : t.checkedState) == null ? void 0 : a.font : this.DEFAULT_FONT, this.root.push(new os("w14:checkedState", y, w)), y = (s = t == null ? void 0 : t.uncheckedState) != null && s.value ? (o = t == null ? void 0 : t.uncheckedState) == null ? void 0 : o.value : this.DEFAULT_UNCHECKED_SYMBOL, w = (c = t == null ? void 0 : t.uncheckedState) != null && c.font ? (u = t == null ? void 0 : t.uncheckedState) == null ? void 0 : u.font : this.DEFAULT_FONT, this.root.push(new os("w14:uncheckedState", y, w));
  }
}
class Fx extends ue {
  constructor(t) {
    var n, r, i, a;
    super("w:sdt"), le(this, "DEFAULT_UNCHECKED_SYMBOL", "2610"), le(this, "DEFAULT_CHECKED_SYMBOL", "2612"), le(this, "DEFAULT_FONT", "MS Gothic");
    const s = new Ax(t == null ? void 0 : t.alias);
    s.addChildElement(new Sx(t)), this.root.push(s);
    const o = new Ex(), c = (n = t == null ? void 0 : t.checkedState) == null ? void 0 : n.font, u = (r = t == null ? void 0 : t.checkedState) == null ? void 0 : r.value, h = (i = t == null ? void 0 : t.uncheckedState) == null ? void 0 : i.font, y = (a = t == null ? void 0 : t.uncheckedState) == null ? void 0 : a.value;
    let w, p;
    t != null && t.checked ? (w = c || this.DEFAULT_FONT, p = u || this.DEFAULT_CHECKED_SYMBOL) : (w = h || this.DEFAULT_FONT, p = y || this.DEFAULT_UNCHECKED_SYMBOL);
    const x = new U0({
      char: p,
      symbolfont: w
    });
    o.addChildElement(x), this.root.push(o);
  }
}
function Si(e) {
  throw new Error('Could not dynamically require "' + e + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var Yp = { exports: {} };
(function(e, t) {
  (function(n) {
    e.exports = n();
  })(function() {
    return function n(r, i, a) {
      function s(u, h) {
        if (!i[u]) {
          if (!r[u]) {
            var y = typeof Si == "function" && Si;
            if (!h && y)
              return y(u, !0);
            if (o)
              return o(u, !0);
            var w = new Error("Cannot find module '" + u + "'");
            throw w.code = "MODULE_NOT_FOUND", w;
          }
          var p = i[u] = { exports: {} };
          r[u][0].call(p.exports, function(x) {
            var d = r[u][1][x];
            return s(d || x);
          }, p, p.exports, n, r, i, a);
        }
        return i[u].exports;
      }
      for (var o = typeof Si == "function" && Si, c = 0; c < a.length; c++)
        s(a[c]);
      return s;
    }({ 1: [function(n, r, i) {
      var a = n("./utils"), s = n("./support"), o = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      i.encode = function(c) {
        for (var u, h, y, w, p, x, d, v = [], l = 0, b = c.length, _ = b, E = a.getTypeOf(c) !== "string"; l < c.length; )
          _ = b - l, y = E ? (u = c[l++], h = l < b ? c[l++] : 0, l < b ? c[l++] : 0) : (u = c.charCodeAt(l++), h = l < b ? c.charCodeAt(l++) : 0, l < b ? c.charCodeAt(l++) : 0), w = u >> 2, p = (3 & u) << 4 | h >> 4, x = 1 < _ ? (15 & h) << 2 | y >> 6 : 64, d = 2 < _ ? 63 & y : 64, v.push(o.charAt(w) + o.charAt(p) + o.charAt(x) + o.charAt(d));
        return v.join("");
      }, i.decode = function(c) {
        var u, h, y, w, p, x, d = 0, v = 0, l = "data:";
        if (c.substr(0, l.length) === l)
          throw new Error("Invalid base64 input, it looks like a data url.");
        var b, _ = 3 * (c = c.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
        if (c.charAt(c.length - 1) === o.charAt(64) && _--, c.charAt(c.length - 2) === o.charAt(64) && _--, _ % 1 != 0)
          throw new Error("Invalid base64 input, bad content length.");
        for (b = s.uint8array ? new Uint8Array(0 | _) : new Array(0 | _); d < c.length; )
          u = o.indexOf(c.charAt(d++)) << 2 | (w = o.indexOf(c.charAt(d++))) >> 4, h = (15 & w) << 4 | (p = o.indexOf(c.charAt(d++))) >> 2, y = (3 & p) << 6 | (x = o.indexOf(c.charAt(d++))), b[v++] = u, p !== 64 && (b[v++] = h), x !== 64 && (b[v++] = y);
        return b;
      };
    }, { "./support": 30, "./utils": 32 }], 2: [function(n, r, i) {
      var a = n("./external"), s = n("./stream/DataWorker"), o = n("./stream/Crc32Probe"), c = n("./stream/DataLengthProbe");
      function u(h, y, w, p, x) {
        this.compressedSize = h, this.uncompressedSize = y, this.crc32 = w, this.compression = p, this.compressedContent = x;
      }
      u.prototype = { getContentWorker: function() {
        var h = new s(a.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new c("data_length")), y = this;
        return h.on("end", function() {
          if (this.streamInfo.data_length !== y.uncompressedSize)
            throw new Error("Bug : uncompressed data size mismatch");
        }), h;
      }, getCompressedWorker: function() {
        return new s(a.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
      } }, u.createWorkerFrom = function(h, y, w) {
        return h.pipe(new o()).pipe(new c("uncompressedSize")).pipe(y.compressWorker(w)).pipe(new c("compressedSize")).withStreamInfo("compression", y);
      }, r.exports = u;
    }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(n, r, i) {
      var a = n("./stream/GenericWorker");
      i.STORE = { magic: "\0\0", compressWorker: function() {
        return new a("STORE compression");
      }, uncompressWorker: function() {
        return new a("STORE decompression");
      } }, i.DEFLATE = n("./flate");
    }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(n, r, i) {
      var a = n("./utils"), s = function() {
        for (var o, c = [], u = 0; u < 256; u++) {
          o = u;
          for (var h = 0; h < 8; h++)
            o = 1 & o ? 3988292384 ^ o >>> 1 : o >>> 1;
          c[u] = o;
        }
        return c;
      }();
      r.exports = function(o, c) {
        return o !== void 0 && o.length ? a.getTypeOf(o) !== "string" ? function(u, h, y, w) {
          var p = s, x = w + y;
          u ^= -1;
          for (var d = w; d < x; d++)
            u = u >>> 8 ^ p[255 & (u ^ h[d])];
          return -1 ^ u;
        }(0 | c, o, o.length, 0) : function(u, h, y, w) {
          var p = s, x = w + y;
          u ^= -1;
          for (var d = w; d < x; d++)
            u = u >>> 8 ^ p[255 & (u ^ h.charCodeAt(d))];
          return -1 ^ u;
        }(0 | c, o, o.length, 0) : 0;
      };
    }, { "./utils": 32 }], 5: [function(n, r, i) {
      i.base64 = !1, i.binary = !1, i.dir = !1, i.createFolders = !0, i.date = null, i.compression = null, i.compressionOptions = null, i.comment = null, i.unixPermissions = null, i.dosPermissions = null;
    }, {}], 6: [function(n, r, i) {
      var a = null;
      a = typeof Promise < "u" ? Promise : n("lie"), r.exports = { Promise: a };
    }, { lie: 37 }], 7: [function(n, r, i) {
      var a = typeof Uint8Array < "u" && typeof Uint16Array < "u" && typeof Uint32Array < "u", s = n("pako"), o = n("./utils"), c = n("./stream/GenericWorker"), u = a ? "uint8array" : "array";
      function h(y, w) {
        c.call(this, "FlateWorker/" + y), this._pako = null, this._pakoAction = y, this._pakoOptions = w, this.meta = {};
      }
      i.magic = "\b\0", o.inherits(h, c), h.prototype.processChunk = function(y) {
        this.meta = y.meta, this._pako === null && this._createPako(), this._pako.push(o.transformTo(u, y.data), !1);
      }, h.prototype.flush = function() {
        c.prototype.flush.call(this), this._pako === null && this._createPako(), this._pako.push([], !0);
      }, h.prototype.cleanUp = function() {
        c.prototype.cleanUp.call(this), this._pako = null;
      }, h.prototype._createPako = function() {
        this._pako = new s[this._pakoAction]({ raw: !0, level: this._pakoOptions.level || -1 });
        var y = this;
        this._pako.onData = function(w) {
          y.push({ data: w, meta: y.meta });
        };
      }, i.compressWorker = function(y) {
        return new h("Deflate", y);
      }, i.uncompressWorker = function() {
        return new h("Inflate", {});
      };
    }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(n, r, i) {
      function a(p, x) {
        var d, v = "";
        for (d = 0; d < x; d++)
          v += String.fromCharCode(255 & p), p >>>= 8;
        return v;
      }
      function s(p, x, d, v, l, b) {
        var _, E, C = p.file, R = p.compression, I = b !== u.utf8encode, q = o.transformTo("string", b(C.name)), F = o.transformTo("string", u.utf8encode(C.name)), ie = C.comment, ce = o.transformTo("string", b(ie)), S = o.transformTo("string", u.utf8encode(ie)), M = F.length !== C.name.length, D = S.length !== ie.length, X = "", H = "", P = "", Z = C.dir, z = C.date, ae = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
        x && !d || (ae.crc32 = p.crc32, ae.compressedSize = p.compressedSize, ae.uncompressedSize = p.uncompressedSize);
        var O = 0;
        x && (O |= 8), I || !M && !D || (O |= 2048);
        var A = 0, G = 0;
        Z && (A |= 16), l === "UNIX" ? (G = 798, A |= function(re, Q) {
          var B = re;
          return re || (B = Q ? 16893 : 33204), (65535 & B) << 16;
        }(C.unixPermissions, Z)) : (G = 20, A |= function(re) {
          return 63 & (re || 0);
        }(C.dosPermissions)), _ = z.getUTCHours(), _ <<= 6, _ |= z.getUTCMinutes(), _ <<= 5, _ |= z.getUTCSeconds() / 2, E = z.getUTCFullYear() - 1980, E <<= 4, E |= z.getUTCMonth() + 1, E <<= 5, E |= z.getUTCDate(), M && (H = a(1, 1) + a(h(q), 4) + F, X += "up" + a(H.length, 2) + H), D && (P = a(1, 1) + a(h(ce), 4) + S, X += "uc" + a(P.length, 2) + P);
        var J = "";
        return J += `
\0`, J += a(O, 2), J += R.magic, J += a(_, 2), J += a(E, 2), J += a(ae.crc32, 4), J += a(ae.compressedSize, 4), J += a(ae.uncompressedSize, 4), J += a(q.length, 2), J += a(X.length, 2), { fileRecord: y.LOCAL_FILE_HEADER + J + q + X, dirRecord: y.CENTRAL_FILE_HEADER + a(G, 2) + J + a(ce.length, 2) + "\0\0\0\0" + a(A, 4) + a(v, 4) + q + X + ce };
      }
      var o = n("../utils"), c = n("../stream/GenericWorker"), u = n("../utf8"), h = n("../crc32"), y = n("../signature");
      function w(p, x, d, v) {
        c.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = x, this.zipPlatform = d, this.encodeFileName = v, this.streamFiles = p, this.accumulate = !1, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
      }
      o.inherits(w, c), w.prototype.push = function(p) {
        var x = p.meta.percent || 0, d = this.entriesCount, v = this._sources.length;
        this.accumulate ? this.contentBuffer.push(p) : (this.bytesWritten += p.data.length, c.prototype.push.call(this, { data: p.data, meta: { currentFile: this.currentFile, percent: d ? (x + 100 * (d - v - 1)) / d : 100 } }));
      }, w.prototype.openedSource = function(p) {
        this.currentSourceOffset = this.bytesWritten, this.currentFile = p.file.name;
        var x = this.streamFiles && !p.file.dir;
        if (x) {
          var d = s(p, x, !1, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
          this.push({ data: d.fileRecord, meta: { percent: 0 } });
        } else
          this.accumulate = !0;
      }, w.prototype.closedSource = function(p) {
        this.accumulate = !1;
        var x = this.streamFiles && !p.file.dir, d = s(p, x, !0, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
        if (this.dirRecords.push(d.dirRecord), x)
          this.push({ data: function(v) {
            return y.DATA_DESCRIPTOR + a(v.crc32, 4) + a(v.compressedSize, 4) + a(v.uncompressedSize, 4);
          }(p), meta: { percent: 100 } });
        else
          for (this.push({ data: d.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; )
            this.push(this.contentBuffer.shift());
        this.currentFile = null;
      }, w.prototype.flush = function() {
        for (var p = this.bytesWritten, x = 0; x < this.dirRecords.length; x++)
          this.push({ data: this.dirRecords[x], meta: { percent: 100 } });
        var d = this.bytesWritten - p, v = function(l, b, _, E, C) {
          var R = o.transformTo("string", C(E));
          return y.CENTRAL_DIRECTORY_END + "\0\0\0\0" + a(l, 2) + a(l, 2) + a(b, 4) + a(_, 4) + a(R.length, 2) + R;
        }(this.dirRecords.length, d, p, this.zipComment, this.encodeFileName);
        this.push({ data: v, meta: { percent: 100 } });
      }, w.prototype.prepareNextSource = function() {
        this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
      }, w.prototype.registerPrevious = function(p) {
        this._sources.push(p);
        var x = this;
        return p.on("data", function(d) {
          x.processChunk(d);
        }), p.on("end", function() {
          x.closedSource(x.previous.streamInfo), x._sources.length ? x.prepareNextSource() : x.end();
        }), p.on("error", function(d) {
          x.error(d);
        }), this;
      }, w.prototype.resume = function() {
        return !!c.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), !0) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), !0));
      }, w.prototype.error = function(p) {
        var x = this._sources;
        if (!c.prototype.error.call(this, p))
          return !1;
        for (var d = 0; d < x.length; d++)
          try {
            x[d].error(p);
          } catch {
          }
        return !0;
      }, w.prototype.lock = function() {
        c.prototype.lock.call(this);
        for (var p = this._sources, x = 0; x < p.length; x++)
          p[x].lock();
      }, r.exports = w;
    }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(n, r, i) {
      var a = n("../compressions"), s = n("./ZipFileWorker");
      i.generateWorker = function(o, c, u) {
        var h = new s(c.streamFiles, u, c.platform, c.encodeFileName), y = 0;
        try {
          o.forEach(function(w, p) {
            y++;
            var x = function(b, _) {
              var E = b || _, C = a[E];
              if (!C)
                throw new Error(E + " is not a valid compression method !");
              return C;
            }(p.options.compression, c.compression), d = p.options.compressionOptions || c.compressionOptions || {}, v = p.dir, l = p.date;
            p._compressWorker(x, d).withStreamInfo("file", { name: w, dir: v, date: l, comment: p.comment || "", unixPermissions: p.unixPermissions, dosPermissions: p.dosPermissions }).pipe(h);
          }), h.entriesCount = y;
        } catch (w) {
          h.error(w);
        }
        return h;
      };
    }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(n, r, i) {
      function a() {
        if (!(this instanceof a))
          return new a();
        if (arguments.length)
          throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
        this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
          var s = new a();
          for (var o in this)
            typeof this[o] != "function" && (s[o] = this[o]);
          return s;
        };
      }
      (a.prototype = n("./object")).loadAsync = n("./load"), a.support = n("./support"), a.defaults = n("./defaults"), a.version = "3.10.1", a.loadAsync = function(s, o) {
        return new a().loadAsync(s, o);
      }, a.external = n("./external"), r.exports = a;
    }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(n, r, i) {
      var a = n("./utils"), s = n("./external"), o = n("./utf8"), c = n("./zipEntries"), u = n("./stream/Crc32Probe"), h = n("./nodejsUtils");
      function y(w) {
        return new s.Promise(function(p, x) {
          var d = w.decompressed.getContentWorker().pipe(new u());
          d.on("error", function(v) {
            x(v);
          }).on("end", function() {
            d.streamInfo.crc32 !== w.decompressed.crc32 ? x(new Error("Corrupted zip : CRC32 mismatch")) : p();
          }).resume();
        });
      }
      r.exports = function(w, p) {
        var x = this;
        return p = a.extend(p || {}, { base64: !1, checkCRC32: !1, optimizedBinaryString: !1, createFolders: !1, decodeFileName: o.utf8decode }), h.isNode && h.isStream(w) ? s.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : a.prepareContent("the loaded zip file", w, !0, p.optimizedBinaryString, p.base64).then(function(d) {
          var v = new c(p);
          return v.load(d), v;
        }).then(function(d) {
          var v = [s.Promise.resolve(d)], l = d.files;
          if (p.checkCRC32)
            for (var b = 0; b < l.length; b++)
              v.push(y(l[b]));
          return s.Promise.all(v);
        }).then(function(d) {
          for (var v = d.shift(), l = v.files, b = 0; b < l.length; b++) {
            var _ = l[b], E = _.fileNameStr, C = a.resolve(_.fileNameStr);
            x.file(C, _.decompressed, { binary: !0, optimizedBinaryString: !0, date: _.date, dir: _.dir, comment: _.fileCommentStr.length ? _.fileCommentStr : null, unixPermissions: _.unixPermissions, dosPermissions: _.dosPermissions, createFolders: p.createFolders }), _.dir || (x.file(C).unsafeOriginalName = E);
          }
          return v.zipComment.length && (x.comment = v.zipComment), x;
        });
      };
    }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(n, r, i) {
      var a = n("../utils"), s = n("../stream/GenericWorker");
      function o(c, u) {
        s.call(this, "Nodejs stream input adapter for " + c), this._upstreamEnded = !1, this._bindStream(u);
      }
      a.inherits(o, s), o.prototype._bindStream = function(c) {
        var u = this;
        (this._stream = c).pause(), c.on("data", function(h) {
          u.push({ data: h, meta: { percent: 0 } });
        }).on("error", function(h) {
          u.isPaused ? this.generatedError = h : u.error(h);
        }).on("end", function() {
          u.isPaused ? u._upstreamEnded = !0 : u.end();
        });
      }, o.prototype.pause = function() {
        return !!s.prototype.pause.call(this) && (this._stream.pause(), !0);
      }, o.prototype.resume = function() {
        return !!s.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), !0);
      }, r.exports = o;
    }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(n, r, i) {
      var a = n("readable-stream").Readable;
      function s(o, c, u) {
        a.call(this, c), this._helper = o;
        var h = this;
        o.on("data", function(y, w) {
          h.push(y) || h._helper.pause(), u && u(w);
        }).on("error", function(y) {
          h.emit("error", y);
        }).on("end", function() {
          h.push(null);
        });
      }
      n("../utils").inherits(s, a), s.prototype._read = function() {
        this._helper.resume();
      }, r.exports = s;
    }, { "../utils": 32, "readable-stream": 16 }], 14: [function(n, r, i) {
      r.exports = { isNode: typeof Buffer < "u", newBufferFrom: function(a, s) {
        if (Buffer.from && Buffer.from !== Uint8Array.from)
          return Buffer.from(a, s);
        if (typeof a == "number")
          throw new Error('The "data" argument must not be a number');
        return new Buffer(a, s);
      }, allocBuffer: function(a) {
        if (Buffer.alloc)
          return Buffer.alloc(a);
        var s = new Buffer(a);
        return s.fill(0), s;
      }, isBuffer: function(a) {
        return Buffer.isBuffer(a);
      }, isStream: function(a) {
        return a && typeof a.on == "function" && typeof a.pause == "function" && typeof a.resume == "function";
      } };
    }, {}], 15: [function(n, r, i) {
      function a(C, R, I) {
        var q, F = o.getTypeOf(R), ie = o.extend(I || {}, h);
        ie.date = ie.date || /* @__PURE__ */ new Date(), ie.compression !== null && (ie.compression = ie.compression.toUpperCase()), typeof ie.unixPermissions == "string" && (ie.unixPermissions = parseInt(ie.unixPermissions, 8)), ie.unixPermissions && 16384 & ie.unixPermissions && (ie.dir = !0), ie.dosPermissions && 16 & ie.dosPermissions && (ie.dir = !0), ie.dir && (C = l(C)), ie.createFolders && (q = v(C)) && b.call(this, q, !0);
        var ce = F === "string" && ie.binary === !1 && ie.base64 === !1;
        I && I.binary !== void 0 || (ie.binary = !ce), (R instanceof y && R.uncompressedSize === 0 || ie.dir || !R || R.length === 0) && (ie.base64 = !1, ie.binary = !0, R = "", ie.compression = "STORE", F = "string");
        var S = null;
        S = R instanceof y || R instanceof c ? R : x.isNode && x.isStream(R) ? new d(C, R) : o.prepareContent(C, R, ie.binary, ie.optimizedBinaryString, ie.base64);
        var M = new w(C, S, ie);
        this.files[C] = M;
      }
      var s = n("./utf8"), o = n("./utils"), c = n("./stream/GenericWorker"), u = n("./stream/StreamHelper"), h = n("./defaults"), y = n("./compressedObject"), w = n("./zipObject"), p = n("./generate"), x = n("./nodejsUtils"), d = n("./nodejs/NodejsStreamInputAdapter"), v = function(C) {
        C.slice(-1) === "/" && (C = C.substring(0, C.length - 1));
        var R = C.lastIndexOf("/");
        return 0 < R ? C.substring(0, R) : "";
      }, l = function(C) {
        return C.slice(-1) !== "/" && (C += "/"), C;
      }, b = function(C, R) {
        return R = R !== void 0 ? R : h.createFolders, C = l(C), this.files[C] || a.call(this, C, null, { dir: !0, createFolders: R }), this.files[C];
      };
      function _(C) {
        return Object.prototype.toString.call(C) === "[object RegExp]";
      }
      var E = { load: function() {
        throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
      }, forEach: function(C) {
        var R, I, q;
        for (R in this.files)
          q = this.files[R], (I = R.slice(this.root.length, R.length)) && R.slice(0, this.root.length) === this.root && C(I, q);
      }, filter: function(C) {
        var R = [];
        return this.forEach(function(I, q) {
          C(I, q) && R.push(q);
        }), R;
      }, file: function(C, R, I) {
        if (arguments.length !== 1)
          return C = this.root + C, a.call(this, C, R, I), this;
        if (_(C)) {
          var q = C;
          return this.filter(function(ie, ce) {
            return !ce.dir && q.test(ie);
          });
        }
        var F = this.files[this.root + C];
        return F && !F.dir ? F : null;
      }, folder: function(C) {
        if (!C)
          return this;
        if (_(C))
          return this.filter(function(F, ie) {
            return ie.dir && C.test(F);
          });
        var R = this.root + C, I = b.call(this, R), q = this.clone();
        return q.root = I.name, q;
      }, remove: function(C) {
        C = this.root + C;
        var R = this.files[C];
        if (R || (C.slice(-1) !== "/" && (C += "/"), R = this.files[C]), R && !R.dir)
          delete this.files[C];
        else
          for (var I = this.filter(function(F, ie) {
            return ie.name.slice(0, C.length) === C;
          }), q = 0; q < I.length; q++)
            delete this.files[I[q].name];
        return this;
      }, generate: function() {
        throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
      }, generateInternalStream: function(C) {
        var R, I = {};
        try {
          if ((I = o.extend(C || {}, { streamFiles: !1, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: s.utf8encode })).type = I.type.toLowerCase(), I.compression = I.compression.toUpperCase(), I.type === "binarystring" && (I.type = "string"), !I.type)
            throw new Error("No output type specified.");
          o.checkSupport(I.type), I.platform !== "darwin" && I.platform !== "freebsd" && I.platform !== "linux" && I.platform !== "sunos" || (I.platform = "UNIX"), I.platform === "win32" && (I.platform = "DOS");
          var q = I.comment || this.comment || "";
          R = p.generateWorker(this, I, q);
        } catch (F) {
          (R = new c("error")).error(F);
        }
        return new u(R, I.type || "string", I.mimeType);
      }, generateAsync: function(C, R) {
        return this.generateInternalStream(C).accumulate(R);
      }, generateNodeStream: function(C, R) {
        return (C = C || {}).type || (C.type = "nodebuffer"), this.generateInternalStream(C).toNodejsStream(R);
      } };
      r.exports = E;
    }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(n, r, i) {
      r.exports = n("stream");
    }, { stream: void 0 }], 17: [function(n, r, i) {
      var a = n("./DataReader");
      function s(o) {
        a.call(this, o);
        for (var c = 0; c < this.data.length; c++)
          o[c] = 255 & o[c];
      }
      n("../utils").inherits(s, a), s.prototype.byteAt = function(o) {
        return this.data[this.zero + o];
      }, s.prototype.lastIndexOfSignature = function(o) {
        for (var c = o.charCodeAt(0), u = o.charCodeAt(1), h = o.charCodeAt(2), y = o.charCodeAt(3), w = this.length - 4; 0 <= w; --w)
          if (this.data[w] === c && this.data[w + 1] === u && this.data[w + 2] === h && this.data[w + 3] === y)
            return w - this.zero;
        return -1;
      }, s.prototype.readAndCheckSignature = function(o) {
        var c = o.charCodeAt(0), u = o.charCodeAt(1), h = o.charCodeAt(2), y = o.charCodeAt(3), w = this.readData(4);
        return c === w[0] && u === w[1] && h === w[2] && y === w[3];
      }, s.prototype.readData = function(o) {
        if (this.checkOffset(o), o === 0)
          return [];
        var c = this.data.slice(this.zero + this.index, this.zero + this.index + o);
        return this.index += o, c;
      }, r.exports = s;
    }, { "../utils": 32, "./DataReader": 18 }], 18: [function(n, r, i) {
      var a = n("../utils");
      function s(o) {
        this.data = o, this.length = o.length, this.index = 0, this.zero = 0;
      }
      s.prototype = { checkOffset: function(o) {
        this.checkIndex(this.index + o);
      }, checkIndex: function(o) {
        if (this.length < this.zero + o || o < 0)
          throw new Error("End of data reached (data length = " + this.length + ", asked index = " + o + "). Corrupted zip ?");
      }, setIndex: function(o) {
        this.checkIndex(o), this.index = o;
      }, skip: function(o) {
        this.setIndex(this.index + o);
      }, byteAt: function() {
      }, readInt: function(o) {
        var c, u = 0;
        for (this.checkOffset(o), c = this.index + o - 1; c >= this.index; c--)
          u = (u << 8) + this.byteAt(c);
        return this.index += o, u;
      }, readString: function(o) {
        return a.transformTo("string", this.readData(o));
      }, readData: function() {
      }, lastIndexOfSignature: function() {
      }, readAndCheckSignature: function() {
      }, readDate: function() {
        var o = this.readInt(4);
        return new Date(Date.UTC(1980 + (o >> 25 & 127), (o >> 21 & 15) - 1, o >> 16 & 31, o >> 11 & 31, o >> 5 & 63, (31 & o) << 1));
      } }, r.exports = s;
    }, { "../utils": 32 }], 19: [function(n, r, i) {
      var a = n("./Uint8ArrayReader");
      function s(o) {
        a.call(this, o);
      }
      n("../utils").inherits(s, a), s.prototype.readData = function(o) {
        this.checkOffset(o);
        var c = this.data.slice(this.zero + this.index, this.zero + this.index + o);
        return this.index += o, c;
      }, r.exports = s;
    }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(n, r, i) {
      var a = n("./DataReader");
      function s(o) {
        a.call(this, o);
      }
      n("../utils").inherits(s, a), s.prototype.byteAt = function(o) {
        return this.data.charCodeAt(this.zero + o);
      }, s.prototype.lastIndexOfSignature = function(o) {
        return this.data.lastIndexOf(o) - this.zero;
      }, s.prototype.readAndCheckSignature = function(o) {
        return o === this.readData(4);
      }, s.prototype.readData = function(o) {
        this.checkOffset(o);
        var c = this.data.slice(this.zero + this.index, this.zero + this.index + o);
        return this.index += o, c;
      }, r.exports = s;
    }, { "../utils": 32, "./DataReader": 18 }], 21: [function(n, r, i) {
      var a = n("./ArrayReader");
      function s(o) {
        a.call(this, o);
      }
      n("../utils").inherits(s, a), s.prototype.readData = function(o) {
        if (this.checkOffset(o), o === 0)
          return new Uint8Array(0);
        var c = this.data.subarray(this.zero + this.index, this.zero + this.index + o);
        return this.index += o, c;
      }, r.exports = s;
    }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(n, r, i) {
      var a = n("../utils"), s = n("../support"), o = n("./ArrayReader"), c = n("./StringReader"), u = n("./NodeBufferReader"), h = n("./Uint8ArrayReader");
      r.exports = function(y) {
        var w = a.getTypeOf(y);
        return a.checkSupport(w), w !== "string" || s.uint8array ? w === "nodebuffer" ? new u(y) : s.uint8array ? new h(a.transformTo("uint8array", y)) : new o(a.transformTo("array", y)) : new c(y);
      };
    }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(n, r, i) {
      i.LOCAL_FILE_HEADER = "PK", i.CENTRAL_FILE_HEADER = "PK", i.CENTRAL_DIRECTORY_END = "PK", i.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", i.ZIP64_CENTRAL_DIRECTORY_END = "PK", i.DATA_DESCRIPTOR = "PK\x07\b";
    }, {}], 24: [function(n, r, i) {
      var a = n("./GenericWorker"), s = n("../utils");
      function o(c) {
        a.call(this, "ConvertWorker to " + c), this.destType = c;
      }
      s.inherits(o, a), o.prototype.processChunk = function(c) {
        this.push({ data: s.transformTo(this.destType, c.data), meta: c.meta });
      }, r.exports = o;
    }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(n, r, i) {
      var a = n("./GenericWorker"), s = n("../crc32");
      function o() {
        a.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
      }
      n("../utils").inherits(o, a), o.prototype.processChunk = function(c) {
        this.streamInfo.crc32 = s(c.data, this.streamInfo.crc32 || 0), this.push(c);
      }, r.exports = o;
    }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(n, r, i) {
      var a = n("../utils"), s = n("./GenericWorker");
      function o(c) {
        s.call(this, "DataLengthProbe for " + c), this.propName = c, this.withStreamInfo(c, 0);
      }
      a.inherits(o, s), o.prototype.processChunk = function(c) {
        if (c) {
          var u = this.streamInfo[this.propName] || 0;
          this.streamInfo[this.propName] = u + c.data.length;
        }
        s.prototype.processChunk.call(this, c);
      }, r.exports = o;
    }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(n, r, i) {
      var a = n("../utils"), s = n("./GenericWorker");
      function o(c) {
        s.call(this, "DataWorker");
        var u = this;
        this.dataIsReady = !1, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = !1, c.then(function(h) {
          u.dataIsReady = !0, u.data = h, u.max = h && h.length || 0, u.type = a.getTypeOf(h), u.isPaused || u._tickAndRepeat();
        }, function(h) {
          u.error(h);
        });
      }
      a.inherits(o, s), o.prototype.cleanUp = function() {
        s.prototype.cleanUp.call(this), this.data = null;
      }, o.prototype.resume = function() {
        return !!s.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = !0, a.delay(this._tickAndRepeat, [], this)), !0);
      }, o.prototype._tickAndRepeat = function() {
        this._tickScheduled = !1, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (a.delay(this._tickAndRepeat, [], this), this._tickScheduled = !0));
      }, o.prototype._tick = function() {
        if (this.isPaused || this.isFinished)
          return !1;
        var c = null, u = Math.min(this.max, this.index + 16384);
        if (this.index >= this.max)
          return this.end();
        switch (this.type) {
          case "string":
            c = this.data.substring(this.index, u);
            break;
          case "uint8array":
            c = this.data.subarray(this.index, u);
            break;
          case "array":
          case "nodebuffer":
            c = this.data.slice(this.index, u);
        }
        return this.index = u, this.push({ data: c, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
      }, r.exports = o;
    }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(n, r, i) {
      function a(s) {
        this.name = s || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = !0, this.isFinished = !1, this.isLocked = !1, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
      }
      a.prototype = { push: function(s) {
        this.emit("data", s);
      }, end: function() {
        if (this.isFinished)
          return !1;
        this.flush();
        try {
          this.emit("end"), this.cleanUp(), this.isFinished = !0;
        } catch (s) {
          this.emit("error", s);
        }
        return !0;
      }, error: function(s) {
        return !this.isFinished && (this.isPaused ? this.generatedError = s : (this.isFinished = !0, this.emit("error", s), this.previous && this.previous.error(s), this.cleanUp()), !0);
      }, on: function(s, o) {
        return this._listeners[s].push(o), this;
      }, cleanUp: function() {
        this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
      }, emit: function(s, o) {
        if (this._listeners[s])
          for (var c = 0; c < this._listeners[s].length; c++)
            this._listeners[s][c].call(this, o);
      }, pipe: function(s) {
        return s.registerPrevious(this);
      }, registerPrevious: function(s) {
        if (this.isLocked)
          throw new Error("The stream '" + this + "' has already been used.");
        this.streamInfo = s.streamInfo, this.mergeStreamInfo(), this.previous = s;
        var o = this;
        return s.on("data", function(c) {
          o.processChunk(c);
        }), s.on("end", function() {
          o.end();
        }), s.on("error", function(c) {
          o.error(c);
        }), this;
      }, pause: function() {
        return !this.isPaused && !this.isFinished && (this.isPaused = !0, this.previous && this.previous.pause(), !0);
      }, resume: function() {
        if (!this.isPaused || this.isFinished)
          return !1;
        var s = this.isPaused = !1;
        return this.generatedError && (this.error(this.generatedError), s = !0), this.previous && this.previous.resume(), !s;
      }, flush: function() {
      }, processChunk: function(s) {
        this.push(s);
      }, withStreamInfo: function(s, o) {
        return this.extraStreamInfo[s] = o, this.mergeStreamInfo(), this;
      }, mergeStreamInfo: function() {
        for (var s in this.extraStreamInfo)
          Object.prototype.hasOwnProperty.call(this.extraStreamInfo, s) && (this.streamInfo[s] = this.extraStreamInfo[s]);
      }, lock: function() {
        if (this.isLocked)
          throw new Error("The stream '" + this + "' has already been used.");
        this.isLocked = !0, this.previous && this.previous.lock();
      }, toString: function() {
        var s = "Worker " + this.name;
        return this.previous ? this.previous + " -> " + s : s;
      } }, r.exports = a;
    }, {}], 29: [function(n, r, i) {
      var a = n("../utils"), s = n("./ConvertWorker"), o = n("./GenericWorker"), c = n("../base64"), u = n("../support"), h = n("../external"), y = null;
      if (u.nodestream)
        try {
          y = n("../nodejs/NodejsStreamOutputAdapter");
        } catch {
        }
      function w(x, d) {
        return new h.Promise(function(v, l) {
          var b = [], _ = x._internalType, E = x._outputType, C = x._mimeType;
          x.on("data", function(R, I) {
            b.push(R), d && d(I);
          }).on("error", function(R) {
            b = [], l(R);
          }).on("end", function() {
            try {
              var R = function(I, q, F) {
                switch (I) {
                  case "blob":
                    return a.newBlob(a.transformTo("arraybuffer", q), F);
                  case "base64":
                    return c.encode(q);
                  default:
                    return a.transformTo(I, q);
                }
              }(E, function(I, q) {
                var F, ie = 0, ce = null, S = 0;
                for (F = 0; F < q.length; F++)
                  S += q[F].length;
                switch (I) {
                  case "string":
                    return q.join("");
                  case "array":
                    return Array.prototype.concat.apply([], q);
                  case "uint8array":
                    for (ce = new Uint8Array(S), F = 0; F < q.length; F++)
                      ce.set(q[F], ie), ie += q[F].length;
                    return ce;
                  case "nodebuffer":
                    return Buffer.concat(q);
                  default:
                    throw new Error("concat : unsupported type '" + I + "'");
                }
              }(_, b), C);
              v(R);
            } catch (I) {
              l(I);
            }
            b = [];
          }).resume();
        });
      }
      function p(x, d, v) {
        var l = d;
        switch (d) {
          case "blob":
          case "arraybuffer":
            l = "uint8array";
            break;
          case "base64":
            l = "string";
        }
        try {
          this._internalType = l, this._outputType = d, this._mimeType = v, a.checkSupport(l), this._worker = x.pipe(new s(l)), x.lock();
        } catch (b) {
          this._worker = new o("error"), this._worker.error(b);
        }
      }
      p.prototype = { accumulate: function(x) {
        return w(this, x);
      }, on: function(x, d) {
        var v = this;
        return x === "data" ? this._worker.on(x, function(l) {
          d.call(v, l.data, l.meta);
        }) : this._worker.on(x, function() {
          a.delay(d, arguments, v);
        }), this;
      }, resume: function() {
        return a.delay(this._worker.resume, [], this._worker), this;
      }, pause: function() {
        return this._worker.pause(), this;
      }, toNodejsStream: function(x) {
        if (a.checkSupport("nodestream"), this._outputType !== "nodebuffer")
          throw new Error(this._outputType + " is not supported by this method");
        return new y(this, { objectMode: this._outputType !== "nodebuffer" }, x);
      } }, r.exports = p;
    }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(n, r, i) {
      if (i.base64 = !0, i.array = !0, i.string = !0, i.arraybuffer = typeof ArrayBuffer < "u" && typeof Uint8Array < "u", i.nodebuffer = typeof Buffer < "u", i.uint8array = typeof Uint8Array < "u", typeof ArrayBuffer > "u")
        i.blob = !1;
      else {
        var a = new ArrayBuffer(0);
        try {
          i.blob = new Blob([a], { type: "application/zip" }).size === 0;
        } catch {
          try {
            var s = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
            s.append(a), i.blob = s.getBlob("application/zip").size === 0;
          } catch {
            i.blob = !1;
          }
        }
      }
      try {
        i.nodestream = !!n("readable-stream").Readable;
      } catch {
        i.nodestream = !1;
      }
    }, { "readable-stream": 16 }], 31: [function(n, r, i) {
      for (var a = n("./utils"), s = n("./support"), o = n("./nodejsUtils"), c = n("./stream/GenericWorker"), u = new Array(256), h = 0; h < 256; h++)
        u[h] = 252 <= h ? 6 : 248 <= h ? 5 : 240 <= h ? 4 : 224 <= h ? 3 : 192 <= h ? 2 : 1;
      u[254] = u[254] = 1;
      function y() {
        c.call(this, "utf-8 decode"), this.leftOver = null;
      }
      function w() {
        c.call(this, "utf-8 encode");
      }
      i.utf8encode = function(p) {
        return s.nodebuffer ? o.newBufferFrom(p, "utf-8") : function(x) {
          var d, v, l, b, _, E = x.length, C = 0;
          for (b = 0; b < E; b++)
            (64512 & (v = x.charCodeAt(b))) == 55296 && b + 1 < E && (64512 & (l = x.charCodeAt(b + 1))) == 56320 && (v = 65536 + (v - 55296 << 10) + (l - 56320), b++), C += v < 128 ? 1 : v < 2048 ? 2 : v < 65536 ? 3 : 4;
          for (d = s.uint8array ? new Uint8Array(C) : new Array(C), b = _ = 0; _ < C; b++)
            (64512 & (v = x.charCodeAt(b))) == 55296 && b + 1 < E && (64512 & (l = x.charCodeAt(b + 1))) == 56320 && (v = 65536 + (v - 55296 << 10) + (l - 56320), b++), v < 128 ? d[_++] = v : (v < 2048 ? d[_++] = 192 | v >>> 6 : (v < 65536 ? d[_++] = 224 | v >>> 12 : (d[_++] = 240 | v >>> 18, d[_++] = 128 | v >>> 12 & 63), d[_++] = 128 | v >>> 6 & 63), d[_++] = 128 | 63 & v);
          return d;
        }(p);
      }, i.utf8decode = function(p) {
        return s.nodebuffer ? a.transformTo("nodebuffer", p).toString("utf-8") : function(x) {
          var d, v, l, b, _ = x.length, E = new Array(2 * _);
          for (d = v = 0; d < _; )
            if ((l = x[d++]) < 128)
              E[v++] = l;
            else if (4 < (b = u[l]))
              E[v++] = 65533, d += b - 1;
            else {
              for (l &= b === 2 ? 31 : b === 3 ? 15 : 7; 1 < b && d < _; )
                l = l << 6 | 63 & x[d++], b--;
              1 < b ? E[v++] = 65533 : l < 65536 ? E[v++] = l : (l -= 65536, E[v++] = 55296 | l >> 10 & 1023, E[v++] = 56320 | 1023 & l);
            }
          return E.length !== v && (E.subarray ? E = E.subarray(0, v) : E.length = v), a.applyFromCharCode(E);
        }(p = a.transformTo(s.uint8array ? "uint8array" : "array", p));
      }, a.inherits(y, c), y.prototype.processChunk = function(p) {
        var x = a.transformTo(s.uint8array ? "uint8array" : "array", p.data);
        if (this.leftOver && this.leftOver.length) {
          if (s.uint8array) {
            var d = x;
            (x = new Uint8Array(d.length + this.leftOver.length)).set(this.leftOver, 0), x.set(d, this.leftOver.length);
          } else
            x = this.leftOver.concat(x);
          this.leftOver = null;
        }
        var v = function(b, _) {
          var E;
          for ((_ = _ || b.length) > b.length && (_ = b.length), E = _ - 1; 0 <= E && (192 & b[E]) == 128; )
            E--;
          return E < 0 || E === 0 ? _ : E + u[b[E]] > _ ? E : _;
        }(x), l = x;
        v !== x.length && (s.uint8array ? (l = x.subarray(0, v), this.leftOver = x.subarray(v, x.length)) : (l = x.slice(0, v), this.leftOver = x.slice(v, x.length))), this.push({ data: i.utf8decode(l), meta: p.meta });
      }, y.prototype.flush = function() {
        this.leftOver && this.leftOver.length && (this.push({ data: i.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
      }, i.Utf8DecodeWorker = y, a.inherits(w, c), w.prototype.processChunk = function(p) {
        this.push({ data: i.utf8encode(p.data), meta: p.meta });
      }, i.Utf8EncodeWorker = w;
    }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(n, r, i) {
      var a = n("./support"), s = n("./base64"), o = n("./nodejsUtils"), c = n("./external");
      function u(d) {
        return d;
      }
      function h(d, v) {
        for (var l = 0; l < d.length; ++l)
          v[l] = 255 & d.charCodeAt(l);
        return v;
      }
      n("setimmediate"), i.newBlob = function(d, v) {
        i.checkSupport("blob");
        try {
          return new Blob([d], { type: v });
        } catch {
          try {
            var l = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
            return l.append(d), l.getBlob(v);
          } catch {
            throw new Error("Bug : can't construct the Blob.");
          }
        }
      };
      var y = { stringifyByChunk: function(d, v, l) {
        var b = [], _ = 0, E = d.length;
        if (E <= l)
          return String.fromCharCode.apply(null, d);
        for (; _ < E; )
          v === "array" || v === "nodebuffer" ? b.push(String.fromCharCode.apply(null, d.slice(_, Math.min(_ + l, E)))) : b.push(String.fromCharCode.apply(null, d.subarray(_, Math.min(_ + l, E)))), _ += l;
        return b.join("");
      }, stringifyByChar: function(d) {
        for (var v = "", l = 0; l < d.length; l++)
          v += String.fromCharCode(d[l]);
        return v;
      }, applyCanBeUsed: { uint8array: function() {
        try {
          return a.uint8array && String.fromCharCode.apply(null, new Uint8Array(1)).length === 1;
        } catch {
          return !1;
        }
      }(), nodebuffer: function() {
        try {
          return a.nodebuffer && String.fromCharCode.apply(null, o.allocBuffer(1)).length === 1;
        } catch {
          return !1;
        }
      }() } };
      function w(d) {
        var v = 65536, l = i.getTypeOf(d), b = !0;
        if (l === "uint8array" ? b = y.applyCanBeUsed.uint8array : l === "nodebuffer" && (b = y.applyCanBeUsed.nodebuffer), b)
          for (; 1 < v; )
            try {
              return y.stringifyByChunk(d, l, v);
            } catch {
              v = Math.floor(v / 2);
            }
        return y.stringifyByChar(d);
      }
      function p(d, v) {
        for (var l = 0; l < d.length; l++)
          v[l] = d[l];
        return v;
      }
      i.applyFromCharCode = w;
      var x = {};
      x.string = { string: u, array: function(d) {
        return h(d, new Array(d.length));
      }, arraybuffer: function(d) {
        return x.string.uint8array(d).buffer;
      }, uint8array: function(d) {
        return h(d, new Uint8Array(d.length));
      }, nodebuffer: function(d) {
        return h(d, o.allocBuffer(d.length));
      } }, x.array = { string: w, array: u, arraybuffer: function(d) {
        return new Uint8Array(d).buffer;
      }, uint8array: function(d) {
        return new Uint8Array(d);
      }, nodebuffer: function(d) {
        return o.newBufferFrom(d);
      } }, x.arraybuffer = { string: function(d) {
        return w(new Uint8Array(d));
      }, array: function(d) {
        return p(new Uint8Array(d), new Array(d.byteLength));
      }, arraybuffer: u, uint8array: function(d) {
        return new Uint8Array(d);
      }, nodebuffer: function(d) {
        return o.newBufferFrom(new Uint8Array(d));
      } }, x.uint8array = { string: w, array: function(d) {
        return p(d, new Array(d.length));
      }, arraybuffer: function(d) {
        return d.buffer;
      }, uint8array: u, nodebuffer: function(d) {
        return o.newBufferFrom(d);
      } }, x.nodebuffer = { string: w, array: function(d) {
        return p(d, new Array(d.length));
      }, arraybuffer: function(d) {
        return x.nodebuffer.uint8array(d).buffer;
      }, uint8array: function(d) {
        return p(d, new Uint8Array(d.length));
      }, nodebuffer: u }, i.transformTo = function(d, v) {
        if (v = v || "", !d)
          return v;
        i.checkSupport(d);
        var l = i.getTypeOf(v);
        return x[l][d](v);
      }, i.resolve = function(d) {
        for (var v = d.split("/"), l = [], b = 0; b < v.length; b++) {
          var _ = v[b];
          _ === "." || _ === "" && b !== 0 && b !== v.length - 1 || (_ === ".." ? l.pop() : l.push(_));
        }
        return l.join("/");
      }, i.getTypeOf = function(d) {
        return typeof d == "string" ? "string" : Object.prototype.toString.call(d) === "[object Array]" ? "array" : a.nodebuffer && o.isBuffer(d) ? "nodebuffer" : a.uint8array && d instanceof Uint8Array ? "uint8array" : a.arraybuffer && d instanceof ArrayBuffer ? "arraybuffer" : void 0;
      }, i.checkSupport = function(d) {
        if (!a[d.toLowerCase()])
          throw new Error(d + " is not supported by this platform");
      }, i.MAX_VALUE_16BITS = 65535, i.MAX_VALUE_32BITS = -1, i.pretty = function(d) {
        var v, l, b = "";
        for (l = 0; l < (d || "").length; l++)
          b += "\\x" + ((v = d.charCodeAt(l)) < 16 ? "0" : "") + v.toString(16).toUpperCase();
        return b;
      }, i.delay = function(d, v, l) {
        setImmediate(function() {
          d.apply(l || null, v || []);
        });
      }, i.inherits = function(d, v) {
        function l() {
        }
        l.prototype = v.prototype, d.prototype = new l();
      }, i.extend = function() {
        var d, v, l = {};
        for (d = 0; d < arguments.length; d++)
          for (v in arguments[d])
            Object.prototype.hasOwnProperty.call(arguments[d], v) && l[v] === void 0 && (l[v] = arguments[d][v]);
        return l;
      }, i.prepareContent = function(d, v, l, b, _) {
        return c.Promise.resolve(v).then(function(E) {
          return a.blob && (E instanceof Blob || ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(E)) !== -1) && typeof FileReader < "u" ? new c.Promise(function(C, R) {
            var I = new FileReader();
            I.onload = function(q) {
              C(q.target.result);
            }, I.onerror = function(q) {
              R(q.target.error);
            }, I.readAsArrayBuffer(E);
          }) : E;
        }).then(function(E) {
          var C = i.getTypeOf(E);
          return C ? (C === "arraybuffer" ? E = i.transformTo("uint8array", E) : C === "string" && (_ ? E = s.decode(E) : l && b !== !0 && (E = function(R) {
            return h(R, a.uint8array ? new Uint8Array(R.length) : new Array(R.length));
          }(E))), E) : c.Promise.reject(new Error("Can't read the data of '" + d + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
        });
      };
    }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(n, r, i) {
      var a = n("./reader/readerFor"), s = n("./utils"), o = n("./signature"), c = n("./zipEntry"), u = n("./support");
      function h(y) {
        this.files = [], this.loadOptions = y;
      }
      h.prototype = { checkSignature: function(y) {
        if (!this.reader.readAndCheckSignature(y)) {
          this.reader.index -= 4;
          var w = this.reader.readString(4);
          throw new Error("Corrupted zip or bug: unexpected signature (" + s.pretty(w) + ", expected " + s.pretty(y) + ")");
        }
      }, isSignature: function(y, w) {
        var p = this.reader.index;
        this.reader.setIndex(y);
        var x = this.reader.readString(4) === w;
        return this.reader.setIndex(p), x;
      }, readBlockEndOfCentral: function() {
        this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
        var y = this.reader.readData(this.zipCommentLength), w = u.uint8array ? "uint8array" : "array", p = s.transformTo(w, y);
        this.zipComment = this.loadOptions.decodeFileName(p);
      }, readBlockZip64EndOfCentral: function() {
        this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
        for (var y, w, p, x = this.zip64EndOfCentralSize - 44; 0 < x; )
          y = this.reader.readInt(2), w = this.reader.readInt(4), p = this.reader.readData(w), this.zip64ExtensibleData[y] = { id: y, length: w, value: p };
      }, readBlockZip64EndOfCentralLocator: function() {
        if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount)
          throw new Error("Multi-volumes zip are not supported");
      }, readLocalFiles: function() {
        var y, w;
        for (y = 0; y < this.files.length; y++)
          w = this.files[y], this.reader.setIndex(w.localHeaderOffset), this.checkSignature(o.LOCAL_FILE_HEADER), w.readLocalPart(this.reader), w.handleUTF8(), w.processAttributes();
      }, readCentralDir: function() {
        var y;
        for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(o.CENTRAL_FILE_HEADER); )
          (y = new c({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(y);
        if (this.centralDirRecords !== this.files.length && this.centralDirRecords !== 0 && this.files.length === 0)
          throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
      }, readEndOfCentral: function() {
        var y = this.reader.lastIndexOfSignature(o.CENTRAL_DIRECTORY_END);
        if (y < 0)
          throw this.isSignature(0, o.LOCAL_FILE_HEADER) ? new Error("Corrupted zip: can't find end of central directory") : new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html");
        this.reader.setIndex(y);
        var w = y;
        if (this.checkSignature(o.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === s.MAX_VALUE_16BITS || this.diskWithCentralDirStart === s.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === s.MAX_VALUE_16BITS || this.centralDirRecords === s.MAX_VALUE_16BITS || this.centralDirSize === s.MAX_VALUE_32BITS || this.centralDirOffset === s.MAX_VALUE_32BITS) {
          if (this.zip64 = !0, (y = this.reader.lastIndexOfSignature(o.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0)
            throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
          if (this.reader.setIndex(y), this.checkSignature(o.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, o.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(o.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0))
            throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
          this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(o.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
        }
        var p = this.centralDirOffset + this.centralDirSize;
        this.zip64 && (p += 20, p += 12 + this.zip64EndOfCentralSize);
        var x = w - p;
        if (0 < x)
          this.isSignature(w, o.CENTRAL_FILE_HEADER) || (this.reader.zero = x);
        else if (x < 0)
          throw new Error("Corrupted zip: missing " + Math.abs(x) + " bytes.");
      }, prepareReader: function(y) {
        this.reader = a(y);
      }, load: function(y) {
        this.prepareReader(y), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
      } }, r.exports = h;
    }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(n, r, i) {
      var a = n("./reader/readerFor"), s = n("./utils"), o = n("./compressedObject"), c = n("./crc32"), u = n("./utf8"), h = n("./compressions"), y = n("./support");
      function w(p, x) {
        this.options = p, this.loadOptions = x;
      }
      w.prototype = { isEncrypted: function() {
        return (1 & this.bitFlag) == 1;
      }, useUTF8: function() {
        return (2048 & this.bitFlag) == 2048;
      }, readLocalPart: function(p) {
        var x, d;
        if (p.skip(22), this.fileNameLength = p.readInt(2), d = p.readInt(2), this.fileName = p.readData(this.fileNameLength), p.skip(d), this.compressedSize === -1 || this.uncompressedSize === -1)
          throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
        if ((x = function(v) {
          for (var l in h)
            if (Object.prototype.hasOwnProperty.call(h, l) && h[l].magic === v)
              return h[l];
          return null;
        }(this.compressionMethod)) === null)
          throw new Error("Corrupted zip : compression " + s.pretty(this.compressionMethod) + " unknown (inner file : " + s.transformTo("string", this.fileName) + ")");
        this.decompressed = new o(this.compressedSize, this.uncompressedSize, this.crc32, x, p.readData(this.compressedSize));
      }, readCentralPart: function(p) {
        this.versionMadeBy = p.readInt(2), p.skip(2), this.bitFlag = p.readInt(2), this.compressionMethod = p.readString(2), this.date = p.readDate(), this.crc32 = p.readInt(4), this.compressedSize = p.readInt(4), this.uncompressedSize = p.readInt(4);
        var x = p.readInt(2);
        if (this.extraFieldsLength = p.readInt(2), this.fileCommentLength = p.readInt(2), this.diskNumberStart = p.readInt(2), this.internalFileAttributes = p.readInt(2), this.externalFileAttributes = p.readInt(4), this.localHeaderOffset = p.readInt(4), this.isEncrypted())
          throw new Error("Encrypted zip are not supported");
        p.skip(x), this.readExtraFields(p), this.parseZIP64ExtraField(p), this.fileComment = p.readData(this.fileCommentLength);
      }, processAttributes: function() {
        this.unixPermissions = null, this.dosPermissions = null;
        var p = this.versionMadeBy >> 8;
        this.dir = !!(16 & this.externalFileAttributes), p == 0 && (this.dosPermissions = 63 & this.externalFileAttributes), p == 3 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || this.fileNameStr.slice(-1) !== "/" || (this.dir = !0);
      }, parseZIP64ExtraField: function() {
        if (this.extraFields[1]) {
          var p = a(this.extraFields[1].value);
          this.uncompressedSize === s.MAX_VALUE_32BITS && (this.uncompressedSize = p.readInt(8)), this.compressedSize === s.MAX_VALUE_32BITS && (this.compressedSize = p.readInt(8)), this.localHeaderOffset === s.MAX_VALUE_32BITS && (this.localHeaderOffset = p.readInt(8)), this.diskNumberStart === s.MAX_VALUE_32BITS && (this.diskNumberStart = p.readInt(4));
        }
      }, readExtraFields: function(p) {
        var x, d, v, l = p.index + this.extraFieldsLength;
        for (this.extraFields || (this.extraFields = {}); p.index + 4 < l; )
          x = p.readInt(2), d = p.readInt(2), v = p.readData(d), this.extraFields[x] = { id: x, length: d, value: v };
        p.setIndex(l);
      }, handleUTF8: function() {
        var p = y.uint8array ? "uint8array" : "array";
        if (this.useUTF8())
          this.fileNameStr = u.utf8decode(this.fileName), this.fileCommentStr = u.utf8decode(this.fileComment);
        else {
          var x = this.findExtraFieldUnicodePath();
          if (x !== null)
            this.fileNameStr = x;
          else {
            var d = s.transformTo(p, this.fileName);
            this.fileNameStr = this.loadOptions.decodeFileName(d);
          }
          var v = this.findExtraFieldUnicodeComment();
          if (v !== null)
            this.fileCommentStr = v;
          else {
            var l = s.transformTo(p, this.fileComment);
            this.fileCommentStr = this.loadOptions.decodeFileName(l);
          }
        }
      }, findExtraFieldUnicodePath: function() {
        var p = this.extraFields[28789];
        if (p) {
          var x = a(p.value);
          return x.readInt(1) !== 1 || c(this.fileName) !== x.readInt(4) ? null : u.utf8decode(x.readData(p.length - 5));
        }
        return null;
      }, findExtraFieldUnicodeComment: function() {
        var p = this.extraFields[25461];
        if (p) {
          var x = a(p.value);
          return x.readInt(1) !== 1 || c(this.fileComment) !== x.readInt(4) ? null : u.utf8decode(x.readData(p.length - 5));
        }
        return null;
      } }, r.exports = w;
    }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(n, r, i) {
      function a(x, d, v) {
        this.name = x, this.dir = v.dir, this.date = v.date, this.comment = v.comment, this.unixPermissions = v.unixPermissions, this.dosPermissions = v.dosPermissions, this._data = d, this._dataBinary = v.binary, this.options = { compression: v.compression, compressionOptions: v.compressionOptions };
      }
      var s = n("./stream/StreamHelper"), o = n("./stream/DataWorker"), c = n("./utf8"), u = n("./compressedObject"), h = n("./stream/GenericWorker");
      a.prototype = { internalStream: function(x) {
        var d = null, v = "string";
        try {
          if (!x)
            throw new Error("No output type specified.");
          var l = (v = x.toLowerCase()) === "string" || v === "text";
          v !== "binarystring" && v !== "text" || (v = "string"), d = this._decompressWorker();
          var b = !this._dataBinary;
          b && !l && (d = d.pipe(new c.Utf8EncodeWorker())), !b && l && (d = d.pipe(new c.Utf8DecodeWorker()));
        } catch (_) {
          (d = new h("error")).error(_);
        }
        return new s(d, v, "");
      }, async: function(x, d) {
        return this.internalStream(x).accumulate(d);
      }, nodeStream: function(x, d) {
        return this.internalStream(x || "nodebuffer").toNodejsStream(d);
      }, _compressWorker: function(x, d) {
        if (this._data instanceof u && this._data.compression.magic === x.magic)
          return this._data.getCompressedWorker();
        var v = this._decompressWorker();
        return this._dataBinary || (v = v.pipe(new c.Utf8EncodeWorker())), u.createWorkerFrom(v, x, d);
      }, _decompressWorker: function() {
        return this._data instanceof u ? this._data.getContentWorker() : this._data instanceof h ? this._data : new o(this._data);
      } };
      for (var y = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], w = function() {
        throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
      }, p = 0; p < y.length; p++)
        a.prototype[y[p]] = w;
      r.exports = a;
    }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(n, r, i) {
      (function(a) {
        var s, o, c = a.MutationObserver || a.WebKitMutationObserver;
        if (c) {
          var u = 0, h = new c(x), y = a.document.createTextNode("");
          h.observe(y, { characterData: !0 }), s = function() {
            y.data = u = ++u % 2;
          };
        } else if (a.setImmediate || a.MessageChannel === void 0)
          s = "document" in a && "onreadystatechange" in a.document.createElement("script") ? function() {
            var d = a.document.createElement("script");
            d.onreadystatechange = function() {
              x(), d.onreadystatechange = null, d.parentNode.removeChild(d), d = null;
            }, a.document.documentElement.appendChild(d);
          } : function() {
            setTimeout(x, 0);
          };
        else {
          var w = new a.MessageChannel();
          w.port1.onmessage = x, s = function() {
            w.port2.postMessage(0);
          };
        }
        var p = [];
        function x() {
          var d, v;
          o = !0;
          for (var l = p.length; l; ) {
            for (v = p, p = [], d = -1; ++d < l; )
              v[d]();
            l = p.length;
          }
          o = !1;
        }
        r.exports = function(d) {
          p.push(d) !== 1 || o || s();
        };
      }).call(this, typeof jt < "u" ? jt : typeof self < "u" ? self : typeof window < "u" ? window : {});
    }, {}], 37: [function(n, r, i) {
      var a = n("immediate");
      function s() {
      }
      var o = {}, c = ["REJECTED"], u = ["FULFILLED"], h = ["PENDING"];
      function y(l) {
        if (typeof l != "function")
          throw new TypeError("resolver must be a function");
        this.state = h, this.queue = [], this.outcome = void 0, l !== s && d(this, l);
      }
      function w(l, b, _) {
        this.promise = l, typeof b == "function" && (this.onFulfilled = b, this.callFulfilled = this.otherCallFulfilled), typeof _ == "function" && (this.onRejected = _, this.callRejected = this.otherCallRejected);
      }
      function p(l, b, _) {
        a(function() {
          var E;
          try {
            E = b(_);
          } catch (C) {
            return o.reject(l, C);
          }
          E === l ? o.reject(l, new TypeError("Cannot resolve promise with itself")) : o.resolve(l, E);
        });
      }
      function x(l) {
        var b = l && l.then;
        if (l && (typeof l == "object" || typeof l == "function") && typeof b == "function")
          return function() {
            b.apply(l, arguments);
          };
      }
      function d(l, b) {
        var _ = !1;
        function E(I) {
          _ || (_ = !0, o.reject(l, I));
        }
        function C(I) {
          _ || (_ = !0, o.resolve(l, I));
        }
        var R = v(function() {
          b(C, E);
        });
        R.status === "error" && E(R.value);
      }
      function v(l, b) {
        var _ = {};
        try {
          _.value = l(b), _.status = "success";
        } catch (E) {
          _.status = "error", _.value = E;
        }
        return _;
      }
      (r.exports = y).prototype.finally = function(l) {
        if (typeof l != "function")
          return this;
        var b = this.constructor;
        return this.then(function(_) {
          return b.resolve(l()).then(function() {
            return _;
          });
        }, function(_) {
          return b.resolve(l()).then(function() {
            throw _;
          });
        });
      }, y.prototype.catch = function(l) {
        return this.then(null, l);
      }, y.prototype.then = function(l, b) {
        if (typeof l != "function" && this.state === u || typeof b != "function" && this.state === c)
          return this;
        var _ = new this.constructor(s);
        return this.state !== h ? p(_, this.state === u ? l : b, this.outcome) : this.queue.push(new w(_, l, b)), _;
      }, w.prototype.callFulfilled = function(l) {
        o.resolve(this.promise, l);
      }, w.prototype.otherCallFulfilled = function(l) {
        p(this.promise, this.onFulfilled, l);
      }, w.prototype.callRejected = function(l) {
        o.reject(this.promise, l);
      }, w.prototype.otherCallRejected = function(l) {
        p(this.promise, this.onRejected, l);
      }, o.resolve = function(l, b) {
        var _ = v(x, b);
        if (_.status === "error")
          return o.reject(l, _.value);
        var E = _.value;
        if (E)
          d(l, E);
        else {
          l.state = u, l.outcome = b;
          for (var C = -1, R = l.queue.length; ++C < R; )
            l.queue[C].callFulfilled(b);
        }
        return l;
      }, o.reject = function(l, b) {
        l.state = c, l.outcome = b;
        for (var _ = -1, E = l.queue.length; ++_ < E; )
          l.queue[_].callRejected(b);
        return l;
      }, y.resolve = function(l) {
        return l instanceof this ? l : o.resolve(new this(s), l);
      }, y.reject = function(l) {
        var b = new this(s);
        return o.reject(b, l);
      }, y.all = function(l) {
        var b = this;
        if (Object.prototype.toString.call(l) !== "[object Array]")
          return this.reject(new TypeError("must be an array"));
        var _ = l.length, E = !1;
        if (!_)
          return this.resolve([]);
        for (var C = new Array(_), R = 0, I = -1, q = new this(s); ++I < _; )
          F(l[I], I);
        return q;
        function F(ie, ce) {
          b.resolve(ie).then(function(S) {
            C[ce] = S, ++R !== _ || E || (E = !0, o.resolve(q, C));
          }, function(S) {
            E || (E = !0, o.reject(q, S));
          });
        }
      }, y.race = function(l) {
        var b = this;
        if (Object.prototype.toString.call(l) !== "[object Array]")
          return this.reject(new TypeError("must be an array"));
        var _ = l.length, E = !1;
        if (!_)
          return this.resolve([]);
        for (var C = -1, R = new this(s); ++C < _; )
          I = l[C], b.resolve(I).then(function(q) {
            E || (E = !0, o.resolve(R, q));
          }, function(q) {
            E || (E = !0, o.reject(R, q));
          });
        var I;
        return R;
      };
    }, { immediate: 36 }], 38: [function(n, r, i) {
      var a = {};
      (0, n("./lib/utils/common").assign)(a, n("./lib/deflate"), n("./lib/inflate"), n("./lib/zlib/constants")), r.exports = a;
    }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(n, r, i) {
      var a = n("./zlib/deflate"), s = n("./utils/common"), o = n("./utils/strings"), c = n("./zlib/messages"), u = n("./zlib/zstream"), h = Object.prototype.toString, y = 0, w = -1, p = 0, x = 8;
      function d(l) {
        if (!(this instanceof d))
          return new d(l);
        this.options = s.assign({ level: w, method: x, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: p, to: "" }, l || {});
        var b = this.options;
        b.raw && 0 < b.windowBits ? b.windowBits = -b.windowBits : b.gzip && 0 < b.windowBits && b.windowBits < 16 && (b.windowBits += 16), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new u(), this.strm.avail_out = 0;
        var _ = a.deflateInit2(this.strm, b.level, b.method, b.windowBits, b.memLevel, b.strategy);
        if (_ !== y)
          throw new Error(c[_]);
        if (b.header && a.deflateSetHeader(this.strm, b.header), b.dictionary) {
          var E;
          if (E = typeof b.dictionary == "string" ? o.string2buf(b.dictionary) : h.call(b.dictionary) === "[object ArrayBuffer]" ? new Uint8Array(b.dictionary) : b.dictionary, (_ = a.deflateSetDictionary(this.strm, E)) !== y)
            throw new Error(c[_]);
          this._dict_set = !0;
        }
      }
      function v(l, b) {
        var _ = new d(b);
        if (_.push(l, !0), _.err)
          throw _.msg || c[_.err];
        return _.result;
      }
      d.prototype.push = function(l, b) {
        var _, E, C = this.strm, R = this.options.chunkSize;
        if (this.ended)
          return !1;
        E = b === ~~b ? b : b === !0 ? 4 : 0, typeof l == "string" ? C.input = o.string2buf(l) : h.call(l) === "[object ArrayBuffer]" ? C.input = new Uint8Array(l) : C.input = l, C.next_in = 0, C.avail_in = C.input.length;
        do {
          if (C.avail_out === 0 && (C.output = new s.Buf8(R), C.next_out = 0, C.avail_out = R), (_ = a.deflate(C, E)) !== 1 && _ !== y)
            return this.onEnd(_), !(this.ended = !0);
          C.avail_out !== 0 && (C.avail_in !== 0 || E !== 4 && E !== 2) || (this.options.to === "string" ? this.onData(o.buf2binstring(s.shrinkBuf(C.output, C.next_out))) : this.onData(s.shrinkBuf(C.output, C.next_out)));
        } while ((0 < C.avail_in || C.avail_out === 0) && _ !== 1);
        return E === 4 ? (_ = a.deflateEnd(this.strm), this.onEnd(_), this.ended = !0, _ === y) : E !== 2 || (this.onEnd(y), !(C.avail_out = 0));
      }, d.prototype.onData = function(l) {
        this.chunks.push(l);
      }, d.prototype.onEnd = function(l) {
        l === y && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = s.flattenChunks(this.chunks)), this.chunks = [], this.err = l, this.msg = this.strm.msg;
      }, i.Deflate = d, i.deflate = v, i.deflateRaw = function(l, b) {
        return (b = b || {}).raw = !0, v(l, b);
      }, i.gzip = function(l, b) {
        return (b = b || {}).gzip = !0, v(l, b);
      };
    }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(n, r, i) {
      var a = n("./zlib/inflate"), s = n("./utils/common"), o = n("./utils/strings"), c = n("./zlib/constants"), u = n("./zlib/messages"), h = n("./zlib/zstream"), y = n("./zlib/gzheader"), w = Object.prototype.toString;
      function p(d) {
        if (!(this instanceof p))
          return new p(d);
        this.options = s.assign({ chunkSize: 16384, windowBits: 0, to: "" }, d || {});
        var v = this.options;
        v.raw && 0 <= v.windowBits && v.windowBits < 16 && (v.windowBits = -v.windowBits, v.windowBits === 0 && (v.windowBits = -15)), !(0 <= v.windowBits && v.windowBits < 16) || d && d.windowBits || (v.windowBits += 32), 15 < v.windowBits && v.windowBits < 48 && !(15 & v.windowBits) && (v.windowBits |= 15), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new h(), this.strm.avail_out = 0;
        var l = a.inflateInit2(this.strm, v.windowBits);
        if (l !== c.Z_OK)
          throw new Error(u[l]);
        this.header = new y(), a.inflateGetHeader(this.strm, this.header);
      }
      function x(d, v) {
        var l = new p(v);
        if (l.push(d, !0), l.err)
          throw l.msg || u[l.err];
        return l.result;
      }
      p.prototype.push = function(d, v) {
        var l, b, _, E, C, R, I = this.strm, q = this.options.chunkSize, F = this.options.dictionary, ie = !1;
        if (this.ended)
          return !1;
        b = v === ~~v ? v : v === !0 ? c.Z_FINISH : c.Z_NO_FLUSH, typeof d == "string" ? I.input = o.binstring2buf(d) : w.call(d) === "[object ArrayBuffer]" ? I.input = new Uint8Array(d) : I.input = d, I.next_in = 0, I.avail_in = I.input.length;
        do {
          if (I.avail_out === 0 && (I.output = new s.Buf8(q), I.next_out = 0, I.avail_out = q), (l = a.inflate(I, c.Z_NO_FLUSH)) === c.Z_NEED_DICT && F && (R = typeof F == "string" ? o.string2buf(F) : w.call(F) === "[object ArrayBuffer]" ? new Uint8Array(F) : F, l = a.inflateSetDictionary(this.strm, R)), l === c.Z_BUF_ERROR && ie === !0 && (l = c.Z_OK, ie = !1), l !== c.Z_STREAM_END && l !== c.Z_OK)
            return this.onEnd(l), !(this.ended = !0);
          I.next_out && (I.avail_out !== 0 && l !== c.Z_STREAM_END && (I.avail_in !== 0 || b !== c.Z_FINISH && b !== c.Z_SYNC_FLUSH) || (this.options.to === "string" ? (_ = o.utf8border(I.output, I.next_out), E = I.next_out - _, C = o.buf2string(I.output, _), I.next_out = E, I.avail_out = q - E, E && s.arraySet(I.output, I.output, _, E, 0), this.onData(C)) : this.onData(s.shrinkBuf(I.output, I.next_out)))), I.avail_in === 0 && I.avail_out === 0 && (ie = !0);
        } while ((0 < I.avail_in || I.avail_out === 0) && l !== c.Z_STREAM_END);
        return l === c.Z_STREAM_END && (b = c.Z_FINISH), b === c.Z_FINISH ? (l = a.inflateEnd(this.strm), this.onEnd(l), this.ended = !0, l === c.Z_OK) : b !== c.Z_SYNC_FLUSH || (this.onEnd(c.Z_OK), !(I.avail_out = 0));
      }, p.prototype.onData = function(d) {
        this.chunks.push(d);
      }, p.prototype.onEnd = function(d) {
        d === c.Z_OK && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = s.flattenChunks(this.chunks)), this.chunks = [], this.err = d, this.msg = this.strm.msg;
      }, i.Inflate = p, i.inflate = x, i.inflateRaw = function(d, v) {
        return (v = v || {}).raw = !0, x(d, v);
      }, i.ungzip = x;
    }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(n, r, i) {
      var a = typeof Uint8Array < "u" && typeof Uint16Array < "u" && typeof Int32Array < "u";
      i.assign = function(c) {
        for (var u = Array.prototype.slice.call(arguments, 1); u.length; ) {
          var h = u.shift();
          if (h) {
            if (typeof h != "object")
              throw new TypeError(h + "must be non-object");
            for (var y in h)
              h.hasOwnProperty(y) && (c[y] = h[y]);
          }
        }
        return c;
      }, i.shrinkBuf = function(c, u) {
        return c.length === u ? c : c.subarray ? c.subarray(0, u) : (c.length = u, c);
      };
      var s = { arraySet: function(c, u, h, y, w) {
        if (u.subarray && c.subarray)
          c.set(u.subarray(h, h + y), w);
        else
          for (var p = 0; p < y; p++)
            c[w + p] = u[h + p];
      }, flattenChunks: function(c) {
        var u, h, y, w, p, x;
        for (u = y = 0, h = c.length; u < h; u++)
          y += c[u].length;
        for (x = new Uint8Array(y), u = w = 0, h = c.length; u < h; u++)
          p = c[u], x.set(p, w), w += p.length;
        return x;
      } }, o = { arraySet: function(c, u, h, y, w) {
        for (var p = 0; p < y; p++)
          c[w + p] = u[h + p];
      }, flattenChunks: function(c) {
        return [].concat.apply([], c);
      } };
      i.setTyped = function(c) {
        c ? (i.Buf8 = Uint8Array, i.Buf16 = Uint16Array, i.Buf32 = Int32Array, i.assign(i, s)) : (i.Buf8 = Array, i.Buf16 = Array, i.Buf32 = Array, i.assign(i, o));
      }, i.setTyped(a);
    }, {}], 42: [function(n, r, i) {
      var a = n("./common"), s = !0, o = !0;
      try {
        String.fromCharCode.apply(null, [0]);
      } catch {
        s = !1;
      }
      try {
        String.fromCharCode.apply(null, new Uint8Array(1));
      } catch {
        o = !1;
      }
      for (var c = new a.Buf8(256), u = 0; u < 256; u++)
        c[u] = 252 <= u ? 6 : 248 <= u ? 5 : 240 <= u ? 4 : 224 <= u ? 3 : 192 <= u ? 2 : 1;
      function h(y, w) {
        if (w < 65537 && (y.subarray && o || !y.subarray && s))
          return String.fromCharCode.apply(null, a.shrinkBuf(y, w));
        for (var p = "", x = 0; x < w; x++)
          p += String.fromCharCode(y[x]);
        return p;
      }
      c[254] = c[254] = 1, i.string2buf = function(y) {
        var w, p, x, d, v, l = y.length, b = 0;
        for (d = 0; d < l; d++)
          (64512 & (p = y.charCodeAt(d))) == 55296 && d + 1 < l && (64512 & (x = y.charCodeAt(d + 1))) == 56320 && (p = 65536 + (p - 55296 << 10) + (x - 56320), d++), b += p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4;
        for (w = new a.Buf8(b), d = v = 0; v < b; d++)
          (64512 & (p = y.charCodeAt(d))) == 55296 && d + 1 < l && (64512 & (x = y.charCodeAt(d + 1))) == 56320 && (p = 65536 + (p - 55296 << 10) + (x - 56320), d++), p < 128 ? w[v++] = p : (p < 2048 ? w[v++] = 192 | p >>> 6 : (p < 65536 ? w[v++] = 224 | p >>> 12 : (w[v++] = 240 | p >>> 18, w[v++] = 128 | p >>> 12 & 63), w[v++] = 128 | p >>> 6 & 63), w[v++] = 128 | 63 & p);
        return w;
      }, i.buf2binstring = function(y) {
        return h(y, y.length);
      }, i.binstring2buf = function(y) {
        for (var w = new a.Buf8(y.length), p = 0, x = w.length; p < x; p++)
          w[p] = y.charCodeAt(p);
        return w;
      }, i.buf2string = function(y, w) {
        var p, x, d, v, l = w || y.length, b = new Array(2 * l);
        for (p = x = 0; p < l; )
          if ((d = y[p++]) < 128)
            b[x++] = d;
          else if (4 < (v = c[d]))
            b[x++] = 65533, p += v - 1;
          else {
            for (d &= v === 2 ? 31 : v === 3 ? 15 : 7; 1 < v && p < l; )
              d = d << 6 | 63 & y[p++], v--;
            1 < v ? b[x++] = 65533 : d < 65536 ? b[x++] = d : (d -= 65536, b[x++] = 55296 | d >> 10 & 1023, b[x++] = 56320 | 1023 & d);
          }
        return h(b, x);
      }, i.utf8border = function(y, w) {
        var p;
        for ((w = w || y.length) > y.length && (w = y.length), p = w - 1; 0 <= p && (192 & y[p]) == 128; )
          p--;
        return p < 0 || p === 0 ? w : p + c[y[p]] > w ? p : w;
      };
    }, { "./common": 41 }], 43: [function(n, r, i) {
      r.exports = function(a, s, o, c) {
        for (var u = 65535 & a | 0, h = a >>> 16 & 65535 | 0, y = 0; o !== 0; ) {
          for (o -= y = 2e3 < o ? 2e3 : o; h = h + (u = u + s[c++] | 0) | 0, --y; )
            ;
          u %= 65521, h %= 65521;
        }
        return u | h << 16 | 0;
      };
    }, {}], 44: [function(n, r, i) {
      r.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
    }, {}], 45: [function(n, r, i) {
      var a = function() {
        for (var s, o = [], c = 0; c < 256; c++) {
          s = c;
          for (var u = 0; u < 8; u++)
            s = 1 & s ? 3988292384 ^ s >>> 1 : s >>> 1;
          o[c] = s;
        }
        return o;
      }();
      r.exports = function(s, o, c, u) {
        var h = a, y = u + c;
        s ^= -1;
        for (var w = u; w < y; w++)
          s = s >>> 8 ^ h[255 & (s ^ o[w])];
        return -1 ^ s;
      };
    }, {}], 46: [function(n, r, i) {
      var a, s = n("../utils/common"), o = n("./trees"), c = n("./adler32"), u = n("./crc32"), h = n("./messages"), y = 0, w = 4, p = 0, x = -2, d = -1, v = 4, l = 2, b = 8, _ = 9, E = 286, C = 30, R = 19, I = 2 * E + 1, q = 15, F = 3, ie = 258, ce = ie + F + 1, S = 42, M = 113, D = 1, X = 2, H = 3, P = 4;
      function Z(m, $) {
        return m.msg = h[$], $;
      }
      function z(m) {
        return (m << 1) - (4 < m ? 9 : 0);
      }
      function ae(m) {
        for (var $ = m.length; 0 <= --$; )
          m[$] = 0;
      }
      function O(m) {
        var $ = m.state, U = $.pending;
        U > m.avail_out && (U = m.avail_out), U !== 0 && (s.arraySet(m.output, $.pending_buf, $.pending_out, U, m.next_out), m.next_out += U, $.pending_out += U, m.total_out += U, m.avail_out -= U, $.pending -= U, $.pending === 0 && ($.pending_out = 0));
      }
      function A(m, $) {
        o._tr_flush_block(m, 0 <= m.block_start ? m.block_start : -1, m.strstart - m.block_start, $), m.block_start = m.strstart, O(m.strm);
      }
      function G(m, $) {
        m.pending_buf[m.pending++] = $;
      }
      function J(m, $) {
        m.pending_buf[m.pending++] = $ >>> 8 & 255, m.pending_buf[m.pending++] = 255 & $;
      }
      function re(m, $) {
        var U, f, g = m.max_chain_length, T = m.strstart, L = m.prev_length, K = m.nice_match, W = m.strstart > m.w_size - ce ? m.strstart - (m.w_size - ce) : 0, j = m.window, Y = m.w_mask, ee = m.prev, se = m.strstart + ie, he = j[T + L - 1], fe = j[T + L];
        m.prev_length >= m.good_match && (g >>= 2), K > m.lookahead && (K = m.lookahead);
        do
          if (j[(U = $) + L] === fe && j[U + L - 1] === he && j[U] === j[T] && j[++U] === j[T + 1]) {
            T += 2, U++;
            do
              ;
            while (j[++T] === j[++U] && j[++T] === j[++U] && j[++T] === j[++U] && j[++T] === j[++U] && j[++T] === j[++U] && j[++T] === j[++U] && j[++T] === j[++U] && j[++T] === j[++U] && T < se);
            if (f = ie - (se - T), T = se - ie, L < f) {
              if (m.match_start = $, K <= (L = f))
                break;
              he = j[T + L - 1], fe = j[T + L];
            }
          }
        while (($ = ee[$ & Y]) > W && --g != 0);
        return L <= m.lookahead ? L : m.lookahead;
      }
      function Q(m) {
        var $, U, f, g, T, L, K, W, j, Y, ee = m.w_size;
        do {
          if (g = m.window_size - m.lookahead - m.strstart, m.strstart >= ee + (ee - ce)) {
            for (s.arraySet(m.window, m.window, ee, ee, 0), m.match_start -= ee, m.strstart -= ee, m.block_start -= ee, $ = U = m.hash_size; f = m.head[--$], m.head[$] = ee <= f ? f - ee : 0, --U; )
              ;
            for ($ = U = ee; f = m.prev[--$], m.prev[$] = ee <= f ? f - ee : 0, --U; )
              ;
            g += ee;
          }
          if (m.strm.avail_in === 0)
            break;
          if (L = m.strm, K = m.window, W = m.strstart + m.lookahead, j = g, Y = void 0, Y = L.avail_in, j < Y && (Y = j), U = Y === 0 ? 0 : (L.avail_in -= Y, s.arraySet(K, L.input, L.next_in, Y, W), L.state.wrap === 1 ? L.adler = c(L.adler, K, Y, W) : L.state.wrap === 2 && (L.adler = u(L.adler, K, Y, W)), L.next_in += Y, L.total_in += Y, Y), m.lookahead += U, m.lookahead + m.insert >= F)
            for (T = m.strstart - m.insert, m.ins_h = m.window[T], m.ins_h = (m.ins_h << m.hash_shift ^ m.window[T + 1]) & m.hash_mask; m.insert && (m.ins_h = (m.ins_h << m.hash_shift ^ m.window[T + F - 1]) & m.hash_mask, m.prev[T & m.w_mask] = m.head[m.ins_h], m.head[m.ins_h] = T, T++, m.insert--, !(m.lookahead + m.insert < F)); )
              ;
        } while (m.lookahead < ce && m.strm.avail_in !== 0);
      }
      function B(m, $) {
        for (var U, f; ; ) {
          if (m.lookahead < ce) {
            if (Q(m), m.lookahead < ce && $ === y)
              return D;
            if (m.lookahead === 0)
              break;
          }
          if (U = 0, m.lookahead >= F && (m.ins_h = (m.ins_h << m.hash_shift ^ m.window[m.strstart + F - 1]) & m.hash_mask, U = m.prev[m.strstart & m.w_mask] = m.head[m.ins_h], m.head[m.ins_h] = m.strstart), U !== 0 && m.strstart - U <= m.w_size - ce && (m.match_length = re(m, U)), m.match_length >= F)
            if (f = o._tr_tally(m, m.strstart - m.match_start, m.match_length - F), m.lookahead -= m.match_length, m.match_length <= m.max_lazy_match && m.lookahead >= F) {
              for (m.match_length--; m.strstart++, m.ins_h = (m.ins_h << m.hash_shift ^ m.window[m.strstart + F - 1]) & m.hash_mask, U = m.prev[m.strstart & m.w_mask] = m.head[m.ins_h], m.head[m.ins_h] = m.strstart, --m.match_length != 0; )
                ;
              m.strstart++;
            } else
              m.strstart += m.match_length, m.match_length = 0, m.ins_h = m.window[m.strstart], m.ins_h = (m.ins_h << m.hash_shift ^ m.window[m.strstart + 1]) & m.hash_mask;
          else
            f = o._tr_tally(m, 0, m.window[m.strstart]), m.lookahead--, m.strstart++;
          if (f && (A(m, !1), m.strm.avail_out === 0))
            return D;
        }
        return m.insert = m.strstart < F - 1 ? m.strstart : F - 1, $ === w ? (A(m, !0), m.strm.avail_out === 0 ? H : P) : m.last_lit && (A(m, !1), m.strm.avail_out === 0) ? D : X;
      }
      function k(m, $) {
        for (var U, f, g; ; ) {
          if (m.lookahead < ce) {
            if (Q(m), m.lookahead < ce && $ === y)
              return D;
            if (m.lookahead === 0)
              break;
          }
          if (U = 0, m.lookahead >= F && (m.ins_h = (m.ins_h << m.hash_shift ^ m.window[m.strstart + F - 1]) & m.hash_mask, U = m.prev[m.strstart & m.w_mask] = m.head[m.ins_h], m.head[m.ins_h] = m.strstart), m.prev_length = m.match_length, m.prev_match = m.match_start, m.match_length = F - 1, U !== 0 && m.prev_length < m.max_lazy_match && m.strstart - U <= m.w_size - ce && (m.match_length = re(m, U), m.match_length <= 5 && (m.strategy === 1 || m.match_length === F && 4096 < m.strstart - m.match_start) && (m.match_length = F - 1)), m.prev_length >= F && m.match_length <= m.prev_length) {
            for (g = m.strstart + m.lookahead - F, f = o._tr_tally(m, m.strstart - 1 - m.prev_match, m.prev_length - F), m.lookahead -= m.prev_length - 1, m.prev_length -= 2; ++m.strstart <= g && (m.ins_h = (m.ins_h << m.hash_shift ^ m.window[m.strstart + F - 1]) & m.hash_mask, U = m.prev[m.strstart & m.w_mask] = m.head[m.ins_h], m.head[m.ins_h] = m.strstart), --m.prev_length != 0; )
              ;
            if (m.match_available = 0, m.match_length = F - 1, m.strstart++, f && (A(m, !1), m.strm.avail_out === 0))
              return D;
          } else if (m.match_available) {
            if ((f = o._tr_tally(m, 0, m.window[m.strstart - 1])) && A(m, !1), m.strstart++, m.lookahead--, m.strm.avail_out === 0)
              return D;
          } else
            m.match_available = 1, m.strstart++, m.lookahead--;
        }
        return m.match_available && (f = o._tr_tally(m, 0, m.window[m.strstart - 1]), m.match_available = 0), m.insert = m.strstart < F - 1 ? m.strstart : F - 1, $ === w ? (A(m, !0), m.strm.avail_out === 0 ? H : P) : m.last_lit && (A(m, !1), m.strm.avail_out === 0) ? D : X;
      }
      function ne(m, $, U, f, g) {
        this.good_length = m, this.max_lazy = $, this.nice_length = U, this.max_chain = f, this.func = g;
      }
      function te() {
        this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = b, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new s.Buf16(2 * I), this.dyn_dtree = new s.Buf16(2 * (2 * C + 1)), this.bl_tree = new s.Buf16(2 * (2 * R + 1)), ae(this.dyn_ltree), ae(this.dyn_dtree), ae(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new s.Buf16(q + 1), this.heap = new s.Buf16(2 * E + 1), ae(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new s.Buf16(2 * E + 1), ae(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
      }
      function V(m) {
        var $;
        return m && m.state ? (m.total_in = m.total_out = 0, m.data_type = l, ($ = m.state).pending = 0, $.pending_out = 0, $.wrap < 0 && ($.wrap = -$.wrap), $.status = $.wrap ? S : M, m.adler = $.wrap === 2 ? 0 : 1, $.last_flush = y, o._tr_init($), p) : Z(m, x);
      }
      function N(m) {
        var $ = V(m);
        return $ === p && function(U) {
          U.window_size = 2 * U.w_size, ae(U.head), U.max_lazy_match = a[U.level].max_lazy, U.good_match = a[U.level].good_length, U.nice_match = a[U.level].nice_length, U.max_chain_length = a[U.level].max_chain, U.strstart = 0, U.block_start = 0, U.lookahead = 0, U.insert = 0, U.match_length = U.prev_length = F - 1, U.match_available = 0, U.ins_h = 0;
        }(m.state), $;
      }
      function oe(m, $, U, f, g, T) {
        if (!m)
          return x;
        var L = 1;
        if ($ === d && ($ = 6), f < 0 ? (L = 0, f = -f) : 15 < f && (L = 2, f -= 16), g < 1 || _ < g || U !== b || f < 8 || 15 < f || $ < 0 || 9 < $ || T < 0 || v < T)
          return Z(m, x);
        f === 8 && (f = 9);
        var K = new te();
        return (m.state = K).strm = m, K.wrap = L, K.gzhead = null, K.w_bits = f, K.w_size = 1 << K.w_bits, K.w_mask = K.w_size - 1, K.hash_bits = g + 7, K.hash_size = 1 << K.hash_bits, K.hash_mask = K.hash_size - 1, K.hash_shift = ~~((K.hash_bits + F - 1) / F), K.window = new s.Buf8(2 * K.w_size), K.head = new s.Buf16(K.hash_size), K.prev = new s.Buf16(K.w_size), K.lit_bufsize = 1 << g + 6, K.pending_buf_size = 4 * K.lit_bufsize, K.pending_buf = new s.Buf8(K.pending_buf_size), K.d_buf = 1 * K.lit_bufsize, K.l_buf = 3 * K.lit_bufsize, K.level = $, K.strategy = T, K.method = U, N(m);
      }
      a = [new ne(0, 0, 0, 0, function(m, $) {
        var U = 65535;
        for (U > m.pending_buf_size - 5 && (U = m.pending_buf_size - 5); ; ) {
          if (m.lookahead <= 1) {
            if (Q(m), m.lookahead === 0 && $ === y)
              return D;
            if (m.lookahead === 0)
              break;
          }
          m.strstart += m.lookahead, m.lookahead = 0;
          var f = m.block_start + U;
          if ((m.strstart === 0 || m.strstart >= f) && (m.lookahead = m.strstart - f, m.strstart = f, A(m, !1), m.strm.avail_out === 0) || m.strstart - m.block_start >= m.w_size - ce && (A(m, !1), m.strm.avail_out === 0))
            return D;
        }
        return m.insert = 0, $ === w ? (A(m, !0), m.strm.avail_out === 0 ? H : P) : (m.strstart > m.block_start && (A(m, !1), m.strm.avail_out), D);
      }), new ne(4, 4, 8, 4, B), new ne(4, 5, 16, 8, B), new ne(4, 6, 32, 32, B), new ne(4, 4, 16, 16, k), new ne(8, 16, 32, 32, k), new ne(8, 16, 128, 128, k), new ne(8, 32, 128, 256, k), new ne(32, 128, 258, 1024, k), new ne(32, 258, 258, 4096, k)], i.deflateInit = function(m, $) {
        return oe(m, $, b, 15, 8, 0);
      }, i.deflateInit2 = oe, i.deflateReset = N, i.deflateResetKeep = V, i.deflateSetHeader = function(m, $) {
        return m && m.state ? m.state.wrap !== 2 ? x : (m.state.gzhead = $, p) : x;
      }, i.deflate = function(m, $) {
        var U, f, g, T;
        if (!m || !m.state || 5 < $ || $ < 0)
          return m ? Z(m, x) : x;
        if (f = m.state, !m.output || !m.input && m.avail_in !== 0 || f.status === 666 && $ !== w)
          return Z(m, m.avail_out === 0 ? -5 : x);
        if (f.strm = m, U = f.last_flush, f.last_flush = $, f.status === S)
          if (f.wrap === 2)
            m.adler = 0, G(f, 31), G(f, 139), G(f, 8), f.gzhead ? (G(f, (f.gzhead.text ? 1 : 0) + (f.gzhead.hcrc ? 2 : 0) + (f.gzhead.extra ? 4 : 0) + (f.gzhead.name ? 8 : 0) + (f.gzhead.comment ? 16 : 0)), G(f, 255 & f.gzhead.time), G(f, f.gzhead.time >> 8 & 255), G(f, f.gzhead.time >> 16 & 255), G(f, f.gzhead.time >> 24 & 255), G(f, f.level === 9 ? 2 : 2 <= f.strategy || f.level < 2 ? 4 : 0), G(f, 255 & f.gzhead.os), f.gzhead.extra && f.gzhead.extra.length && (G(f, 255 & f.gzhead.extra.length), G(f, f.gzhead.extra.length >> 8 & 255)), f.gzhead.hcrc && (m.adler = u(m.adler, f.pending_buf, f.pending, 0)), f.gzindex = 0, f.status = 69) : (G(f, 0), G(f, 0), G(f, 0), G(f, 0), G(f, 0), G(f, f.level === 9 ? 2 : 2 <= f.strategy || f.level < 2 ? 4 : 0), G(f, 3), f.status = M);
          else {
            var L = b + (f.w_bits - 8 << 4) << 8;
            L |= (2 <= f.strategy || f.level < 2 ? 0 : f.level < 6 ? 1 : f.level === 6 ? 2 : 3) << 6, f.strstart !== 0 && (L |= 32), L += 31 - L % 31, f.status = M, J(f, L), f.strstart !== 0 && (J(f, m.adler >>> 16), J(f, 65535 & m.adler)), m.adler = 1;
          }
        if (f.status === 69)
          if (f.gzhead.extra) {
            for (g = f.pending; f.gzindex < (65535 & f.gzhead.extra.length) && (f.pending !== f.pending_buf_size || (f.gzhead.hcrc && f.pending > g && (m.adler = u(m.adler, f.pending_buf, f.pending - g, g)), O(m), g = f.pending, f.pending !== f.pending_buf_size)); )
              G(f, 255 & f.gzhead.extra[f.gzindex]), f.gzindex++;
            f.gzhead.hcrc && f.pending > g && (m.adler = u(m.adler, f.pending_buf, f.pending - g, g)), f.gzindex === f.gzhead.extra.length && (f.gzindex = 0, f.status = 73);
          } else
            f.status = 73;
        if (f.status === 73)
          if (f.gzhead.name) {
            g = f.pending;
            do {
              if (f.pending === f.pending_buf_size && (f.gzhead.hcrc && f.pending > g && (m.adler = u(m.adler, f.pending_buf, f.pending - g, g)), O(m), g = f.pending, f.pending === f.pending_buf_size)) {
                T = 1;
                break;
              }
              T = f.gzindex < f.gzhead.name.length ? 255 & f.gzhead.name.charCodeAt(f.gzindex++) : 0, G(f, T);
            } while (T !== 0);
            f.gzhead.hcrc && f.pending > g && (m.adler = u(m.adler, f.pending_buf, f.pending - g, g)), T === 0 && (f.gzindex = 0, f.status = 91);
          } else
            f.status = 91;
        if (f.status === 91)
          if (f.gzhead.comment) {
            g = f.pending;
            do {
              if (f.pending === f.pending_buf_size && (f.gzhead.hcrc && f.pending > g && (m.adler = u(m.adler, f.pending_buf, f.pending - g, g)), O(m), g = f.pending, f.pending === f.pending_buf_size)) {
                T = 1;
                break;
              }
              T = f.gzindex < f.gzhead.comment.length ? 255 & f.gzhead.comment.charCodeAt(f.gzindex++) : 0, G(f, T);
            } while (T !== 0);
            f.gzhead.hcrc && f.pending > g && (m.adler = u(m.adler, f.pending_buf, f.pending - g, g)), T === 0 && (f.status = 103);
          } else
            f.status = 103;
        if (f.status === 103 && (f.gzhead.hcrc ? (f.pending + 2 > f.pending_buf_size && O(m), f.pending + 2 <= f.pending_buf_size && (G(f, 255 & m.adler), G(f, m.adler >> 8 & 255), m.adler = 0, f.status = M)) : f.status = M), f.pending !== 0) {
          if (O(m), m.avail_out === 0)
            return f.last_flush = -1, p;
        } else if (m.avail_in === 0 && z($) <= z(U) && $ !== w)
          return Z(m, -5);
        if (f.status === 666 && m.avail_in !== 0)
          return Z(m, -5);
        if (m.avail_in !== 0 || f.lookahead !== 0 || $ !== y && f.status !== 666) {
          var K = f.strategy === 2 ? function(W, j) {
            for (var Y; ; ) {
              if (W.lookahead === 0 && (Q(W), W.lookahead === 0)) {
                if (j === y)
                  return D;
                break;
              }
              if (W.match_length = 0, Y = o._tr_tally(W, 0, W.window[W.strstart]), W.lookahead--, W.strstart++, Y && (A(W, !1), W.strm.avail_out === 0))
                return D;
            }
            return W.insert = 0, j === w ? (A(W, !0), W.strm.avail_out === 0 ? H : P) : W.last_lit && (A(W, !1), W.strm.avail_out === 0) ? D : X;
          }(f, $) : f.strategy === 3 ? function(W, j) {
            for (var Y, ee, se, he, fe = W.window; ; ) {
              if (W.lookahead <= ie) {
                if (Q(W), W.lookahead <= ie && j === y)
                  return D;
                if (W.lookahead === 0)
                  break;
              }
              if (W.match_length = 0, W.lookahead >= F && 0 < W.strstart && (ee = fe[se = W.strstart - 1]) === fe[++se] && ee === fe[++se] && ee === fe[++se]) {
                he = W.strstart + ie;
                do
                  ;
                while (ee === fe[++se] && ee === fe[++se] && ee === fe[++se] && ee === fe[++se] && ee === fe[++se] && ee === fe[++se] && ee === fe[++se] && ee === fe[++se] && se < he);
                W.match_length = ie - (he - se), W.match_length > W.lookahead && (W.match_length = W.lookahead);
              }
              if (W.match_length >= F ? (Y = o._tr_tally(W, 1, W.match_length - F), W.lookahead -= W.match_length, W.strstart += W.match_length, W.match_length = 0) : (Y = o._tr_tally(W, 0, W.window[W.strstart]), W.lookahead--, W.strstart++), Y && (A(W, !1), W.strm.avail_out === 0))
                return D;
            }
            return W.insert = 0, j === w ? (A(W, !0), W.strm.avail_out === 0 ? H : P) : W.last_lit && (A(W, !1), W.strm.avail_out === 0) ? D : X;
          }(f, $) : a[f.level].func(f, $);
          if (K !== H && K !== P || (f.status = 666), K === D || K === H)
            return m.avail_out === 0 && (f.last_flush = -1), p;
          if (K === X && ($ === 1 ? o._tr_align(f) : $ !== 5 && (o._tr_stored_block(f, 0, 0, !1), $ === 3 && (ae(f.head), f.lookahead === 0 && (f.strstart = 0, f.block_start = 0, f.insert = 0))), O(m), m.avail_out === 0))
            return f.last_flush = -1, p;
        }
        return $ !== w ? p : f.wrap <= 0 ? 1 : (f.wrap === 2 ? (G(f, 255 & m.adler), G(f, m.adler >> 8 & 255), G(f, m.adler >> 16 & 255), G(f, m.adler >> 24 & 255), G(f, 255 & m.total_in), G(f, m.total_in >> 8 & 255), G(f, m.total_in >> 16 & 255), G(f, m.total_in >> 24 & 255)) : (J(f, m.adler >>> 16), J(f, 65535 & m.adler)), O(m), 0 < f.wrap && (f.wrap = -f.wrap), f.pending !== 0 ? p : 1);
      }, i.deflateEnd = function(m) {
        var $;
        return m && m.state ? ($ = m.state.status) !== S && $ !== 69 && $ !== 73 && $ !== 91 && $ !== 103 && $ !== M && $ !== 666 ? Z(m, x) : (m.state = null, $ === M ? Z(m, -3) : p) : x;
      }, i.deflateSetDictionary = function(m, $) {
        var U, f, g, T, L, K, W, j, Y = $.length;
        if (!m || !m.state || (T = (U = m.state).wrap) === 2 || T === 1 && U.status !== S || U.lookahead)
          return x;
        for (T === 1 && (m.adler = c(m.adler, $, Y, 0)), U.wrap = 0, Y >= U.w_size && (T === 0 && (ae(U.head), U.strstart = 0, U.block_start = 0, U.insert = 0), j = new s.Buf8(U.w_size), s.arraySet(j, $, Y - U.w_size, U.w_size, 0), $ = j, Y = U.w_size), L = m.avail_in, K = m.next_in, W = m.input, m.avail_in = Y, m.next_in = 0, m.input = $, Q(U); U.lookahead >= F; ) {
          for (f = U.strstart, g = U.lookahead - (F - 1); U.ins_h = (U.ins_h << U.hash_shift ^ U.window[f + F - 1]) & U.hash_mask, U.prev[f & U.w_mask] = U.head[U.ins_h], U.head[U.ins_h] = f, f++, --g; )
            ;
          U.strstart = f, U.lookahead = F - 1, Q(U);
        }
        return U.strstart += U.lookahead, U.block_start = U.strstart, U.insert = U.lookahead, U.lookahead = 0, U.match_length = U.prev_length = F - 1, U.match_available = 0, m.next_in = K, m.input = W, m.avail_in = L, U.wrap = T, p;
      }, i.deflateInfo = "pako deflate (from Nodeca project)";
    }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(n, r, i) {
      r.exports = function() {
        this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
      };
    }, {}], 48: [function(n, r, i) {
      r.exports = function(a, s) {
        var o, c, u, h, y, w, p, x, d, v, l, b, _, E, C, R, I, q, F, ie, ce, S, M, D, X;
        o = a.state, c = a.next_in, D = a.input, u = c + (a.avail_in - 5), h = a.next_out, X = a.output, y = h - (s - a.avail_out), w = h + (a.avail_out - 257), p = o.dmax, x = o.wsize, d = o.whave, v = o.wnext, l = o.window, b = o.hold, _ = o.bits, E = o.lencode, C = o.distcode, R = (1 << o.lenbits) - 1, I = (1 << o.distbits) - 1;
        e:
          do {
            _ < 15 && (b += D[c++] << _, _ += 8, b += D[c++] << _, _ += 8), q = E[b & R];
            t:
              for (; ; ) {
                if (b >>>= F = q >>> 24, _ -= F, (F = q >>> 16 & 255) === 0)
                  X[h++] = 65535 & q;
                else {
                  if (!(16 & F)) {
                    if (!(64 & F)) {
                      q = E[(65535 & q) + (b & (1 << F) - 1)];
                      continue t;
                    }
                    if (32 & F) {
                      o.mode = 12;
                      break e;
                    }
                    a.msg = "invalid literal/length code", o.mode = 30;
                    break e;
                  }
                  ie = 65535 & q, (F &= 15) && (_ < F && (b += D[c++] << _, _ += 8), ie += b & (1 << F) - 1, b >>>= F, _ -= F), _ < 15 && (b += D[c++] << _, _ += 8, b += D[c++] << _, _ += 8), q = C[b & I];
                  n:
                    for (; ; ) {
                      if (b >>>= F = q >>> 24, _ -= F, !(16 & (F = q >>> 16 & 255))) {
                        if (!(64 & F)) {
                          q = C[(65535 & q) + (b & (1 << F) - 1)];
                          continue n;
                        }
                        a.msg = "invalid distance code", o.mode = 30;
                        break e;
                      }
                      if (ce = 65535 & q, _ < (F &= 15) && (b += D[c++] << _, (_ += 8) < F && (b += D[c++] << _, _ += 8)), p < (ce += b & (1 << F) - 1)) {
                        a.msg = "invalid distance too far back", o.mode = 30;
                        break e;
                      }
                      if (b >>>= F, _ -= F, (F = h - y) < ce) {
                        if (d < (F = ce - F) && o.sane) {
                          a.msg = "invalid distance too far back", o.mode = 30;
                          break e;
                        }
                        if (M = l, (S = 0) === v) {
                          if (S += x - F, F < ie) {
                            for (ie -= F; X[h++] = l[S++], --F; )
                              ;
                            S = h - ce, M = X;
                          }
                        } else if (v < F) {
                          if (S += x + v - F, (F -= v) < ie) {
                            for (ie -= F; X[h++] = l[S++], --F; )
                              ;
                            if (S = 0, v < ie) {
                              for (ie -= F = v; X[h++] = l[S++], --F; )
                                ;
                              S = h - ce, M = X;
                            }
                          }
                        } else if (S += v - F, F < ie) {
                          for (ie -= F; X[h++] = l[S++], --F; )
                            ;
                          S = h - ce, M = X;
                        }
                        for (; 2 < ie; )
                          X[h++] = M[S++], X[h++] = M[S++], X[h++] = M[S++], ie -= 3;
                        ie && (X[h++] = M[S++], 1 < ie && (X[h++] = M[S++]));
                      } else {
                        for (S = h - ce; X[h++] = X[S++], X[h++] = X[S++], X[h++] = X[S++], 2 < (ie -= 3); )
                          ;
                        ie && (X[h++] = X[S++], 1 < ie && (X[h++] = X[S++]));
                      }
                      break;
                    }
                }
                break;
              }
          } while (c < u && h < w);
        c -= ie = _ >> 3, b &= (1 << (_ -= ie << 3)) - 1, a.next_in = c, a.next_out = h, a.avail_in = c < u ? u - c + 5 : 5 - (c - u), a.avail_out = h < w ? w - h + 257 : 257 - (h - w), o.hold = b, o.bits = _;
      };
    }, {}], 49: [function(n, r, i) {
      var a = n("../utils/common"), s = n("./adler32"), o = n("./crc32"), c = n("./inffast"), u = n("./inftrees"), h = 1, y = 2, w = 0, p = -2, x = 1, d = 852, v = 592;
      function l(S) {
        return (S >>> 24 & 255) + (S >>> 8 & 65280) + ((65280 & S) << 8) + ((255 & S) << 24);
      }
      function b() {
        this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new a.Buf16(320), this.work = new a.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
      }
      function _(S) {
        var M;
        return S && S.state ? (M = S.state, S.total_in = S.total_out = M.total = 0, S.msg = "", M.wrap && (S.adler = 1 & M.wrap), M.mode = x, M.last = 0, M.havedict = 0, M.dmax = 32768, M.head = null, M.hold = 0, M.bits = 0, M.lencode = M.lendyn = new a.Buf32(d), M.distcode = M.distdyn = new a.Buf32(v), M.sane = 1, M.back = -1, w) : p;
      }
      function E(S) {
        var M;
        return S && S.state ? ((M = S.state).wsize = 0, M.whave = 0, M.wnext = 0, _(S)) : p;
      }
      function C(S, M) {
        var D, X;
        return S && S.state ? (X = S.state, M < 0 ? (D = 0, M = -M) : (D = 1 + (M >> 4), M < 48 && (M &= 15)), M && (M < 8 || 15 < M) ? p : (X.window !== null && X.wbits !== M && (X.window = null), X.wrap = D, X.wbits = M, E(S))) : p;
      }
      function R(S, M) {
        var D, X;
        return S ? (X = new b(), (S.state = X).window = null, (D = C(S, M)) !== w && (S.state = null), D) : p;
      }
      var I, q, F = !0;
      function ie(S) {
        if (F) {
          var M;
          for (I = new a.Buf32(512), q = new a.Buf32(32), M = 0; M < 144; )
            S.lens[M++] = 8;
          for (; M < 256; )
            S.lens[M++] = 9;
          for (; M < 280; )
            S.lens[M++] = 7;
          for (; M < 288; )
            S.lens[M++] = 8;
          for (u(h, S.lens, 0, 288, I, 0, S.work, { bits: 9 }), M = 0; M < 32; )
            S.lens[M++] = 5;
          u(y, S.lens, 0, 32, q, 0, S.work, { bits: 5 }), F = !1;
        }
        S.lencode = I, S.lenbits = 9, S.distcode = q, S.distbits = 5;
      }
      function ce(S, M, D, X) {
        var H, P = S.state;
        return P.window === null && (P.wsize = 1 << P.wbits, P.wnext = 0, P.whave = 0, P.window = new a.Buf8(P.wsize)), X >= P.wsize ? (a.arraySet(P.window, M, D - P.wsize, P.wsize, 0), P.wnext = 0, P.whave = P.wsize) : (X < (H = P.wsize - P.wnext) && (H = X), a.arraySet(P.window, M, D - X, H, P.wnext), (X -= H) ? (a.arraySet(P.window, M, D - X, X, 0), P.wnext = X, P.whave = P.wsize) : (P.wnext += H, P.wnext === P.wsize && (P.wnext = 0), P.whave < P.wsize && (P.whave += H))), 0;
      }
      i.inflateReset = E, i.inflateReset2 = C, i.inflateResetKeep = _, i.inflateInit = function(S) {
        return R(S, 15);
      }, i.inflateInit2 = R, i.inflate = function(S, M) {
        var D, X, H, P, Z, z, ae, O, A, G, J, re, Q, B, k, ne, te, V, N, oe, m, $, U, f, g = 0, T = new a.Buf8(4), L = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        if (!S || !S.state || !S.output || !S.input && S.avail_in !== 0)
          return p;
        (D = S.state).mode === 12 && (D.mode = 13), Z = S.next_out, H = S.output, ae = S.avail_out, P = S.next_in, X = S.input, z = S.avail_in, O = D.hold, A = D.bits, G = z, J = ae, $ = w;
        e:
          for (; ; )
            switch (D.mode) {
              case x:
                if (D.wrap === 0) {
                  D.mode = 13;
                  break;
                }
                for (; A < 16; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                if (2 & D.wrap && O === 35615) {
                  T[D.check = 0] = 255 & O, T[1] = O >>> 8 & 255, D.check = o(D.check, T, 2, 0), A = O = 0, D.mode = 2;
                  break;
                }
                if (D.flags = 0, D.head && (D.head.done = !1), !(1 & D.wrap) || (((255 & O) << 8) + (O >> 8)) % 31) {
                  S.msg = "incorrect header check", D.mode = 30;
                  break;
                }
                if ((15 & O) != 8) {
                  S.msg = "unknown compression method", D.mode = 30;
                  break;
                }
                if (A -= 4, m = 8 + (15 & (O >>>= 4)), D.wbits === 0)
                  D.wbits = m;
                else if (m > D.wbits) {
                  S.msg = "invalid window size", D.mode = 30;
                  break;
                }
                D.dmax = 1 << m, S.adler = D.check = 1, D.mode = 512 & O ? 10 : 12, A = O = 0;
                break;
              case 2:
                for (; A < 16; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                if (D.flags = O, (255 & D.flags) != 8) {
                  S.msg = "unknown compression method", D.mode = 30;
                  break;
                }
                if (57344 & D.flags) {
                  S.msg = "unknown header flags set", D.mode = 30;
                  break;
                }
                D.head && (D.head.text = O >> 8 & 1), 512 & D.flags && (T[0] = 255 & O, T[1] = O >>> 8 & 255, D.check = o(D.check, T, 2, 0)), A = O = 0, D.mode = 3;
              case 3:
                for (; A < 32; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                D.head && (D.head.time = O), 512 & D.flags && (T[0] = 255 & O, T[1] = O >>> 8 & 255, T[2] = O >>> 16 & 255, T[3] = O >>> 24 & 255, D.check = o(D.check, T, 4, 0)), A = O = 0, D.mode = 4;
              case 4:
                for (; A < 16; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                D.head && (D.head.xflags = 255 & O, D.head.os = O >> 8), 512 & D.flags && (T[0] = 255 & O, T[1] = O >>> 8 & 255, D.check = o(D.check, T, 2, 0)), A = O = 0, D.mode = 5;
              case 5:
                if (1024 & D.flags) {
                  for (; A < 16; ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  D.length = O, D.head && (D.head.extra_len = O), 512 & D.flags && (T[0] = 255 & O, T[1] = O >>> 8 & 255, D.check = o(D.check, T, 2, 0)), A = O = 0;
                } else
                  D.head && (D.head.extra = null);
                D.mode = 6;
              case 6:
                if (1024 & D.flags && (z < (re = D.length) && (re = z), re && (D.head && (m = D.head.extra_len - D.length, D.head.extra || (D.head.extra = new Array(D.head.extra_len)), a.arraySet(D.head.extra, X, P, re, m)), 512 & D.flags && (D.check = o(D.check, X, re, P)), z -= re, P += re, D.length -= re), D.length))
                  break e;
                D.length = 0, D.mode = 7;
              case 7:
                if (2048 & D.flags) {
                  if (z === 0)
                    break e;
                  for (re = 0; m = X[P + re++], D.head && m && D.length < 65536 && (D.head.name += String.fromCharCode(m)), m && re < z; )
                    ;
                  if (512 & D.flags && (D.check = o(D.check, X, re, P)), z -= re, P += re, m)
                    break e;
                } else
                  D.head && (D.head.name = null);
                D.length = 0, D.mode = 8;
              case 8:
                if (4096 & D.flags) {
                  if (z === 0)
                    break e;
                  for (re = 0; m = X[P + re++], D.head && m && D.length < 65536 && (D.head.comment += String.fromCharCode(m)), m && re < z; )
                    ;
                  if (512 & D.flags && (D.check = o(D.check, X, re, P)), z -= re, P += re, m)
                    break e;
                } else
                  D.head && (D.head.comment = null);
                D.mode = 9;
              case 9:
                if (512 & D.flags) {
                  for (; A < 16; ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  if (O !== (65535 & D.check)) {
                    S.msg = "header crc mismatch", D.mode = 30;
                    break;
                  }
                  A = O = 0;
                }
                D.head && (D.head.hcrc = D.flags >> 9 & 1, D.head.done = !0), S.adler = D.check = 0, D.mode = 12;
                break;
              case 10:
                for (; A < 32; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                S.adler = D.check = l(O), A = O = 0, D.mode = 11;
              case 11:
                if (D.havedict === 0)
                  return S.next_out = Z, S.avail_out = ae, S.next_in = P, S.avail_in = z, D.hold = O, D.bits = A, 2;
                S.adler = D.check = 1, D.mode = 12;
              case 12:
                if (M === 5 || M === 6)
                  break e;
              case 13:
                if (D.last) {
                  O >>>= 7 & A, A -= 7 & A, D.mode = 27;
                  break;
                }
                for (; A < 3; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                switch (D.last = 1 & O, A -= 1, 3 & (O >>>= 1)) {
                  case 0:
                    D.mode = 14;
                    break;
                  case 1:
                    if (ie(D), D.mode = 20, M !== 6)
                      break;
                    O >>>= 2, A -= 2;
                    break e;
                  case 2:
                    D.mode = 17;
                    break;
                  case 3:
                    S.msg = "invalid block type", D.mode = 30;
                }
                O >>>= 2, A -= 2;
                break;
              case 14:
                for (O >>>= 7 & A, A -= 7 & A; A < 32; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                if ((65535 & O) != (O >>> 16 ^ 65535)) {
                  S.msg = "invalid stored block lengths", D.mode = 30;
                  break;
                }
                if (D.length = 65535 & O, A = O = 0, D.mode = 15, M === 6)
                  break e;
              case 15:
                D.mode = 16;
              case 16:
                if (re = D.length) {
                  if (z < re && (re = z), ae < re && (re = ae), re === 0)
                    break e;
                  a.arraySet(H, X, P, re, Z), z -= re, P += re, ae -= re, Z += re, D.length -= re;
                  break;
                }
                D.mode = 12;
                break;
              case 17:
                for (; A < 14; ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                if (D.nlen = 257 + (31 & O), O >>>= 5, A -= 5, D.ndist = 1 + (31 & O), O >>>= 5, A -= 5, D.ncode = 4 + (15 & O), O >>>= 4, A -= 4, 286 < D.nlen || 30 < D.ndist) {
                  S.msg = "too many length or distance symbols", D.mode = 30;
                  break;
                }
                D.have = 0, D.mode = 18;
              case 18:
                for (; D.have < D.ncode; ) {
                  for (; A < 3; ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  D.lens[L[D.have++]] = 7 & O, O >>>= 3, A -= 3;
                }
                for (; D.have < 19; )
                  D.lens[L[D.have++]] = 0;
                if (D.lencode = D.lendyn, D.lenbits = 7, U = { bits: D.lenbits }, $ = u(0, D.lens, 0, 19, D.lencode, 0, D.work, U), D.lenbits = U.bits, $) {
                  S.msg = "invalid code lengths set", D.mode = 30;
                  break;
                }
                D.have = 0, D.mode = 19;
              case 19:
                for (; D.have < D.nlen + D.ndist; ) {
                  for (; ne = (g = D.lencode[O & (1 << D.lenbits) - 1]) >>> 16 & 255, te = 65535 & g, !((k = g >>> 24) <= A); ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  if (te < 16)
                    O >>>= k, A -= k, D.lens[D.have++] = te;
                  else {
                    if (te === 16) {
                      for (f = k + 2; A < f; ) {
                        if (z === 0)
                          break e;
                        z--, O += X[P++] << A, A += 8;
                      }
                      if (O >>>= k, A -= k, D.have === 0) {
                        S.msg = "invalid bit length repeat", D.mode = 30;
                        break;
                      }
                      m = D.lens[D.have - 1], re = 3 + (3 & O), O >>>= 2, A -= 2;
                    } else if (te === 17) {
                      for (f = k + 3; A < f; ) {
                        if (z === 0)
                          break e;
                        z--, O += X[P++] << A, A += 8;
                      }
                      A -= k, m = 0, re = 3 + (7 & (O >>>= k)), O >>>= 3, A -= 3;
                    } else {
                      for (f = k + 7; A < f; ) {
                        if (z === 0)
                          break e;
                        z--, O += X[P++] << A, A += 8;
                      }
                      A -= k, m = 0, re = 11 + (127 & (O >>>= k)), O >>>= 7, A -= 7;
                    }
                    if (D.have + re > D.nlen + D.ndist) {
                      S.msg = "invalid bit length repeat", D.mode = 30;
                      break;
                    }
                    for (; re--; )
                      D.lens[D.have++] = m;
                  }
                }
                if (D.mode === 30)
                  break;
                if (D.lens[256] === 0) {
                  S.msg = "invalid code -- missing end-of-block", D.mode = 30;
                  break;
                }
                if (D.lenbits = 9, U = { bits: D.lenbits }, $ = u(h, D.lens, 0, D.nlen, D.lencode, 0, D.work, U), D.lenbits = U.bits, $) {
                  S.msg = "invalid literal/lengths set", D.mode = 30;
                  break;
                }
                if (D.distbits = 6, D.distcode = D.distdyn, U = { bits: D.distbits }, $ = u(y, D.lens, D.nlen, D.ndist, D.distcode, 0, D.work, U), D.distbits = U.bits, $) {
                  S.msg = "invalid distances set", D.mode = 30;
                  break;
                }
                if (D.mode = 20, M === 6)
                  break e;
              case 20:
                D.mode = 21;
              case 21:
                if (6 <= z && 258 <= ae) {
                  S.next_out = Z, S.avail_out = ae, S.next_in = P, S.avail_in = z, D.hold = O, D.bits = A, c(S, J), Z = S.next_out, H = S.output, ae = S.avail_out, P = S.next_in, X = S.input, z = S.avail_in, O = D.hold, A = D.bits, D.mode === 12 && (D.back = -1);
                  break;
                }
                for (D.back = 0; ne = (g = D.lencode[O & (1 << D.lenbits) - 1]) >>> 16 & 255, te = 65535 & g, !((k = g >>> 24) <= A); ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                if (ne && !(240 & ne)) {
                  for (V = k, N = ne, oe = te; ne = (g = D.lencode[oe + ((O & (1 << V + N) - 1) >> V)]) >>> 16 & 255, te = 65535 & g, !(V + (k = g >>> 24) <= A); ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  O >>>= V, A -= V, D.back += V;
                }
                if (O >>>= k, A -= k, D.back += k, D.length = te, ne === 0) {
                  D.mode = 26;
                  break;
                }
                if (32 & ne) {
                  D.back = -1, D.mode = 12;
                  break;
                }
                if (64 & ne) {
                  S.msg = "invalid literal/length code", D.mode = 30;
                  break;
                }
                D.extra = 15 & ne, D.mode = 22;
              case 22:
                if (D.extra) {
                  for (f = D.extra; A < f; ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  D.length += O & (1 << D.extra) - 1, O >>>= D.extra, A -= D.extra, D.back += D.extra;
                }
                D.was = D.length, D.mode = 23;
              case 23:
                for (; ne = (g = D.distcode[O & (1 << D.distbits) - 1]) >>> 16 & 255, te = 65535 & g, !((k = g >>> 24) <= A); ) {
                  if (z === 0)
                    break e;
                  z--, O += X[P++] << A, A += 8;
                }
                if (!(240 & ne)) {
                  for (V = k, N = ne, oe = te; ne = (g = D.distcode[oe + ((O & (1 << V + N) - 1) >> V)]) >>> 16 & 255, te = 65535 & g, !(V + (k = g >>> 24) <= A); ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  O >>>= V, A -= V, D.back += V;
                }
                if (O >>>= k, A -= k, D.back += k, 64 & ne) {
                  S.msg = "invalid distance code", D.mode = 30;
                  break;
                }
                D.offset = te, D.extra = 15 & ne, D.mode = 24;
              case 24:
                if (D.extra) {
                  for (f = D.extra; A < f; ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  D.offset += O & (1 << D.extra) - 1, O >>>= D.extra, A -= D.extra, D.back += D.extra;
                }
                if (D.offset > D.dmax) {
                  S.msg = "invalid distance too far back", D.mode = 30;
                  break;
                }
                D.mode = 25;
              case 25:
                if (ae === 0)
                  break e;
                if (re = J - ae, D.offset > re) {
                  if ((re = D.offset - re) > D.whave && D.sane) {
                    S.msg = "invalid distance too far back", D.mode = 30;
                    break;
                  }
                  Q = re > D.wnext ? (re -= D.wnext, D.wsize - re) : D.wnext - re, re > D.length && (re = D.length), B = D.window;
                } else
                  B = H, Q = Z - D.offset, re = D.length;
                for (ae < re && (re = ae), ae -= re, D.length -= re; H[Z++] = B[Q++], --re; )
                  ;
                D.length === 0 && (D.mode = 21);
                break;
              case 26:
                if (ae === 0)
                  break e;
                H[Z++] = D.length, ae--, D.mode = 21;
                break;
              case 27:
                if (D.wrap) {
                  for (; A < 32; ) {
                    if (z === 0)
                      break e;
                    z--, O |= X[P++] << A, A += 8;
                  }
                  if (J -= ae, S.total_out += J, D.total += J, J && (S.adler = D.check = D.flags ? o(D.check, H, J, Z - J) : s(D.check, H, J, Z - J)), J = ae, (D.flags ? O : l(O)) !== D.check) {
                    S.msg = "incorrect data check", D.mode = 30;
                    break;
                  }
                  A = O = 0;
                }
                D.mode = 28;
              case 28:
                if (D.wrap && D.flags) {
                  for (; A < 32; ) {
                    if (z === 0)
                      break e;
                    z--, O += X[P++] << A, A += 8;
                  }
                  if (O !== (4294967295 & D.total)) {
                    S.msg = "incorrect length check", D.mode = 30;
                    break;
                  }
                  A = O = 0;
                }
                D.mode = 29;
              case 29:
                $ = 1;
                break e;
              case 30:
                $ = -3;
                break e;
              case 31:
                return -4;
              case 32:
              default:
                return p;
            }
        return S.next_out = Z, S.avail_out = ae, S.next_in = P, S.avail_in = z, D.hold = O, D.bits = A, (D.wsize || J !== S.avail_out && D.mode < 30 && (D.mode < 27 || M !== 4)) && ce(S, S.output, S.next_out, J - S.avail_out) ? (D.mode = 31, -4) : (G -= S.avail_in, J -= S.avail_out, S.total_in += G, S.total_out += J, D.total += J, D.wrap && J && (S.adler = D.check = D.flags ? o(D.check, H, J, S.next_out - J) : s(D.check, H, J, S.next_out - J)), S.data_type = D.bits + (D.last ? 64 : 0) + (D.mode === 12 ? 128 : 0) + (D.mode === 20 || D.mode === 15 ? 256 : 0), (G == 0 && J === 0 || M === 4) && $ === w && ($ = -5), $);
      }, i.inflateEnd = function(S) {
        if (!S || !S.state)
          return p;
        var M = S.state;
        return M.window && (M.window = null), S.state = null, w;
      }, i.inflateGetHeader = function(S, M) {
        var D;
        return S && S.state && 2 & (D = S.state).wrap ? ((D.head = M).done = !1, w) : p;
      }, i.inflateSetDictionary = function(S, M) {
        var D, X = M.length;
        return S && S.state ? (D = S.state).wrap !== 0 && D.mode !== 11 ? p : D.mode === 11 && s(1, M, X, 0) !== D.check ? -3 : ce(S, M, X, X) ? (D.mode = 31, -4) : (D.havedict = 1, w) : p;
      }, i.inflateInfo = "pako inflate (from Nodeca project)";
    }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(n, r, i) {
      var a = n("../utils/common"), s = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], o = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], c = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], u = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
      r.exports = function(h, y, w, p, x, d, v, l) {
        var b, _, E, C, R, I, q, F, ie, ce = l.bits, S = 0, M = 0, D = 0, X = 0, H = 0, P = 0, Z = 0, z = 0, ae = 0, O = 0, A = null, G = 0, J = new a.Buf16(16), re = new a.Buf16(16), Q = null, B = 0;
        for (S = 0; S <= 15; S++)
          J[S] = 0;
        for (M = 0; M < p; M++)
          J[y[w + M]]++;
        for (H = ce, X = 15; 1 <= X && J[X] === 0; X--)
          ;
        if (X < H && (H = X), X === 0)
          return x[d++] = 20971520, x[d++] = 20971520, l.bits = 1, 0;
        for (D = 1; D < X && J[D] === 0; D++)
          ;
        for (H < D && (H = D), S = z = 1; S <= 15; S++)
          if (z <<= 1, (z -= J[S]) < 0)
            return -1;
        if (0 < z && (h === 0 || X !== 1))
          return -1;
        for (re[1] = 0, S = 1; S < 15; S++)
          re[S + 1] = re[S] + J[S];
        for (M = 0; M < p; M++)
          y[w + M] !== 0 && (v[re[y[w + M]]++] = M);
        if (I = h === 0 ? (A = Q = v, 19) : h === 1 ? (A = s, G -= 257, Q = o, B -= 257, 256) : (A = c, Q = u, -1), S = D, R = d, Z = M = O = 0, E = -1, C = (ae = 1 << (P = H)) - 1, h === 1 && 852 < ae || h === 2 && 592 < ae)
          return 1;
        for (; ; ) {
          for (q = S - Z, ie = v[M] < I ? (F = 0, v[M]) : v[M] > I ? (F = Q[B + v[M]], A[G + v[M]]) : (F = 96, 0), b = 1 << S - Z, D = _ = 1 << P; x[R + (O >> Z) + (_ -= b)] = q << 24 | F << 16 | ie | 0, _ !== 0; )
            ;
          for (b = 1 << S - 1; O & b; )
            b >>= 1;
          if (b !== 0 ? (O &= b - 1, O += b) : O = 0, M++, --J[S] == 0) {
            if (S === X)
              break;
            S = y[w + v[M]];
          }
          if (H < S && (O & C) !== E) {
            for (Z === 0 && (Z = H), R += D, z = 1 << (P = S - Z); P + Z < X && !((z -= J[P + Z]) <= 0); )
              P++, z <<= 1;
            if (ae += 1 << P, h === 1 && 852 < ae || h === 2 && 592 < ae)
              return 1;
            x[E = O & C] = H << 24 | P << 16 | R - d | 0;
          }
        }
        return O !== 0 && (x[R + O] = S - Z << 24 | 64 << 16 | 0), l.bits = H, 0;
      };
    }, { "../utils/common": 41 }], 51: [function(n, r, i) {
      r.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
    }, {}], 52: [function(n, r, i) {
      var a = n("../utils/common"), s = 0, o = 1;
      function c(g) {
        for (var T = g.length; 0 <= --T; )
          g[T] = 0;
      }
      var u = 0, h = 29, y = 256, w = y + 1 + h, p = 30, x = 19, d = 2 * w + 1, v = 15, l = 16, b = 7, _ = 256, E = 16, C = 17, R = 18, I = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], q = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], F = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], ie = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], ce = new Array(2 * (w + 2));
      c(ce);
      var S = new Array(2 * p);
      c(S);
      var M = new Array(512);
      c(M);
      var D = new Array(256);
      c(D);
      var X = new Array(h);
      c(X);
      var H, P, Z, z = new Array(p);
      function ae(g, T, L, K, W) {
        this.static_tree = g, this.extra_bits = T, this.extra_base = L, this.elems = K, this.max_length = W, this.has_stree = g && g.length;
      }
      function O(g, T) {
        this.dyn_tree = g, this.max_code = 0, this.stat_desc = T;
      }
      function A(g) {
        return g < 256 ? M[g] : M[256 + (g >>> 7)];
      }
      function G(g, T) {
        g.pending_buf[g.pending++] = 255 & T, g.pending_buf[g.pending++] = T >>> 8 & 255;
      }
      function J(g, T, L) {
        g.bi_valid > l - L ? (g.bi_buf |= T << g.bi_valid & 65535, G(g, g.bi_buf), g.bi_buf = T >> l - g.bi_valid, g.bi_valid += L - l) : (g.bi_buf |= T << g.bi_valid & 65535, g.bi_valid += L);
      }
      function re(g, T, L) {
        J(g, L[2 * T], L[2 * T + 1]);
      }
      function Q(g, T) {
        for (var L = 0; L |= 1 & g, g >>>= 1, L <<= 1, 0 < --T; )
          ;
        return L >>> 1;
      }
      function B(g, T, L) {
        var K, W, j = new Array(v + 1), Y = 0;
        for (K = 1; K <= v; K++)
          j[K] = Y = Y + L[K - 1] << 1;
        for (W = 0; W <= T; W++) {
          var ee = g[2 * W + 1];
          ee !== 0 && (g[2 * W] = Q(j[ee]++, ee));
        }
      }
      function k(g) {
        var T;
        for (T = 0; T < w; T++)
          g.dyn_ltree[2 * T] = 0;
        for (T = 0; T < p; T++)
          g.dyn_dtree[2 * T] = 0;
        for (T = 0; T < x; T++)
          g.bl_tree[2 * T] = 0;
        g.dyn_ltree[2 * _] = 1, g.opt_len = g.static_len = 0, g.last_lit = g.matches = 0;
      }
      function ne(g) {
        8 < g.bi_valid ? G(g, g.bi_buf) : 0 < g.bi_valid && (g.pending_buf[g.pending++] = g.bi_buf), g.bi_buf = 0, g.bi_valid = 0;
      }
      function te(g, T, L, K) {
        var W = 2 * T, j = 2 * L;
        return g[W] < g[j] || g[W] === g[j] && K[T] <= K[L];
      }
      function V(g, T, L) {
        for (var K = g.heap[L], W = L << 1; W <= g.heap_len && (W < g.heap_len && te(T, g.heap[W + 1], g.heap[W], g.depth) && W++, !te(T, K, g.heap[W], g.depth)); )
          g.heap[L] = g.heap[W], L = W, W <<= 1;
        g.heap[L] = K;
      }
      function N(g, T, L) {
        var K, W, j, Y, ee = 0;
        if (g.last_lit !== 0)
          for (; K = g.pending_buf[g.d_buf + 2 * ee] << 8 | g.pending_buf[g.d_buf + 2 * ee + 1], W = g.pending_buf[g.l_buf + ee], ee++, K === 0 ? re(g, W, T) : (re(g, (j = D[W]) + y + 1, T), (Y = I[j]) !== 0 && J(g, W -= X[j], Y), re(g, j = A(--K), L), (Y = q[j]) !== 0 && J(g, K -= z[j], Y)), ee < g.last_lit; )
            ;
        re(g, _, T);
      }
      function oe(g, T) {
        var L, K, W, j = T.dyn_tree, Y = T.stat_desc.static_tree, ee = T.stat_desc.has_stree, se = T.stat_desc.elems, he = -1;
        for (g.heap_len = 0, g.heap_max = d, L = 0; L < se; L++)
          j[2 * L] !== 0 ? (g.heap[++g.heap_len] = he = L, g.depth[L] = 0) : j[2 * L + 1] = 0;
        for (; g.heap_len < 2; )
          j[2 * (W = g.heap[++g.heap_len] = he < 2 ? ++he : 0)] = 1, g.depth[W] = 0, g.opt_len--, ee && (g.static_len -= Y[2 * W + 1]);
        for (T.max_code = he, L = g.heap_len >> 1; 1 <= L; L--)
          V(g, j, L);
        for (W = se; L = g.heap[1], g.heap[1] = g.heap[g.heap_len--], V(g, j, 1), K = g.heap[1], g.heap[--g.heap_max] = L, g.heap[--g.heap_max] = K, j[2 * W] = j[2 * L] + j[2 * K], g.depth[W] = (g.depth[L] >= g.depth[K] ? g.depth[L] : g.depth[K]) + 1, j[2 * L + 1] = j[2 * K + 1] = W, g.heap[1] = W++, V(g, j, 1), 2 <= g.heap_len; )
          ;
        g.heap[--g.heap_max] = g.heap[1], function(fe, ve) {
          var be, xe, Ce, we, Ve, Xt, Me = ve.dyn_tree, Rr = ve.max_code, io = ve.stat_desc.static_tree, ao = ve.stat_desc.has_stree, oo = ve.stat_desc.extra_bits, Ir = ve.stat_desc.extra_base, kt = ve.stat_desc.max_length, $t = 0;
          for (we = 0; we <= v; we++)
            fe.bl_count[we] = 0;
          for (Me[2 * fe.heap[fe.heap_max] + 1] = 0, be = fe.heap_max + 1; be < d; be++)
            kt < (we = Me[2 * Me[2 * (xe = fe.heap[be]) + 1] + 1] + 1) && (we = kt, $t++), Me[2 * xe + 1] = we, Rr < xe || (fe.bl_count[we]++, Ve = 0, Ir <= xe && (Ve = oo[xe - Ir]), Xt = Me[2 * xe], fe.opt_len += Xt * (we + Ve), ao && (fe.static_len += Xt * (io[2 * xe + 1] + Ve)));
          if ($t !== 0) {
            do {
              for (we = kt - 1; fe.bl_count[we] === 0; )
                we--;
              fe.bl_count[we]--, fe.bl_count[we + 1] += 2, fe.bl_count[kt]--, $t -= 2;
            } while (0 < $t);
            for (we = kt; we !== 0; we--)
              for (xe = fe.bl_count[we]; xe !== 0; )
                Rr < (Ce = fe.heap[--be]) || (Me[2 * Ce + 1] !== we && (fe.opt_len += (we - Me[2 * Ce + 1]) * Me[2 * Ce], Me[2 * Ce + 1] = we), xe--);
          }
        }(g, T), B(j, he, g.bl_count);
      }
      function m(g, T, L) {
        var K, W, j = -1, Y = T[1], ee = 0, se = 7, he = 4;
        for (Y === 0 && (se = 138, he = 3), T[2 * (L + 1) + 1] = 65535, K = 0; K <= L; K++)
          W = Y, Y = T[2 * (K + 1) + 1], ++ee < se && W === Y || (ee < he ? g.bl_tree[2 * W] += ee : W !== 0 ? (W !== j && g.bl_tree[2 * W]++, g.bl_tree[2 * E]++) : ee <= 10 ? g.bl_tree[2 * C]++ : g.bl_tree[2 * R]++, j = W, he = (ee = 0) === Y ? (se = 138, 3) : W === Y ? (se = 6, 3) : (se = 7, 4));
      }
      function $(g, T, L) {
        var K, W, j = -1, Y = T[1], ee = 0, se = 7, he = 4;
        for (Y === 0 && (se = 138, he = 3), K = 0; K <= L; K++)
          if (W = Y, Y = T[2 * (K + 1) + 1], !(++ee < se && W === Y)) {
            if (ee < he)
              for (; re(g, W, g.bl_tree), --ee != 0; )
                ;
            else
              W !== 0 ? (W !== j && (re(g, W, g.bl_tree), ee--), re(g, E, g.bl_tree), J(g, ee - 3, 2)) : ee <= 10 ? (re(g, C, g.bl_tree), J(g, ee - 3, 3)) : (re(g, R, g.bl_tree), J(g, ee - 11, 7));
            j = W, he = (ee = 0) === Y ? (se = 138, 3) : W === Y ? (se = 6, 3) : (se = 7, 4);
          }
      }
      c(z);
      var U = !1;
      function f(g, T, L, K) {
        J(g, (u << 1) + (K ? 1 : 0), 3), function(W, j, Y, ee) {
          ne(W), ee && (G(W, Y), G(W, ~Y)), a.arraySet(W.pending_buf, W.window, j, Y, W.pending), W.pending += Y;
        }(g, T, L, !0);
      }
      i._tr_init = function(g) {
        U || (function() {
          var T, L, K, W, j, Y = new Array(v + 1);
          for (W = K = 0; W < h - 1; W++)
            for (X[W] = K, T = 0; T < 1 << I[W]; T++)
              D[K++] = W;
          for (D[K - 1] = W, W = j = 0; W < 16; W++)
            for (z[W] = j, T = 0; T < 1 << q[W]; T++)
              M[j++] = W;
          for (j >>= 7; W < p; W++)
            for (z[W] = j << 7, T = 0; T < 1 << q[W] - 7; T++)
              M[256 + j++] = W;
          for (L = 0; L <= v; L++)
            Y[L] = 0;
          for (T = 0; T <= 143; )
            ce[2 * T + 1] = 8, T++, Y[8]++;
          for (; T <= 255; )
            ce[2 * T + 1] = 9, T++, Y[9]++;
          for (; T <= 279; )
            ce[2 * T + 1] = 7, T++, Y[7]++;
          for (; T <= 287; )
            ce[2 * T + 1] = 8, T++, Y[8]++;
          for (B(ce, w + 1, Y), T = 0; T < p; T++)
            S[2 * T + 1] = 5, S[2 * T] = Q(T, 5);
          H = new ae(ce, I, y + 1, w, v), P = new ae(S, q, 0, p, v), Z = new ae(new Array(0), F, 0, x, b);
        }(), U = !0), g.l_desc = new O(g.dyn_ltree, H), g.d_desc = new O(g.dyn_dtree, P), g.bl_desc = new O(g.bl_tree, Z), g.bi_buf = 0, g.bi_valid = 0, k(g);
      }, i._tr_stored_block = f, i._tr_flush_block = function(g, T, L, K) {
        var W, j, Y = 0;
        0 < g.level ? (g.strm.data_type === 2 && (g.strm.data_type = function(ee) {
          var se, he = 4093624447;
          for (se = 0; se <= 31; se++, he >>>= 1)
            if (1 & he && ee.dyn_ltree[2 * se] !== 0)
              return s;
          if (ee.dyn_ltree[18] !== 0 || ee.dyn_ltree[20] !== 0 || ee.dyn_ltree[26] !== 0)
            return o;
          for (se = 32; se < y; se++)
            if (ee.dyn_ltree[2 * se] !== 0)
              return o;
          return s;
        }(g)), oe(g, g.l_desc), oe(g, g.d_desc), Y = function(ee) {
          var se;
          for (m(ee, ee.dyn_ltree, ee.l_desc.max_code), m(ee, ee.dyn_dtree, ee.d_desc.max_code), oe(ee, ee.bl_desc), se = x - 1; 3 <= se && ee.bl_tree[2 * ie[se] + 1] === 0; se--)
            ;
          return ee.opt_len += 3 * (se + 1) + 5 + 5 + 4, se;
        }(g), W = g.opt_len + 3 + 7 >>> 3, (j = g.static_len + 3 + 7 >>> 3) <= W && (W = j)) : W = j = L + 5, L + 4 <= W && T !== -1 ? f(g, T, L, K) : g.strategy === 4 || j === W ? (J(g, 2 + (K ? 1 : 0), 3), N(g, ce, S)) : (J(g, 4 + (K ? 1 : 0), 3), function(ee, se, he, fe) {
          var ve;
          for (J(ee, se - 257, 5), J(ee, he - 1, 5), J(ee, fe - 4, 4), ve = 0; ve < fe; ve++)
            J(ee, ee.bl_tree[2 * ie[ve] + 1], 3);
          $(ee, ee.dyn_ltree, se - 1), $(ee, ee.dyn_dtree, he - 1);
        }(g, g.l_desc.max_code + 1, g.d_desc.max_code + 1, Y + 1), N(g, g.dyn_ltree, g.dyn_dtree)), k(g), K && ne(g);
      }, i._tr_tally = function(g, T, L) {
        return g.pending_buf[g.d_buf + 2 * g.last_lit] = T >>> 8 & 255, g.pending_buf[g.d_buf + 2 * g.last_lit + 1] = 255 & T, g.pending_buf[g.l_buf + g.last_lit] = 255 & L, g.last_lit++, T === 0 ? g.dyn_ltree[2 * L]++ : (g.matches++, T--, g.dyn_ltree[2 * (D[L] + y + 1)]++, g.dyn_dtree[2 * A(T)]++), g.last_lit === g.lit_bufsize - 1;
      }, i._tr_align = function(g) {
        J(g, 2, 3), re(g, _, ce), function(T) {
          T.bi_valid === 16 ? (G(T, T.bi_buf), T.bi_buf = 0, T.bi_valid = 0) : 8 <= T.bi_valid && (T.pending_buf[T.pending++] = 255 & T.bi_buf, T.bi_buf >>= 8, T.bi_valid -= 8);
        }(g);
      };
    }, { "../utils/common": 41 }], 53: [function(n, r, i) {
      r.exports = function() {
        this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
      };
    }, {}], 54: [function(n, r, i) {
      (function(a) {
        (function(s, o) {
          if (!s.setImmediate) {
            var c, u, h, y, w = 1, p = {}, x = !1, d = s.document, v = Object.getPrototypeOf && Object.getPrototypeOf(s);
            v = v && v.setTimeout ? v : s, c = {}.toString.call(s.process) === "[object process]" ? function(E) {
              _e.nextTick(function() {
                b(E);
              });
            } : function() {
              if (s.postMessage && !s.importScripts) {
                var E = !0, C = s.onmessage;
                return s.onmessage = function() {
                  E = !1;
                }, s.postMessage("", "*"), s.onmessage = C, E;
              }
            }() ? (y = "setImmediate$" + Math.random() + "$", s.addEventListener ? s.addEventListener("message", _, !1) : s.attachEvent("onmessage", _), function(E) {
              s.postMessage(y + E, "*");
            }) : s.MessageChannel ? ((h = new MessageChannel()).port1.onmessage = function(E) {
              b(E.data);
            }, function(E) {
              h.port2.postMessage(E);
            }) : d && "onreadystatechange" in d.createElement("script") ? (u = d.documentElement, function(E) {
              var C = d.createElement("script");
              C.onreadystatechange = function() {
                b(E), C.onreadystatechange = null, u.removeChild(C), C = null;
              }, u.appendChild(C);
            }) : function(E) {
              setTimeout(b, 0, E);
            }, v.setImmediate = function(E) {
              typeof E != "function" && (E = new Function("" + E));
              for (var C = new Array(arguments.length - 1), R = 0; R < C.length; R++)
                C[R] = arguments[R + 1];
              var I = { callback: E, args: C };
              return p[w] = I, c(w), w++;
            }, v.clearImmediate = l;
          }
          function l(E) {
            delete p[E];
          }
          function b(E) {
            if (x)
              setTimeout(b, 0, E);
            else {
              var C = p[E];
              if (C) {
                x = !0;
                try {
                  (function(R) {
                    var I = R.callback, q = R.args;
                    switch (q.length) {
                      case 0:
                        I();
                        break;
                      case 1:
                        I(q[0]);
                        break;
                      case 2:
                        I(q[0], q[1]);
                        break;
                      case 3:
                        I(q[0], q[1], q[2]);
                        break;
                      default:
                        I.apply(o, q);
                    }
                  })(C);
                } finally {
                  l(E), x = !1;
                }
              }
            }
          }
          function _(E) {
            E.source === s && typeof E.data == "string" && E.data.indexOf(y) === 0 && b(+E.data.slice(y.length));
          }
        })(typeof self > "u" ? a === void 0 ? this : a : self);
      }).call(this, typeof jt < "u" ? jt : typeof self < "u" ? self : typeof window < "u" ? window : {});
    }, {}] }, {}, [10])(10);
  });
})(Yp);
var kx = Yp.exports;
const Bx = /* @__PURE__ */ zf(kx);
var $i = { exports: {} }, Rx = {
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
  "<": "&lt;",
  ">": "&gt;"
};
function Ix(e) {
  return e && e.replace ? e.replace(/([&"<>'])/g, function(t, n) {
    return Rx[n];
  }) : e;
}
var Nx = Ix, Fc = Nx, Bd = qc.Stream, Ox = "    ";
function Wx(e, t) {
  typeof t != "object" && (t = {
    indent: t
  });
  var n = t.stream ? new Bd() : null, r = "", i = !1, a = t.indent ? t.indent === !0 ? Ox : t.indent : "", s = !0;
  function o(w) {
    s ? _e.nextTick(w) : w();
  }
  function c(w, p) {
    if (p !== void 0 && (r += p), w && !i && (n = n || new Bd(), i = !0), w && i) {
      var x = r;
      o(function() {
        n.emit("data", x);
      }), r = "";
    }
  }
  function u(w, p) {
    nu(c, Ki(w, a, a ? 1 : 0), p);
  }
  function h() {
    if (n) {
      var w = r;
      o(function() {
        n.emit("data", w), n.emit("end"), n.readable = !1, n.emit("close");
      });
    }
  }
  function y(w) {
    var p = w.encoding || "UTF-8", x = { version: "1.0", encoding: p };
    w.standalone && (x.standalone = w.standalone), u({ "?xml": { _attr: x } }), r = r.replace("/>", "?>");
  }
  return o(function() {
    s = !1;
  }), t.declaration && y(t.declaration), e && e.forEach ? e.forEach(function(w, p) {
    var x;
    p + 1 === e.length && (x = h), u(w, x);
  }) : u(e, h), n ? (n.readable = !0, n) : r;
}
function Lx() {
  var e = Array.prototype.slice.call(arguments), t = {
    _elem: Ki(e)
  };
  return t.push = function(n) {
    if (!this.append)
      throw new Error("not assigned to a parent!");
    var r = this, i = this._elem.indent;
    nu(
      this.append,
      Ki(
        n,
        i,
        this._elem.icount + (i ? 1 : 0)
      ),
      function() {
        r.append(!0);
      }
    );
  }, t.close = function(n) {
    n !== void 0 && this.push(n), this.end && this.end();
  }, t;
}
function Px(e, t) {
  return new Array(t || 0).join(e || "");
}
function Ki(e, t, n) {
  n = n || 0;
  var r = Px(t, n), i, a = e, s = !1;
  if (typeof e == "object") {
    var o = Object.keys(e);
    if (i = o[0], a = e[i], a && a._elem)
      return a._elem.name = i, a._elem.icount = n, a._elem.indent = t, a._elem.indents = r, a._elem.interrupt = a, a._elem;
  }
  var c = [], u = [], h;
  function y(w) {
    var p = Object.keys(w);
    p.forEach(function(x) {
      c.push(Mx(x, w[x]));
    });
  }
  switch (typeof a) {
    case "object":
      if (a === null)
        break;
      a._attr && y(a._attr), a._cdata && u.push(
        ("<![CDATA[" + a._cdata).replace(/\]\]>/g, "]]]]><![CDATA[>") + "]]>"
      ), a.forEach && (h = !1, u.push(""), a.forEach(function(w) {
        if (typeof w == "object") {
          var p = Object.keys(w)[0];
          p == "_attr" ? y(w._attr) : u.push(Ki(
            w,
            t,
            n + 1
          ));
        } else
          u.pop(), h = !0, u.push(Fc(w));
      }), h || u.push(""));
      break;
    default:
      u.push(Fc(a));
  }
  return {
    name: i,
    interrupt: s,
    attributes: c,
    content: u,
    icount: n,
    indents: r,
    indent: t
  };
}
function nu(e, t, n) {
  if (typeof t != "object")
    return e(!1, t);
  var r = t.interrupt ? 1 : t.content.length;
  function i() {
    for (; t.content.length; ) {
      var s = t.content.shift();
      if (s !== void 0) {
        if (a(s))
          return;
        nu(e, s);
      }
    }
    e(!1, (r > 1 ? t.indents : "") + (t.name ? "</" + t.name + ">" : "") + (t.indent && !n ? `
` : "")), n && n();
  }
  function a(s) {
    return s.interrupt ? (s.interrupt.append = e, s.interrupt.end = i, s.interrupt = !1, e(!0), !0) : !1;
  }
  if (e(!1, t.indents + (t.name ? "<" + t.name : "") + (t.attributes.length ? " " + t.attributes.join(" ") : "") + (r ? t.name ? ">" : "" : t.name ? "/>" : "") + (t.indent && r > 1 ? `
` : "")), !r)
    return e(!1, t.indent ? `
` : "");
  a(t) || i();
}
function Mx(e, t) {
  return e + '="' + Fc(t) + '"';
}
$i.exports = Wx;
$i.exports.element = $i.exports.Element = Lx;
var zx = $i.exports;
const ze = /* @__PURE__ */ zf(zx), Rd = 0, Id = 32, jx = 32, qx = (e, t) => {
  const n = t.replace(/-/g, "");
  if (n.length !== jx)
    throw new Error(`Error: Cannot extract GUID from font filename: ${t}`);
  const i = n.replace(/(..)/g, "$1 ").trim().split(" ").map((c) => parseInt(c, 16));
  i.reverse();
  const s = e.slice(Rd, Id).map((c, u) => c ^ i[u % i.length]);
  return Buffer.concat([e.slice(0, Rd), s, e.slice(Id)]);
};
class Hx {
  // tslint:disable-next-line: no-object-literal-type-assertion
  format(t, n = { stack: [] }) {
    const r = t.prepForXml(n);
    if (r)
      return r;
    throw Error("XMLComponent did not format correctly");
  }
}
class Vx {
  replace(t, n, r) {
    let i = t;
    return n.forEach((a, s) => {
      i = i.replace(new RegExp(`{${a.fileName}}`, "g"), (r + s).toString());
    }), i;
  }
  getMediaData(t, n) {
    return n.Array.filter((r) => t.search(`{${r.fileName}}`) > 0);
  }
}
class Gx {
  replace(t, n) {
    let r = t;
    for (const i of n)
      r = r.replace(
        new RegExp(`{${i.reference}-${i.instance}}`, "g"),
        i.numId.toString()
      );
    return r;
  }
}
class Xx {
  constructor() {
    le(this, "formatter"), le(this, "imageReplacer"), le(this, "numberingReplacer"), this.formatter = new Hx(), this.imageReplacer = new Vx(), this.numberingReplacer = new Gx();
  }
  compile(t, n) {
    const r = new Bx(), i = this.xmlifyFile(t, n), a = new Map(Object.entries(i));
    for (const [, s] of a)
      if (Array.isArray(s))
        for (const o of s)
          r.file(o.path, o.data);
      else
        r.file(s.path, s.data);
    for (const s of t.Media.Array)
      s.type !== "svg" ? r.file(`word/media/${s.fileName}`, s.data) : (r.file(`word/media/${s.fileName}`, s.data), r.file(`word/media/${s.fallback.fileName}`, s.fallback.data));
    for (const { data: s, name: o, fontKey: c } of t.FontTable.fontOptionsWithKey) {
      const [u] = o.split(".");
      r.file(`word/fonts/${u}.odttf`, qx(s, c));
    }
    return r;
  }
  xmlifyFile(t, n) {
    const r = t.Document.Relationships.RelationshipCount + 1, i = ze(
      this.formatter.format(t.Document.View, {
        viewWrapper: t.Document,
        file: t,
        stack: []
      }),
      {
        indent: n,
        declaration: {
          standalone: "yes",
          encoding: "UTF-8"
        }
      }
    ), a = this.imageReplacer.getMediaData(i, t.Media);
    return {
      Relationships: {
        data: (() => (a.forEach((s, o) => {
          t.Document.Relationships.createRelationship(
            r + o,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            `media/${s.fileName}`
          );
        }), ze(
          this.formatter.format(t.Document.Relationships, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        )))(),
        path: "word/_rels/document.xml.rels"
      },
      Document: {
        data: (() => {
          const s = this.imageReplacer.replace(i, a, r);
          return this.numberingReplacer.replace(s, t.Numbering.ConcreteNumbering);
        })(),
        path: "word/document.xml"
      },
      Styles: {
        data: (() => {
          const s = ze(
            this.formatter.format(t.Styles, {
              viewWrapper: t.Document,
              file: t,
              stack: []
            }),
            {
              indent: n,
              declaration: {
                standalone: "yes",
                encoding: "UTF-8"
              }
            }
          );
          return this.numberingReplacer.replace(s, t.Numbering.ConcreteNumbering);
        })(),
        path: "word/styles.xml"
      },
      Properties: {
        data: ze(
          this.formatter.format(t.CoreProperties, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "docProps/core.xml"
      },
      Numbering: {
        data: ze(
          this.formatter.format(t.Numbering, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "word/numbering.xml"
      },
      FileRelationships: {
        data: ze(
          this.formatter.format(t.FileRelationships, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ),
        path: "_rels/.rels"
      },
      HeaderRelationships: t.Headers.map((s, o) => {
        const c = ze(
          this.formatter.format(s.View, {
            viewWrapper: s,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        );
        return this.imageReplacer.getMediaData(c, t.Media).forEach((h, y) => {
          s.Relationships.createRelationship(
            y,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            `media/${h.fileName}`
          );
        }), {
          data: ze(
            this.formatter.format(s.Relationships, {
              viewWrapper: s,
              file: t,
              stack: []
            }),
            {
              indent: n,
              declaration: {
                encoding: "UTF-8"
              }
            }
          ),
          path: `word/_rels/header${o + 1}.xml.rels`
        };
      }),
      FooterRelationships: t.Footers.map((s, o) => {
        const c = ze(
          this.formatter.format(s.View, {
            viewWrapper: s,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        );
        return this.imageReplacer.getMediaData(c, t.Media).forEach((h, y) => {
          s.Relationships.createRelationship(
            y,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            `media/${h.fileName}`
          );
        }), {
          data: ze(
            this.formatter.format(s.Relationships, {
              viewWrapper: s,
              file: t,
              stack: []
            }),
            {
              indent: n,
              declaration: {
                encoding: "UTF-8"
              }
            }
          ),
          path: `word/_rels/footer${o + 1}.xml.rels`
        };
      }),
      Headers: t.Headers.map((s, o) => {
        const c = ze(
          this.formatter.format(s.View, {
            viewWrapper: s,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ), u = this.imageReplacer.getMediaData(c, t.Media), h = this.imageReplacer.replace(c, u, 0);
        return {
          data: this.numberingReplacer.replace(h, t.Numbering.ConcreteNumbering),
          path: `word/header${o + 1}.xml`
        };
      }),
      Footers: t.Footers.map((s, o) => {
        const c = ze(
          this.formatter.format(s.View, {
            viewWrapper: s,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ), u = this.imageReplacer.getMediaData(c, t.Media), h = this.imageReplacer.replace(c, u, 0);
        return {
          data: this.numberingReplacer.replace(h, t.Numbering.ConcreteNumbering),
          path: `word/footer${o + 1}.xml`
        };
      }),
      ContentTypes: {
        data: ze(
          this.formatter.format(t.ContentTypes, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ),
        path: "[Content_Types].xml"
      },
      CustomProperties: {
        data: ze(
          this.formatter.format(t.CustomProperties, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "docProps/custom.xml"
      },
      AppProperties: {
        data: ze(
          this.formatter.format(t.AppProperties, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "docProps/app.xml"
      },
      FootNotes: {
        data: ze(
          this.formatter.format(t.FootNotes.View, {
            viewWrapper: t.FootNotes,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ),
        path: "word/footnotes.xml"
      },
      FootNotesRelationships: {
        data: ze(
          this.formatter.format(t.FootNotes.Relationships, {
            viewWrapper: t.FootNotes,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ),
        path: "word/_rels/footnotes.xml.rels"
      },
      Settings: {
        data: ze(
          this.formatter.format(t.Settings, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "word/settings.xml"
      },
      Comments: {
        data: ze(
          this.formatter.format(t.Comments, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "word/comments.xml"
      },
      FontTable: {
        data: ze(
          this.formatter.format(t.FontTable.View, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              standalone: "yes",
              encoding: "UTF-8"
            }
          }
        ),
        path: "word/fontTable.xml"
      },
      FontTableRelationships: {
        data: (() => ze(
          this.formatter.format(t.FontTable.Relationships, {
            viewWrapper: t.Document,
            file: t,
            stack: []
          }),
          {
            indent: n,
            declaration: {
              encoding: "UTF-8"
            }
          }
        ))(),
        path: "word/_rels/fontTable.xml.rels"
      }
    };
  }
}
const $x = {
  NONE: "",
  WITH_2_BLANKS: "  ",
  WITH_4_BLANKS: "    ",
  // eslint-disable-next-line @typescript-eslint/naming-convention
  WITH_TAB: "	"
}, Lr = (e) => e === !0 ? $x.WITH_2_BLANKS : e === !1 ? void 0 : e;
class Jp {
  static toString(t, n) {
    return vi(this, null, function* () {
      return yield this.compiler.compile(t, Lr(n)).generateAsync({
        type: "string",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
      });
    });
  }
  static toBuffer(t, n) {
    return vi(this, null, function* () {
      return yield this.compiler.compile(t, Lr(n)).generateAsync({
        type: "nodebuffer",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
      });
    });
  }
  static toBase64String(t, n) {
    return vi(this, null, function* () {
      return yield this.compiler.compile(t, Lr(n)).generateAsync({
        type: "base64",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
      });
    });
  }
  static toBlob(t, n) {
    return vi(this, null, function* () {
      return yield this.compiler.compile(t, Lr(n)).generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
      });
    });
  }
  static toStream(t, n) {
    const r = new qc.Stream();
    return this.compiler.compile(t, Lr(n)).generateAsync({
      type: "nodebuffer",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE"
    }).then((a) => {
      r.emit("data", a), r.emit("end");
    }), r;
  }
}
le(Jp, "compiler", new Xx());
function Kx(e, t) {
  const n = document.createElement("a");
  n.href = window.URL.createObjectURL(e), n.download = t, n.click(), window.URL.revokeObjectURL(n.href);
}
const Zx = {
  [qn.FIRST]: Hn.HEADING_1,
  [qn.SECOND]: Hn.HEADING_2,
  [qn.THIRD]: Hn.HEADING_3,
  [qn.FOURTH]: Hn.HEADING_4,
  [qn.FIFTH]: Hn.HEADING_5,
  [qn.SIXTH]: Hn.HEADING_6
};
function Xn(e) {
  return Math.round(e * 15);
}
function ss(e) {
  switch (e) {
    case yi.LEFT:
      return dt.LEFT;
    case yi.CENTER:
      return dt.CENTER;
    case yi.RIGHT:
      return dt.RIGHT;
    case yi.ALIGNMENT:
      return dt.JUSTIFIED;
    default:
      return;
  }
}
function Yx(e) {
  switch (e) {
    case so.TOP:
      return ns.TOP;
    case so.MIDDLE:
      return ns.CENTER;
    case so.BOTTOM:
      return ns.BOTTOM;
    default:
      return;
  }
}
function Jx(e) {
  const t = { style: Rn.SINGLE, size: 1, color: "#000000" }, n = { style: Rn.NIL, size: 0, color: "#000000" };
  switch (e) {
    case co.ALL:
      return {
        top: t,
        bottom: t,
        left: t,
        right: t,
        insideHorizontal: t,
        insideVertical: t
      };
    case co.EXTERNAL:
      return {
        top: t,
        bottom: t,
        left: t,
        right: t,
        insideHorizontal: n,
        insideVertical: n
      };
    case co.EMPTY:
      return {
        top: n,
        bottom: n,
        left: n,
        right: n,
        insideHorizontal: n,
        insideVertical: n
      };
    default:
      return;
  }
}
function Qx(e) {
  const t = e.match(/^data:image\/(png|jpg|jpeg|gif|bmp);base64,/i);
  if (t) {
    const n = t[1].toLowerCase();
    return n === "jpeg" ? "jpg" : n;
  }
  return "png";
}
function eD(e) {
  return e.replace(/^data:image\/[^;]+;base64,/, "");
}
function Fi(e) {
  var t, n;
  return e.type === vt.IMAGE ? new Pv({
    type: Qx(e.value),
    data: eD(e.value),
    transformation: {
      width: e.width,
      height: e.height
    }
  }) : e.type === vt.HYPERLINK ? new zp({
    children: [
      new sr({
        text: (t = e.valueList) == null ? void 0 : t.map((r) => r.value).join(""),
        style: "Hyperlink"
      })
    ],
    link: e.url
  }) : e.type === vt.TAB ? new sr({
    children: [new Hv()]
  }) : e.type === vt.LATEX ? new W2(e.value) : e.type === vt.PAGE_BREAK ? new Xv() : e.type === vt.CHECKBOX ? new Fx({
    checked: !!((n = e.checkbox) != null && n.value)
  }) : new sr({
    font: e.font,
    text: e.value,
    bold: e.bold,
    size: `${(e.size || 16) / 0.75}pt`,
    color: xc(e.color).hex() || "#000000",
    italics: e.italic,
    strike: e.strikeout,
    shading: e.highlight ? { fill: xc(e.highlight).hex() } : void 0,
    superScript: e.type === vt.SUPERSCRIPT,
    subScript: e.type === vt.SUBSCRIPT,
    underline: e.underline ? {} : void 0
  });
}
function ji(e) {
  var s, o, c, u;
  const t = [];
  let n = [], r, i;
  function a() {
    n.length && (t.push(new Mt({
      alignment: r,
      spacing: i,
      children: n
    })), n = [], r = void 0, i = void 0);
  }
  for (let h = 0; h < e.length; h++) {
    const y = e[h];
    if (y.type === vt.TITLE) {
      const w = h > 0 ? e[h - 1] : void 0;
      w && (!w.value || /\n$/.test(w.value)) && n.length && (w.value = w.value.replace(/\n$/, ""), w.value ? n[n.length - 1] = Fi(w) : n.length === 1 ? (n = [], r = void 0, i = void 0) : n = n.slice(0, -1)), a(), t.push(new Mt({
        heading: Zx[y.level],
        alignment: ss(y.rowFlex),
        spacing: y.rowMargin ? { line: Xn(y.rowMargin), lineRule: cr.AUTO } : void 0,
        children: ((s = y.valueList) == null ? void 0 : s.map((p) => Fi(p))) || []
      }));
    } else if (y.type === vt.LIST) {
      a();
      const w = ((o = y.valueList) == null ? void 0 : o.map((p) => p.value).join("").split(`
`).filter((p, x) => x !== 0 || p !== "").map((p, x) => new Mt({
        alignment: ss(y.rowFlex),
        spacing: y.rowMargin ? {
          line: Xn(y.rowMargin),
          lineRule: cr.AUTO
        } : void 0,
        children: [
          new sr({
            text: `${!y.listStyle || y.listStyle === uy.DECIMAL ? `${x + 1}. ` : "• "}${p}`
          })
        ]
      }))) || [];
      t.push(...w);
    } else if (y.type === vt.TABLE) {
      a();
      const { trList: w, colgroup: p, borderType: x } = y, d = [], v = p == null ? void 0 : p.map((l) => Xn(l.width));
      for (let l = 0; l < w.length; l++) {
        const b = w[l], _ = b.tdList, E = [];
        for (let C = 0; C < _.length; C++) {
          const R = _[C];
          E.push(new tu({
            columnSpan: R.colspan,
            rowSpan: R.rowspan,
            shading: R.backgroundColor ? { fill: xc(R.backgroundColor).hex() } : void 0,
            verticalAlign: Yx(R.verticalAlign),
            width: R.width ? { size: Xn(R.width), type: Gr.DXA } : void 0,
            children: ji(R.value) || []
          }));
        }
        d.push(new nw({
          height: b.height ? { value: Xn(b.height), rule: J2.ATLEAST } : void 0,
          children: E
        }));
      }
      t.push(new Y2({
        rows: d,
        width: {
          size: "100%",
          type: Gr.PERCENTAGE
        },
        columnWidths: v,
        borders: Jx(x)
      }));
    } else
      y.type === vt.SEPARATOR ? (a(), t.push(new Mt({
        border: {
          bottom: {
            color: y.color || "#000000",
            space: 1,
            style: (c = y.dashArray) != null && c.length ? Rn.DASHED : Rn.SINGLE,
            size: 6
          }
        },
        spacing: { after: 0, before: 0 },
        children: []
      }))) : y.type === vt.DATE ? n.push(...((u = y.valueList) == null ? void 0 : u.map((w) => Fi(w))) || []) : (/^\n/.test(y.value) && (a(), y.value = y.value.replace(/^\n/, "")), n.length === 0 && (r = ss(y.rowFlex), i = y.rowMargin ? { line: Xn(y.rowMargin), lineRule: cr.AUTO } : void 0), n.push(Fi(y)));
  }
  return n.length && t.push(new Mt({
    alignment: r,
    spacing: i,
    children: n
  })), t;
}
function tD(e) {
  return function(t) {
    const { fileName: n } = t, { data: { header: r, main: i, footer: a } } = e.getValue(), s = new Tx({
      sections: [
        {
          properties: { page: { margin: Object.fromEntries(['top', 'right', 'bottom', 'left'].map((key, index) => [key, Math.round(e.getOptions().margins[index] * 15)])), size: { width: Math.round(e.getOptions().width * 15), height: Math.round(e.getOptions().height * 15) } } },
          headers: {
            default: new Ux({
              children: ji(r || [])
            })
          },
          footers: {
            default: new Cx({
              children: ji(a || [])
            })
          },
          children: ji(i || [])
        }
      ]
    });
    return Jp.toBlob(s);
  };
}

export default function plugin(editor) { editor.command.executeExportDocx = tD(editor.command); }
