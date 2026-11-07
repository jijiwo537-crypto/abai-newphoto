function ii(w) {
  return w instanceof Int8Array || w instanceof Uint8Array || w instanceof Uint8ClampedArray;
}
class Qr {
  fileName;
  data;
  constructor(e, n) {
    this.fileName = e, this.data = n;
  }
}
const Jr = {
  XmlResourceFiles: {
    log: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE logmap [
<!ELEMENT logmap (log)+>
<!ELEMENT log (#PCDATA)>
<!ATTLIST log events CDATA #IMPLIED>
<!ATTLIST log output CDATA #IMPLIED>
<!ATTLIST log filename CDATA #IMPLIED>
<!ATTLIST log generations CDATA #IMPLIED>
<!ATTLIST log limit CDATA #IMPLIED>
<!ATTLIST log format CDATA #IMPLIED>
]>
<logmap>
  <log events="None"/>
  <log output="Debug"/>
  <log filename="Magick-%g.log"/>
  <log generations="3"/>
  <log limit="2000"/>
  <log format="%t %r %u %v %d %c[%p]: %m/%f/%l/%d
  %e"/>
</logmap>
`,
    policy: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policymap [
<!ELEMENT policymap (policy)*>
<!ATTLIST policymap xmlns CDATA #FIXED "">
<!ELEMENT policy EMPTY>
<!ATTLIST policy xmlns CDATA #FIXED "">
<!ATTLIST policy domain NMTOKEN #REQUIRED>
<!ATTLIST policy name NMTOKEN #IMPLIED>
<!ATTLIST policy pattern CDATA #IMPLIED>
<!ATTLIST policy rights NMTOKEN #IMPLIED>
<!ATTLIST policy stealth NMTOKEN #IMPLIED>
<!ATTLIST policy value CDATA #IMPLIED>
]>
<policymap>
  <policy domain="cache" name="shared-secret" value="passphrase"/>
  <policy domain="coder" rights="none" pattern="EPHEMERAL" />
  <policy domain="coder" rights="none" pattern="MVG" />
  <policy domain="coder" rights="none" pattern="MSL" />
  <policy domain="path" rights="none" pattern="@*" />
  <policy domain="path" rights="none" pattern="|*" />
</policymap>
`
  }
};
class ar {
  constructor() {
    this.log = new Qr("log.xml", Jr.XmlResourceFiles.log), this.policy = new Qr("policy.xml", Jr.XmlResourceFiles.policy);
  }
  /**
   * Gets the default configuration.
   */
  static default = new ar();
  /**
   * Gets all the configuration files.
   */
  *all() {
    yield this.log, yield this.policy;
  }
  /// <summary>
  /// Gets the log configuration.
  /// </summary>
  log;
  /// <summary>
  /// Gets the policy configuration.
  /// </summary>
  policy;
}
class er {
  /**
   * Initializes a new instance of the {@link MagickDefine} class.
   * @param format
   * @param name The name of the define.
   * @param value The value of the define.
   */
  constructor(e, n, t) {
    this.format = e, this.name = n, this.value = t;
  }
  /**
   * Gets the format to set the define for.
   */
  format;
  /**
   * Gets the name of the define.
   */
  name;
  /**
   * Gets the value of the define.
   */
  value;
}
class to {
  format;
  constructor(e) {
    this.format = e;
  }
  createDefine(e, n) {
    return typeof n == "boolean" ? new er(this.format, e, n ? "true" : "false") : typeof n == "string" ? new er(this.format, e, n) : new er(this.format, e, n.toString());
  }
  hasValue(e) {
    return e != null;
  }
}
class de {
  _scaleX;
  _scaleY;
  _shearX;
  _shearY;
  _translateX;
  _translateY;
  constructor(e = 1, n = 1, t = 0, _ = 0, g = 0, p = 0) {
    this._scaleX = e, this._scaleY = n, this._shearX = t, this._shearY = _, this._translateX = g, this._translateY = p;
  }
  get scaleX() {
    return this._scaleX;
  }
  get scaleY() {
    return this._scaleY;
  }
  get shearX() {
    return this._shearX;
  }
  get shearY() {
    return this._shearY;
  }
  get translateX() {
    return this._translateX;
  }
  get translateY() {
    return this._translateY;
  }
  draw(e) {
    e.affine(this._scaleX, this._scaleY, this._shearX, this._shearY, this._translateX, this._translateY);
  }
  reset() {
    this._scaleX = 1, this._scaleY = 1, this._shearX = 0, this._shearY = 0, this._translateX = 0, this._translateY = 0;
  }
  transformOrigin(e, n) {
    const t = new de();
    t._translateX = e, t._translateY = n, this.transform(t);
  }
  transformRotation(e) {
    const n = new de();
    n._scaleX = Math.cos(de.normalizeAngleToRadians(e)), n._scaleY = Math.cos(de.normalizeAngleToRadians(e)), n._shearX = -Math.sin(de.normalizeAngleToRadians(e)), n._shearY = Math.sin(de.normalizeAngleToRadians(e)), this.transform(n);
  }
  transformScale(e, n) {
    const t = new de();
    t._scaleX = e, t._scaleY = n, this.transform(t);
  }
  transformSkewX(e) {
    const n = new de();
    n._shearX = Math.tan(de.normalizeAngleToRadians(e)), this.transform(n);
  }
  transformSkewY(e) {
    const n = new de();
    n._shearY = Math.tan(de.normalizeAngleToRadians(e)), this.transform(n);
  }
  static normalizeAngleToRadians(e) {
    const t = e / 360;
    let _ = Math.round(t);
    return Math.abs(t - _) === 0.5 && _ % 2 !== 0 && (_ = t > 0 ? _ - 1 : _ + 1), Math.PI * (e - _ * 360) / 180;
  }
  transform(e) {
    const n = this._scaleX, t = this._scaleY, _ = this._shearX, g = this._shearY, p = this._translateX, m = this._translateY;
    this._scaleX = n * e._scaleX + g * e._shearX, this._scaleY = _ * e._shearY + t * e._scaleY, this._shearX = _ * e._scaleX + t * e._shearX, this._shearY = n * e._shearY + g * e._scaleY, this._translateX = n * e._translateX + g * e._translateY + p, this._translateY = _ * e._translateX + t * e._translateY + m;
  }
}
class ro {
  _color;
  /**
   * Initializes a new instance of the {@link DrawableBorderColor} class.
   * @param color The color to use.
   */
  constructor(e) {
    this._color = e;
  }
  /**
   * Gets the color to use.
   */
  get color() {
    return this._color;
  }
  draw(e) {
    e.borderColor(this._color);
  }
}
class io {
  _x;
  _y;
  _paintMethod;
  /**
   * Initializes a new instance of the {@link DrawableColor} class.
   * @param x The X coordinate.
   * @param  y The Y coordinate.
   * @param paintMethod The paint method to use.
   */
  constructor(e, n, t) {
    this._x = e, this._y = n, this._paintMethod = t;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  /**
   * Gets the paint method to use.
   */
  get paintMethod() {
    return this._paintMethod;
  }
  draw(e) {
    e.color(this._x, this._y, this._paintMethod);
  }
}
class no {
  _color;
  /**
   * Initializes a new instance of the {@link DrawableFillColor} class.
   * @param color The color to use.
   */
  constructor(e) {
    this._color = e;
  }
  /**
   * Gets the color to use.
   */
  get color() {
    return this._color;
  }
  draw(e) {
    e.fillColor(this._color);
  }
}
class ao {
  _opacity;
  /**
   * Initializes a new instance of the {@link DrawableFillOpacity} class.
   * @param opacity The opacity.
   */
  constructor(e) {
    this._opacity = e;
  }
  /**
   * Gets the opacity.
   */
  get opacity() {
    return this._opacity;
  }
  draw(e) {
    e.fillOpacity(this._opacity.toDouble() / 100);
  }
}
class so {
  _fillRule;
  /**
   * Initializes a new instance of the {@link DrawableFillRule} class.
   * @param fillRule The rule to use when filling drawn objects.
   */
  constructor(e) {
    this._fillRule = e;
  }
  /**
   * Gets the rule to use when filling drawn objects.
   */
  get fillRule() {
    return this._fillRule;
  }
  draw(e) {
    e.fillRule(this._fillRule);
  }
}
class oo {
  _pointSize;
  /**
   * Initializes a new instance of the {@link DrawableFontPointSize} class.
   * @param pointSize The point size.
   */
  constructor(e) {
    this._pointSize = e;
  }
  /**
   * Gets the point size.
   */
  get pointSize() {
    return this._pointSize;
  }
  draw(e) {
    e.fontPointSize(this._pointSize);
  }
}
class _o {
  /**
   * Initializes a new instance of the {@link LogEvent} class.
   * @param eventType - The type of the log message.
   * @param message - The log message.
   */
  constructor(e, n) {
    this.eventType = e, this.message = n ?? "";
  }
  /**
   * Gets the type of the log message.
   */
  eventType;
  /**
   * Gets the log message.
   */
  message;
}
const co = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Enable the image's transparency channel. Note that normally Set should be used instead of
   * this, unless you specifically need to preserve the existing (but specifically turned Off)
   * transparency channel.
   */
  Activate: 1,
  /**
   * Associate the alpha channel with the image.
   */
  Associate: 2,
  /**
   * Set any fully-transparent pixel to the background color, while leaving it fully-transparent.
   * This can make some image file formats, such as PNG, smaller as the RGB values of transparent
   * pixels are more uniform, and thus can compress better.
   */
  Background: 3,
  /**
   * Turns 'On' the alpha/matte channel, then copies the grayscale intensity of the image, into
   * the alpha channel, converting a grayscale mask into a transparent shaped mask ready to be
   * colored appropriately. The color channels are not modified.
   */
  Copy: 4,
  /**
   * Disables the image's transparency channel. This does not delete or change the existing data,
   * it just turns off the use of that data.
   */
  Deactivate: 5,
  /**
   * Discrete.
   */
  Discrete: 6,
  /**
   * Disassociate the alpha channel from the image.
   */
  Disassociate: 7,
  /**
   * Copies the alpha channel values into all the color channels and turns 'Off' the image's
   * transparency, so as to generate a grayscale mask of the image's shape. The alpha channel
   * data is left intact just deactivated. This is the inverse of 'Copy'.
   */
  Extract: 8,
  /**
   * Off.
   */
  Off: 9,
  /**
  * On.
  */
  On: 10,
  /**
   * Enables the alpha/matte channel and forces it to be fully opaque.
   */
  Opaque: 11,
  /**
   * Composite the image over the background color.
   */
  Remove: 12,
  /**
   * Activates the alpha/matte channel. If it was previously turned off then it also
   * resets the channel to opaque. If the image already had the alpha channel turned on,
   * it will have no effect.
   */
  Set: 13,
  /**
   * As per 'Copy' but also colors the resulting shape mask with the current background color.
   * That is the RGB color channels is replaced, with appropriate alpha shape.
   */
  Shape: 14,
  /**
   * Activates the alpha/matte channel and forces it to be fully transparent. This effectively
   * creates a fully transparent image the same size as the original and with all its original
   * RGB data still intact, but fully transparent.
  */
  Transparent: 15,
  /**
   * Removes the alpha channel when the alpha value is opaque for all pixels.
   */
  OffIfOpaque: 16
}, G = {
  /**
   * Red.
   */
  Red: 0,
  /**
   * Cyan.
   */
  Cyan: 0,
  /**
   * Gray.
   */
  Gray: 0,
  /**
   * Green.
   */
  Green: 1,
  /**
   * Magenta.
   */
  Magenta: 1,
  /**
   * Blue.
   */
  Blue: 2,
  /**
   * Yellow.
   */
  Yellow: 2,
  /**
   * Black.
   */
  Black: 3,
  /**
   * Alpha.
   */
  Alpha: 4,
  /**
   * Index.
   */
  Index: 5,
  /**
   * Meta 0.
   */
  Meta0: 10,
  /**
   * Meta 1.
   */
  Meta1: 11,
  /**
   * Meta 2.
   */
  Meta2: 12,
  /**
   * Meta 3.
   */
  Meta3: 13,
  /**
   * Meta 4.
   */
  Meta4: 14,
  /**
   * Meta 5.
   */
  Meta5: 15,
  /**
   * Meta 6.
   */
  Meta6: 16,
  /**
   * Meta 7.
   */
  Meta7: 17,
  /**
   * Meta 8.
   */
  Meta8: 18,
  /**
   * Meta 9.
   */
  Meta9: 19,
  /**
   * Meta 10.
   */
  Meta10: 20,
  /**
   * Meta 11.
   */
  Meta11: 21,
  /**
   * Meta 12.
   */
  Meta12: 22,
  /**
   * Meta 13.
   */
  Meta13: 23,
  /**
   * Meta 14.
   */
  Meta14: 24,
  /**
   * Meta 15.
   */
  Meta15: 25,
  /**
   * Meta 16.
   */
  Meta16: 26,
  /**
   * Meta 17.
   */
  Meta17: 27,
  /**
   * Meta 18.
   */
  Meta18: 28,
  /**
   * Meta 19.
   */
  Meta19: 29,
  /**
   * Meta 20.
   */
  Meta20: 30,
  /**
   * Meta 21.
   */
  Meta21: 31,
  /**
   * Meta 22.
   */
  Meta22: 32,
  /**
   * Meta 23.
   */
  Meta23: 33,
  /**
   * Meta 24.
   */
  Meta24: 34,
  /**
   * Meta 25.
   */
  Meta25: 35,
  /**
   * Meta 26.
   */
  Meta26: 36,
  /**
   * Meta 27.
   */
  Meta27: 37,
  /**
   * Meta 28.
   */
  Meta28: 38,
  /**
   * Meta 29.
   */
  Meta29: 39,
  /**
   * Meta 30.
   */
  Meta30: 40,
  /**
   * Meta 31.
   */
  Meta31: 41,
  /**
   * Meta 32.
   */
  Meta32: 42,
  /**
   * Meta 33.
   */
  Meta33: 43,
  /**
   * Meta 34.
   */
  Meta34: 44,
  /**
   * Meta 35.
   */
  Meta35: 45,
  /**
   * Meta 36.
   */
  Meta36: 46,
  /**
   * Meta 37.
   */
  Meta37: 47,
  /**
   * Meta 38.
   */
  Meta38: 48,
  /**
   * Meta 39.
   */
  Meta39: 49,
  /**
   * Meta 40.
   */
  Meta40: 50,
  /**
   * Meta 41.
   */
  Meta41: 51,
  /**
   * Meta 42.
   */
  Meta42: 52,
  /**
   * Meta 43.
   */
  Meta43: 53,
  /**
   * Meta 44.
   */
  Meta44: 54,
  /**
   * Meta 45.
   */
  Meta45: 55,
  /**
   * Meta 46.
   */
  Meta46: 56,
  /**
   * Meta 47.
   */
  Meta47: 57,
  /**
   * Meta 48.
   */
  Meta48: 58,
  /**
   * Meta 49.
   */
  Meta49: 59,
  /**
   * Meta 50.
   */
  Meta50: 60,
  /**
   * Meta 51.
   */
  Meta51: 61,
  /**
   * Meta 52.
   */
  Meta52: 62,
  /**
   * Composite.
   */
  Composite: 64
}, X = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Red.
   */
  Red: 1,
  /**
   * Gray.
   */
  Gray: 1,
  /**
   * Cyan.
   */
  Cyan: 1,
  /**
   * Green.
   */
  Green: 2,
  /**
   * Magenta.
   */
  Magenta: 2,
  /**
   * Blue.
   */
  Blue: 4,
  /**
   * Yellow.
   */
  Yellow: 4,
  /**
   * Black.
   */
  Black: 8,
  /**
   * Alpha.
   */
  Alpha: 16,
  /**
   * Opacity.
   */
  Opacity: 16,
  /**
   * Index.
   */
  Index: 32,
  /**
   * Composite.
   */
  Composite: 31,
  /**
   * TrueAlpha.
   */
  TrueAlpha: 256,
  /**
   * RGB.
   */
  get RGB() {
    return this.Red | this.Green | this.Blue;
  },
  /**
   * CMYK.
   */
  get CMYK() {
    return this.Cyan | this.Magenta | this.Yellow | this.Black;
  },
  /**
   * CMYKA.
   */
  get CMYKA() {
    return this.Cyan | this.Magenta | this.Yellow | this.Black | this.Alpha;
  },
  /**
   * Meta 0
   */
  Meta0: 1 << G.Meta0,
  /**
   * Meta 1
   */
  Meta1: 1 << G.Meta1,
  /**
   * Meta 2
   */
  Meta2: 1 << G.Meta2,
  /**
   * Meta 3
   */
  Meta3: 1 << G.Meta3,
  /**
   * Meta 4
   */
  Meta4: 1 << G.Meta4,
  /**
   * Meta 5
   */
  Meta5: 1 << G.Meta5,
  /**
   * Meta 6
   */
  Meta6: 1 << G.Meta6,
  /**
   * Meta 7
   */
  Meta7: 1 << G.Meta7,
  /**
   * Meta 8
   */
  Meta8: 1 << G.Meta8,
  /**
   * Meta 9
   */
  Meta9: 1 << G.Meta9,
  /**
   * Meta 10
   */
  Meta10: 1 << G.Meta10,
  /**
   * Meta 11
   */
  Meta11: 1 << G.Meta11,
  /**
   * Meta 12
   */
  Meta12: 1 << G.Meta12,
  /**
   * Meta 13
   */
  Meta13: 1 << G.Meta13,
  /**
   * Meta 14
   */
  Meta14: 1 << G.Meta14,
  /**
   * Meta 15
   */
  Meta15: 1 << G.Meta15,
  /**
   * Meta 16
   */
  Meta16: 1 << G.Meta16,
  /**
   * Meta 17
   */
  Meta17: 1 << G.Meta17,
  /**
   * Meta 18
   */
  Meta18: 1 << G.Meta18,
  /**
   * Meta 19
   */
  Meta19: 1 << G.Meta19,
  /**
   * Meta 20
   */
  Meta20: 1 << G.Meta20,
  /**
   * Meta 21
   */
  Meta21: 1 << G.Meta21,
  /**
   * All.
   */
  All: 134217727
};
class lo {
  constructor(e, n, t, _) {
    this.red = e, this.green = n, this.blue = t, this.white = _;
  }
  /**
   * Gets the chromaticity red primary point.
   */
  red;
  /**
   * Gets the chromaticity green primary point.
   */
  green;
  /**
   * Gets the chromaticity blue primary point.
   */
  blue;
  /**
   * Gets the chromaticity white primary point.
   */
  white;
}
const T = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * CMY.
   */
  CMY: 1,
  /**
   * CMYK.
   */
  CMYK: 2,
  /**
   * Gray.
   */
  Gray: 3,
  /**
   * HCL.
   */
  HCL: 4,
  /**
   * HCLp.
   */
  HCLp: 5,
  /**
   * HSB.
   */
  HSB: 6,
  /**
   * HSI.
   */
  HSI: 7,
  /**
   * HSL.
   */
  HSL: 8,
  /**
   * HSV.
   */
  HSV: 9,
  /**
   * HWB.
   */
  HWB: 10,
  /**
   * Lab
   */
  Lab: 11,
  /**
   * LCH.
   */
  LCH: 12,
  /**
   * LCHab.
   */
  LCHab: 13,
  /**
   * LCHuv.
   */
  LCHuv: 14,
  /**
   * Log.
   */
  Log: 15,
  /**
   * LMS.
   */
  LMS: 16,
  /**
   * Luv.
   */
  Luv: 17,
  /**
   * OHTA.
   */
  OHTA: 18,
  /**
   * Rec601YCbCr.
   */
  Rec601YCbCr: 19,
  /**
   * Rec709YCbCr.
   */
  Rec709YCbCr: 20,
  /**
   * RGB.
   */
  RGB: 21,
  /**
   * scRGB.
   */
  scRGB: 22,
  /**
   * sRGB.
   */
  sRGB: 23,
  /**
   * Transparent.
   */
  Transparent: 24,
  /**
   * XyY.
   */
  XyY: 25,
  /**
   * XYZ.
   */
  XYZ: 26,
  /**
   * YCbCr.
   */
  YCbCr: 27,
  /**
   * YCC.
   */
  YCC: 28,
  /**
   * YDbDr.
   */
  YDbDr: 29,
  /**
   * YIQ.
   */
  YIQ: 30,
  /**
   * YPbPr.
   */
  YPbPr: 31,
  /**
   * YUV.
   */
  YUV: 32,
  /**
   * LinearGray.
   */
  LinearGray: 33,
  /**
   * Jzazbz.
   */
  Jzazbz: 34,
  /**
   * DisplayP3.
   */
  DisplayP3: 35,
  /**
   * Adobe98.
   */
  Adobe98: 36,
  /**
   * ProPhoto.
   */
  ProPhoto: 37,
  /**
   * Oklab.
   */
  Oklab: 38,
  /**
   * Oklch.
   */
  Oklch: 39,
  /**
   * CAT02LMS.
   */
  CAT02LMSC: 40
}, Or = {
  [T.Undefined]: "Undefined",
  [T.CMY]: "CMY",
  [T.CMYK]: "CMYK",
  [T.Gray]: "Gray",
  [T.HCL]: "HCL",
  [T.HCLp]: "HCLp",
  [T.HSB]: "HSB",
  [T.HSI]: "HSI",
  [T.HSL]: "HSL",
  [T.HSV]: "HSV",
  [T.HWB]: "HWB",
  [T.Lab]: "Lab",
  [T.LCH]: "LCH",
  [T.LCHab]: "LCHab",
  [T.LCHuv]: "LCHuv",
  [T.Log]: "Log",
  [T.LMS]: "LMS",
  [T.Luv]: "Luv",
  [T.OHTA]: "OHTA",
  [T.Rec601YCbCr]: "Rec601YCbCr",
  [T.Rec709YCbCr]: "Rec709YCbCr",
  [T.RGB]: "RGB",
  [T.scRGB]: "scRGB",
  [T.sRGB]: "sRGB",
  [T.Transparent]: "Transparent",
  [T.XyY]: "XyY",
  [T.XYZ]: "XYZ",
  [T.YCbCr]: "YCbCr",
  [T.YCC]: "YCC",
  [T.YDbDr]: "YDbDr",
  [T.YIQ]: "YIQ",
  [T.YPbPr]: "YPbPr",
  [T.YUV]: "YUV",
  [T.LinearGray]: "LinearGray",
  [T.Jzazbz]: "Jzazbz",
  [T.DisplayP3]: "DisplayP3",
  [T.Adobe98]: "Adobe98",
  [T.ProPhoto]: "ProPhoto",
  [T.Oklab]: "Oklab",
  [T.Oklch]: "Oklch",
  [T.CAT02LMSC]: "CAT02LMS"
};
class uo {
  colorSpace = T.Undefined;
  copyright = null;
  description = null;
  manufacturer = null;
  model = null;
}
class ho {
  _data;
  _index;
  constructor(e) {
    this._data = e, this._index = 0, this.isLittleEndian = !1;
  }
  get index() {
    return this._index;
  }
  isLittleEndian;
  readLong() {
    return this.canRead(4) ? this.isLittleEndian ? this.readLongLSB() : this.readLongMSB() : null;
  }
  readString(e) {
    if (e == 0)
      return "";
    if (!this.canRead(e))
      return null;
    let t = new TextDecoder("utf-8").decode(this._data.subarray(this._index, this._index + e));
    const _ = t.indexOf("\0");
    return _ != -1 && (t = t.substring(0, _)), this._index += e, t;
  }
  seek(e) {
    return e >= this._data.length ? !1 : (this._index = e, !0);
  }
  skip(e) {
    return this._index + e >= this._data.length ? !1 : (this._index += e, !0);
  }
  canRead(e) {
    return e > this._data.length ? !1 : this._index + e <= this._data.length;
  }
  readLongLSB() {
    let e = this._data[this._index];
    return e |= this._data[this._index + 1] << 8, e |= this._data[this._index + 2] << 16, e |= this._data[this._index + 3] << 24, this._index += 4, e;
  }
  readLongMSB() {
    let e = this._data[this._index] << 24;
    return e |= this._data[this._index + 1] << 16, e |= this._data[this._index + 2] << 8, e |= this._data[this._index + 3], this._index += 4, e;
  }
}
class sr {
  _data = new uo();
  _reader;
  constructor(e) {
    this._reader = new ho(e);
  }
  static read(e) {
    const n = new sr(e);
    return n.readColorSpace(), n.readTagTable(), n._data;
  }
  readColorSpace() {
    this._reader.seek(16);
    const e = this._reader.readString(4);
    e != null && (this._data.colorSpace = this.determineColorSpace(e.trimEnd()));
  }
  determineColorSpace(e) {
    switch (e) {
      case "CMY":
        return T.CMY;
      case "CMYK":
        return T.CMYK;
      case "GRAY":
        return T.Gray;
      case "HSL":
        return T.HSL;
      case "HSV":
        return T.HSV;
      case "Lab":
        return T.Lab;
      case "Luv":
        return T.Luv;
      case "RGB":
        return T.sRGB;
      case "XYZ":
        return T.XYZ;
      case "YCbr":
        return T.YCbCr;
      default:
        return T.Undefined;
    }
  }
  readTagTable() {
    if (!this._reader.seek(128))
      return;
    const e = this._reader.readLong();
    if (e != null)
      for (let n = 0; n < e; n++)
        switch (this._reader.readLong()) {
          case 1668313716:
            this._data.copyright = this.readTag();
            break;
          case 1684370275:
            this._data.description = this.readTag();
            break;
          case 1684893284:
            this._data.manufacturer = this.readTag();
            break;
          case 1684890724:
            this._data.model = this.readTag();
            break;
          default:
            this._reader.skip(8);
            break;
        }
  }
  readTag() {
    const e = this._reader.readLong(), n = this._reader.readLong();
    if (e === null || n === null)
      return null;
    const t = this._reader.index;
    if (!this._reader.seek(e))
      return null;
    const _ = this.readTagValue(n);
    return this._reader.seek(t), _;
  }
  readTagValue(e) {
    switch (this._reader.readString(4)) {
      case "desc":
        return this.readTextDescriptionTypeValue();
      case "text":
        return this.readTextTypeValue(e);
      default:
        return null;
    }
  }
  readTextDescriptionTypeValue() {
    if (!this._reader.skip(4))
      return null;
    const e = this._reader.readLong();
    return e == null ? null : this._reader.readString(e);
  }
  readTextTypeValue(e) {
    return this._reader.skip(4) ? this._reader.readString(e) : null;
  }
}
class ni {
  constructor(e, n) {
    this.name = e, this.data = n;
  }
  name;
  data;
}
class go extends ni {
  _data;
  constructor(e) {
    super("icc", e);
  }
  /**
   * Gets the color space of the profile.
   */
  get colorSpace() {
    return this.initialize(), this._data.colorSpace;
  }
  /**
   * Gets the copyright of the profile.
   */
  get copyright() {
    return this.initialize(), this._data.copyright;
  }
  /**
   * Gets the description of the profile.
   */
  get description() {
    return this.initialize(), this._data.description;
  }
  /**
   * Gets the manufacturer of the profile.
   */
  get manufacturer() {
    return this.initialize(), this._data.manufacturer;
  }
  /**
   * Gets the model of the profile.
   */
  get model() {
    return this.initialize(), this._data.model;
  }
  initialize() {
    this._data || (this._data = sr.read(this.data));
  }
}
const Zr = {
  /**
   * High resolution (double).
   */
  HighRes: 0,
  /**
   * Quantum.
   */
  Quantum: 1
};
class or {
  constructor(e, n) {
    this.distortion = e, this.difference = n;
  }
  /**
   * Gets the difference image.
   */
  difference;
  /**
   * Gets the distortion.
   */
  distortion;
  /** @internal */
  static _create(e, n) {
    return new or(e, n);
  }
}
class fo {
  constructor(e) {
    this.metric = e;
  }
  /**
   * Gets the distortion method to use.
   */
  metric;
  /**
   * Gets or sets the color that emphasize pixel differences.
   */
  highlightColor;
  /**
   * Gets or sets the color that de-emphasize pixel differences.
   */
  lowlightColor;
  /**
   * Gets or sets the color of pixels that are inside the read mask.
   */
  masklightColor;
  /** @internal */
  _setArtifacts(e) {
    this.highlightColor !== void 0 && e.setArtifact("compare:highlight-color", this.highlightColor), this.lowlightColor !== void 0 && e.setArtifact("compare:lowlight-color", this.lowlightColor), this.masklightColor !== void 0 && e.setArtifact("compare:masklight-color", this.masklightColor);
  }
}
const tr = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Alpha.
   */
  Alpha: 1,
  /**
   * Atop.
   */
  Atop: 2,
  /**
   * Blend.
   */
  Blend: 3,
  /**
   * Blur.
   */
  Blur: 4,
  /**
   * Bumpmap.
   */
  Bumpmap: 5,
  /**
   * Change mask.
   */
  ChangeMask: 6,
  /**
   * Clear.
   */
  Clear: 7,
  /**
   * Color burn.
   */
  ColorBurn: 8,
  /**
   * Color dodge.
   */
  ColorDodge: 9,
  /**
   * Colorize.
   */
  Colorize: 10,
  /**
   * Copy black.
   */
  CopyBlack: 11,
  /**
   * Copy blue.
   */
  CopyBlue: 12,
  /**
   * Copy.
   */
  Copy: 13,
  /**
   * Copy cyan.
   */
  CopyCyan: 14,
  /**
   * Copy green.
   */
  CopyGreen: 15,
  /**
   * Copy magenta.
   */
  CopyMagenta: 16,
  /**
   * Copy alpha.
   */
  CopyAlpha: 17,
  /**
   * Copy red.
   */
  CopyRed: 18,
  /**
   * Copy yellow.
   */
  CopyYellow: 19,
  /**
   * Darken.
   */
  Darken: 20,
  /**
   * Darken intensity.
   */
  DarkenIntensity: 21,
  /**
   * Difference.
   */
  Difference: 22,
  /**
   * Displace.
   */
  Displace: 23,
  /**
   * Dissolve.
   */
  Dissolve: 24,
  /**
   * Distort.
   */
  Distort: 25,
  /**
   * Divide dst.
   */
  DivideDst: 26,
  /**
   * Divide src.
   */
  DivideSrc: 27,
  /**
   * Dst atop.
   */
  DstAtop: 28,
  /**
   * Dst.
   */
  Dst: 29,
  /**
   * Dst in.
   */
  DstIn: 30,
  /**
   * Dst out.
   */
  DstOut: 31,
  /**
   * Dst over.
   */
  DstOver: 32,
  /**
   * Exclusion.
   */
  Exclusion: 33,
  /**
   * Hard light.
   */
  HardLight: 34,
  /**
   * Hard mix.
   */
  HardMix: 35,
  /**
   * Hue.
   */
  Hue: 36,
  /**
   * In.
   */
  In: 37,
  /**
   * Intensity.
   */
  Intensity: 38,
  /**
   * Lighten.
   */
  Lighten: 39,
  /**
   * Lighten intensity.
   */
  LightenIntensity: 40,
  /**
   * Linear burn.
   */
  LinearBurn: 41,
  /**
   * Linear dodge.
   */
  LinearDodge: 42,
  /**
   * Linear light.
   */
  LinearLight: 43,
  /**
   * Luminize.
   */
  Luminize: 44,
  /**
   * Mathematics.
   */
  Mathematics: 45,
  /**
   * Minus dst.
   */
  MinusDst: 46,
  /**
   * Minus src.
   */
  MinusSrc: 47,
  /**
   * Modulate.
   */
  Modulate: 48,
  /**
   * Modulus add.
   */
  ModulusAdd: 49,
  /**
   * Modulus subtract.
   */
  ModulusSubtract: 50,
  /**
   * Multiply.
   */
  Multiply: 51,
  /**
   * No.
   */
  No: 52,
  /**
   * Out.
   */
  Out: 53,
  /**
   * Over.
   */
  Over: 54,
  /**
   * Overlay.
   */
  Overlay: 55,
  /**
   * Pegtop light.
   */
  PegtopLight: 56,
  /**
   * Pin light.
   */
  PinLight: 57,
  /**
   * Plus.
   */
  Plus: 58,
  /**
   * Replace.
   */
  Replace: 59,
  /**
   * Saturate.
   */
  Saturate: 60,
  /**
   * Screen.
   */
  Screen: 61,
  /**
   * Soft light.
   */
  SoftLight: 62,
  /**
   * Src atop.
   */
  SrcAtop: 63,
  /**
   * Src.
   */
  Src: 64,
  /**
   * Src in.
   */
  SrcIn: 65,
  /**
   * Src out.
   */
  SrcOut: 66,
  /**
   * Src over.
   */
  SrcOver: 67,
  /**
   * Threshold.
   */
  Threshold: 68,
  /**
   * Vivid light.
   */
  VividLight: 69,
  /**
   * Xor.
   */
  Xor: 70,
  /**
   * Stereo.
   */
  Stereo: 71,
  /**
   * Freeze.
   */
  Freeze: 72,
  /**
   * Interpolate.
   */
  Interpolate: 73,
  /**
   * Negate.
   */
  Negate: 74,
  /**
   * Reflect.
   */
  Reflect: 75,
  /**
   * Soft burn.
   */
  SoftBurn: 76,
  /**
   * Soft dodge.
   */
  SoftDodge: 77,
  /**
   * Stamp.
   */
  Stamp: 78,
  /**
   * Root-mean-square error.
   */
  RMSE: 79,
  /**
   * Saliency blend.
   */
  SaliencyBlend: 80,
  /**
   * Seamless blend.
   */
  SeamlessBlend: 81
}, rr = {
  /**
   * Warning.
   */
  Warning: 300,
  /**
   * Resource limit warning.
   */
  ResourceLimitWarning: 300,
  /**
   * Type warning.
   */
  TypeWarning: 305,
  /**
   * Option warning.
   */
  OptionWarning: 310,
  /**
   * Delegate warning.
   */
  DelegateWarning: 315,
  /**
   * Missing delegate warning.
   */
  MissingDelegateWarning: 320,
  /**
   * Corrupt image warning.
   */
  CorruptImageWarning: 325,
  /**
   * File open warning.
   */
  FileOpenWarning: 330,
  /**
   * Blob warning.
   */
  BlobWarning: 335,
  /**
   * Stream warning.
   */
  StreamWarning: 340,
  /**
   * Cache warning.
   */
  CacheWarning: 345,
  /**
   * Coder warning.
   */
  CoderWarning: 350,
  /**
   * Filter warning.
   */
  FilterWarning: 352,
  /**
   * Module warning.
   */
  ModuleWarning: 355,
  /**
   * Draw warning.
   */
  DrawWarning: 360,
  /**
   * Image warning.
   */
  ImageWarning: 365,
  /**
   * Wand warning.
   */
  WandWarning: 370,
  /**
   * Random warning.
   */
  RandomWarning: 375,
  /**
   * X server warning.
   */
  XServerWarning: 380,
  /**
   * Monitor warning.
   */
  MonitorWarning: 385,
  /**
   * Registry warning.
   */
  RegistryWarning: 390,
  /**
   * Configure warning.
   */
  ConfigureWarning: 395,
  /**
   * Policy warning.
   */
  PolicyWarning: 399,
  /**
   * Error.
   */
  Error: 400,
  /**
   * Resource limit error.
   */
  ResourceLimitError: 400,
  /**
   * Type error.
   */
  TypeError: 405,
  /**
   * Option error.
   */
  OptionError: 410,
  /**
   * Delegate error.
   */
  DelegateError: 415,
  /**
   * Missing delegate error.
   */
  MissingDelegateError: 420,
  /**
   * Corrupt image error.
   */
  CorruptImageError: 425,
  /**
   * File open error.
   */
  FileOpenError: 430,
  /**
   * Blob error.
   */
  BlobError: 435,
  /**
   * Stream error.
   */
  StreamError: 440,
  /**
   * Cache error.
   */
  CacheError: 445,
  /**
   * Coder error.
   */
  CoderError: 450,
  /**
   * Filter error.
   */
  FilterError: 452,
  /**
   * Module error.
   */
  ModuleError: 455,
  /**
   * Draw error.
   */
  DrawError: 460,
  /**
   * Image error.
   */
  ImageError: 465,
  /**
   * Wand error.
   */
  WandError: 470,
  /**
   * Random error.
   */
  RandomError: 475,
  /**
   * X server error.
   */
  XServerError: 480,
  /**
   * Monitor error.
   */
  MonitorError: 485,
  /**
   * Registry error.
   */
  RegistryError: 490,
  /**
   * Configure error.
   */
  ConfigureError: 495,
  /**
   * Policy error.
   */
  PolicyError: 499
};
class Y extends Error {
  _relatedErrors = [];
  /** @internal */
  constructor(e, n = rr.Error) {
    super(e), this.severity = n;
  }
  /**
   * Gets the severity of an exception.
   */
  severity;
  /**
   * Gets the exceptions that are related to this exception.
   */
  get relatedErrors() {
    return this._relatedErrors;
  }
  /** @internal */
  _setRelatedErrors(e) {
    this._relatedErrors = e;
  }
}
class Fe {
  /**
   * Gets the quantum depth.
   */
  static get depth() {
    return c._api._Quantum_Depth_Get();
  }
  /**
   * Gets the maximum value of the quantum.
   */
  static get max() {
    return c._api._Quantum_Max_Get();
  }
}
function ce(w, e) {
  return w === 0 ? e ?? null : c._api.UTF8ToString(w);
}
function po(w, e) {
  const n = ce(e);
  return w._MagickMemory_Relinquish(e), n;
}
function ir(w, e, n) {
  const t = w.lengthBytesUTF8(e) + 1, _ = w._malloc(t);
  try {
    return w.stringToUTF8(e, _, t), n(_);
  } finally {
    w._free(_);
  }
}
function A(w, e) {
  return w === null ? e(0) : ir(c._api, w, e);
}
class k {
  constructor(e, n, t, _, g) {
    if (e !== void 0)
      if (typeof e == "string") {
        let p = 0;
        try {
          p = c._api._MagickColor_Create(), A(e, (m) => {
            if (c._api._MagickColor_Initialize(p, m) === 0)
              throw new Y("invalid color specified");
            this.initialize(p);
          });
        } finally {
          c._api._free(p);
        }
      } else
        this.r = e, this.g = n ?? 0, this.b = t ?? 0, g === void 0 ? this.a = _ ?? Fe.max : (this.k = _ ?? 0, this.a = g, this.isCmyk = !0);
  }
  r = 0;
  g = 0;
  b = 0;
  a = 0;
  k = 0;
  isCmyk = !1;
  /** @internal */
  static _create(e) {
    const n = new k();
    return n.initialize(e), n;
  }
  fuzzyEquals(e, n) {
    return e == this ? !0 : this._use((t) => e._use((_) => c._api._MagickColor_FuzzyEquals(t, _, n._toQuantum()) === 1));
  }
  toShortString() {
    return this.a !== Fe.max ? this.toString() : this.isCmyk ? `cmyka(${this.r},${this.g},${this.b},${this.k})` : `#${this.toHex(this.r)}${this.toHex(this.g)}${this.toHex(this.b)}`;
  }
  toString() {
    return this.isCmyk ? `cmyka(${this.r},${this.g},${this.b},${this.k},${(this.a / Fe.max).toFixed(4)})` : `#${this.toHex(this.r)}${this.toHex(this.g)}${this.toHex(this.b)}${this.toHex(this.a)}`;
  }
  /** @internal */
  _use(e) {
    let n = 0;
    try {
      return n = c._api._MagickColor_Create(), c._api._MagickColor_Red_Set(n, this.r), c._api._MagickColor_Green_Set(n, this.g), c._api._MagickColor_Blue_Set(n, this.b), c._api._MagickColor_Alpha_Set(n, this.a), this.isCmyk ? (c._api._MagickColor_Black_Set(n, this.k), c._api._MagickColor_IsCMYK_Set(n, 1)) : c._api._MagickColor_IsCMYK_Set(n, 0), e(n);
    } finally {
      c._api._MagickColor_Dispose(n);
    }
  }
  initialize(e) {
    this.r = c._api._MagickColor_Red_Get(e), this.g = c._api._MagickColor_Green_Get(e), this.b = c._api._MagickColor_Blue_Get(e), this.a = c._api._MagickColor_Alpha_Get(e), this.isCmyk = c._api._MagickColor_IsCMYK_Get(e) === 1, this.isCmyk && (this.k = c._api._MagickColor_Black_Get(e));
  }
  toHex(e) {
    return e.toString(16).padStart(2, "0");
  }
}
var Pe = /* @__PURE__ */ ((w) => (w[w.NoValue = 0] = "NoValue", w[w.PercentValue = 4096] = "PercentValue", w[w.IgnoreAspectRatio = 8192] = "IgnoreAspectRatio", w[w.Less = 16384] = "Less", w[w.Greater = 32768] = "Greater", w[w.FillArea = 65536] = "FillArea", w[w.LimitPixels = 131072] = "LimitPixels", w[w.AspectRatio = 1048576] = "AspectRatio", w))(Pe || {});
class ae {
  _includeXyInToString;
  _width = 0;
  _height = 0;
  _x = 0;
  _y = 0;
  _aspectRatio = !1;
  _fillArea = !1;
  _greater = !1;
  _isPercentage = !1;
  _ignoreAspectRatio = !1;
  _less = !1;
  _limitPixels = !1;
  constructor(e, n, t, _) {
    if (typeof e == "number") {
      if (t !== void 0 && _ !== void 0 ? (this._width = t, this._height = _, this._x = e, this._y = n ?? 0, this._includeXyInToString = !0) : (this._width = e, this._height = n ?? this._width, this._x = 0, this._y = 0, this._includeXyInToString = !1), this._width < 0)
        throw new Y("negative width is not allowed");
      if (this._height < 0)
        throw new Y("negative height is not allowed");
    } else {
      this._includeXyInToString = e.indexOf("+") >= 0 || e.indexOf("-") >= 0;
      const g = c._api._MagickGeometry_Create();
      try {
        A(e, (p) => {
          const m = c._api._MagickGeometry_Initialize(g, p);
          if (m === Pe.NoValue)
            throw new Y("invalid geometry specified");
          this.hasFlag(m, Pe.AspectRatio) ? this.initializeFromAspectRation(g, e) : this.initialize(g, m);
        });
      } finally {
        c._api._MagickGeometry_Dispose(g);
      }
    }
  }
  get aspectRatio() {
    return this._aspectRatio;
  }
  get fillArea() {
    return this._fillArea;
  }
  set fillArea(e) {
    this._fillArea = e;
  }
  get greater() {
    return this._greater;
  }
  set greater(e) {
    this._greater = e;
  }
  get height() {
    return this._height;
  }
  set height(e) {
    this._height = e;
  }
  get ignoreAspectRatio() {
    return this._ignoreAspectRatio;
  }
  set ignoreAspectRatio(e) {
    this._ignoreAspectRatio = e;
  }
  get isPercentage() {
    return this._isPercentage;
  }
  set isPercentage(e) {
    this._isPercentage = e;
  }
  get less() {
    return this._less;
  }
  set less(e) {
    this._less = e;
  }
  get limitPixels() {
    return this._limitPixels;
  }
  set limitPixels(e) {
    this._limitPixels = e;
  }
  get width() {
    return this._width;
  }
  set width(e) {
    this._width = e;
  }
  get x() {
    return this._x;
  }
  set x(e) {
    this._x = e;
  }
  get y() {
    return this._y;
  }
  set y(e) {
    this._y = e;
  }
  toString() {
    if (this._aspectRatio)
      return this._width + ":" + this._height;
    let e = "";
    return this._width == 0 && this._height == 0 ? e += "0x0" : (this._width > 0 && (e += this._width.toString()), this._height > 0 ? e += "x" + this._height.toString() : e += "x"), (this._x != 0 || this._y != 0 || this._includeXyInToString) && (this._x >= 0 && (e += "+"), e += this._x, this.y >= 0 && (e += "+"), e += this.y), this._fillArea && (e += "^"), this._greater && (e += ">"), this._isPercentage && (e += "%"), this._ignoreAspectRatio && (e += "!"), this._less && (e += "<"), this._limitPixels && (e += "@"), e;
  }
  /** @internal */
  static _fromRectangle(e) {
    if (e === 0)
      throw new Y("unable to allocate memory");
    try {
      const n = c._api._MagickRectangle_Width_Get(e), t = c._api._MagickRectangle_Height_Get(e), _ = c._api._MagickRectangle_X_Get(e), g = c._api._MagickRectangle_Y_Get(e);
      return new ae(_, g, n, t);
    } finally {
      c._api._MagickRectangle_Dispose(e);
    }
  }
  /** @internal */
  _toRectangle(e) {
    const n = c._api._MagickRectangle_Create();
    if (n === 0)
      throw new Y("unable to allocate memory");
    try {
      return c._api._MagickRectangle_Width_Set(n, this._width), c._api._MagickRectangle_Height_Set(n, this._height), c._api._MagickRectangle_X_Set(n, this._x), c._api._MagickRectangle_Y_Set(n, this._y), e(n);
    } finally {
      c._api._MagickRectangle_Dispose(n);
    }
  }
  initialize(e, n) {
    this._width = c._api._MagickGeometry_Width_Get(e), this._height = c._api._MagickGeometry_Height_Get(e), this._x = c._api._MagickGeometry_X_Get(e), this._y = c._api._MagickGeometry_Y_Get(e), this._ignoreAspectRatio = this.hasFlag(n, Pe.IgnoreAspectRatio), this._isPercentage = this.hasFlag(n, Pe.PercentValue), this._fillArea = this.hasFlag(n, Pe.FillArea), this._greater = this.hasFlag(n, Pe.Greater), this._less = this.hasFlag(n, Pe.Less), this._limitPixels = this.hasFlag(n, Pe.LimitPixels);
  }
  initializeFromAspectRation(e, n) {
    this._aspectRatio = !0;
    const t = n.split(":");
    this._width = this.parseNumber(t[0]), this._height = this.parseNumber(t[1]), this._x = c._api._MagickGeometry_X_Get(e), this._y = c._api._MagickGeometry_Y_Get(e);
  }
  parseNumber(e) {
    let n = 0;
    for (; n < e.length && !this.isNumber(e[n]); )
      n++;
    const t = n;
    for (; n < e.length && this.isNumber(e[n]); )
      n++;
    return parseInt(e.substr(t, n - t));
  }
  isNumber(e) {
    return e >= "0" && e <= "9";
  }
  hasFlag(e, n) {
    return (e & n) === n;
  }
}
class Te {
  constructor(e, n) {
    this.x = e, this.y = n ?? e;
  }
  /**
   * Gets the x-coordinate of this point.
   */
  x;
  /**
   * Gets the y-coordinate of this point.
   */
  y;
  /** @internal */
  static _create(e) {
    return e === 0 ? new Te(0, 0) : new Te(c._api._PointInfo_X_Get(e), c._api._PointInfo_Y_Get(e));
  }
}
class _r {
  constructor(e) {
    this.area = c._api._ConnectedComponent_GetArea(e), this.centroid = Te._create(c._api._ConnectedComponent_GetCentroid(e)), this.color = k._create(c._api._ConnectedComponent_GetColor(e)), this.height = c._api._ConnectedComponent_GetHeight(e), this.id = c._api._ConnectedComponent_GetId(e), this.width = c._api._ConnectedComponent_GetWidth(e), this.x = c._api._ConnectedComponent_GetX(e), this.y = c._api._ConnectedComponent_GetY(e);
  }
  /**
   * The pixel count of the area.
   */
  area;
  /**
   * The centroid of the area.
   */
  centroid;
  /**
   * The color of the area.
   */
  color;
  /**
   * The height of the area.
   */
  height;
  /**
   * The id of the area.
   */
  id;
  /**
   * The width of the area.
   */
  width;
  /**
   * The X offset from origin.
   */
  x;
  /**
   * The Y offset from origin.
   */
  y;
  /** @internal */
  static _create(e, n) {
    const t = [];
    if (e === 0)
      return t;
    for (let _ = 0; _ < n; _++) {
      const g = c._api._ConnectedComponent_GetInstance(e, _);
      g === 0 || c._api._ConnectedComponent_GetArea(g) < Number.EPSILON || t.push(new _r(g));
    }
    return t;
  }
  /**
   * Returns the geometry of the area of the connected component.
   */
  toGeometry() {
    return new ae(this.x, this.y, this.width, this.height);
  }
}
class mo {
  /**
   * The threshold that merges any object not within the min and max angle
   * threshold.
   */
  angleThreshold;
  /**
   * The threshold that eliminates small objects by merging them with their
   * larger neighbors.
   */
  areaThreshold;
  /**
   * The threshold that merges any object not within the min and max
   * circularity threshold.
   */
  circularityThreshold;
  /**
   * The number of neighbors to visit (4 or 8).
   */
  connectivity;
  /**
   * The threshold that merges any object not within the min and max diameter
   * threshold.
   */
  diameterThreshold;
  /**
   * The threshold that merges any object not within the min and max
   * eccentricity threshold.
   */
  eccentricityThreshold;
  /**
   * The threshold that merges any object not within the min and max ellipse
   * major threshold.
   */
  majorAxisThreshold;
  /**
   * Whether the object color in the component labeled image will be replaced
   * with the mean color from the source image (defaults to grayscale).
   */
  meanColor;
  /**
   * The threshold that merges any object not within the min and max ellipse
   * minor threshold.
   */
  minorAxisThreshold;
  /**
   * The threshold that merges any object not within the min and max perimeter
   * threshold.
   */
  perimeterThreshold;
  constructor(e) {
    this.connectivity = e;
  }
  /** @internal */
  _setArtifacts(e) {
    this.angleThreshold !== void 0 && e.setArtifact("connected-components:angle-threshold", this.angleThreshold.toString()), this.areaThreshold !== void 0 && e.setArtifact("connected-components:area-threshold", this.areaThreshold.toString()), this.circularityThreshold !== void 0 && e.setArtifact("connected-components:circularity-threshold", this.circularityThreshold.toString()), this.diameterThreshold !== void 0 && e.setArtifact("connected-components:diameter-threshold", this.diameterThreshold.toString()), this.eccentricityThreshold !== void 0 && e.setArtifact("connected-components:eccentricity-threshold", this.eccentricityThreshold.toString()), this.majorAxisThreshold !== void 0 && e.setArtifact("connected-components:major-axis-threshold", this.majorAxisThreshold.toString()), this.meanColor !== void 0 && e.setArtifact("connected-components:mean-color", this.meanColor.toString()), this.minorAxisThreshold !== void 0 && e.setArtifact("connected-components:minor-axis-threshold", this.minorAxisThreshold.toString()), this.perimeterThreshold !== void 0 && e.setArtifact("connected-components:perimeter-threshold", this.perimeterThreshold.toString());
  }
}
const Ve = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Pixels per inch.
   */
  PixelsPerInch: 1,
  /**
   * Pixels per centimeter.
   */
  PixelsPerCentimeter: 2
};
class rt {
  constructor(e, n, t) {
    n === void 0 ? (this.x = e, this.y = e, this.units = Ve.PixelsPerInch) : t !== void 0 ? (this.x = e, this.y = n, this.units = t) : (this.x = e, this.y = e, this.units = n);
  }
  /**
   * Gets the x resolution.
   */
  x;
  /**
   * Gets the y resolution.
   */
  y;
  /**
   * Gets the units.
   */
  units;
  /**
   * Returns a string that represents the current {@link Density} object.
   */
  toString(e) {
    return e == this.units || e === Ve.Undefined || e === void 0 ? rt.toString(this.x, this.y, e ?? Ve.Undefined) : this.units == Ve.PixelsPerCentimeter && e == Ve.PixelsPerInch ? rt.toString(this.x * 2.54, this.y * 2.54, e) : rt.toString(this.x / 2.54, this.y / 2.54, e);
  }
  static toString(e, n, t) {
    let _ = `${e}x${n}`;
    switch (t) {
      case Ve.PixelsPerCentimeter:
        _ += "cm";
        break;
      case Ve.PixelsPerInch:
        _ += "inch";
        break;
    }
    return _;
  }
}
class le {
  static _disposeAfterExecution(e, n) {
    try {
      const t = n(e);
      return t instanceof Promise ? Promise.resolve(t).then((_) => (e.dispose(), le.checkResult(e, _), _)) : (e.dispose(), le.checkResult(e, t), t);
    } catch (t) {
      throw e.dispose(), t;
    }
  }
  static checkResult(e, n) {
    if (n === e)
      throw new Y("The result of the function cannot be the instance that has been disposed.");
    return n;
  }
}
class ai {
  _pointer;
  _bytes;
  _func;
  constructor(e, n, t) {
    this._pointer = e, this._func = t, this._bytes = c._api.HEAPU8.subarray(e, e + n);
  }
  func(e) {
    return e._bytes === void 0 ? e._func(new Uint8Array()) : e._func(e._bytes);
  }
  dispose() {
    this._pointer = c._api._MagickMemory_Relinquish(this._pointer);
  }
}
class si {
  instance;
  type;
  constructor(e, n) {
    this.instance = c._api._malloc(e), this.type = n, c._api.setValue(this.instance, 0, this.type);
  }
  get ptr() {
    return this.instance;
  }
  get value() {
    return c._api.getValue(this.instance, this.type);
  }
}
class Re extends si {
  constructor() {
    super(4, "i32");
  }
  static use(e) {
    const n = new Re();
    try {
      return e(n);
    } finally {
      c._api._free(n.ptr);
    }
  }
}
class E {
  pointer;
  constructor(e) {
    this.pointer = e;
  }
  get ptr() {
    return this.pointer.ptr;
  }
  check(e, n) {
    return this.isError() ? n() : e();
  }
  static usePointer(e, n) {
    return Re.use((t) => {
      const _ = e(t.ptr);
      return E.checkException(t, _, n);
    });
  }
  static use(e, n) {
    return Re.use((t) => {
      const _ = e(new E(t));
      return E.checkException(t, _, n);
    });
  }
  static checkException(e, n, t) {
    if (!E.isRaised(e))
      return n;
    const _ = E.getErrorSeverity(e.value);
    if (_ >= rr.Error)
      E.throw(e, _);
    else if (t !== void 0) {
      const g = E.createError(e.value, _);
      t(g);
    } else
      E.dispose(e);
    return n;
  }
  isError() {
    return E.isRaised(this.pointer) ? E.getErrorSeverity(this.pointer.value) >= rr.Error : !1;
  }
  static getErrorSeverity(e) {
    return c._api._MagickExceptionHelper_Severity(e);
  }
  static isRaised(e) {
    return e.value !== 0;
  }
  static throw(e, n) {
    const t = E.createError(e.value, n);
    throw E.dispose(e), t;
  }
  static createError(e, n) {
    const t = E.getMessage(e), _ = new Y(t, n), g = c._api._MagickExceptionHelper_RelatedCount(e);
    if (g === 0)
      return _;
    const p = [];
    for (let m = 0; m < g; m++) {
      const S = c._api._MagickExceptionHelper_Related(e, m), R = E.getErrorSeverity(S), $ = E.createError(S, R);
      p.push($);
    }
    return _._setRelatedErrors(p), _;
  }
  static getMessage(e) {
    const n = c._api._MagickExceptionHelper_Message(e), t = c._api._MagickExceptionHelper_Description(e);
    let _ = ce(n, "Unknown error");
    return t !== 0 && (_ += `(${c._api.UTF8ToString(t)})`), _;
  }
  static dispose(e) {
    c._api._MagickExceptionHelper_Dispose(e.value);
  }
}
class Ke {
  disposeMethod;
  instance;
  /** @internal */
  constructor(e, n) {
    this.instance = e, this.disposeMethod = n;
  }
  /** @internal */
  get _instance() {
    if (this.instance > 0)
      return this.instance;
    throw this.instance === -1 && this._instanceNotInitialized(), new Y("instance is disposed");
  }
  /** @internal */
  set _instance(e) {
    this.disposeInstance(this.instance), this.instance = e;
  }
  dispose() {
    this.instance = this.disposeInstance(this.instance);
  }
  /** @internal */
  _instanceNotInitialized() {
    throw new Y("instance is not initialized");
  }
  /** @internal */
  _setInstance(e, n) {
    return n.check(() => this.instance === 0 ? !1 : (this.dispose(), this.instance = e, !0), () => (this.disposeInstance(e), !0));
  }
  disposeInstance(e) {
    return e > 0 && (this.onDispose !== void 0 && this.onDispose(), this.disposeMethod(e)), 0;
  }
}
class cr {
  constructor(e, n, t, _, g, p, m) {
    this.ascent = e, this.descent = n, this.maxHorizontalAdvance = t, this.textHeight = _, this.textWidth = g, this.underlinePosition = p, this.underlineThickness = m;
  }
  /**
   * Gets the ascent, the distance in pixels from the text baseline to the highest/upper grid coordinate
   * used to place an outline point.
   */
  ascent;
  /**
   * Gets the descent, the distance in pixels from the baseline to the lowest grid coordinate used to
   * place an outline point. Always a negative value.
   */
  descent;
  /**
   * Gets the maximum horizontal advance in pixels.
   */
  maxHorizontalAdvance;
  /**
   * Gets the text height in pixels.
   */
  textHeight;
  /**
   * Gets the text width in pixels.
   */
  textWidth;
  /**
   * Gets the underline position.
   */
  underlinePosition;
  /**
   * Gets the underline thickness.
   */
  underlineThickness;
  /** @internal */
  static _create(e) {
    if (e == 0)
      return null;
    try {
      const n = c._api._TypeMetric_Ascent_Get(e), t = c._api._TypeMetric_Descent_Get(e), _ = c._api._TypeMetric_MaxHorizontalAdvance_Get(e), g = c._api._TypeMetric_TextHeight_Get(e), p = c._api._TypeMetric_TextWidth_Get(e), m = c._api._TypeMetric_UnderlinePosition_Get(e), S = c._api._TypeMetric_UnderlineThickness_Get(e);
      return new cr(n, t, _, g, p, m, S);
    } finally {
      c._api._TypeMetric_Dispose(e);
    }
  }
}
function ei(w, e) {
  if (w.byteLength === 0)
    throw new Y("The specified array cannot be empty");
  let n = 0;
  try {
    return n = c._api._malloc(w.byteLength), c._api.HEAPU8.set(w, n), e(n);
  } finally {
    n !== 0 && c._api._free(n);
  }
}
function Et(w, e) {
  if (w.length === 0)
    throw new Y("The specified array cannot be empty");
  const n = w.length * 8;
  let t = 0;
  try {
    t = c._api._malloc(n);
    const _ = new ArrayBuffer(n), g = new Float64Array(_);
    for (let p = 0; p < w.length; p++)
      g[p] = w[p];
    return c._api.HEAPU8.set(new Int8Array(_), t), e(t);
  } finally {
    t !== 0 && c._api._free(t);
  }
}
function vo(w, e) {
  if (w.byteLength === 0)
    throw new Y("The specified array cannot be empty");
  let n = 0;
  try {
    return n = c._api._malloc(w.byteLength), c._api.HEAPU8.set(w, n), e(n);
  } finally {
    n !== 0 && c._api._free(n);
  }
}
class Tt extends Ke {
  constructor(e) {
    const n = e.settings._drawing._use((_) => c._api._DrawingWand_Create(e._instance, _._instance)), t = c._api._DrawingWand_Dispose;
    super(n, t);
  }
  affine(e, n, t, _, g, p) {
    E.usePointer((m) => {
      c._api._DrawingWand_Affine(this._instance, e, n, t, _, g, p, m);
    });
  }
  borderColor(e) {
    E.usePointer((n) => {
      e._use((t) => {
        c._api._DrawingWand_BorderColor(this._instance, t, n);
      });
    });
  }
  color(e, n, t) {
    E.usePointer((_) => {
      c._api._DrawingWand_Color(this._instance, e, n, t, _);
    });
  }
  draw(e) {
    e.forEach((n) => {
      n.draw(this);
    }), E.usePointer((n) => {
      c._api._DrawingWand_Render(this._instance, n);
    });
  }
  fillColor(e) {
    E.usePointer((n) => {
      e._use((t) => {
        c._api._DrawingWand_FillColor(this._instance, t, n);
      });
    });
  }
  fillOpacity(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_FillOpacity(this._instance, e, n);
    });
  }
  fillRule(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_FillRule(this._instance, e, n);
    });
  }
  font(e) {
    E.usePointer((n) => {
      A(e, (t) => {
        c._api._DrawingWand_Font(this._instance, t, n);
      });
    });
  }
  fontPointSize(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_FontPointSize(this._instance, e, n);
    });
  }
  /** @internal */
  fontTypeMetrics(e, n) {
    return E.usePointer((t) => A(e, (_) => {
      const g = c._api._DrawingWand_FontTypeMetrics(this._instance, _, n ? 1 : 0, t);
      return cr._create(g);
    }));
  }
  gravity(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_Gravity(this._instance, e, n);
    });
  }
  line(e, n, t, _) {
    E.usePointer((g) => {
      c._api._DrawingWand_Line(this._instance, e, n, t, _, g);
    });
  }
  pathFinish() {
    E.usePointer((e) => {
      c._api._DrawingWand_PathFinish(this._instance, e);
    });
  }
  pathLineToAbs(e, n) {
    E.usePointer((t) => {
      c._api._DrawingWand_PathLineToAbs(this._instance, e, n, t);
    });
  }
  pathLineToRel(e, n) {
    E.usePointer((t) => {
      c._api._DrawingWand_PathLineToRel(this._instance, e, n, t);
    });
  }
  pathMoveToAbs(e, n) {
    E.usePointer((t) => {
      c._api._DrawingWand_PathMoveToAbs(this._instance, e, n, t);
    });
  }
  pathMoveToRel(e, n) {
    E.usePointer((t) => {
      c._api._DrawingWand_PathMoveToRel(this._instance, e, n, t);
    });
  }
  pathStart() {
    E.usePointer((e) => {
      c._api._DrawingWand_PathStart(this._instance, e);
    });
  }
  point(e, n) {
    E.usePointer((t) => {
      c._api._DrawingWand_Point(this._instance, e, n, t);
    });
  }
  rectangle(e, n, t, _) {
    E.usePointer((g) => {
      c._api._DrawingWand_Rectangle(this._instance, e, n, t, _, g);
    });
  }
  roundRectangle(e, n, t, _, g, p) {
    E.usePointer((m) => {
      c._api._DrawingWand_RoundRectangle(this._instance, e, n, t, _, g, p, m);
    });
  }
  strokeColor(e) {
    E.usePointer((n) => {
      e._use((t) => {
        c._api._DrawingWand_StrokeColor(this._instance, t, n);
      });
    });
  }
  strokeDashArray(e) {
    E.usePointer((n) => {
      Et(e, (t) => {
        c._api._DrawingWand_StrokeDashArray(this._instance, t, e.length, n);
      });
    });
  }
  strokeDashOffset(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_StrokeDashOffset(this._instance, e, n);
    });
  }
  strokeWidth(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_StrokeWidth(this._instance, e, n);
    });
  }
  text(e, n, t) {
    E.usePointer((_) => {
      A(t, (g) => {
        c._api._DrawingWand_Text(this._instance, e, n, g, _);
      });
    });
  }
  textAlignment(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_TextAlignment(this._instance, e, n);
    });
  }
  textAntialias(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_TextAntialias(this._instance, e ? 1 : 0, n);
    });
  }
  textDecoration(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_TextDecoration(this._instance, e, n);
    });
  }
  textInterlineSpacing(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_TextInterlineSpacing(this._instance, e, n);
    });
  }
  textInterwordspacing(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_TextInterwordSpacing(this._instance, e, n);
    });
  }
  textKerning(e) {
    E.usePointer((n) => {
      c._api._DrawingWand_TextKerning(this._instance, e, n);
    });
  }
  textUnderColor(e) {
    E.usePointer((n) => {
      e._use((t) => {
        c._api._DrawingWand_TextUnderColor(this._instance, t, n);
      });
    });
  }
  /** @internal */
  static _use(e, n) {
    const t = new Tt(e);
    return le._disposeAfterExecution(t, n);
  }
}
class lr extends si {
  constructor() {
    super(8, "double");
  }
  static use(e) {
    const n = new lr();
    try {
      return e(n);
    } finally {
      c._api._free(n.ptr);
    }
  }
}
const O = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Forget.
   */
  Forget: 0,
  /**
   * Northwest
   */
  Northwest: 1,
  /**
   * North
   */
  North: 2,
  /**
   * Northeast
   */
  Northeast: 3,
  /**
   * West
   */
  West: 4,
  /**
   * Center
   */
  Center: 5,
  /**
   * East
   */
  East: 6,
  /**
   * Southwest
   */
  Southwest: 7,
  /**
   * South
   */
  South: 8,
  /**
   * Southeast
   */
  Southeast: 9
};
function* wo(w) {
  for (const e of w)
    switch (e) {
      case O.North:
        yield "north";
        break;
      case O.Northeast:
        yield "north", yield "east";
        break;
      case O.Northwest:
        yield "north", yield "west";
        break;
      case O.East:
        yield "east";
        break;
      case O.West:
        yield "west";
        break;
      case O.South:
        yield "south";
        break;
      case O.Southeast:
        yield "south", yield "east";
        break;
      case O.Southwest:
        yield "south", yield "west";
    }
}
function ko(w) {
  switch (w) {
    case O.North:
      return "north";
    case O.Northeast:
      return "northeast";
    case O.Northwest:
      return "northwest";
    case O.East:
      return "east";
    case O.West:
      return "west";
    case O.South:
      return "south";
    case O.Southeast:
      return "southeast";
    case O.Southwest:
      return "southwest";
    case O.Center:
      return "center";
    default:
      return;
  }
}
class bt {
  constructor(e, n, t) {
    this.meanErrorPerPixel = e, this.normalizedMeanError = n, this.normalizedMaximumError = t;
  }
  /**
   * Gets the mean error per pixel computed when an image is color reduced.
   */
  meanErrorPerPixel;
  /**
   * Gets the normalized maximum error per pixel computed when an image is color reduced.
   */
  normalizedMaximumError;
  /**
   * Gets the normalized mean error per pixel computed when an image is color reduced.
   */
  normalizedMeanError;
  /** @internal */
  static _create(e) {
    const n = c._api._MagickImage_MeanErrorPerPixel_Get(e._instance), t = c._api._MagickImage_NormalizedMeanError_Get(e._instance), _ = c._api._MagickImage_NormalizedMaximumError_Get(e._instance);
    return new bt(n, t, _);
  }
}
const Le = {
  /**
   * Unknown.
   */
  Unknown: "UNKNOWN",
  /**
   * Hasselblad CFV/H3D39II Raw Format.
   */
  ThreeFr: "3FR",
  /**
   * Media Container.
   */
  ThreeG2: "3G2",
  /**
   * Media Container.
   */
  ThreeGp: "3GP",
  /**
   * Raw alpha samples.
   */
  A: "A",
  /**
   * AAI Dune image.
   */
  Aai: "AAI",
  /**
   * Adobe Illustrator CS2.
   */
  Ai: "AI",
  /**
   * Animated Portable Network Graphics.
   */
  APng: "APNG",
  /**
   * PFS: 1st Publisher Clip Art.
   */
  Art: "ART",
  /**
   * Sony Alpha Raw Format.
   */
  Arw: "ARW",
  /**
   * Image sequence laid out in continuous irregular courses (Unknown).
   */
  Ashlar: "ASHLAR",
  /**
   * AVC Image File Format.
   */
  Avci: "AVCI",
  /**
   * Microsoft Audio/Visual Interleaved.
   */
  Avi: "AVI",
  /**
   * AV1 Image File Format (Heic).
   */
  Avif: "AVIF",
  /**
   * AVS X image.
   */
  Avs: "AVS",
  /**
   * Raw blue samples.
   */
  B: "B",
  /**
   * Raw mosaiced samples.
   */
  Bayer: "BAYER",
  /**
   * Raw mosaiced and alpha samples.
   */
  Bayera: "BAYERA",
  /**
   * Raw blue, green, and red samples.
   */
  Bgr: "BGR",
  /**
   * Raw blue, green, red, and alpha samples.
   */
  Bgra: "BGRA",
  /**
   * Raw blue, green, red, and opacity samples.
   */
  Bgro: "BGRO",
  /**
   * Microsoft Windows bitmap image.
   */
  Bmp: "BMP",
  /**
   * Microsoft Windows bitmap image (V2).
   */
  Bmp2: "BMP2",
  /**
   * Microsoft Windows bitmap image (V3).
   */
  Bmp3: "BMP3",
  /**
   * BRF ASCII Braille format.
   */
  Brf: "BRF",
  /**
   * Raw cyan samples.
   */
  C: "C",
  /**
   * Continuous Acquisition and Life-cycle Support Type 1.
   */
  Cal: "CAL",
  /**
   * Continuous Acquisition and Life-cycle Support Type 1.
   */
  Cals: "CALS",
  /**
   * Constant image uniform color.
   */
  Canvas: "CANVAS",
  /**
   * Caption.
   */
  Caption: "CAPTION",
  /**
   * Cineon Image File.
   */
  Cin: "CIN",
  /**
   * Cisco IP phone image format.
   */
  Cip: "CIP",
  /**
   * Image Clip Mask.
   */
  Clip: "CLIP",
  /**
   * Raw cyan, magenta, yellow, and black samples.
   */
  Cmyk: "CMYK",
  /**
   * Raw cyan, magenta, yellow, black, and alpha samples.
   */
  Cmyka: "CMYKA",
  /**
   * Canon Digital Camera Raw Format.
   */
  Cr2: "CR2",
  /**
   * Canon Digital Camera Raw Format.
   */
  Cr3: "CR3",
  /**
   * Canon Digital Camera Raw Format.
   */
  Crw: "CRW",
  /**
   * Cube color lookup table image.
   */
  Cube: "CUBE",
  /**
   * Microsoft icon.
   */
  Cur: "CUR",
  /**
   * DR Halo.
   */
  Cut: "CUT",
  /**
   * Base64-encoded inline images.
   */
  Data: "DATA",
  /**
   * Digital Imaging and Communications in Medicine image.
   */
  Dcm: "DCM",
  /**
   * Kodak Digital Camera Raw Format.
   */
  Dcr: "DCR",
  /**
   * Raw Photo Decoder (dcraw).
   */
  Dcraw: "DCRAW",
  /**
   * ZSoft IBM PC multi-page Paintbrush.
   */
  Dcx: "DCX",
  /**
   * Microsoft DirectDraw Surface.
   */
  Dds: "DDS",
  /**
   * Multi-face font package.
   */
  Dfont: "DFONT",
  /**
   * Digital Negative Raw Format.
   */
  Dng: "DNG",
  /**
   * SMPTE 268M-2003 (DPX 2.0).
   */
  Dpx: "DPX",
  /**
   * Microsoft DirectDraw Surface.
   */
  Dxt1: "DXT1",
  /**
   * Microsoft DirectDraw Surface.
   */
  Dxt5: "DXT5",
  /**
   * Encapsulated Portable Document Format.
   */
  Epdf: "EPDF",
  /**
   * Encapsulated PostScript Interchange format.
   */
  Epi: "EPI",
  /**
   * Encapsulated PostScript.
   */
  Eps: "EPS",
  /**
   * Level II Encapsulated PostScript.
   */
  Eps2: "EPS2",
  /**
   * Level III Encapsulated PostScript.
   */
  Eps3: "EPS3",
  /**
   * Encapsulated PostScript.
   */
  Epsf: "EPSF",
  /**
   * Encapsulated PostScript Interchange format.
   */
  Epsi: "EPSI",
  /**
   * Encapsulated PostScript with TIFF preview.
   */
  Ept: "EPT",
  /**
   * Encapsulated PostScript Level II with TIFF preview.
   */
  Ept2: "EPT2",
  /**
   * Encapsulated PostScript Level III with TIFF preview.
   */
  Ept3: "EPT3",
  /**
   * Epson Raw Format.
   */
  Erf: "ERF",
  /**
   * High Dynamic-range (HDR).
   */
  Exr: "EXR",
  /**
   * Farbfeld.
   */
  Farbfeld: "FARBFELD",
  /**
   * Group 3 FAX.
   */
  Fax: "FAX",
  /**
   * Farbfeld.
   */
  Ff: "FF",
  /**
   * Hasselblad CFV/H3D39II Raw Format.
   */
  Fff: "FFF",
  /**
   * Uniform Resource Locator (file://).
   */
  File: "FILE",
  /**
   * Flexible Image Transport System.
   */
  Fits: "FITS",
  /**
   * FilmLight.
   */
  Fl32: "FL32",
  /**
   * Flash Video Stream.
   */
  Flv: "FLV",
  /**
   * Plasma fractal image.
   */
  Fractal: "FRACTAL",
  /**
   * Uniform Resource Locator (ftp://).
   */
  Ftp: "FTP",
  /**
   * Flexible Image Transport System.
   */
  Fts: "FTS",
  /**
   * Formatted text image.
   */
  Ftxt: "FTXT",
  /**
   * Raw green samples.
   */
  G: "G",
  /**
   * Group 3 FAX.
   */
  G3: "G3",
  /**
   * Group 4 FAX.
   */
  G4: "G4",
  /**
   * CompuServe graphics interchange format.
   */
  Gif: "GIF",
  /**
   * CompuServe graphics interchange format.
   */
  Gif87: "GIF87",
  /**
   * Gradual linear passing from one shade to another.
   */
  Gradient: "GRADIENT",
  /**
   * Raw gray samples.
   */
  Gray: "GRAY",
  /**
   * Raw gray and alpha samples.
   */
  Graya: "GRAYA",
  /**
   * Raw CCITT Group4.
   */
  Group4: "GROUP4",
  /**
   * Identity Hald color lookup table image.
   */
  Hald: "HALD",
  /**
   * Radiance RGBE image format.
   */
  Hdr: "HDR",
  /**
   * High Efficiency Image Format.
   */
  Heic: "HEIC",
  /**
   * High Efficiency Image Format.
   */
  Heif: "HEIF",
  /**
   * Histogram of the image.
   */
  Histogram: "HISTOGRAM",
  /**
   * Slow Scan TeleVision.
   */
  Hrz: "HRZ",
  /**
   * Hypertext Markup Language and a client-side image map.
   */
  Htm: "HTM",
  /**
   * Hypertext Markup Language and a client-side image map.
   */
  Html: "HTML",
  /**
   * Uniform Resource Locator (http://).
   */
  Http: "HTTP",
  /**
   * Uniform Resource Locator (https://).
   */
  Https: "HTTPS",
  /**
   * Truevision Targa image.
   */
  Icb: "ICB",
  /**
   * Microsoft icon.
   */
  Ico: "ICO",
  /**
   * Microsoft icon.
   */
  Icon: "ICON",
  /**
   * Microsoft icon.
   */
  Icn: "ICN",
  /**
   * Phase One Raw Format.
   */
  Iiq: "IIQ",
  /**
   * The image format and characteristics.
   */
  Info: "INFO",
  /**
   * Base64-encoded inline images.
   */
  Inline: "INLINE",
  /**
   * IPL Image Sequence.
   */
  Ipl: "IPL",
  /**
   * ISO/TR 11548-1 format.
   */
  Isobrl: "ISOBRL",
  /**
   * ISO/TR 11548-1 format 6dot.
   */
  Isobrl6: "ISOBRL6",
  /**
   * JPEG-2000 Code Stream Syntax.
   */
  J2c: "J2C",
  /**
   * JPEG-2000 Code Stream Syntax.
   */
  J2k: "J2K",
  /**
   * JPEG Network Graphics.
   */
  Jng: "JNG",
  /**
   * Garmin tile format.
   */
  Jnx: "JNX",
  /**
   * JPEG-2000 File Format Syntax.
   */
  Jp2: "JP2",
  /**
   * JPEG-2000 Code Stream Syntax.
   */
  Jpc: "JPC",
  /**
   * Joint Photographic Experts Group JFIF format.
   */
  Jpe: "JPE",
  /**
   * Joint Photographic Experts Group JFIF format.
   */
  Jpeg: "JPEG",
  /**
   * Joint Photographic Experts Group JFIF format.
   */
  Jpg: "JPG",
  /**
   * JPEG-2000 File Format Syntax.
   */
  Jpm: "JPM",
  /**
   * Joint Photographic Experts Group JFIF format.
   */
  Jps: "JPS",
  /**
   * JPEG-2000 File Format Syntax.
   */
  Jpt: "JPT",
  /**
   * The image format and characteristics.
   */
  Json: "JSON",
  /**
   * JPEG XL Lossless JPEG1 Recompression.
   */
  Jxl: "JXL",
  /**
   * Raw black samples.
   */
  K: "K",
  /**
   * Kodak Digital Camera Raw Format.
   */
  K25: "K25",
  /**
   * Kodak Digital Camera Raw Format.
   */
  Kdc: "KDC",
  /**
   * Image label.
   */
  Label: "LABEL",
  /**
   * Raw magenta samples.
   */
  M: "M",
  /**
   * MPEG Video Stream.
   */
  M2v: "M2V",
  /**
   * Raw MPEG-4 Video.
   */
  M4v: "M4V",
  /**
   * MAC Paint.
   */
  Mac: "MAC",
  /**
   * Colormap intensities and indices.
   */
  Map: "MAP",
  /**
   * Image Clip Mask.
   */
  Mask: "MASK",
  /**
   * MATLAB level 5 image format.
   */
  Mat: "MAT",
  /**
   * MATTE format.
   */
  Matte: "MATTE",
  /**
   * Minolta Digital Camera Raw Format.
   */
  Mdc: "MDC",
  /**
   * Mamiya Raw Format.
   */
  Mef: "MEF",
  /**
   * Magick Image File Format.
   */
  Miff: "MIFF",
  /**
   * Multimedia Container.
   */
  Mkv: "MKV",
  /**
   * Multiple-image Network Graphics.
   */
  Mng: "MNG",
  /**
   * Raw bi-level bitmap.
   */
  Mono: "MONO",
  /**
   * MPEG Video Stream.
   */
  Mov: "MOV",
  /**
   * Aptus Leaf Raw Format.
   */
  Mos: "MOS",
  /**
   * MPEG-4 Video Stream.
   */
  Mp4: "MP4",
  /**
   * Magick Persistent Cache image format.
   */
  Mpc: "MPC",
  /**
   * MPEG Video Stream.
   */
  Mpeg: "MPEG",
  /**
   * MPEG Video Stream.
   */
  Mpg: "MPG",
  /**
   * Joint Photographic Experts Group JFIF format (Jpeg).
   */
  Mpo: "MPO",
  /**
   * Sony (Minolta) Raw Format.
   */
  Mrw: "MRW",
  /**
   * Magick Scripting Language.
   */
  Msl: "MSL",
  /**
   * ImageMagick's own SVG internal renderer.
   */
  Msvg: "MSVG",
  /**
   * MTV Raytracing image format.
   */
  Mtv: "MTV",
  /**
   * Magick Vector Graphics.
   */
  Mvg: "MVG",
  /**
   * Nikon Digital SLR Camera Raw Format.
   */
  Nef: "NEF",
  /**
   * Nikon Digital SLR Camera Raw Format.
   */
  Nrw: "NRW",
  /**
   * Constant image of uniform color.
   */
  Null: "NULL",
  /**
   * Raw opacity samples.
   */
  O: "O",
  /**
   * OpenRaster format.
   */
  Ora: "ORA",
  /**
   * Olympus Digital Camera Raw Format.
   */
  Orf: "ORF",
  /**
   * On-the-air bitmap.
   */
  Otb: "OTB",
  /**
   * Open Type font.
   */
  Otf: "OTF",
  /**
   * 16bit/pixel interleaved YUV.
   */
  Pal: "PAL",
  /**
   * Palm pixmap.
   */
  Palm: "PALM",
  /**
   * Common 2-dimensional bitmap format.
   */
  Pam: "PAM",
  /**
   * Pango Markup Language.
   */
  Pango: "PANGO",
  /**
   * Predefined pattern.
   */
  Pattern: "PATTERN",
  /**
   * Portable bitmap format (black and white).
   */
  Pbm: "PBM",
  /**
   * Photo CD.
   */
  Pcd: "PCD",
  /**
   * Photo CD.
   */
  Pcds: "PCDS",
  /**
   * Printer Control Language.
   */
  Pcl: "PCL",
  /**
   * Apple Macintosh QuickDraw/PICT.
   */
  Pct: "PCT",
  /**
   * ZSoft IBM PC Paintbrush.
   */
  Pcx: "PCX",
  /**
   * Palm Database ImageViewer Format.
   */
  Pdb: "PDB",
  /**
   * Portable Document Format.
   */
  Pdf: "PDF",
  /**
   * Portable Document Archive Format.
   */
  Pdfa: "PDFA",
  /**
   * Pentax Electronic Raw Format.
   */
  Pef: "PEF",
  /**
   * Embrid Embroidery Format.
   */
  Pes: "PES",
  /**
   * Postscript Type 1 font (ASCII).
   */
  Pfa: "PFA",
  /**
   * Postscript Type 1 font (binary).
   */
  Pfb: "PFB",
  /**
   * Portable float format.
   */
  Pfm: "PFM",
  /**
   * Portable graymap format (gray scale).
   */
  Pgm: "PGM",
  /**
   * JPEG 2000 uncompressed format.
   */
  Pgx: "PGX",
  /**
   * Portable half float format.
   */
  Phm: "PHM",
  /**
   * Personal Icon.
   */
  Picon: "PICON",
  /**
   * Apple Macintosh QuickDraw/PICT.
   */
  Pict: "PICT",
  /**
   * Alias/Wavefront RLE image format.
   */
  Pix: "PIX",
  /**
   * Joint Photographic Experts Group JFIF format.
   */
  Pjpeg: "PJPEG",
  /**
   * Plasma fractal image.
   */
  Plasma: "PLASMA",
  /**
   * Portable Network Graphics.
   */
  Png: "PNG",
  /**
   * PNG inheriting bit-depth and color-type from original.
   */
  Png00: "PNG00",
  /**
   * opaque or binary transparent 24-bit RGB.
   */
  Png24: "PNG24",
  /**
   * opaque or transparent 32-bit RGBA.
   */
  Png32: "PNG32",
  /**
   * opaque or binary transparent 48-bit RGB.
   */
  Png48: "PNG48",
  /**
   * opaque or transparent 64-bit RGBA.
   */
  Png64: "PNG64",
  /**
   * 8-bit indexed with optional binary transparency.
   */
  Png8: "PNG8",
  /**
   * Portable anymap.
   */
  Pnm: "PNM",
  /**
   * Pocketmod Personal Organizer (Pdf).
   */
  Pocketmod: "POCKETMOD",
  /**
   * Portable pixmap format (color).
   */
  Ppm: "PPM",
  /**
   * PostScript.
   */
  Ps: "PS",
  /**
   * Level II PostScript.
   */
  Ps2: "PS2",
  /**
   * Level III PostScript.
   */
  Ps3: "PS3",
  /**
   * Adobe Large Document Format.
   */
  Psb: "PSB",
  /**
   * Adobe Photoshop bitmap.
   */
  Psd: "PSD",
  /**
   * Pyramid encoded TIFF.
   */
  Ptif: "PTIF",
  /**
   * Seattle Film Works.
   */
  Pwp: "PWP",
  /**
   * Quite OK image format.
   */
  Qoi: "QOI",
  /**
   * Raw red samples.
   */
  R: "R",
  /**
   * Gradual radial passing from one shade to another.
   */
  RadialGradient: "RADIAL-GRADIENT",
  /**
   * Fuji CCD-RAW Graphic File.
   */
  Raf: "RAF",
  /**
   * SUN Rasterfile.
   */
  Ras: "RAS",
  /**
   * Raw.
   */
  Raw: "RAW",
  /**
   * Raw red, green, and blue samples.
   */
  Rgb: "RGB",
  /**
   * Raw red, green, blue samples in 565 format.
   */
  Rgb565: "RGB565",
  /**
   * Raw red, green, blue, and alpha samples.
   */
  Rgba: "RGBA",
  /**
   * Raw red, green, blue, and opacity samples.
   */
  Rgbo: "RGBO",
  /**
   * LEGO Mindstorms EV3 Robot Graphic Format (black and white).
   */
  Rgf: "RGF",
  /**
   * Alias/Wavefront image.
   */
  Rla: "RLA",
  /**
   * Utah Run length encoded image.
   */
  Rle: "RLE",
  /**
   * Raw Media Format.
   */
  Rmf: "RMF",
  /**
   * Panasonic Lumix Raw Format.
   */
  Rw2: "RW2",
  /**
   * Leica Raw Format.
   */
  Rwl: "RWL",
  /**
   * ZX-Spectrum SCREEN$.
   */
  Scr: "SCR",
  /**
   * Screen shot.
   */
  Screenshot: "SCREENSHOT",
  /**
   * Scitex HandShake.
   */
  Sct: "SCT",
  /**
   * Simple File Format Family Images.
   */
  Sf3: "SF3",
  /**
   * Seattle Film Works.
   */
  Sfw: "SFW",
  /**
   * Irix RGB image.
   */
  Sgi: "SGI",
  /**
   * Hypertext Markup Language and a client-side image map.
   */
  Shtml: "SHTML",
  /**
   * DEC SIXEL Graphics Format.
   */
  Six: "SIX",
  /**
   * DEC SIXEL Graphics Format.
   */
  Sixel: "SIXEL",
  /**
   * Sparse Color.
   */
  SparseColor: "SPARSE-COLOR",
  /**
   * Sony Raw Format 2.
   */
  Sr2: "SR2",
  /**
   * Sony Raw Format.
   */
  Srf: "SRF",
  /**
   * Samsung Raw Format.
   */
  Srw: "SRW",
  /**
   * Steganographic image.
   */
  Stegano: "STEGANO",
  /**
   * Sinar CaptureShop Raw Format.
   */
  Sti: "STI",
  /**
   * String to image and back.
   */
  StrImg: "STRIMG",
  /**
   * SUN Rasterfile.
   */
  Sun: "SUN",
  /**
   * Scalable Vector Graphics.
   */
  Svg: "SVG",
  /**
   * Compressed Scalable Vector Graphics.
   */
  Svgz: "SVGZ",
  /**
   * Text.
   */
  Text: "TEXT",
  /**
   * Truevision Targa image.
   */
  Tga: "TGA",
  /**
   * EXIF Profile Thumbnail.
   */
  Thumbnail: "THUMBNAIL",
  /**
   * Tagged Image File Format.
   */
  Tif: "TIF",
  /**
   * Tagged Image File Format.
   */
  Tiff: "TIFF",
  /**
   * Tagged Image File Format (64-bit).
   */
  Tiff64: "TIFF64",
  /**
   * Tile image with a texture.
   */
  Tile: "TILE",
  /**
   * PSX TIM.
   */
  Tim: "TIM",
  /**
   * PS2 TIM2.
   */
  Tm2: "TM2",
  /**
   * TrueType font collection.
   */
  Ttc: "TTC",
  /**
   * TrueType font.
   */
  Ttf: "TTF",
  /**
   * Text.
   */
  Txt: "TXT",
  /**
   * Unicode Text format.
   */
  Ubrl: "UBRL",
  /**
   * Unicode Text format 6dot.
   */
  Ubrl6: "UBRL6",
  /**
   * X-Motif UIL table.
   */
  Uil: "UIL",
  /**
   * 16bit/pixel interleaved YUV.
   */
  Uyvy: "UYVY",
  /**
   * Truevision Targa image.
   */
  Vda: "VDA",
  /**
   * VICAR rasterfile format.
   */
  Vicar: "VICAR",
  /**
   * Visual Image Directory.
   */
  Vid: "VID",
  /**
   * Khoros Visualization image.
   */
  Viff: "VIFF",
  /**
   * VIPS image.
   */
  Vips: "VIPS",
  /**
   * Truevision Targa image.
   */
  Vst: "VST",
  /**
   * Open Web Media.
   */
  WebM: "WEBM",
  /**
   * WebP Image Format.
   */
  WebP: "WEBP",
  /**
   * Wireless Bitmap (level 0) image.
   */
  Wbmp: "WBMP",
  /**
   * Windows Media Video.
   */
  Wmv: "WMV",
  /**
   * Word Perfect Graphics.
   */
  Wpg: "WPG",
  /**
   * Sigma Camera RAW Format.
   */
  X3f: "X3F",
  /**
   * X Windows system bitmap (black and white).
   */
  Xbm: "XBM",
  /**
   * Constant image uniform color.
   */
  Xc: "XC",
  /**
   * GIMP image.
   */
  Xcf: "XCF",
  /**
   * X Windows system pixmap (color).
   */
  Xpm: "XPM",
  /**
   * Microsoft XML Paper Specification.
   */
  Xps: "XPS",
  /**
   * Khoros Visualization image.
   */
  Xv: "XV",
  /**
   * Raw yellow samples.
   */
  Y: "Y",
  /**
   * The image format and characteristics.
   */
  Yaml: "YAML",
  /**
   * Raw Y, Cb, and Cr samples.
   */
  Ycbcr: "YCBCR",
  /**
   * Raw Y, Cb, Cr, and alpha samples.
   */
  Ycbcra: "YCBCRA",
  /**
   * CCIR 601 4:1:1 or 4:2:2.
   */
  Yuv: "YUV"
}, Pt = {
  Merge: 13,
  Flatten: 14,
  Mosaic: 15,
  Trimbounds: 16
};
class Mo extends Ke {
  constructor(e) {
    const n = c._api._DrawingSettings_Create(), t = c._api._DrawingSettings_Dispose;
    super(n, t);
    const _ = e.affine;
    if (_ !== void 0 && c._api._DrawingSettings_SetAffine(this._instance, _.scaleX, _.scaleY, _.shearX, _.shearY, _.translateX, _.translateY), e.borderColor !== void 0 && e.borderColor._use((p) => {
      c._api._DrawingSettings_BorderColor_Set(this._instance, p);
    }), e.fillColor !== void 0 && e.fillColor._use((p) => {
      c._api._DrawingSettings_FillColor_Set(this._instance, p);
    }), e.fillRule !== void 0 && c._api._DrawingSettings_FillRule_Set(this._instance, e.fillRule), e.font !== void 0) {
      const p = Ae._getFontFileName(e.font);
      A(p, (m) => {
        c._api._DrawingSettings_Font_Set(this._instance, m);
      });
    }
    e.fontPointsize !== void 0 && c._api._DrawingSettings_FontPointsize_Set(this._instance, e.fontPointsize), e.strokeColor !== void 0 && e.strokeColor._use((p) => {
      c._api._DrawingSettings_StrokeColor_Set(this._instance, p);
    });
    const g = e.strokeDashArray;
    g !== void 0 && Et(g, (p) => {
      c._api._DrawingSettings_SetStrokeDashArray(this._instance, p, g.length);
    }), e.strokeDashOffset !== void 0 && c._api._DrawingSettings_StrokeDashOffset_Set(this._instance, e.strokeDashOffset), e.strokeWidth !== void 0 && c._api._DrawingSettings_StrokeWidth_Set(this._instance, e.strokeWidth), e.textAntiAlias !== void 0 && c._api._DrawingSettings_TextAntiAlias_Set(this._instance, e.textAntiAlias ? 1 : 0), e.textGravity !== void 0 && c._api._DrawingSettings_TextGravity_Set(this._instance, e.textGravity), e.textKerning !== void 0 && c._api._DrawingSettings_TextKerning_Set(this._instance, e.textKerning), e.textUnderColor !== void 0 && e.textUnderColor._use((p) => {
      c._api._DrawingSettings_TextUnderColor_Set(this._instance, p);
    });
  }
  setFillColor(e) {
    e !== void 0 ? e._use((n) => {
      c._api._DrawingSettings_FillColor_Set(this._instance, n);
    }) : c._api._DrawingSettings_FillColor_Set(this._instance, 0);
  }
  setFillPattern(e) {
    E.usePointer((n) => {
      e !== void 0 ? c._api._DrawingSettings_SetFillPattern(this._instance, e._instance, n) : c._api._DrawingSettings_SetFillPattern(this._instance, 0, n);
    });
  }
}
class yo {
  affine;
  borderColor;
  backgroundColor;
  fillColor;
  fillRule;
  font;
  fontPointsize;
  strokeColor;
  strokeDashArray;
  strokeDashOffset;
  strokeWidth;
  textAntiAlias;
  textGravity;
  textKerning;
  textUnderColor;
  _use(e) {
    const n = new Mo(this);
    return le._disposeAfterExecution(n, e);
  }
}
const So = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Even odd.
   */
  EvenOdd: 1,
  /**
   * Non zero.
   */
  NonZero: 2
};
class oi extends Ke {
  constructor(e) {
    const n = c._api._MagickSettings_Create(), t = c._api._MagickSettings_Dispose;
    if (super(n, t), e._colorFuzz !== void 0 && c._api._MagickSettings_SetColorFuzz(this._instance, e._colorFuzz), e._fileName !== void 0 && A(e._fileName, (_) => {
      c._api._MagickSettings_SetFileName(this._instance, _);
    }), e._ping && c._api._MagickSettings_SetPing(this._instance, 1), e._quality !== void 0 && c._api._MagickSettings_SetQuality(this._instance, e._quality), e.antiAlias !== void 0 && c._api._MagickSettings_AntiAlias_Set(this._instance, e.antiAlias ? 1 : 0), e.backgroundColor !== void 0 && e.backgroundColor._use((_) => {
      c._api._MagickSettings_BackgroundColor_Set(this._instance, _);
    }), e.colorSpace !== void 0 && c._api._MagickSettings_ColorSpace_Set(this._instance, e.colorSpace), e.colorType !== void 0 && c._api._MagickSettings_ColorType_Set(this._instance, e.colorType), e.compression !== void 0 && c._api._MagickSettings_Compression_Set(this._instance, e.compression), e.debug !== void 0 && c._api._MagickSettings_Debug_Set(this._instance, e.debug ? 1 : 0), e.density !== void 0) {
      const _ = e.density.toString();
      A(_, (g) => {
        c._api._MagickSettings_Density_Set(this._instance, g);
      });
    }
    if (e.depth !== void 0 && c._api._MagickSettings_Depth_Set(this._instance, e.depth), e.endian !== void 0 && c._api._MagickSettings_Endian_Set(this._instance, e.endian), e.fillColor !== void 0 && this.setOption("fill", e.fillColor.toString()), e.font !== void 0) {
      const _ = Ae._getFontFileName(e.font);
      A(_, (g) => {
        c._api._MagickSettings_SetFont(this._instance, g);
      });
    }
    e.fontPointsize !== void 0 && c._api._MagickSettings_FontPointsize_Set(this._instance, e.fontPointsize), e.format !== void 0 && A(e.format, (_) => {
      c._api._MagickSettings_Format_Set(this._instance, _);
    }), e.interlace !== void 0 && c._api._MagickSettings_Interlace_Set(this._instance, e.interlace), e.page !== void 0 && A(e.page.toString(), (_) => {
      c._api._MagickSettings_SetPage(this._instance, _);
    }), e.strokeColor !== void 0 && this.setOption("stroke", e.strokeColor.toString()), e.strokeWidth !== void 0 && this.setOption("strokeWidth", e.strokeWidth.toString()), e.textInterlineSpacing !== void 0 && this.setOption("interline-spacing", e.textInterlineSpacing.toString());
    for (const _ in e._options)
      this.setOption(_, e._options[_]);
  }
  setOption(e, n) {
    A(e, (t) => {
      A(n, (_) => {
        c._api._MagickSettings_SetOption(this._instance, t, _);
      });
    });
  }
}
class lt {
  /** @internal */
  _colorFuzz;
  /** @internal */
  _drawing = new yo();
  /** @internal */
  _fileName;
  /** @internal */
  _onArtifact;
  /** @internal */
  _options = {};
  /** @internal */
  _ping = !1;
  /** @internal */
  _quality;
  /**
   * Gets or sets the affine to use when annotating with text or drawing.
   */
  get affine() {
    return this._drawing.affine;
  }
  set affine(e) {
    this._drawing.affine = e;
  }
  /**
   * Gets or sets a value indicating whether anti-aliasing should be enabled (default true).
   */
  antiAlias;
  /**
   * Gets or sets the background color.
   */
  backgroundColor;
  /**
   * Gets or sets the border color.
   */
  get borderColor() {
    return this._drawing.borderColor;
  }
  set borderColor(e) {
    this._drawing.borderColor = e;
  }
  /**
   * Gets or sets the color space.
   */
  colorSpace;
  /**
   * Gets or sets the color type of the image.
   */
  colorType;
  /**
   * Gets or sets the compression method to use.
   */
  compression;
  /**
   * Gets or sets a value indicating whether printing of debug messages from ImageMagick is enabled when a debugger is attached.
   */
  debug;
  /**
   * Gets or sets the vertical and horizontal resolution in pixels.
   */
  density;
  /**
   * Gets or sets the depth (bits allocated to red/green/blue components).
   */
  depth;
  /**
   * Gets or sets the endianness (little like Intel or big like SPARC) for image formats which support
   * endian-specific options.
   */
  endian;
  /**
   * Gets or sets the fill color.
   */
  get fillColor() {
    return this._drawing.fillColor;
  }
  set fillColor(e) {
    this.setDefineAndArtifact("fill", e?.toString()), this._drawing.fillColor = e;
  }
  /**
   * Gets or sets the rule to use when filling drawn objects.
   */
  get fillRule() {
    return this._drawing.fillRule ?? So.Undefined;
  }
  set fillRule(e) {
    this._drawing.fillRule = e;
  }
  /**
   * Gets or sets the text rendering font.
   */
  get font() {
    return this._drawing.font;
  }
  set font(e) {
    this._drawing.font = e;
  }
  /**
   * Gets or sets the font point size.
   */
  get fontPointsize() {
    return this._drawing.fontPointsize;
  }
  set fontPointsize(e) {
    this._drawing.fontPointsize = e;
  }
  /**
   * Gets or sets the the format of the image.
   */
  format;
  /**
   * Gets or sets the interlace method.
   */
  interlace;
  /**
   * Gets or sets the preferred size and location of an image canvas.
   */
  page;
  /**
   * Gets or sets the color to use when drawing object outlines.
   */
  get strokeColor() {
    return this._drawing.strokeColor;
  }
  set strokeColor(e) {
    this._drawing.strokeColor = e;
  }
  /**
   * Gets or sets the pattern of dashes and gaps used to stroke paths. This represents a
   * zero-terminated array of numbers that specify the lengths of alternating dashes and gaps
   * in pixels. If a zero value is not found it will be added. If an odd number of values is
   * provided, then the list of values is repeated to yield an even number of values.
   */
  get strokeDashArray() {
    return this._drawing.strokeDashArray;
  }
  set strokeDashArray(e) {
    this._drawing.strokeDashArray = e;
  }
  /**
   * Gets or sets the distance into the dash pattern to start the dash (default 0) while
   * drawing using a dash pattern.
  */
  get strokeDashOffset() {
    return this._drawing.strokeDashOffset;
  }
  set strokeDashOffset(e) {
    this._drawing.strokeDashOffset = e;
  }
  /**
   * Gets or sets the stroke width for drawing lines, circles, ellipses, etc.
   */
  get strokeWidth() {
    return this._drawing.strokeWidth;
  }
  set strokeWidth(e) {
    this.setDefineAndArtifact("stroke", e?.toString()), this._drawing.strokeWidth = e;
  }
  /**
   * Gets or sets a value indicating whether text anti-aliasing should be enabled (default true).
   */
  get textAntiAlias() {
    return this._drawing.textAntiAlias;
  }
  set textAntiAlias(e) {
    this._drawing.textAntiAlias = e;
  }
  /**
   * Gets or sets the text inter-line spacing.
   */
  textInterlineSpacing;
  /**
   * Gets or sets the text inter-character kerning.
   */
  get textKerning() {
    return this._drawing.textKerning;
  }
  set textKerning(e) {
    this.setDefineAndArtifact("kerning", e?.toString()), this._drawing.textKerning = e;
  }
  /**
   * Gets or sets the text annotation gravity.
   */
  get textGravity() {
    return this._drawing.textGravity;
  }
  set textGravity(e) {
    this.setDefineAndArtifact("gravity", ko(e)), this._drawing.textGravity = e;
  }
  /**
   * Gets or sets the text undercolor box.
   */
  get textUnderColor() {
    return this._drawing.textUnderColor;
  }
  set textUnderColor(e) {
    this._drawing.textUnderColor = e;
  }
  getDefine(e, n) {
    return n !== void 0 ? this._options[`${e}:${n}`] ?? null : this._options[e] ?? null;
  }
  removeDefine(e, n) {
    if (n === void 0)
      delete this._options[e];
    else {
      const t = this.parseDefine(e, n);
      delete this._options[t];
    }
  }
  setDefine(e, n, t) {
    if (t === void 0)
      this._options[e] = n;
    else {
      const _ = this.parseDefine(e, n);
      typeof t == "string" ? this._options[_] = t : typeof t == "number" ? this._options[_] = t.toString() : this._options[_] = t ? "true" : "false";
    }
  }
  /**
   * Sets format-specific options with the specified defines.
   */
  setDefines(e) {
    e.getDefines().forEach((n) => {
      n !== void 0 && this.setDefine(n.format, n.name, n.value);
    });
  }
  /** @internal */
  _clone() {
    const e = new lt();
    return Object.assign(e, this), e;
  }
  /** @internal */
  _use(e) {
    const n = new oi(this);
    return le._disposeAfterExecution(n, e);
  }
  parseDefine(e, n) {
    return e === Le.Unknown ? n : `${e}:${n}`;
  }
  setDefineAndArtifact(e, n) {
    n === void 0 ? this.removeDefine(e) : this.setDefine(e, n), this._onArtifact !== void 0 && this._onArtifact(e, n);
  }
}
class be extends lt {
  constructor(e) {
    super(), Object.assign(this, e);
  }
  /**
   * Gets or sets the specified area to extract from the image.
   */
  extractArea;
  /**
   * Gets or sets the index of the image to read from a multi layer/frame image.
   */
  frameIndex;
  /**
   * Gets or sets the number of images to read from a multi layer/frame image.
   */
  frameCount;
  /**
   * Gets or sets the height.
   */
  height;
  /**
   * Gets or sets a value indicating whether the exif profile should be used to update
   * some of the properties of the image (e.g. {@link MagickImage#density},
   * {@link MagickImage#orientation}).
   */
  get syncImageWithExifProfile() {
    const e = this.getDefine("exif:sync-image");
    return e === null ? !0 : e.toLowerCase() === "true";
  }
  set syncImageWithExifProfile(e) {
    this.setDefine("exif:sync-image", e.toString());
  }
  /**
   * Gets or sets a value indicating whether the tiff profile should be used to update
   * some of the properties of the image (e.g. {@link MagickImage#density},
   * {@link MagickImage#orientation}).
   */
  get syncImageWithTiffProperties() {
    const e = this.getDefine("tiff:sync-image");
    return e === null ? !0 : e.toLowerCase() === "true";
  }
  set syncImageWithTiffProperties(e) {
    this.setDefine("tiff:sync-image", e.toString());
  }
  /**
   * Gets or sets the width.
   */
  width;
  /** @internal */
  _use(e) {
    const n = new oi(this), t = this.getSize();
    if (t !== "" && A(t, (_) => {
      c._api._MagickSettings_SetSize(n._instance, _);
    }), this.frameIndex !== void 0 || this.frameCount !== void 0) {
      const _ = this.frameIndex ?? 0, g = this.frameCount ?? 1;
      c._api._MagickSettings_SetScene(n._instance, _), c._api._MagickSettings_SetNumberScenes(n._instance, g);
      const p = this.frameCount !== void 0 ? `${_}-${_ + g}` : _.toString();
      A(p.toString(), (m) => {
        c._api._MagickSettings_SetScenes(n._instance, m);
      });
    }
    return this.extractArea !== void 0 && A(this.extractArea.toString(), (_) => {
      c._api._MagickSettings_Extract_Set(n._instance, _);
    }), le._disposeAfterExecution(n, e);
  }
  getSize() {
    return this.width !== void 0 && this.height !== void 0 ? `${this.width}x${this.height}` : this.width !== void 0 ? `${this.width}x` : this.height !== void 0 ? `x${this.height}` : "";
  }
}
const _i = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * No.
   */
  No: 1,
  /**
   * Riemersma.
   */
  Riemersma: 2,
  /**
   * FloydSteinberg.
   */
  FloydSteinberg: 3
};
class Co extends Ke {
  constructor(e) {
    const n = c._api._QuantizeSettings_Create(), t = c._api._QuantizeSettings_Dispose;
    super(n, t), c._api._QuantizeSettings_SetColors(this._instance, e.colors), c._api._QuantizeSettings_SetColorSpace(this._instance, e.colorSpace), c._api._QuantizeSettings_SetDitherMethod(this._instance, e.ditherMethod ?? _i.No), c._api._QuantizeSettings_SetMeasureErrors(this._instance, e.measureErrors ? 1 : 0), c._api._QuantizeSettings_SetTreeDepth(this._instance, e.treeDepth);
  }
}
class nr {
  constructor() {
    this.colors = 256, this.colorSpace = T.Undefined, this.ditherMethod = _i.Riemersma, this.measureErrors = !1, this.treeDepth = 0;
  }
  /**
   * Gets or sets the maximum number of colors to quantize to.
   */
  colors;
  /**
   * Gets or sets the colorspace to quantize in.
   */
  colorSpace;
  /// <summary>
  /// Gets or sets the dither method to use.
  /// </summary>
  ditherMethod;
  /// <summary>
  /// Gets or sets a value indicating whether errors should be measured.
  /// </summary>
  measureErrors;
  /// <summary>
  /// Gets or sets the quantization tree-depth.
  /// </summary>
  treeDepth;
  /** @internal */
  _use(e) {
    const n = new Co(this);
    return le._disposeAfterExecution(n, e);
  }
}
class Ee {
  _image;
  _names = [];
  constructor(e) {
    this._image = e;
  }
  setArtifact(e, n) {
    this._names.push(e), this._image.setArtifact(e, n);
  }
  static use(e, n) {
    const t = new Ee(e);
    try {
      return n(t);
    } finally {
      t.dispose();
    }
  }
  dispose() {
    for (const e of this._names)
      this._image.removeArtifact(e);
  }
}
class ke extends Array {
  constructor() {
    super();
  }
  static create(e) {
    const n = ke.createObject();
    return e !== void 0 && n.read(e), n;
  }
  dispose() {
    let e = this.pop();
    for (; e !== void 0; )
      e.dispose(), e = this.pop();
  }
  appendHorizontally(e) {
    return this.createImage((n, t) => c._api._MagickImageCollection_Append(n, 0, t.ptr), e);
  }
  appendVertically(e) {
    return this.createImage((n, t) => c._api._MagickImageCollection_Append(n, 1, t.ptr), e);
  }
  clone(e) {
    return ke.use((n) => {
      for (let t = 0; t < this.length; t++)
        n.push(ie._clone(this[t]));
      return e(n);
    });
  }
  coalesce() {
    this.replaceImages((e, n) => c._api._MagickImageCollection_Coalesce(e, n.ptr));
  }
  combine(e, n) {
    let t = n, _ = T.sRGB;
    return typeof e == "number" ? _ = e : t = e, this.createImage((g, p) => c._api._MagickImageCollection_Combine(g, _, p.ptr), t);
  }
  complex(e, n) {
    return Ee.use(this[0], (t) => (e._setArtifacts(t), this.createImage((_, g) => c._api._MagickImageCollection_Complex(_, e.complexOperator, g.ptr), n)));
  }
  deconstruct() {
    this.replaceImages((e, n) => c._api._MagickImageCollection_Deconstruct(e, n.ptr));
  }
  evaluate(e, n) {
    return this.createImage((t, _) => c._api._MagickImageCollection_Evaluate(t, e, _.ptr), n);
  }
  flatten(e) {
    return this.mergeImages(Pt.Flatten, e);
  }
  fx(e, n, t) {
    this.throwIfEmpty();
    let _ = X.All, g = t;
    return typeof n == "number" ? _ = n : g = n, A(e, (p) => this.createImage((m, S) => c._api._MagickImageCollection_Fx(m, p, _, S.ptr), g));
  }
  merge(e) {
    return this.mergeImages(Pt.Merge, e);
  }
  montage(e, n) {
    return this.throwIfEmpty(), this.attachImages((t) => {
      const _ = e._use((g) => E.use((p) => {
        const m = c._api._MagickImageCollection_Montage(t, g._instance, p.ptr);
        return this.checkResult(m, p);
      }));
      return ke._createFromImages(_, this.getSettings(), (g) => {
        const p = e.transparentColor;
        return p !== void 0 && g.forEach((m) => {
          m.transparent(p);
        }), g.merge(n);
      });
    });
  }
  morph(e) {
    if (this.length < 2)
      throw new Y("operation requires at least two images");
    this.replaceImages((n, t) => c._api._MagickImageCollection_Morph(n, e, t.ptr));
  }
  mosaic(e) {
    return this.mergeImages(Pt.Mosaic, e);
  }
  optimize() {
    this.replaceImages((e, n) => c._api._MagickImageCollection_Optimize(e, n.ptr));
  }
  optimizePlus() {
    this.replaceImages((e, n) => c._api._MagickImageCollection_OptimizePlus(e, n.ptr));
  }
  optimizeTransparency() {
    this.throwIfEmpty(), this.attachImages((e) => {
      E.usePointer((n) => {
        c._api._MagickImageCollection_OptimizeTransparency(e, n);
      });
    });
  }
  ping(e, n) {
    this.readOrPing(!0, e, n);
  }
  polynomial(e, n) {
    return this.createImage((t, _) => Et(e, (g) => c._api._MagickImageCollection_Polynomial(t, g, e.length, _.ptr)), n);
  }
  quantize(e) {
    this.throwIfEmpty();
    const n = e === void 0 ? new nr() : e;
    return this.attachImages((t) => {
      n._use((_) => {
        E.usePointer((g) => {
          c._api._MagickImageCollection_Quantize(t, _._instance, g);
        });
      });
    }), n.measureErrors ? bt._create(this[0]) : null;
  }
  read(e, n) {
    this.readOrPing(!1, e, n);
  }
  remap(e, n) {
    this.throwIfEmpty();
    const t = n === void 0 ? new nr() : n;
    this.attachImages((_) => {
      t._use((g) => {
        E.use((p) => {
          c._api._MagickImageCollection_Remap(_, g._instance, e._instance, p.ptr);
        });
      });
    });
  }
  resetPage() {
    this.forEach((e) => {
      e.resetPage();
    });
  }
  smushHorizontal(e, n) {
    return this.smush(e, !1, n);
  }
  smushVertical(e, n) {
    return this.smush(e, !0, n);
  }
  trimBounds() {
    this.mergeImages(Pt.Trimbounds, () => {
    });
  }
  static use(e) {
    const n = ke.create();
    return le._disposeAfterExecution(n, e);
  }
  write(e, n) {
    this.throwIfEmpty();
    let t = 0, _ = 0;
    const g = this[0], p = this.getSettings();
    n !== void 0 ? p.format = e : (n = e, p.format = g.format), E.use((S) => {
      Re.use((R) => {
        p._use(($) => {
          this.attachImages((V) => {
            t = c._api._MagickImage_WriteBlob(V, $._instance, R.ptr, S.ptr), _ = R.value;
          });
        });
      });
    });
    const m = new ai(t, _, n);
    return le._disposeAfterExecution(m, m.func);
  }
  /** @internal */
  static _createFromImages(e, n, t) {
    const _ = ke.createObject();
    return _.addImages(e, n._clone()), t(_);
  }
  addImages(e, n) {
    n.format = Le.Unknown;
    let t = e;
    for (; t !== 0; ) {
      const _ = c._api._MagickImage_GetNext(t);
      c._api._MagickImage_SetNext(t, 0), this.push(ie._createFromImage(t, n)), t = _;
    }
  }
  attachImages(e) {
    try {
      for (let n = 0; n < this.length - 1; n++)
        c._api._MagickImage_SetNext(this[n]._instance, this[n + 1]._instance);
      return e(this[0]._instance);
    } finally {
      for (let n = 0; n < this.length - 1; n++)
        c._api._MagickImage_SetNext(this[n]._instance, 0);
    }
  }
  checkResult(e, n) {
    return n.check(() => e, () => (c._api._MagickImageCollection_Dispose(e), 0));
  }
  static createObject() {
    return Object.create(ke.prototype);
  }
  createImage(e, n) {
    this.throwIfEmpty();
    const t = this.attachImages((g) => E.use((p) => {
      const m = e(g, p);
      return this.checkResult(m, p);
    }));
    return ie._createFromImage(t, this.getSettings())._use(n);
  }
  getSettings() {
    return this[0]._getSettings()._clone();
  }
  mergeImages(e, n) {
    return this.createImage((t, _) => c._api._MagickImageCollection_Merge(t, e, _.ptr), n);
  }
  readOrPing(e, n, t) {
    this.dispose(), E.use((_) => {
      const g = t === void 0 ? new be() : new be(t);
      g._ping = e, typeof n == "string" ? (g._fileName = n, g._use((p) => {
        const m = c._api._MagickImageCollection_ReadFile(p._instance, _.ptr);
        this.addImages(m, g);
      })) : g._use((p) => {
        const m = n.byteLength;
        let S = 0;
        try {
          S = c._api._malloc(m), c._api.HEAPU8.set(n, S);
          const R = c._api._MagickImageCollection_ReadBlob(p._instance, S, 0, m, _.ptr);
          this.addImages(R, g);
        } finally {
          S !== 0 && c._api._free(S);
        }
      });
    });
  }
  replaceImages(e) {
    this.throwIfEmpty();
    const n = this.attachImages((_) => E.use((g) => {
      const p = e(_, g);
      return this.checkResult(p, g);
    })), t = this.getSettings()._clone();
    this.dispose(), this.addImages(n, t);
  }
  smush(e, n, t) {
    return this.createImage((_, g) => c._api._MagickImageCollection_Smush(_, e, n ? 1 : 0, g.ptr), t);
  }
  throwIfEmpty() {
    if (this.length === 0)
      throw new Y("operation requires at least one image");
  }
}
class re {
  _value;
  /**
   * Initializes a new instance of the {@link Percentage} class.
   * @param value -The value (0% = 0.0, 100% = 100.0)
   */
  constructor(e) {
    this._value = e;
  }
  /** @internal */
  static _fromQuantum(e) {
    return new re(e / Fe.max * 100);
  }
  /**
   * ultiplies the value by the specified percentage.
   * @param value The value to use.
   * @returns The new value.
   */
  multiply(e) {
    return e * this._value / 100;
  }
  /**
   * Returns a double that represents the current percentage.
   * @returns A double that represents the current percentage.
   */
  toDouble() {
    return this._value;
  }
  /**
   * Returns a string that represents the current percentage.
   * @returns A string that represents the current percentage.
   */
  toString() {
    return `${parseFloat(this._value.toFixed(2))}%`;
  }
  /** @internal */
  _toQuantum() {
    return Fe.max * (this._value / 100);
  }
}
class Io {
  static use(e, n, t) {
    const _ = c._api._MagickRectangle_Create();
    try {
      c._api._MagickRectangle_X_Set(_, n.x), c._api._MagickRectangle_Y_Set(_, n.y);
      let g = n.width, p = n.height;
      return n.isPercentage && (g = new re(n.width).multiply(e.width), p = new re(n.height).multiply(e.height)), c._api._MagickRectangle_Width_Set(_, g), c._api._MagickRectangle_Height_Set(_, p), t(_);
    } finally {
      c._api._MagickRectangle_Dispose(_);
    }
  }
}
class Po {
  static _use(e, n, t) {
    let _ = 0;
    try {
      return _ = c._api._OffsetInfo_Create(), c._api._PrimaryInfo_X_Set(_, e), c._api._PrimaryInfo_Y_Set(_, n), t(_);
    } finally {
      c._api._free(_);
    }
  }
}
class ti {
  _values;
  constructor() {
    this._values = new Array(7).fill(0);
  }
  get(e) {
    return this._values[e];
  }
  set(e, n) {
    this._values[e] = n;
  }
}
class tt {
  _huPhashes = /* @__PURE__ */ new Map();
  _hash = "";
  channel;
  constructor(e, n, t) {
    if (this.channel = e, typeof t == "number")
      for (let _ = 0; _ < n.length; _++) {
        const g = new ti();
        for (let p = 0; p < 7; p++) {
          const m = c._api._ChannelPerceptualHash_GetHuPhash(t, _, p);
          g.set(p, m);
        }
        this._huPhashes.set(n[_], g);
      }
    else
      this.parseHash(n, t);
  }
  huPhash(e, n) {
    if (n < 0 || n > 6)
      throw new Y("Invalid index specified");
    const t = this._huPhashes.get(e);
    if (t === void 0)
      throw new Y("Invalid color space specified");
    return t.get(n);
  }
  sumSquaredDistance(e) {
    let n = 0;
    return this._huPhashes.forEach((t, _) => {
      for (let g = 0; g < 7; g++) {
        const p = t.get(g), m = e.huPhash(_, g);
        n += (p - m) * (p - m);
      }
    }), n;
  }
  toString() {
    return this._hash == "" && this.setHash(), this._hash;
  }
  parseHash(e, n) {
    this._hash = n;
    let t = 0;
    for (const _ of e) {
      const g = new ti();
      for (let p = 0; p < 7; p++, t += 5) {
        const m = Number.parseInt(n.substring(t, t + 5), 16);
        if (isNaN(m))
          throw new Y("Invalid hash specified");
        let S = m / tt.powerOfTen(m >> 17);
        (m & 65536) != 0 && (S = -S), g.set(p, S);
      }
      this._huPhashes.set(_, g);
    }
  }
  static powerOfTen(e) {
    switch (e) {
      case 2:
        return 100;
      case 3:
        return 1e3;
      case 4:
        return 1e4;
      case 5:
        return 1e5;
      case 6:
        return 1e6;
      default:
        return 10;
    }
  }
  setHash() {
    this._hash = "", this._huPhashes.forEach((e) => {
      for (let n = 0; n < 7; n++) {
        let t = e.get(n), _ = 0;
        for (; _ < 7 && Math.abs(t * 10) < 65356; )
          t *= 10, _++;
        _ <<= 1, _ < 0 && (_ |= 1), _ = (_ << 16) + Math.floor(t < 0 ? -(t - 0.5) : t + 0.5), this._hash += _.toString(16);
      }
    });
  }
}
class Me {
  _red;
  _green;
  _blue;
  constructor(e, n, t) {
    if (typeof e == "string") {
      const _ = n ?? Me._defaultColorspaces();
      Me._validateColorSpaces(_);
      const g = 35 * _.length;
      if (e.length !== 3 * g)
        throw new Y("Invalid hash size");
      this._red = new tt(G.Red, _, e.substring(0, g)), this._blue = new tt(G.Blue, _, e.substring(g, g + g)), this._green = new tt(G.Green, _, e.substring(g + g));
    } else
      this._red = e, this._green = n, this._blue = t;
  }
  /** @internal */
  static _create(e, n, t) {
    if (t === 0)
      throw new Y("The native operation failed to create an instance");
    const _ = Me.createChannel(e, n, t, G.Red), g = Me.createChannel(e, n, t, G.Green), p = Me.createChannel(e, n, t, G.Blue);
    return new Me(_, g, p);
  }
  /** @internal */
  static _defaultColorspaces() {
    return [T.XyY, T.HSB];
  }
  /** @internal */
  static _validateColorSpaces(e) {
    if (e.length < 1 || e.length > 6)
      throw new Y("Invalid number of colorspaces, the minimum is 1 and the maximum is 6");
    if (new Set(e).size !== e.length)
      throw new Y("Specifying the same colorspace more than once is not allowed");
  }
  getChannel(e) {
    switch (e) {
      case G.Red:
        return this._red;
      case G.Green:
        return this._green;
      case G.Blue:
        return this._blue;
      default:
        return null;
    }
  }
  sumSquaredDistance(e) {
    const n = e.getChannel(G.Red), t = e.getChannel(G.Green), _ = e.getChannel(G.Blue);
    if (n === null || t === null || _ === null)
      throw new Y("The other perceptual hash should contain a red, green and blue channel.");
    return this._red.sumSquaredDistance(n) + this._green.sumSquaredDistance(t) + this._blue.sumSquaredDistance(_);
  }
  toString() {
    return this._red.toString() + this._green.toString() + this._blue.toString();
  }
  static createChannel(e, n, t, _) {
    const g = c._api._PerceptualHash_GetInstance(e._instance, t, _);
    return new tt(_, n, g);
  }
}
class it extends Ke {
  image;
  constructor(e) {
    const n = E.usePointer((_) => c._api._PixelCollection_Create(e._instance, _)), t = c._api._PixelCollection_Dispose;
    super(n, t), this.image = e;
  }
  /** @internal */
  static _create(e) {
    return new it(e);
  }
  static _use(e, n) {
    const t = new it(e);
    return le._disposeAfterExecution(t, n);
  }
  /** @internal */
  static _map(e, n, t) {
    const _ = new it(e);
    try {
      _.use(0, 0, e.width, e.height, n, (g) => {
        t(g);
      });
    } finally {
      _.dispose();
    }
  }
  getArea(e, n, t, _) {
    return E.usePointer((g) => {
      const p = c._api._PixelCollection_GetArea(this._instance, e, n, t, _, g), m = t * _ * this.image.channelCount;
      return c._api.HEAPU8.subarray(p, p + m);
    });
  }
  getReadOnlyArea(e, n, t, _) {
    return E.usePointer((g) => {
      const p = c._api._PixelCollection_GetReadOnlyArea(this.image._instance, e, n, t, _, g), m = t * _ * this.image.channelCount;
      return c._api.HEAPU8.subarray(p, p + m);
    });
  }
  getChannelIndex(e) {
    return this.image._channelOffset(e);
  }
  getColor(e, n) {
    const t = this.getArea(e, n, 1, 1), _ = Array.from(t), g = this.image._channelOffset(G.Index);
    if (g >= 0 && _.splice(g, 1), _.length === 0)
      return null;
    if (_.length === 1)
      return new k(_[0], _[0], _[0]);
    if (_.length === 2)
      return new k(_[0], _[0], _[0], _[1]);
    const p = this.image._channelOffset(G.Black) >= 0, m = this.image._channelOffset(G.Alpha) >= 0;
    return p ? _.length === 4 || !m ? new k(_[0], _[1], _[2], _[3], Fe.max) : new k(_[0], _[1], _[2], _[3], _[4]) : _.length === 3 || !m ? new k(_[0], _[1], _[2]) : new k(_[0], _[1], _[2], _[3]);
  }
  getPixel(e, n) {
    return this.getArea(e, n, 1, 1);
  }
  setArea(e, n, t, _, g) {
    E.usePointer((p) => {
      const m = g instanceof Uint8Array ? g : new Uint8Array(g);
      vo(m, (S) => {
        c._api._PixelCollection_SetArea(this._instance, e, n, t, _, S, m.length, p);
      });
    });
  }
  setPixel(e, n, t) {
    t instanceof Uint8Array ? this.setArea(e, n, 1, 1, t) : this.setArea(e, n, 1, 1, t);
  }
  toByteArray(e, n, t, _, g) {
    return this.use(e, n, t, _, g, (p) => {
      if (p === 0)
        return null;
      const m = t * _ * g.length;
      return c._api.HEAPU8.slice(p, p + m);
    });
  }
  use(e, n, t, _, g, p) {
    return A(g, (m) => E.use((S) => {
      let R = c._api._PixelCollection_ToByteArray(this._instance, e, n, t, _, m, S.ptr);
      return S.check(() => {
        const $ = p(R);
        return R = c._api._MagickMemory_Relinquish(R), $;
      }, () => (R = c._api._MagickMemory_Relinquish(R), null));
    }));
  }
}
const Do = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Average.
   */
  Average: 1,
  /**
   * Brightness.
   */
  Brightness: 2,
  /**
   * Lightness.
   */
  Lightness: 3,
  /**
   * MS.
   */
  MS: 4,
  /**
   * Rec601Luma.
   */
  Rec601Luma: 5,
  /**
   * Rec601Luminance.
   */
  Rec601Luminance: 6,
  /**
   * Rec709Luma.
   */
  Rec709Luma: 7,
  /**
   * Rec709Luminance.
   */
  Rec709Luminance: 8,
  /**
   * RMS.
   */
  RMS: 9
}, Eo = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Average.
   */
  Average: 1,
  /**
   * Average9.
   */
  Average9: 2,
  /**
   * Average16.
   */
  Average16: 3,
  /**
   * Background.
   */
  Background: 4,
  /**
   * Bilinear.
   */
  Bilinear: 5,
  /**
   * Blend.
   */
  Blend: 6,
  /**
   * Catrom.
   */
  Catrom: 7,
  /**
   * Integer.
   */
  Integer: 8,
  /**
   * Mesh.
   */
  Mesh: 9,
  /**
   * Nearest.
   */
  Nearest: 10,
  /**
   * Spline.
   */
  Spline: 11
};
class qe {
  /**
   * Initializes a new instance of the {@link PrimaryInfo} class.
   * @param x The x,
   * @param y The y.
   * @param z The z.
   */
  constructor(e, n, t) {
    this.x = e, this.y = n, this.z = t;
  }
  /**
   * Gets the X value.
   */
  x;
  /**
   * Gets the Y value.
   */
  y;
  /**
   * Gets the Z value.
   */
  z;
  /** @internal */
  static _create(e) {
    return e === 0 ? new qe(0, 0, 0) : new qe(
      c._api._PrimaryInfo_X_Get(e),
      c._api._PrimaryInfo_Y_Get(e),
      c._api._PrimaryInfo_Z_Get(e)
    );
  }
  /** @internal */
  _use(e) {
    let n = 0;
    try {
      n = c._api._PrimaryInfo_Create(), c._api._PrimaryInfo_X_Set(n, this.x), c._api._PrimaryInfo_Y_Set(n, this.y), c._api._PrimaryInfo_Z_Set(n, this.z), e(n);
    } finally {
      c._api._PrimaryInfo_Dispose(n);
    }
  }
}
class To {
  channel;
  depth;
  entropy;
  kurtosis;
  maximum;
  mean;
  minimum;
  skewness;
  standardDeviation;
  constructor(e, n) {
    this.channel = e, this.depth = c._api._ChannelStatistics_Depth_Get(n), this.entropy = c._api._ChannelStatistics_Entropy_Get(n), this.kurtosis = c._api._ChannelStatistics_Kurtosis_Get(n), this.maximum = c._api._ChannelStatistics_Maximum_Get(n), this.mean = c._api._ChannelStatistics_Mean_Get(n), this.minimum = c._api._ChannelStatistics_Minimum_Get(n), this.skewness = c._api._ChannelStatistics_Skewness_Get(n), this.standardDeviation = c._api._ChannelStatistics_StandardDeviation_Get(n);
  }
}
class ur {
  _channels = /* @__PURE__ */ new Map();
  get channels() {
    return Array.from(this._channels.keys());
  }
  composite() {
    return this._channels.get(G.Composite);
  }
  getChannel(e) {
    const n = this._channels.get(e);
    return n !== void 0 ? n : null;
  }
  static _create(e, n, t) {
    const _ = new ur();
    return e.channels.forEach((g) => {
      (t >> g & 1) != 0 && _.addChannel(n, g);
    }), _.addChannel(n, G.Composite), _;
  }
  addChannel(e, n) {
    const t = c._api._Statistics_GetInstance(e, n);
    t !== 0 && this._channels.set(n, new To(n, t));
  }
}
class bo {
  static toArray(e) {
    if (e === 0)
      return null;
    const n = c._api._StringInfo_Datum_Get(e), t = c._api._StringInfo_Length_Get(e);
    return c._api.HEAPU8.subarray(n, n + t);
  }
}
class ri {
  /** @internal */
  constructor(e) {
    this.error = e;
  }
  /**
   * Gets the warning that was raised.
   */
  error;
}
class ie extends Ke {
  _settings;
  _progress;
  _warning;
  constructor(e, n) {
    super(e, c._api._MagickImage_Dispose), this._settings = n, this._settings._onArtifact = this.onSettingsArtifactChanged.bind(this);
  }
  get animationDelay() {
    return c._api._MagickImage_AnimationDelay_Get(this._instance);
  }
  set animationDelay(e) {
    c._api._MagickImage_AnimationDelay_Set(this._instance, e);
  }
  get animationIterations() {
    return c._api._MagickImage_AnimationIterations_Get(this._instance);
  }
  set animationIterations(e) {
    c._api._MagickImage_AnimationIterations_Set(this._instance, e);
  }
  get animationTicksPerSecond() {
    return c._api._MagickImage_AnimationTicksPerSecond_Get(this._instance);
  }
  set animationTicksPerSecond(e) {
    c._api._MagickImage_AnimationTicksPerSecond_Set(this._instance, e);
  }
  get artifactNames() {
    const e = [];
    c._api._MagickImage_ResetArtifactIterator(this._instance);
    let n = c._api._MagickImage_GetNextArtifactName(this._instance);
    for (; n !== 0; )
      e.push(c._api.UTF8ToString(n)), n = c._api._MagickImage_GetNextArtifactName(this._instance);
    return e;
  }
  get attributeNames() {
    const e = [];
    c._api._MagickImage_ResetAttributeIterator(this._instance);
    let n = c._api._MagickImage_GetNextAttributeName(this._instance);
    for (; n !== 0; )
      e.push(c._api.UTF8ToString(n)), n = c._api._MagickImage_GetNextAttributeName(this._instance);
    return e;
  }
  get backgroundColor() {
    const e = c._api._MagickImage_BackgroundColor_Get(this._instance);
    return k._create(e);
  }
  set backgroundColor(e) {
    e._use((n) => {
      c._api._MagickImage_BackgroundColor_Set(this._instance, n);
    });
  }
  get baseHeight() {
    return c._api._MagickImage_BaseHeight_Get(this._instance);
  }
  get baseWidth() {
    return c._api._MagickImage_BaseWidth_Get(this._instance);
  }
  get blackPointCompensation() {
    return c._api._MagickImage_BlackPointCompensation_Get(this._instance) === 1;
  }
  set blackPointCompensation(e) {
    c._api._MagickImage_BlackPointCompensation_Set(this._instance, e ? 1 : 0);
  }
  get borderColor() {
    const e = c._api._MagickImage_BorderColor_Get(this._instance);
    return k._create(e);
  }
  set borderColor(e) {
    e._use((n) => {
      c._api._MagickImage_BorderColor_Set(this._instance, n);
    });
  }
  get boundingBox() {
    return this.useExceptionPointer((e) => {
      const n = c._api._MagickImage_BoundingBox_Get(this._instance, e), t = ae._fromRectangle(n);
      return t.width === 0 || t.height === 0 ? null : t;
    });
  }
  get channelCount() {
    return c._api._MagickImage_ChannelCount_Get(this._instance);
  }
  get channels() {
    const e = [];
    return [G.Red, G.Green, G.Blue, G.Black, G.Alpha].forEach((n) => {
      c._api._MagickImage_HasChannel(this._instance, n) && e.push(n);
    }), e;
  }
  get chromaticity() {
    return new lo(
      qe._create(c._api._MagickImage_ChromaRed_Get(this._instance)),
      qe._create(c._api._MagickImage_ChromaGreen_Get(this._instance)),
      qe._create(c._api._MagickImage_ChromaBlue_Get(this._instance)),
      qe._create(c._api._MagickImage_ChromaWhite_Get(this._instance))
    );
  }
  set chromaticity(e) {
    e.blue._use((n) => c._api._MagickImage_ChromaBlue_Set(this._instance, n)), e.green._use((n) => c._api._MagickImage_ChromaGreen_Set(this._instance, n)), e.red._use((n) => c._api._MagickImage_ChromaRed_Set(this._instance, n)), e.white._use((n) => c._api._MagickImage_ChromaWhite_Set(this._instance, n));
  }
  get classType() {
    return c._api._MagickImage_ClassType_Get(this._instance);
  }
  set classType(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_ClassType_Set(this._instance, e, n);
    });
  }
  get colorFuzz() {
    return re._fromQuantum(c._api._MagickImage_ColorFuzz_Get(this._instance));
  }
  set colorFuzz(e) {
    const n = e._toQuantum();
    c._api._MagickImage_ColorFuzz_Set(this._instance, n), this._settings._colorFuzz = n;
  }
  get colormapSize() {
    return c._api._MagickImage_ColormapSize_Get(this._instance);
  }
  set colormapSize(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_ColormapSize_Set(this._instance, e, n);
    });
  }
  get colorSpace() {
    return c._api._MagickImage_ColorSpace_Get(this._instance);
  }
  set colorSpace(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_ColorSpace_Set(this._instance, e, n);
    });
  }
  get colorType() {
    return this.settings.colorType !== void 0 ? this.settings.colorType : c._api._MagickImage_ColorType_Get(this._instance);
  }
  set colorType(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_ColorType_Set(this._instance, e, n);
    });
  }
  get comment() {
    return this.getAttribute("comment");
  }
  set comment(e) {
    e === null ? this.removeAttribute("comment") : this.setAttribute("comment", e);
  }
  get compose() {
    return c._api._MagickImage_Compose_Get(this._instance);
  }
  set compose(e) {
    c._api._MagickImage_Compose_Set(this._instance, e);
  }
  get compression() {
    return c._api._MagickImage_Compression_Get(this._instance);
  }
  get density() {
    return new rt(
      c._api._MagickImage_ResolutionX_Get(this._instance),
      c._api._MagickImage_ResolutionY_Get(this._instance),
      c._api._MagickImage_ResolutionUnits_Get(this._instance)
    );
  }
  set density(e) {
    c._api._MagickImage_ResolutionX_Set(this._instance, e.x), c._api._MagickImage_ResolutionY_Set(this._instance, e.y), c._api._MagickImage_ResolutionUnits_Set(this._instance, e.units);
  }
  get depth() {
    return c._api._MagickImage_Depth_Get(this._instance);
  }
  set depth(e) {
    c._api._MagickImage_Depth_Set(this._instance, e);
  }
  get endian() {
    return c._api._MagickImage_Endian_Get(this._instance);
  }
  set endian(e) {
    c._api._MagickImage_Endian_Set(this._instance, e);
  }
  get fileName() {
    const e = c._api._MagickImage_FileName_Get(this._instance);
    return e === 0 ? null : c._api.UTF8ToString(e);
  }
  get filterType() {
    return c._api._MagickImage_FilterType_Get(this._instance);
  }
  set filterType(e) {
    c._api._MagickImage_FilterType_Set(this._instance, e);
  }
  get format() {
    return ce(c._api._MagickImage_Format_Get(this._instance), "");
  }
  set format(e) {
    A(e.toString(), (n) => c._api._MagickImage_Format_Set(this._instance, n));
  }
  get gamma() {
    return c._api._MagickImage_Gamma_Get(this._instance);
  }
  get gifDisposeMethod() {
    return c._api._MagickImage_GifDisposeMethod_Get(this._instance);
  }
  set gifDisposeMethod(e) {
    c._api._MagickImage_GifDisposeMethod_Set(this._instance, e);
  }
  get hasAlpha() {
    return this.toBool(c._api._MagickImage_HasAlpha_Get(this._instance));
  }
  set hasAlpha(e) {
    this.useExceptionPointer((n) => {
      e && this.alpha(co.Opaque), c._api._MagickImage_HasAlpha_Set(this._instance, this.fromBool(e), n);
    });
  }
  get height() {
    return c._api._MagickImage_Height_Get(this._instance);
  }
  get interlace() {
    return c._api._MagickImage_Interlace_Get(this._instance);
  }
  get isOpaque() {
    return this.useExceptionPointer((e) => this.toBool(c._api._MagickImage_IsOpaque_Get(this._instance, e)));
  }
  get interpolate() {
    return c._api._MagickImage_Interpolate_Get(this._instance);
  }
  set interpolate(e) {
    c._api._MagickImage_Interpolate_Set(this._instance, e);
  }
  get label() {
    return this.getAttribute("label");
  }
  set label(e) {
    e === null ? this.removeAttribute("label") : this.setAttribute("label", e);
  }
  get matteColor() {
    const e = c._api._MagickImage_MatteColor_Get(this._instance);
    return k._create(e);
  }
  set matteColor(e) {
    e._use((n) => {
      c._api._MagickImage_MatteColor_Set(this._instance, n);
    });
  }
  get metaChannelCount() {
    return c._api._MagickImage_MetaChannelCount_Get(this._instance);
  }
  set metaChannelCount(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_MetaChannelCount_Set(this._instance, e, n);
    });
  }
  get orientation() {
    return c._api._MagickImage_Orientation_Get(this._instance);
  }
  set orientation(e) {
    c._api._MagickImage_Orientation_Set(this._instance, e);
  }
  get onProgress() {
    return this._progress;
  }
  set onProgress(e) {
    e !== void 0 ? se.setProgressDelegate(this) : this.disposeProgressDelegate(), this._progress = e;
  }
  get onWarning() {
    return this._warning;
  }
  set onWarning(e) {
    this._warning = e;
  }
  get page() {
    const e = c._api._MagickImage_Page_Get(this._instance);
    return ae._fromRectangle(e);
  }
  set page(e) {
    e._toRectangle((n) => {
      c._api._MagickImage_Page_Set(this._instance, n);
    });
  }
  get profileNames() {
    const e = [];
    c._api._MagickImage_ResetProfileIterator(this._instance);
    let n = c._api._MagickImage_GetNextProfileName(this._instance);
    for (; n !== 0; )
      e.push(c._api.UTF8ToString(n)), n = c._api._MagickImage_GetNextProfileName(this._instance);
    return e;
  }
  get quality() {
    return c._api._MagickImage_Quality_Get(this._instance);
  }
  set quality(e) {
    let n = e < 1 ? 1 : e;
    n = n > 100 ? 100 : n, c._api._MagickImage_Quality_Set(this._instance, n), this._settings._quality = n;
  }
  get renderingIntent() {
    return c._api._MagickImage_RenderingIntent_Get(this._instance);
  }
  set renderingIntent(e) {
    c._api._MagickImage_RenderingIntent_Set(this._instance, e);
  }
  get settings() {
    return this._settings;
  }
  get signature() {
    return this.useExceptionPointer((e) => ce(c._api._MagickImage_Signature_Get(this._instance, e)));
  }
  get totalColors() {
    return this.useExceptionPointer((e) => c._api._MagickImage_TotalColors_Get(this._instance, e));
  }
  get virtualPixelMethod() {
    return c._api._MagickImage_VirtualPixelMethod_Get(this._instance);
  }
  set virtualPixelMethod(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_VirtualPixelMethod_Set(this._instance, e, n);
    });
  }
  get width() {
    return c._api._MagickImage_Width_Get(this._instance);
  }
  adaptiveBlur(e, n) {
    const t = this.valueOrDefault(e, 0), _ = this.valueOrDefault(n, 1);
    this.useException((g) => {
      const p = c._api._MagickImage_AdaptiveBlur(this._instance, t, _, g.ptr);
      this._setInstance(p, g);
    });
  }
  adaptiveResize(e, n) {
    const t = typeof e == "number" ? new ae(0, 0, e, n) : e;
    this.useException((_) => {
      A(t.toString(), (g) => {
        const p = c._api._MagickImage_AdaptiveResize(this._instance, g, _.ptr);
        this._setInstance(p, _);
      });
    });
  }
  adaptiveSharpen(e, n, t) {
    let _ = 0;
    const g = n ?? 1;
    let p = t ?? X.Undefined;
    e !== void 0 && (n === void 0 ? p = e : _ = e), this.useException((m) => {
      const S = c._api._MagickImage_AdaptiveSharpen(this._instance, _, g, p, m.ptr);
      this._setInstance(S, m);
    });
  }
  adaptiveThreshold(e, n, t, _) {
    const g = t instanceof re ? t._toQuantum() : 0;
    let p = _ ?? X.Undefined;
    typeof t == "number" && (p = t), this.useException((m) => {
      const S = c._api._MagickImage_AdaptiveThreshold(this._instance, e, n, g, p, m.ptr);
      this._setInstance(S, m);
    });
  }
  addNoise(e, n, t) {
    let _ = 1, g = t ?? X.Undefined;
    n !== void 0 && (t === void 0 ? g = n : _ = n), this.useException((p) => {
      const m = c._api._MagickImage_AddNoise(this._instance, e, _, g, p.ptr);
      this._setInstance(m, p);
    });
  }
  affineTransform(e) {
    this.useException((n) => {
      const t = c._api._MagickImage_AffineTransform(this._instance, e.scaleX, e.scaleY, e.shearX, e.shearY, e.translateX, e.translateY, n.ptr);
      this._setInstance(t, n);
    });
  }
  alpha(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_SetAlpha(this._instance, e, n);
    });
  }
  annotate(e, n, t, _) {
    return this.useExceptionPointer((g) => this._settings._drawing._use((p) => {
      A(e, (m) => {
        let S = null, R = O.Undefined, $ = 0;
        typeof n == "object" ? (S = n.toString(), t !== void 0 && (R = t), _ !== void 0 && ($ = _)) : (R = n, t !== void 0 && ($ = t)), A(S, (V) => {
          c._api._MagickImage_Annotate(this._instance, p._instance, m, V, R, $, g);
        });
      });
    }));
  }
  autoGamma(e) {
    this.useExceptionPointer((n) => {
      const t = this.valueOrDefault(e, X.Composite);
      c._api._MagickImage_AutoGamma(this._instance, t, n);
    });
  }
  autoLevel(e) {
    this.useExceptionPointer((n) => {
      const t = this.valueOrDefault(e, X.Undefined);
      c._api._MagickImage_AutoLevel(this._instance, t, n);
    });
  }
  autoOrient() {
    this.useException((e) => {
      const n = c._api._MagickImage_AutoOrient(this._instance, e.ptr);
      this._setInstance(n, e);
    });
  }
  autoThreshold(e) {
    this.useException((n) => {
      c._api._MagickImage_AutoThreshold(this._instance, e, n.ptr);
    });
  }
  bilateralBlur(e, n, t, _) {
    const g = this.valueOrComputedDefault(t, () => Math.sqrt(e * e + n * n)), p = this.valueOrDefault(_, g * 0.25);
    this.useException((m) => {
      const S = c._api._MagickImage_BilateralBlur(this._instance, e, n, g, p, m.ptr);
      this._setInstance(S, m);
    });
  }
  blackThreshold(e, n) {
    const t = this.valueOrDefault(n, X.Composite);
    this.useException((_) => {
      A(e.toString(), (g) => {
        c._api._MagickImage_BlackThreshold(this._instance, g, t, _.ptr);
      });
    });
  }
  blueShift(e) {
    const n = this.valueOrDefault(e, 1.5);
    this.useException((t) => {
      const _ = c._api._MagickImage_BlueShift(this._instance, n, t.ptr);
      this._setInstance(_, t);
    });
  }
  blur(e, n, t) {
    let _ = 0;
    const g = this.valueOrDefault(n, 1);
    let p = this.valueOrDefault(t, X.Undefined);
    e !== void 0 && (n === void 0 ? p = e : _ = e), this.useException((m) => {
      const S = c._api._MagickImage_Blur(this._instance, _, g, p, m.ptr);
      this._setInstance(S, m);
    });
  }
  border(e, n) {
    const t = e, _ = this.valueOrDefault(n, e), g = new ae(0, 0, t, _);
    this.useException((p) => {
      g._toRectangle((m) => {
        const S = c._api._MagickImage_Border(this._instance, m, p.ptr);
        this._setInstance(S, p);
      });
    });
  }
  brightnessContrast(e, n, t) {
    const _ = this.valueOrDefault(t, X.Undefined);
    this.useException((g) => {
      c._api._MagickImage_BrightnessContrast(this._instance, e.toDouble(), n.toDouble(), _, g.ptr);
    });
  }
  cannyEdge(e, n, t, _) {
    const g = this.valueOrDefault(e, 0), p = this.valueOrDefault(n, 1), m = this.valueOrDefault(t, new re(10)).toDouble() / 100, S = this.valueOrDefault(_, new re(30)).toDouble() / 100;
    this.useException((R) => {
      const $ = c._api._MagickImage_CannyEdge(this._instance, g, p, m, S, R.ptr);
      this._setInstance($, R);
    });
  }
  charcoal(e, n) {
    const t = e === void 0 ? 0 : e, _ = n === void 0 ? 1 : n;
    this.useException((g) => {
      const p = c._api._MagickImage_Charcoal(this._instance, t, _, g.ptr);
      this._setInstance(p, g);
    });
  }
  chop(e) {
    this.useException((n) => {
      e._toRectangle((t) => {
        const _ = c._api._MagickImage_Chop(this._instance, t, n.ptr);
        this._setInstance(_, n);
      });
    });
  }
  chopHorizontal(e, n) {
    this.chop(new ae(e, 0, n, 0));
  }
  chopVertical(e, n) {
    this.chop(new ae(0, e, 0, n));
  }
  clahe(e, n, t, _) {
    this.useExceptionPointer((g) => {
      const p = e instanceof re ? e.multiply(this.width) : e, m = n instanceof re ? n.multiply(this.height) : n;
      c._api._MagickImage_Clahe(this._instance, p, m, t, _, g);
    });
  }
  clone(e) {
    return ie._clone(this)._use(e);
  }
  cloneArea(e, n) {
    return E.usePointer((t) => e._toRectangle((_) => Po._use(0, 0, (g) => {
      const p = c._api._MagickImage_CloneArea(this._instance, e.width, e.height, t);
      c._api._MagickImage_CopyPixels(p, this._instance, _, g, X.Undefined, t);
      const m = new ie(p, this._settings);
      return n(m);
    })));
  }
  clut(e, n, t) {
    const _ = this.valueOrDefault(n, Eo.Undefined), g = this.valueOrDefault(t, X.Undefined);
    this.useExceptionPointer((p) => {
      c._api._MagickImage_Clut(this._instance, e._instance, _, g, p);
    });
  }
  colorAlpha(e) {
    if (!this.hasAlpha)
      return;
    const n = ie.create();
    n.read(e, this.width, this.height), n.composite(this, tr.SrcOver, new Te(0, 0)), this._instance = n._instance;
  }
  colorDecisionList(e) {
    this.useExceptionPointer((n) => {
      A(e, (t) => {
        c._api._MagickImage_ColorDecisionList(this._instance, t, n);
      });
    });
  }
  compare(e, n, t, _) {
    const g = n instanceof fo, p = g ? n.metric : n;
    let m = t;
    _ !== void 0 && (m = _);
    let S = X.Undefined;
    if (typeof m != "function")
      return m !== void 0 && (S = m), this.useExceptionPointer(($) => c._api._MagickImage_CompareDistortion(this._instance, e._instance, p, S, $));
    t !== void 0 && typeof t != "function" && (S = t);
    const R = Ee.use(this, ($) => (g && n._setArtifacts($), lr.use((V) => {
      const We = this.useExceptionPointer((Ge) => c._api._MagickImage_Compare(this._instance, e._instance, p, S, V.ptr, Ge)), Be = V.value, xe = ie._createFromImage(We, this._settings);
      return or._create(Be, xe);
    })));
    return R.difference._use(() => m(R));
  }
  composite(e, n, t, _, g) {
    let p = 0, m = 0, S = tr.In, R = X.All, $ = null;
    n instanceof Te ? (p = n.x, m = n.y) : n !== void 0 && (S = n), t instanceof Te ? (p = t.x, m = t.y) : typeof t == "string" ? $ = t : t !== void 0 && (R = t), typeof _ == "string" ? $ = _ : _ !== void 0 && (R = _), g !== void 0 && (R = g), $ !== null && this.setArtifact("compose:args", $), this.useExceptionPointer((V) => {
      c._api._MagickImage_Composite(this._instance, e._instance, p, m, S, R, V);
    }), $ !== null && this.removeArtifact("compose:args");
  }
  compositeGravity(e, n, t, _, g, p) {
    let m = 0, S = 0, R = tr.In, $ = X.All, V = null;
    t instanceof Te ? (m = t.x, S = t.y) : t !== void 0 && (R = t), _ instanceof Te ? (m = _.x, S = _.y) : typeof _ == "string" ? V = _ : _ !== void 0 && ($ = _), typeof g == "string" ? V = g : g !== void 0 && ($ = g), p !== void 0 && ($ = p), V !== null && this.setArtifact("compose:args", V), this.useExceptionPointer((We) => {
      c._api._MagickImage_CompositeGravity(this._instance, e._instance, n, m, S, R, $, We);
    }), V !== null && this.removeArtifact("compose:args");
  }
  connectedComponents(e) {
    const n = typeof e == "number" ? new mo(e) : e;
    return Ee.use(this, (_) => (n._setArtifacts(_), this.useException((g) => Re.use((p) => {
      try {
        const m = c._api._MagickImage_ConnectedComponents(this._instance, n.connectivity, p.ptr, g.ptr);
        return this._setInstance(m, g), _r._create(p.value, this.colormapSize);
      } finally {
        p.value !== 0 && c._api._ConnectedComponent_DisposeList(p.value);
      }
    }))));
  }
  contrast = () => this.contrastPrivate(!0);
  contrastStretch(e, n, t) {
    const _ = this.width * this.height, g = e.multiply(_);
    let p = 0, m = this.valueOrDefault(t, X.Undefined);
    n instanceof re ? p = _ - n.multiply(_) : (p = _ - e.multiply(_), n !== void 0 && (m = n)), this.useExceptionPointer((S) => {
      c._api._MagickImage_ContrastStretch(this._instance, g, p, m, S);
    });
  }
  static create(e, n, t) {
    const _ = new ie(ie.createInstance(), new lt());
    return e !== void 0 && _.readOrPing(!1, e, n, t), _;
  }
  crop(e, n, t) {
    let _, g;
    typeof e != "number" ? (_ = e, g = this.valueOrDefault(n, O.Undefined)) : n !== void 0 && (_ = new ae(e, n), g = this.valueOrDefault(t, O.Undefined)), this.useException((p) => {
      A(_.toString(), (m) => {
        const S = c._api._MagickImage_Crop(this._instance, m, g, p.ptr);
        this._setInstance(S, p);
      });
    });
  }
  cropToTiles(e, n, t) {
    let _, g;
    return typeof e == "number" && typeof n == "number" && t !== void 0 ? (_ = new ae(0, 0, e, n), g = t) : typeof e != "number" && typeof n != "number" && (_ = e, g = n), this.useException((p) => A(_.toString(), (m) => {
      const S = c._api._MagickImage_CropToTiles(this._instance, m, p.ptr);
      return ke._createFromImages(S, this._settings, (R) => g(R));
    }));
  }
  cycleColormap(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_CycleColormap(this._instance, e, n);
    });
  }
  deskew(e, n) {
    return Ee.use(this, (t) => {
      n !== void 0 && t.setArtifact("deskew:auto-crop", n), this.useException((g) => {
        const p = c._api._MagickImage_Deskew(this._instance, e._toQuantum(), g.ptr);
        this._setInstance(p, g);
      });
      const _ = Number(this.getArtifact("deskew:angle"));
      return isNaN(_) ? 0 : _;
    });
  }
  determineBitDepth(e) {
    const n = this.valueOrDefault(e, X.Undefined);
    return this.useExceptionPointer((t) => c._api._MagickImage_DetermineBitDepth(this._instance, n, t));
  }
  distort(e, n) {
    Ee.use(this, (t) => {
      let _, g = 0;
      typeof e == "number" ? _ = e : (_ = e.method, g = e.bestFit ? 1 : 0, e._setArtifacts(t)), this.useException((p) => {
        Et(n, (m) => {
          const S = c._api._MagickImage_Distort(this._instance, _, g, m, n.length, p.ptr);
          this._setInstance(S, p);
        });
      });
    });
  }
  draw(...e) {
    const n = e.flat();
    n.length !== 0 && Tt._use(this, (t) => {
      t.draw(n);
    });
  }
  evaluate(e, n, t, _) {
    if (typeof n == "number") {
      const g = n, p = typeof t == "number" ? t : t._toQuantum();
      this.useExceptionPointer((m) => {
        c._api._MagickImage_EvaluateOperator(this._instance, e, g, p, m);
      });
    } else if (_ !== void 0) {
      if (typeof t != "number")
        throw new Y("this should not happen");
      const g = n, p = t, m = typeof _ == "number" ? _ : _._toQuantum();
      if (g.isPercentage)
        throw new Y("percentage is not supported");
      this.useExceptionPointer((S) => {
        Io.use(this, g, (R) => {
          c._api._MagickImage_EvaluateGeometry(this._instance, e, R, p, m, S);
        });
      });
    }
  }
  extent(e, n, t) {
    let _ = O.Undefined, g;
    typeof e != "number" ? g = e : typeof n == "number" && (g = new ae(e, n)), typeof n == "number" ? _ = n : n !== void 0 && (this.backgroundColor = n), typeof t == "number" ? _ = t : t !== void 0 && (this.backgroundColor = t), this.useException((p) => {
      A(g.toString(), (m) => {
        const S = c._api._MagickImage_Extent(this._instance, m, _, p.ptr);
        this._setInstance(S, p);
      });
    });
  }
  flip() {
    this.useException((e) => {
      const n = c._api._MagickImage_Flip(this._instance, e.ptr);
      this._setInstance(n, e);
    });
  }
  floodFill(e, n, t, _) {
    this.floodFillPrivate(e, n, t, _, !1);
  }
  flop() {
    this.useException((e) => {
      const n = c._api._MagickImage_Flop(this._instance, e.ptr);
      this._setInstance(n, e);
    });
  }
  formatExpression(e) {
    return this.useExceptionPointer((n) => this._settings._use((t) => A(e, (_) => {
      const g = c._api._MagickImage_FormatExpression(this._instance, t._instance, _, n);
      return po(c._api, g);
    })));
  }
  gammaCorrect(e, n) {
    const t = this.valueOrDefault(n, X.Undefined);
    this.useExceptionPointer((_) => {
      c._api._MagickImage_GammaCorrect(this._instance, e, t, _);
    });
  }
  gaussianBlur(e, n, t) {
    const _ = this.valueOrDefault(n, 1), g = this.valueOrDefault(t, X.Undefined);
    this.useException((p) => {
      const m = c._api._MagickImage_GaussianBlur(this._instance, e, _, g, p.ptr);
      this._setInstance(m, p);
    });
  }
  getArtifact(e) {
    return A(e, (n) => {
      const t = c._api._MagickImage_GetArtifact(this._instance, n);
      return ce(t);
    });
  }
  getAttribute(e) {
    return this.useException((n) => A(e, (t) => {
      const _ = c._api._MagickImage_GetAttribute(this._instance, t, n.ptr);
      return ce(_);
    }));
  }
  getColormapColor(e) {
    const n = c._api._MagickImage_GetColormapColor(this._instance, e);
    return n === 0 ? null : k._create(n);
  }
  getColorProfile() {
    const e = ["icc", "icm"];
    for (const n of e) {
      const t = this.getProfilePrivate(n);
      if (t !== null)
        return new go(t);
    }
    return null;
  }
  getPixels(e) {
    if (this._settings._ping)
      throw new Y("image contains no pixel data");
    return it._use(this, e);
  }
  getProfile(e) {
    const n = this.getProfilePrivate(e);
    return n === null ? null : new ni(e, n);
  }
  getWriteMask(e) {
    const n = this.useExceptionPointer((_) => c._api._MagickImage_GetWriteMask(this._instance, _)), t = n === 0 ? null : new ie(n, new lt());
    return t == null ? e(t) : t._use(e);
  }
  grayscale(e = Do.Undefined) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_Grayscale(this._instance, e, n);
    });
  }
  hasProfile(e) {
    return A(e, (n) => this.toBool(c._api._MagickImage_HasProfile(this._instance, n)));
  }
  histogram() {
    const e = /* @__PURE__ */ new Map();
    return this.useExceptionPointer((n) => {
      Re.use((t) => {
        const _ = c._api._MagickImage_Histogram(this._instance, t.ptr, n);
        if (_ !== 0) {
          const g = t.value;
          for (let p = 0; p < g; p++) {
            const m = c._api._MagickColorCollection_GetInstance(_, p), S = k._create(m), R = c._api._MagickColor_Count_Get(m);
            e.set(S.toString(), R);
          }
          c._api._MagickColorCollection_DisposeList(_);
        }
      });
    }), e;
  }
  inverseContrast = () => this.contrastPrivate(!1);
  inverseFloodFill(e, n, t, _) {
    this.floodFillPrivate(e, n, t, _, !0);
  }
  inverseLevel(e, n, t, _) {
    const g = this.valueOrDefault(t, 1), p = this.valueOrDefault(_, X.Composite);
    this.useExceptionPointer((m) => {
      c._api._MagickImage_InverseLevel(this._instance, e.toDouble(), n._toQuantum(), g, p, m);
    });
  }
  inverseOpaque = (e, n) => this.opaquePrivate(e, n, !0);
  inverseSigmoidalContrast(e, n, t) {
    this.sigmoidalContrastPrivate(!1, e, n, t);
  }
  inverseTransparent = (e) => this.transparentPrivate(e, !0);
  level(e, n, t, _) {
    const g = this.valueOrDefault(t, 1), p = this.valueOrDefault(_, X.Composite);
    this.useExceptionPointer((m) => {
      c._api._MagickImage_Level(this._instance, e.toDouble(), n._toQuantum(), g, p, m);
    });
  }
  linearStretch(e, n) {
    this.useExceptionPointer((t) => {
      c._api._MagickImage_LinearStretch(this._instance, e.toDouble(), n._toQuantum(), t);
    });
  }
  liquidRescale(e, n) {
    const t = typeof e == "number" ? new ae(e, n) : e;
    this.useException((_) => {
      A(t.toString(), (g) => {
        const p = c._api._MagickImage_LiquidRescale(this._instance, g, t.x, t.y, _.ptr);
        this._setInstance(p, _);
      });
    });
  }
  negate(e) {
    this.useExceptionPointer((n) => {
      const t = this.valueOrDefault(e, X.Undefined);
      c._api._MagickImage_Negate(this._instance, 0, t, n);
    });
  }
  negateGrayScale(e) {
    this.useExceptionPointer((n) => {
      const t = this.valueOrDefault(e, X.Undefined);
      c._api._MagickImage_Negate(this._instance, 1, t, n);
    });
  }
  normalize() {
    this.useExceptionPointer((e) => {
      c._api._MagickImage_Normalize(this._instance, e);
    });
  }
  modulate(e, n, t) {
    const _ = this.valueOrDefault(n, new re(100)), g = this.valueOrDefault(t, new re(100));
    this.useExceptionPointer((p) => {
      const m = `${e.toDouble()}/${_.toDouble()}/${g.toDouble()}`;
      A(m, (S) => {
        c._api._MagickImage_Modulate(this._instance, S, p);
      });
    });
  }
  morphology(e) {
    this.useException((n) => {
      A(e.kernel, (t) => {
        const _ = c._api._MagickImage_Morphology(this._instance, e.method, t, e.channels, e.iterations, n.ptr);
        this._setInstance(_, n);
      });
    });
  }
  motionBlur(e, n, t) {
    this.useException((_) => {
      const g = c._api._MagickImage_MotionBlur(this._instance, e, n, t, _.ptr);
      this._setInstance(g, _);
    });
  }
  oilPaint(e) {
    const n = this.valueOrDefault(e, 3), t = 0;
    this.useException((_) => {
      const g = c._api._MagickImage_OilPaint(this._instance, n, t, _.ptr);
      this._setInstance(g, _);
    });
  }
  opaque = (e, n) => this.opaquePrivate(e, n, !1);
  ping(e, n) {
    this.readOrPing(!0, e, n);
  }
  perceptualHash(e) {
    const n = this.valueOrDefault(e, Me._defaultColorspaces());
    return Me._validateColorSpaces(n), Ee.use(this, (t) => {
      const _ = n.map((g) => Or[g]).join(",");
      return t.setArtifact("phash:colorspaces", _), this.useExceptionPointer((g) => {
        const p = c._api._MagickImage_PerceptualHash(this._instance, g);
        try {
          return Me._create(this, n, p);
        } finally {
          c._api._PerceptualHash_DisposeList(p);
        }
      });
    });
  }
  quantize(e) {
    const n = this.valueOrDefault(e, new nr());
    return this.useException((t) => {
      n._use((_) => {
        c._api._MagickImage_Quantize(this._instance, _._instance, t.ptr);
      });
    }), n.measureErrors ? bt._create(this) : null;
  }
  read(e, n, t) {
    this.readOrPing(!1, e, n, t);
  }
  readFromCanvas(e, n) {
    const t = e.getContext("2d", n);
    if (t === null)
      return;
    const _ = t.getImageData(0, 0, e.width, e.height), g = new be();
    g.format = Le.Rgba, g.width = e.width, g.height = e.height, this.useException((p) => {
      this.readFromArray(_.data, g, p);
    });
  }
  removeArtifact(e) {
    A(e, (n) => {
      c._api._MagickImage_RemoveArtifact(this._instance, n);
    });
  }
  removeAttribute(e) {
    A(e, (n) => {
      c._api._MagickImage_RemoveAttribute(this._instance, n);
    });
  }
  removeProfile(e) {
    const n = typeof e == "string" ? e : e.name;
    A(n, (t) => {
      c._api._MagickImage_RemoveProfile(this._instance, t);
    });
  }
  removeWriteMask() {
    this.useExceptionPointer((e) => {
      c._api._MagickImage_SetWriteMask(this._instance, 0, e);
    });
  }
  resetPage() {
    this.page = new ae(0, 0, 0, 0);
  }
  resize(e, n, t) {
    let _ = this.filterType, g;
    typeof e == "number" ? (g = new ae(e, n), t !== void 0 && (_ = t)) : (g = e, n !== void 0 && (_ = n)), this.useException((p) => {
      A(g.toString(), (m) => {
        const S = c._api._MagickImage_Resize(this._instance, m, _, p.ptr);
        this._setInstance(S, p);
      });
    });
  }
  roll(e, n) {
    this.useException((t) => {
      const _ = c._api._MagickImage_Roll(this._instance, e, n, t.ptr);
      this._setInstance(_, t);
    });
  }
  rotate(e) {
    this.useException((n) => {
      const t = c._api._MagickImage_Rotate(this._instance, e, n.ptr);
      this._setInstance(t, n);
    });
  }
  separate(e, n) {
    return this.useException((t) => {
      let _, g = X.Undefined;
      if (typeof e == "number" && n !== void 0)
        g = e, _ = n;
      else if (typeof e == "function")
        _ = e;
      else
        throw new Y("invalid arguments");
      const p = c._api._MagickImage_Separate(this._instance, g, t.ptr);
      return ke._createFromImages(p, this._settings, (m) => _(m));
    });
  }
  sepiaTone(e = new re(80)) {
    this.useException((n) => {
      const t = typeof e == "number" ? new re(e) : e, _ = c._api._MagickImage_SepiaTone(this._instance, t._toQuantum(), n.ptr);
      this._setInstance(_, n);
    });
  }
  setArtifact(e, n) {
    let t;
    typeof n == "string" ? t = n : typeof n == "boolean" ? t = this.fromBool(n).toString() : t = n.toString(), A(e, (_) => {
      A(t, (g) => {
        c._api._MagickImage_SetArtifact(this._instance, _, g);
      });
    });
  }
  setAttribute(e, n) {
    this.useException((t) => {
      A(e, (_) => {
        A(n, (g) => {
          c._api._MagickImage_SetAttribute(this._instance, _, g, t.ptr);
        });
      });
    });
  }
  setCompression(e) {
    c._api._MagickImage_Compression_Set(this._instance, e);
  }
  setProfile(e, n) {
    const t = typeof e == "string" ? e : e.name;
    let _;
    n !== void 0 ? _ = n : typeof e != "string" && (_ = e.data), this.useException((g) => {
      A(t, (p) => {
        ei(_, (m) => {
          c._api._MagickImage_SetProfile(this._instance, p, m, _.byteLength, g.ptr);
        });
      });
    });
  }
  setWriteMask(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_SetWriteMask(this._instance, e._instance, n);
    });
  }
  sharpen(e, n, t) {
    const _ = this.valueOrDefault(e, 0), g = this.valueOrDefault(n, 1), p = this.valueOrDefault(t, X.Undefined);
    this.useException((m) => {
      const S = c._api._MagickImage_Sharpen(this._instance, _, g, p, m.ptr);
      this._setInstance(S, m);
    });
  }
  shave(e, n) {
    this.useException((t) => {
      const _ = c._api._MagickImage_Shave(this._instance, e, n, t.ptr);
      this._setInstance(_, t);
    });
  }
  sigmoidalContrast(e, n, t) {
    this.sigmoidalContrastPrivate(!0, e, n, t);
  }
  solarize(e = new re(50)) {
    this.useException((n) => {
      const t = typeof e == "number" ? new re(e) : e;
      c._api._MagickImage_Solarize(this._instance, t._toQuantum(), n.ptr);
    });
  }
  splice(e, n) {
    const t = this.valueOrDefault(n, O.Undefined);
    A(e.toString(), (_) => {
      this.useException((g) => {
        const p = c._api._MagickImage_Splice(this._instance, _, t, g.ptr);
        this._setInstance(p, g);
      });
    });
  }
  statistics(e) {
    const n = this.valueOrDefault(e, X.All);
    return this.useExceptionPointer((t) => {
      const _ = c._api._MagickImage_Statistics(this._instance, n, t), g = ur._create(this, _, n);
      return c._api._Statistics_DisposeList(_), g;
    });
  }
  strip() {
    this.useExceptionPointer((e) => {
      c._api._MagickImage_Strip(this._instance, e);
    });
  }
  transformColorSpace(e, n, t) {
    const _ = e;
    let g, p = Zr.Quantum;
    n !== void 0 && (typeof n == "number" ? p = n : g = n), t !== void 0 && (p = t);
    const m = this.hasProfile("icc") || this.hasProfile("icm");
    if (g === void 0) {
      if (!m)
        return !1;
      g = _;
    } else {
      if (_.colorSpace !== this.colorSpace)
        return !1;
      m || this.setProfile(_);
    }
    return p === Zr.Quantum ? Ee.use(this, (S) => {
      S.setArtifact("profile:highres-transform", !1), this.setProfile(g);
    }) : this.setProfile(g), !0;
  }
  threshold(e, n) {
    const t = this.valueOrDefault(n, X.Undefined);
    this.useExceptionPointer((_) => {
      c._api._MagickImage_Threshold(this._instance, e._toQuantum(), t, _);
    });
  }
  thumbnail(e, n) {
    const t = typeof e == "number" ? new ae(e, n) : e;
    this.useException((_) => {
      A(t.toString(), (g) => {
        const p = c._api._MagickImage_Thumbnail(this._instance, g, _.ptr);
        this._setInstance(p, _);
      });
    });
  }
  toString = () => `${this.format} ${this.width}x${this.height} ${this.depth}-bit ${Or[this.colorSpace]}`;
  transparent(e) {
    e._use((n) => {
      this.useExceptionPointer((t) => {
        c._api._MagickImage_Transparent(this._instance, n, 0, t);
      });
    });
  }
  trim(...e) {
    if (e.length > 0)
      if (e.length == 1 && e[0] instanceof re) {
        const n = e[0];
        this.setArtifact("trim:percent-background", n.toDouble().toString());
      } else {
        const n = e, t = [...new Set(wo(n))].join(",");
        this.setArtifact("trim:edges", t);
      }
    this.useException((n) => {
      const t = c._api._MagickImage_Trim(this._instance, n.ptr);
      this._setInstance(t, n), this.removeArtifact("trim:edges"), this.removeArtifact("trim:percent-background");
    });
  }
  wave(e, n, t) {
    const _ = this.valueOrDefault(e, this.interpolate), g = this.valueOrDefault(n, 25), p = this.valueOrDefault(t, 150);
    this.useException((m) => {
      const S = c._api._MagickImage_Wave(this._instance, _, g, p, m.ptr);
      this._setInstance(S, m);
    });
  }
  vignette(e, n, t, _) {
    const g = this.valueOrDefault(e, 0), p = this.valueOrDefault(n, 1), m = this.valueOrDefault(t, 0), S = this.valueOrDefault(_, 0);
    this.useException((R) => {
      const $ = c._api._MagickImage_Vignette(this._instance, g, p, m, S, R.ptr);
      this._setInstance($, R);
    });
  }
  whiteThreshold(e, n) {
    const t = this.valueOrDefault(n, X.Composite);
    this.useException((_) => {
      A(e.toString(), (g) => {
        c._api._MagickImage_WhiteThreshold(this._instance, g, t, _.ptr);
      });
    });
  }
  write(e, n) {
    let t = 0, _ = 0;
    n !== void 0 ? this._settings.format = e : n = e, this.useException((p) => {
      Re.use((m) => {
        this._settings._use((S) => {
          try {
            t = c._api._MagickImage_WriteBlob(this._instance, S._instance, m.ptr, p.ptr), _ = m.value;
          } catch {
            t !== 0 && (t = c._api._MagickMemory_Relinquish(t));
          }
        });
      });
    });
    const g = new ai(t, _, n);
    return le._disposeAfterExecution(g, g.func);
  }
  writeToCanvas(e, n) {
    e.width = this.width, e.height = this.height;
    const t = e.getContext("2d", n);
    t !== null && it._map(this, "RGBA", (_) => {
      const g = t.createImageData(this.width, this.height);
      let p = 0;
      for (let m = 0; m < this.height; m++)
        for (let S = 0; S < this.width; S++)
          g.data[p++] = c._api.HEAPU8[_++], g.data[p++] = c._api.HEAPU8[_++], g.data[p++] = c._api.HEAPU8[_++], g.data[p++] = c._api.HEAPU8[_++];
      t.putImageData(g, 0, 0);
    });
  }
  /** @internal */
  static _createFromImage(e, n) {
    return new ie(e, n);
  }
  /** @internal */
  _channelOffset(e) {
    return c._api._MagickImage_HasChannel(this._instance, e) ? c._api._MagickImage_ChannelOffset(this._instance, e) : -1;
  }
  /** @internal */
  static _clone(e) {
    return E.usePointer((n) => new ie(c._api._MagickImage_Clone(e._instance, n), e._settings._clone()));
  }
  /** @internal */
  _getSettings() {
    return this._settings;
  }
  /** @internal */
  _instanceNotInitialized() {
    throw new Y("no image has been read");
  }
  /** @internal */
  _setInstance(e, n) {
    if (super._setInstance(e, n) === !0 || e === 0 && this.onProgress !== void 0)
      return !0;
    throw new Y("out of memory");
  }
  _use(e) {
    return le._disposeAfterExecution(this, e);
  }
  static _create(e) {
    return ie.create()._use(e);
  }
  onDispose() {
    this.disposeProgressDelegate();
  }
  contrastPrivate(e) {
    this.useExceptionPointer((n) => {
      c._api._MagickImage_Contrast(this._instance, this.fromBool(e), n);
    });
  }
  static createInstance() {
    return E.usePointer((e) => c._api._MagickImage_Create(0, e));
  }
  disposeProgressDelegate() {
    se.removeProgressDelegate(this), this._progress = void 0;
  }
  floodFillPrivate(e, n, t, _, g) {
    let p = _;
    p === void 0 && this.getPixels((m) => {
      const S = m.getColor(n, t);
      S !== null && (p = S);
    }), typeof e == "number" && p !== void 0 && (p.a = e), this.settings._drawing._use((m) => {
      e instanceof k ? (m.setFillColor(e), m.setFillPattern()) : e instanceof ie && (m.setFillColor(), m.setFillPattern(e)), this.useExceptionPointer((S) => {
        p !== void 0 ? p._use((R) => {
          c._api._MagickImage_FloodFill(this._instance, m._instance, n, t, R, this.fromBool(g), S);
        }) : c._api._MagickImage_FloodFill(this._instance, m._instance, n, t, 0, this.fromBool(g), S);
      });
    });
  }
  fromBool(e) {
    return e ? 1 : 0;
  }
  getProfilePrivate(e) {
    return A(e, (n) => {
      const t = c._api._MagickImage_GetProfile(this._instance, n), _ = bo.toArray(t);
      return _ === null ? null : _;
    });
  }
  onSettingsArtifactChanged(e, n) {
    n === void 0 ? this.removeArtifact(e) : this.setArtifact(e, n);
  }
  opaquePrivate(e, n, t) {
    this.useExceptionPointer((_) => {
      e._use((g) => {
        n._use((p) => {
          c._api._MagickImage_Opaque(this._instance, g, p, this.fromBool(t), _);
        });
      });
    });
  }
  readOrPing(e, n, t, _) {
    this.useException((g) => {
      const p = t instanceof be ? t : new be(this._settings);
      if (p._ping = e, this._settings._ping = e, p.frameCount !== void 0 && p.frameCount > 1)
        throw new Y("The frame count can only be set to 1 when a single image is being read.");
      if (typeof n == "string")
        p._fileName = n;
      else if (ii(n)) {
        this.readFromArray(n, p, g);
        return;
      } else
        p._fileName = "xc:" + n.toShortString(), p.width = typeof t == "number" ? t : 0, p.height = typeof _ == "number" ? _ : 0;
      p._use((m) => {
        const S = c._api._MagickImage_ReadFile(m._instance, g.ptr);
        this._setInstance(S, g);
      });
    });
  }
  readFromArray(e, n, t) {
    n._use((_) => {
      ei(e, (g) => {
        const p = c._api._MagickImage_ReadBlob(_._instance, g, 0, e.byteLength, t.ptr);
        this._setInstance(p, t);
      });
    });
  }
  sigmoidalContrastPrivate(e, n, t, _) {
    let g;
    t !== void 0 ? typeof t == "number" ? g = t : g = t.multiply(Fe.max) : g = Fe.max * 0.5;
    const p = this.valueOrDefault(_, X.Undefined);
    this.useExceptionPointer((m) => {
      c._api._MagickImage_SigmoidalContrast(this._instance, this.fromBool(e), n, g, p, m);
    });
  }
  toBool(e) {
    return e === 1;
  }
  transparentPrivate(e, n) {
    e._use((t) => {
      this.useExceptionPointer((_) => {
        c._api._MagickImage_Transparent(this._instance, t, this.fromBool(n), _);
      });
    });
  }
  valueOrDefault(e, n) {
    return e === void 0 ? n : e;
  }
  valueOrComputedDefault(e, n) {
    return e === void 0 ? n() : e;
  }
  useException(e) {
    return E.use(e, (n) => {
      this.onWarning !== void 0 && this.onWarning(new ri(n));
    });
  }
  useExceptionPointer(e) {
    return E.usePointer(e, (n) => {
      this.onWarning !== void 0 && this.onWarning(new ri(n));
    });
  }
}
var Ao = (() => {
  var w = import.meta.url;
  return (async function(e = {}) {
    var n, t = e, _, g, p = new Promise((r, i) => {
      _ = r, g = i;
    }), m = typeof window == "object", S = typeof WorkerGlobalScope < "u";
    typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer", (!globalThis.crypto || !globalThis.crypto.getRandomValues) && (globalThis.crypto = { getRandomValues: (r) => {
      for (let i = 0; i < r.length; i++) r[i] = Math.random() * 256 | 0;
    } });
    var R = "./this.program", $ = (r, i) => {
      throw i;
    }, V = "";
    function We(r) {
      return t.locateFile ? t.locateFile(r, V) : V + r;
    }
    var Be, xe;
    (m || S) && (S ? V = self.location.href : typeof document < "u" && document.currentScript && (V = document.currentScript.src), w && (V = w), V.startsWith("blob:") ? V = "" : V = V.slice(0, V.replace(/[?#].*/, "").lastIndexOf("/") + 1), S && (xe = (r) => {
      var i = new XMLHttpRequest();
      return i.open("GET", r, !1), i.responseType = "arraybuffer", i.send(null), new Uint8Array(i.response);
    }), Be = async (r) => {
      if (gr(r))
        return new Promise((a, o) => {
          var l = new XMLHttpRequest();
          l.open("GET", r, !0), l.responseType = "arraybuffer", l.onload = () => {
            if (l.status == 200 || l.status == 0 && l.response) {
              a(l.response);
              return;
            }
            o(l.status);
          }, l.onerror = o, l.send(null);
        });
      var i = await fetch(r, { credentials: "same-origin" });
      if (i.ok)
        return i.arrayBuffer();
      throw new Error(i.status + " : " + i.url);
    });
    var Ge = console.log.bind(console), me = console.error.bind(console), Ne, ht, At = !1, q, oe, ue, nt, D, L, gt, _e, hr, dt, gr = (r) => r.startsWith("file://");
    function dr() {
      var r = ht.buffer;
      q = new Int8Array(r), ue = new Int16Array(r), t.HEAPU8 = oe = new Uint8Array(r), nt = new Uint16Array(r), D = new Int32Array(r), L = new Uint32Array(r), gt = new Float32Array(r), dt = new Float64Array(r), _e = new BigInt64Array(r), hr = new BigUint64Array(r);
    }
    function li() {
      if (t.preRun)
        for (typeof t.preRun == "function" && (t.preRun = [t.preRun]); t.preRun.length; )
          yi(t.preRun.shift());
      pr(vr);
    }
    function ui() {
      !t.noFSInit && !u.initialized && u.init(), s.hb(), u.ignorePermissions = !1;
    }
    function hi() {
      if (t.postRun)
        for (typeof t.postRun == "function" && (t.postRun = [t.postRun]); t.postRun.length; )
          Mi(t.postRun.shift());
      pr(mr);
    }
    var ze = 0, at = null;
    function fr(r) {
      ze++, t.monitorRunDependencies?.(ze);
    }
    function Rt(r) {
      if (ze--, t.monitorRunDependencies?.(ze), ze == 0 && at) {
        var i = at;
        at = null, i();
      }
    }
    function st(r) {
      t.onAbort?.(r), r = "Aborted(" + r + ")", me(r), At = !0, r += ". Build with -sASSERTIONS for more info.";
      var i = new WebAssembly.RuntimeError(r);
      throw g(i), i;
    }
    var xt;
    function gi() {
      return t.locateFile ? We("magick.wasm") : new URL("data:text/plain;base64,").href;
    }
    function di(r) {
      if (r == xt && Ne)
        return new Uint8Array(Ne);
      if (xe)
        return xe(r);
      throw "both async and sync fetching of the wasm failed";
    }
    async function fi(r) {
      if (!Ne)
        try {
          var i = await Be(r);
          return new Uint8Array(i);
        } catch {
        }
      return di(r);
    }
    async function pi(r, i) {
      try {
        var a = await fi(r), o = await WebAssembly.instantiate(a, i);
        return o;
      } catch (l) {
        me(`failed to asynchronously prepare wasm: ${l}`), st(l);
      }
    }
    async function mi(r, i, a) {
      if (!r && typeof WebAssembly.instantiateStreaming == "function" && !gr(i))
        try {
          var o = fetch(i, { credentials: "same-origin" }), l = await WebAssembly.instantiateStreaming(o, a);
          return l;
        } catch (h) {
          me(`wasm streaming compile failed: ${h}`), me("falling back to ArrayBuffer instantiation");
        }
      return pi(i, a);
    }
    function vi() {
      return { a: ls };
    }
    async function wi() {
      function r(h, d) {
        return s = h.exports, s = Zs(s), ht = s.gb, dr(), $e = s.Bb, Rt(), s;
      }
      fr();
      function i(h) {
        return r(h.instance);
      }
      var a = vi();
      if (t.instantiateWasm)
        return new Promise((h, d) => {
          t.instantiateWasm(a, (f, v) => {
            h(r(f));
          });
        });
      xt ??= gi();
      try {
        var o = await mi(Ne, xt, a), l = i(o);
        return l;
      } catch (h) {
        return g(h), Promise.reject(h);
      }
    }
    class ki {
      name = "ExitStatus";
      constructor(i) {
        this.message = `Program terminated with exit(${i})`, this.status = i;
      }
    }
    var pr = (r) => {
      for (; r.length > 0; )
        r.shift()(t);
    }, mr = [], Mi = (r) => mr.push(r), vr = [], yi = (r) => vr.push(r);
    function Si(r, i = "i8") {
      switch (i.endsWith("*") && (i = "*"), i) {
        case "i1":
          return q[r >>> 0];
        case "i8":
          return q[r >>> 0];
        case "i16":
          return ue[r >>> 1 >>> 0];
        case "i32":
          return D[r >>> 2 >>> 0];
        case "i64":
          return _e[r >>> 3];
        case "float":
          return gt[r >>> 2 >>> 0];
        case "double":
          return dt[r >>> 3 >>> 0];
        case "*":
          return L[r >>> 2 >>> 0];
        default:
          st(`invalid type for getValue: ${i}`);
      }
    }
    var Gt = !0;
    function Ci(r, i, a = "i8") {
      switch (a.endsWith("*") && (a = "*"), a) {
        case "i1":
          q[r >>> 0] = i;
          break;
        case "i8":
          q[r >>> 0] = i;
          break;
        case "i16":
          ue[r >>> 1 >>> 0] = i;
          break;
        case "i32":
          D[r >>> 2 >>> 0] = i;
          break;
        case "i64":
          _e[r >>> 3] = BigInt(i);
          break;
        case "float":
          gt[r >>> 2 >>> 0] = i;
          break;
        case "double":
          dt[r >>> 3 >>> 0] = i;
          break;
        case "*":
          L[r >>> 2 >>> 0] = i;
          break;
        default:
          st(`invalid type for setValue: ${a}`);
      }
    }
    var N = (r) => ds(r), z = () => fs(), Ii = 9007199254740992, Pi = -9007199254740992, ye = (r) => r < Pi || r > Ii ? NaN : Number(r), Ft = [], $e, W = (r) => {
      var i = Ft[r];
      return i || (Ft[r] = i = $e.get(r)), i;
    };
    function Di(r, i) {
      return r >>>= 0, W(r)(i);
    }
    var wr = [];
    function Ei(r) {
      r >>>= 0;
      var i = new Lt(r);
      return i.get_caught() || i.set_caught(!0), i.set_rethrown(!1), wr.push(i), ms(r), ws(r);
    }
    var He = 0, Ti = () => {
      B(0, 0);
      var r = wr.pop();
      ps(r.excPtr), He = 0;
    };
    class Lt {
      constructor(i) {
        this.excPtr = i, this.ptr = i - 24;
      }
      set_type(i) {
        L[this.ptr + 4 >>> 2 >>> 0] = i;
      }
      get_type() {
        return L[this.ptr + 4 >>> 2 >>> 0];
      }
      set_destructor(i) {
        L[this.ptr + 8 >>> 2 >>> 0] = i;
      }
      get_destructor() {
        return L[this.ptr + 8 >>> 2 >>> 0];
      }
      set_caught(i) {
        i = i ? 1 : 0, q[this.ptr + 12 >>> 0] = i;
      }
      get_caught() {
        return q[this.ptr + 12 >>> 0] != 0;
      }
      set_rethrown(i) {
        i = i ? 1 : 0, q[this.ptr + 13 >>> 0] = i;
      }
      get_rethrown() {
        return q[this.ptr + 13 >>> 0] != 0;
      }
      init(i, a) {
        this.set_adjusted_ptr(0), this.set_type(i), this.set_destructor(a);
      }
      set_adjusted_ptr(i) {
        L[this.ptr + 16 >>> 2 >>> 0] = i;
      }
      get_adjusted_ptr() {
        return L[this.ptr + 16 >>> 2 >>> 0];
      }
    }
    var ft = (r) => gs(r), kr = (r) => {
      var i = He;
      if (!i)
        return ft(0), 0;
      var a = new Lt(i);
      a.set_adjusted_ptr(i);
      var o = a.get_type();
      if (!o)
        return ft(0), i;
      for (var l of r) {
        if (l === 0 || l === o)
          break;
        var h = a.ptr + 16;
        if (vs(l, o, h))
          return ft(l), i;
      }
      return ft(o), i;
    };
    function bi() {
      return kr([]);
    }
    function Ai(r) {
      return r >>>= 0, kr([r]);
    }
    function Ri(r, i, a) {
      r >>>= 0, i >>>= 0, a >>>= 0;
      var o = new Lt(r);
      throw o.init(i, a), He = r, He;
    }
    function xi(r) {
      throw r >>>= 0, He || (He = r), He;
    }
    var j = { isAbs: (r) => r.charAt(0) === "/", splitPath: (r) => {
      var i = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
      return i.exec(r).slice(1);
    }, normalizeArray: (r, i) => {
      for (var a = 0, o = r.length - 1; o >= 0; o--) {
        var l = r[o];
        l === "." ? r.splice(o, 1) : l === ".." ? (r.splice(o, 1), a++) : a && (r.splice(o, 1), a--);
      }
      if (i)
        for (; a; a--)
          r.unshift("..");
      return r;
    }, normalize: (r) => {
      var i = j.isAbs(r), a = r.slice(-1) === "/";
      return r = j.normalizeArray(r.split("/").filter((o) => !!o), !i).join("/"), !r && !i && (r = "."), r && a && (r += "/"), (i ? "/" : "") + r;
    }, dirname: (r) => {
      var i = j.splitPath(r), a = i[0], o = i[1];
      return !a && !o ? "." : (o && (o = o.slice(0, -1)), a + o);
    }, basename: (r) => r && r.match(/([^\/]+|\/)\/*$/)[1], join: (...r) => j.normalize(r.join("/")), join2: (r, i) => j.normalize(r + "/" + i) }, Gi = () => (r) => crypto.getRandomValues(r), Wt = (r) => {
      (Wt = Gi())(r);
    }, Qe = { resolve: (...r) => {
      for (var i = "", a = !1, o = r.length - 1; o >= -1 && !a; o--) {
        var l = o >= 0 ? r[o] : u.cwd();
        if (typeof l != "string")
          throw new TypeError("Arguments to path.resolve must be strings");
        if (!l)
          return "";
        i = l + "/" + i, a = j.isAbs(l);
      }
      return i = j.normalizeArray(i.split("/").filter((h) => !!h), !a).join("/"), (a ? "/" : "") + i || ".";
    }, relative: (r, i) => {
      r = Qe.resolve(r).slice(1), i = Qe.resolve(i).slice(1);
      function a(M) {
        for (var y = 0; y < M.length && M[y] === ""; y++)
          ;
        for (var C = M.length - 1; C >= 0 && M[C] === ""; C--)
          ;
        return y > C ? [] : M.slice(y, C - y + 1);
      }
      for (var o = a(r.split("/")), l = a(i.split("/")), h = Math.min(o.length, l.length), d = h, f = 0; f < h; f++)
        if (o[f] !== l[f]) {
          d = f;
          break;
        }
      for (var v = [], f = d; f < o.length; f++)
        v.push("..");
      return v = v.concat(l.slice(d)), v.join("/");
    } }, Mr = typeof TextDecoder < "u" ? new TextDecoder() : void 0, Je = (r, i = 0, a = NaN) => {
      i >>>= 0;
      for (var o = i + a, l = i; r[l] && !(l >= o); ) ++l;
      if (l - i > 16 && r.buffer && Mr)
        return Mr.decode(r.subarray(i, l));
      for (var h = ""; i < l; ) {
        var d = r[i++];
        if (!(d & 128)) {
          h += String.fromCharCode(d);
          continue;
        }
        var f = r[i++] & 63;
        if ((d & 224) == 192) {
          h += String.fromCharCode((d & 31) << 6 | f);
          continue;
        }
        var v = r[i++] & 63;
        if ((d & 240) == 224 ? d = (d & 15) << 12 | f << 6 | v : d = (d & 7) << 18 | f << 12 | v << 6 | r[i++] & 63, d < 65536)
          h += String.fromCharCode(d);
        else {
          var M = d - 65536;
          h += String.fromCharCode(55296 | M >> 10, 56320 | M & 1023);
        }
      }
      return h;
    }, Bt = [], Ye = (r) => {
      for (var i = 0, a = 0; a < r.length; ++a) {
        var o = r.charCodeAt(a);
        o <= 127 ? i++ : o <= 2047 ? i += 2 : o >= 55296 && o <= 57343 ? (i += 4, ++a) : i += 3;
      }
      return i;
    }, Nt = (r, i, a, o) => {
      if (a >>>= 0, !(o > 0)) return 0;
      for (var l = a, h = a + o - 1, d = 0; d < r.length; ++d) {
        var f = r.charCodeAt(d);
        if (f >= 55296 && f <= 57343) {
          var v = r.charCodeAt(++d);
          f = 65536 + ((f & 1023) << 10) | v & 1023;
        }
        if (f <= 127) {
          if (a >= h) break;
          i[a++ >>> 0] = f;
        } else if (f <= 2047) {
          if (a + 1 >= h) break;
          i[a++ >>> 0] = 192 | f >> 6, i[a++ >>> 0] = 128 | f & 63;
        } else if (f <= 65535) {
          if (a + 2 >= h) break;
          i[a++ >>> 0] = 224 | f >> 12, i[a++ >>> 0] = 128 | f >> 6 & 63, i[a++ >>> 0] = 128 | f & 63;
        } else {
          if (a + 3 >= h) break;
          i[a++ >>> 0] = 240 | f >> 18, i[a++ >>> 0] = 128 | f >> 12 & 63, i[a++ >>> 0] = 128 | f >> 6 & 63, i[a++ >>> 0] = 128 | f & 63;
        }
      }
      return i[a >>> 0] = 0, a - l;
    }, yr = (r, i, a) => {
      var o = Ye(r) + 1, l = new Array(o), h = Nt(r, l, 0, l.length);
      return l.length = h, l;
    }, Fi = () => {
      if (!Bt.length) {
        var r = null;
        if (typeof window < "u" && typeof window.prompt == "function" && (r = window.prompt("Input: "), r !== null && (r += `
`)), !r)
          return null;
        Bt = yr(r);
      }
      return Bt.shift();
    }, Ue = { ttys: [], init() {
    }, shutdown() {
    }, register(r, i) {
      Ue.ttys[r] = { input: [], output: [], ops: i }, u.registerDevice(r, Ue.stream_ops);
    }, stream_ops: { open(r) {
      var i = Ue.ttys[r.node.rdev];
      if (!i)
        throw new u.ErrnoError(43);
      r.tty = i, r.seekable = !1;
    }, close(r) {
      r.tty.ops.fsync(r.tty);
    }, fsync(r) {
      r.tty.ops.fsync(r.tty);
    }, read(r, i, a, o, l) {
      if (!r.tty || !r.tty.ops.get_char)
        throw new u.ErrnoError(60);
      for (var h = 0, d = 0; d < o; d++) {
        var f;
        try {
          f = r.tty.ops.get_char(r.tty);
        } catch {
          throw new u.ErrnoError(29);
        }
        if (f === void 0 && h === 0)
          throw new u.ErrnoError(6);
        if (f == null) break;
        h++, i[a + d] = f;
      }
      return h && (r.node.atime = Date.now()), h;
    }, write(r, i, a, o, l) {
      if (!r.tty || !r.tty.ops.put_char)
        throw new u.ErrnoError(60);
      try {
        for (var h = 0; h < o; h++)
          r.tty.ops.put_char(r.tty, i[a + h]);
      } catch {
        throw new u.ErrnoError(29);
      }
      return o && (r.node.mtime = r.node.ctime = Date.now()), h;
    } }, default_tty_ops: { get_char(r) {
      return Fi();
    }, put_char(r, i) {
      i === null || i === 10 ? (Ge(Je(r.output)), r.output = []) : i != 0 && r.output.push(i);
    }, fsync(r) {
      r.output?.length > 0 && (Ge(Je(r.output)), r.output = []);
    }, ioctl_tcgets(r) {
      return { c_iflag: 25856, c_oflag: 5, c_cflag: 191, c_lflag: 35387, c_cc: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    }, ioctl_tcsets(r, i, a) {
      return 0;
    }, ioctl_tiocgwinsz(r) {
      return [24, 80];
    } }, default_tty1_ops: { put_char(r, i) {
      i === null || i === 10 ? (me(Je(r.output)), r.output = []) : i != 0 && r.output.push(i);
    }, fsync(r) {
      r.output?.length > 0 && (me(Je(r.output)), r.output = []);
    } } }, Li = (r, i) => oe.fill(0, r, r + i), Sr = (r, i) => Math.ceil(r / i) * i, Cr = (r) => {
      r = Sr(r, 65536);
      var i = hs(65536, r);
      return i && Li(i, r), i;
    }, F = { ops_table: null, mount(r) {
      return F.createNode(null, "/", 16895, 0);
    }, createNode(r, i, a, o) {
      if (u.isBlkdev(a) || u.isFIFO(a))
        throw new u.ErrnoError(63);
      F.ops_table ||= { dir: { node: { getattr: F.node_ops.getattr, setattr: F.node_ops.setattr, lookup: F.node_ops.lookup, mknod: F.node_ops.mknod, rename: F.node_ops.rename, unlink: F.node_ops.unlink, rmdir: F.node_ops.rmdir, readdir: F.node_ops.readdir, symlink: F.node_ops.symlink }, stream: { llseek: F.stream_ops.llseek } }, file: { node: { getattr: F.node_ops.getattr, setattr: F.node_ops.setattr }, stream: { llseek: F.stream_ops.llseek, read: F.stream_ops.read, write: F.stream_ops.write, mmap: F.stream_ops.mmap, msync: F.stream_ops.msync } }, link: { node: { getattr: F.node_ops.getattr, setattr: F.node_ops.setattr, readlink: F.node_ops.readlink }, stream: {} }, chrdev: { node: { getattr: F.node_ops.getattr, setattr: F.node_ops.setattr }, stream: u.chrdev_stream_ops } };
      var l = u.createNode(r, i, a, o);
      return u.isDir(l.mode) ? (l.node_ops = F.ops_table.dir.node, l.stream_ops = F.ops_table.dir.stream, l.contents = {}) : u.isFile(l.mode) ? (l.node_ops = F.ops_table.file.node, l.stream_ops = F.ops_table.file.stream, l.usedBytes = 0, l.contents = null) : u.isLink(l.mode) ? (l.node_ops = F.ops_table.link.node, l.stream_ops = F.ops_table.link.stream) : u.isChrdev(l.mode) && (l.node_ops = F.ops_table.chrdev.node, l.stream_ops = F.ops_table.chrdev.stream), l.atime = l.mtime = l.ctime = Date.now(), r && (r.contents[i] = l, r.atime = r.mtime = r.ctime = l.atime), l;
    }, getFileDataAsTypedArray(r) {
      return r.contents ? r.contents.subarray ? r.contents.subarray(0, r.usedBytes) : new Uint8Array(r.contents) : new Uint8Array(0);
    }, expandFileStorage(r, i) {
      var a = r.contents ? r.contents.length : 0;
      if (!(a >= i)) {
        var o = 1024 * 1024;
        i = Math.max(i, a * (a < o ? 2 : 1.125) >>> 0), a != 0 && (i = Math.max(i, 256));
        var l = r.contents;
        r.contents = new Uint8Array(i), r.usedBytes > 0 && r.contents.set(l.subarray(0, r.usedBytes), 0);
      }
    }, resizeFileStorage(r, i) {
      if (r.usedBytes != i)
        if (i == 0)
          r.contents = null, r.usedBytes = 0;
        else {
          var a = r.contents;
          r.contents = new Uint8Array(i), a && r.contents.set(a.subarray(0, Math.min(i, r.usedBytes))), r.usedBytes = i;
        }
    }, node_ops: { getattr(r) {
      var i = {};
      return i.dev = u.isChrdev(r.mode) ? r.id : 1, i.ino = r.id, i.mode = r.mode, i.nlink = 1, i.uid = 0, i.gid = 0, i.rdev = r.rdev, u.isDir(r.mode) ? i.size = 4096 : u.isFile(r.mode) ? i.size = r.usedBytes : u.isLink(r.mode) ? i.size = r.link.length : i.size = 0, i.atime = new Date(r.atime), i.mtime = new Date(r.mtime), i.ctime = new Date(r.ctime), i.blksize = 4096, i.blocks = Math.ceil(i.size / i.blksize), i;
    }, setattr(r, i) {
      for (const a of ["mode", "atime", "mtime", "ctime"])
        i[a] != null && (r[a] = i[a]);
      i.size !== void 0 && F.resizeFileStorage(r, i.size);
    }, lookup(r, i) {
      throw F.doesNotExistError;
    }, mknod(r, i, a, o) {
      return F.createNode(r, i, a, o);
    }, rename(r, i, a) {
      var o;
      try {
        o = u.lookupNode(i, a);
      } catch {
      }
      if (o) {
        if (u.isDir(r.mode))
          for (var l in o.contents)
            throw new u.ErrnoError(55);
        u.hashRemoveNode(o);
      }
      delete r.parent.contents[r.name], i.contents[a] = r, r.name = a, i.ctime = i.mtime = r.parent.ctime = r.parent.mtime = Date.now();
    }, unlink(r, i) {
      delete r.contents[i], r.ctime = r.mtime = Date.now();
    }, rmdir(r, i) {
      var a = u.lookupNode(r, i);
      for (var o in a.contents)
        throw new u.ErrnoError(55);
      delete r.contents[i], r.ctime = r.mtime = Date.now();
    }, readdir(r) {
      return [".", "..", ...Object.keys(r.contents)];
    }, symlink(r, i, a) {
      var o = F.createNode(r, i, 41471, 0);
      return o.link = a, o;
    }, readlink(r) {
      if (!u.isLink(r.mode))
        throw new u.ErrnoError(28);
      return r.link;
    } }, stream_ops: { read(r, i, a, o, l) {
      var h = r.node.contents;
      if (l >= r.node.usedBytes) return 0;
      var d = Math.min(r.node.usedBytes - l, o);
      if (d > 8 && h.subarray)
        i.set(h.subarray(l, l + d), a);
      else
        for (var f = 0; f < d; f++) i[a + f] = h[l + f];
      return d;
    }, write(r, i, a, o, l, h) {
      if (i.buffer === q.buffer && (h = !1), !o) return 0;
      var d = r.node;
      if (d.mtime = d.ctime = Date.now(), i.subarray && (!d.contents || d.contents.subarray)) {
        if (h)
          return d.contents = i.subarray(a, a + o), d.usedBytes = o, o;
        if (d.usedBytes === 0 && l === 0)
          return d.contents = i.slice(a, a + o), d.usedBytes = o, o;
        if (l + o <= d.usedBytes)
          return d.contents.set(i.subarray(a, a + o), l), o;
      }
      if (F.expandFileStorage(d, l + o), d.contents.subarray && i.subarray)
        d.contents.set(i.subarray(a, a + o), l);
      else
        for (var f = 0; f < o; f++)
          d.contents[l + f] = i[a + f];
      return d.usedBytes = Math.max(d.usedBytes, l + o), o;
    }, llseek(r, i, a) {
      var o = i;
      if (a === 1 ? o += r.position : a === 2 && u.isFile(r.node.mode) && (o += r.node.usedBytes), o < 0)
        throw new u.ErrnoError(28);
      return o;
    }, mmap(r, i, a, o, l) {
      if (!u.isFile(r.node.mode))
        throw new u.ErrnoError(43);
      var h, d, f = r.node.contents;
      if (!(l & 2) && f && f.buffer === q.buffer)
        d = !1, h = f.byteOffset;
      else {
        if (d = !0, h = Cr(i), !h)
          throw new u.ErrnoError(48);
        f && ((a > 0 || a + i < f.length) && (f.subarray ? f = f.subarray(a, a + i) : f = Array.prototype.slice.call(f, a, a + i)), q.set(f, h >>> 0));
      }
      return { ptr: h, allocated: d };
    }, msync(r, i, a, o, l) {
      return F.stream_ops.write(r, i, 0, o, a, !1), 0;
    } } }, Wi = async (r) => {
      var i = await Be(r);
      return new Uint8Array(i);
    }, Bi = (r, i, a, o, l, h) => {
      u.createDataFile(r, i, a, o, l, h);
    }, Ir = [], Ni = (r, i, a, o) => {
      typeof Browser < "u" && Browser.init();
      var l = !1;
      return Ir.forEach((h) => {
        l || h.canHandle(i) && (h.handle(r, i, a, o), l = !0);
      }), l;
    }, zi = (r, i, a, o, l, h, d, f, v, M) => {
      var y = i ? Qe.resolve(j.join2(r, i)) : r;
      function C(P) {
        function I(b) {
          M?.(), f || Bi(r, i, b, o, l, v), h?.(), Rt();
        }
        Ni(P, y, I, () => {
          d?.(), Rt();
        }) || I(P);
      }
      fr(), typeof a == "string" ? Wi(a).then(C, d) : C(a);
    }, $i = (r) => {
      var i = { r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090 }, a = i[r];
      if (typeof a > "u")
        throw new Error(`Unknown file open mode: ${r}`);
      return a;
    }, zt = (r, i) => {
      var a = 0;
      return r && (a |= 365), i && (a |= 146), a;
    }, u = { root: null, mounts: [], devices: {}, streams: [], nextInode: 1, nameTable: null, currentPath: "/", initialized: !1, ignorePermissions: !0, filesystems: null, syncFSRequests: 0, readFiles: {}, ErrnoError: class {
      name = "ErrnoError";
      constructor(r) {
        this.errno = r;
      }
    }, FSStream: class {
      shared = {};
      get object() {
        return this.node;
      }
      set object(r) {
        this.node = r;
      }
      get isRead() {
        return (this.flags & 2097155) !== 1;
      }
      get isWrite() {
        return (this.flags & 2097155) !== 0;
      }
      get isAppend() {
        return this.flags & 1024;
      }
      get flags() {
        return this.shared.flags;
      }
      set flags(r) {
        this.shared.flags = r;
      }
      get position() {
        return this.shared.position;
      }
      set position(r) {
        this.shared.position = r;
      }
    }, FSNode: class {
      node_ops = {};
      stream_ops = {};
      readMode = 365;
      writeMode = 146;
      mounted = null;
      constructor(r, i, a, o) {
        r || (r = this), this.parent = r, this.mount = r.mount, this.id = u.nextInode++, this.name = i, this.mode = a, this.rdev = o, this.atime = this.mtime = this.ctime = Date.now();
      }
      get read() {
        return (this.mode & this.readMode) === this.readMode;
      }
      set read(r) {
        r ? this.mode |= this.readMode : this.mode &= ~this.readMode;
      }
      get write() {
        return (this.mode & this.writeMode) === this.writeMode;
      }
      set write(r) {
        r ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
      }
      get isFolder() {
        return u.isDir(this.mode);
      }
      get isDevice() {
        return u.isChrdev(this.mode);
      }
    }, lookupPath(r, i = {}) {
      if (!r)
        throw new u.ErrnoError(44);
      i.follow_mount ??= !0, j.isAbs(r) || (r = u.cwd() + "/" + r);
      e: for (var a = 0; a < 40; a++) {
        for (var o = r.split("/").filter((M) => !!M), l = u.root, h = "/", d = 0; d < o.length; d++) {
          var f = d === o.length - 1;
          if (f && i.parent)
            break;
          if (o[d] !== ".") {
            if (o[d] === "..") {
              if (h = j.dirname(h), u.isRoot(l)) {
                r = h + "/" + o.slice(d + 1).join("/");
                continue e;
              } else
                l = l.parent;
              continue;
            }
            h = j.join2(h, o[d]);
            try {
              l = u.lookupNode(l, o[d]);
            } catch (M) {
              if (M?.errno === 44 && f && i.noent_okay)
                return { path: h };
              throw M;
            }
            if (u.isMountpoint(l) && (!f || i.follow_mount) && (l = l.mounted.root), u.isLink(l.mode) && (!f || i.follow)) {
              if (!l.node_ops.readlink)
                throw new u.ErrnoError(52);
              var v = l.node_ops.readlink(l);
              j.isAbs(v) || (v = j.dirname(h) + "/" + v), r = v + "/" + o.slice(d + 1).join("/");
              continue e;
            }
          }
        }
        return { path: h, node: l };
      }
      throw new u.ErrnoError(32);
    }, getPath(r) {
      for (var i; ; ) {
        if (u.isRoot(r)) {
          var a = r.mount.mountpoint;
          return i ? a[a.length - 1] !== "/" ? `${a}/${i}` : a + i : a;
        }
        i = i ? `${r.name}/${i}` : r.name, r = r.parent;
      }
    }, hashName(r, i) {
      for (var a = 0, o = 0; o < i.length; o++)
        a = (a << 5) - a + i.charCodeAt(o) | 0;
      return (r + a >>> 0) % u.nameTable.length;
    }, hashAddNode(r) {
      var i = u.hashName(r.parent.id, r.name);
      r.name_next = u.nameTable[i], u.nameTable[i] = r;
    }, hashRemoveNode(r) {
      var i = u.hashName(r.parent.id, r.name);
      if (u.nameTable[i] === r)
        u.nameTable[i] = r.name_next;
      else
        for (var a = u.nameTable[i]; a; ) {
          if (a.name_next === r) {
            a.name_next = r.name_next;
            break;
          }
          a = a.name_next;
        }
    }, lookupNode(r, i) {
      var a = u.mayLookup(r);
      if (a)
        throw new u.ErrnoError(a);
      for (var o = u.hashName(r.id, i), l = u.nameTable[o]; l; l = l.name_next) {
        var h = l.name;
        if (l.parent.id === r.id && h === i)
          return l;
      }
      return u.lookup(r, i);
    }, createNode(r, i, a, o) {
      var l = new u.FSNode(r, i, a, o);
      return u.hashAddNode(l), l;
    }, destroyNode(r) {
      u.hashRemoveNode(r);
    }, isRoot(r) {
      return r === r.parent;
    }, isMountpoint(r) {
      return !!r.mounted;
    }, isFile(r) {
      return (r & 61440) === 32768;
    }, isDir(r) {
      return (r & 61440) === 16384;
    }, isLink(r) {
      return (r & 61440) === 40960;
    }, isChrdev(r) {
      return (r & 61440) === 8192;
    }, isBlkdev(r) {
      return (r & 61440) === 24576;
    }, isFIFO(r) {
      return (r & 61440) === 4096;
    }, isSocket(r) {
      return (r & 49152) === 49152;
    }, flagsToPermissionString(r) {
      var i = ["r", "w", "rw"][r & 3];
      return r & 512 && (i += "w"), i;
    }, nodePermissions(r, i) {
      return u.ignorePermissions ? 0 : i.includes("r") && !(r.mode & 292) || i.includes("w") && !(r.mode & 146) || i.includes("x") && !(r.mode & 73) ? 2 : 0;
    }, mayLookup(r) {
      if (!u.isDir(r.mode)) return 54;
      var i = u.nodePermissions(r, "x");
      return i || (r.node_ops.lookup ? 0 : 2);
    }, mayCreate(r, i) {
      if (!u.isDir(r.mode))
        return 54;
      try {
        var a = u.lookupNode(r, i);
        return 20;
      } catch {
      }
      return u.nodePermissions(r, "wx");
    }, mayDelete(r, i, a) {
      var o;
      try {
        o = u.lookupNode(r, i);
      } catch (h) {
        return h.errno;
      }
      var l = u.nodePermissions(r, "wx");
      if (l)
        return l;
      if (a) {
        if (!u.isDir(o.mode))
          return 54;
        if (u.isRoot(o) || u.getPath(o) === u.cwd())
          return 10;
      } else if (u.isDir(o.mode))
        return 31;
      return 0;
    }, mayOpen(r, i) {
      return r ? u.isLink(r.mode) ? 32 : u.isDir(r.mode) && (u.flagsToPermissionString(i) !== "r" || i & 576) ? 31 : u.nodePermissions(r, u.flagsToPermissionString(i)) : 44;
    }, checkOpExists(r, i) {
      if (!r)
        throw new u.ErrnoError(i);
      return r;
    }, MAX_OPEN_FDS: 4096, nextfd() {
      for (var r = 0; r <= u.MAX_OPEN_FDS; r++)
        if (!u.streams[r])
          return r;
      throw new u.ErrnoError(33);
    }, getStreamChecked(r) {
      var i = u.getStream(r);
      if (!i)
        throw new u.ErrnoError(8);
      return i;
    }, getStream: (r) => u.streams[r], createStream(r, i = -1) {
      return r = Object.assign(new u.FSStream(), r), i == -1 && (i = u.nextfd()), r.fd = i, u.streams[i] = r, r;
    }, closeStream(r) {
      u.streams[r] = null;
    }, dupStream(r, i = -1) {
      var a = u.createStream(r, i);
      return a.stream_ops?.dup?.(a), a;
    }, doSetAttr(r, i, a) {
      var o = r?.stream_ops.setattr, l = o ? r : i;
      o ??= i.node_ops.setattr, u.checkOpExists(o, 63), o(l, a);
    }, chrdev_stream_ops: { open(r) {
      var i = u.getDevice(r.node.rdev);
      r.stream_ops = i.stream_ops, r.stream_ops.open?.(r);
    }, llseek() {
      throw new u.ErrnoError(70);
    } }, major: (r) => r >> 8, minor: (r) => r & 255, makedev: (r, i) => r << 8 | i, registerDevice(r, i) {
      u.devices[r] = { stream_ops: i };
    }, getDevice: (r) => u.devices[r], getMounts(r) {
      for (var i = [], a = [r]; a.length; ) {
        var o = a.pop();
        i.push(o), a.push(...o.mounts);
      }
      return i;
    }, syncfs(r, i) {
      typeof r == "function" && (i = r, r = !1), u.syncFSRequests++, u.syncFSRequests > 1 && me(`warning: ${u.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
      var a = u.getMounts(u.root.mount), o = 0;
      function l(d) {
        return u.syncFSRequests--, i(d);
      }
      function h(d) {
        if (d)
          return h.errored ? void 0 : (h.errored = !0, l(d));
        ++o >= a.length && l(null);
      }
      a.forEach((d) => {
        if (!d.type.syncfs)
          return h(null);
        d.type.syncfs(d, r, h);
      });
    }, mount(r, i, a) {
      var o = a === "/", l = !a, h;
      if (o && u.root)
        throw new u.ErrnoError(10);
      if (!o && !l) {
        var d = u.lookupPath(a, { follow_mount: !1 });
        if (a = d.path, h = d.node, u.isMountpoint(h))
          throw new u.ErrnoError(10);
        if (!u.isDir(h.mode))
          throw new u.ErrnoError(54);
      }
      var f = { type: r, opts: i, mountpoint: a, mounts: [] }, v = r.mount(f);
      return v.mount = f, f.root = v, o ? u.root = v : h && (h.mounted = f, h.mount && h.mount.mounts.push(f)), v;
    }, unmount(r) {
      var i = u.lookupPath(r, { follow_mount: !1 });
      if (!u.isMountpoint(i.node))
        throw new u.ErrnoError(28);
      var a = i.node, o = a.mounted, l = u.getMounts(o);
      Object.keys(u.nameTable).forEach((d) => {
        for (var f = u.nameTable[d]; f; ) {
          var v = f.name_next;
          l.includes(f.mount) && u.destroyNode(f), f = v;
        }
      }), a.mounted = null;
      var h = a.mount.mounts.indexOf(o);
      a.mount.mounts.splice(h, 1);
    }, lookup(r, i) {
      return r.node_ops.lookup(r, i);
    }, mknod(r, i, a) {
      var o = u.lookupPath(r, { parent: !0 }), l = o.node, h = j.basename(r);
      if (!h)
        throw new u.ErrnoError(28);
      if (h === "." || h === "..")
        throw new u.ErrnoError(20);
      var d = u.mayCreate(l, h);
      if (d)
        throw new u.ErrnoError(d);
      if (!l.node_ops.mknod)
        throw new u.ErrnoError(63);
      return l.node_ops.mknod(l, h, i, a);
    }, statfs(r) {
      return u.statfsNode(u.lookupPath(r, { follow: !0 }).node);
    }, statfsStream(r) {
      return u.statfsNode(r.node);
    }, statfsNode(r) {
      var i = { bsize: 4096, frsize: 4096, blocks: 1e6, bfree: 5e5, bavail: 5e5, files: u.nextInode, ffree: u.nextInode - 1, fsid: 42, flags: 2, namelen: 255 };
      return r.node_ops.statfs && Object.assign(i, r.node_ops.statfs(r.mount.opts.root)), i;
    }, create(r, i = 438) {
      return i &= 4095, i |= 32768, u.mknod(r, i, 0);
    }, mkdir(r, i = 511) {
      return i &= 1023, i |= 16384, u.mknod(r, i, 0);
    }, mkdirTree(r, i) {
      var a = r.split("/"), o = "";
      for (var l of a)
        if (l) {
          (o || j.isAbs(r)) && (o += "/"), o += l;
          try {
            u.mkdir(o, i);
          } catch (h) {
            if (h.errno != 20) throw h;
          }
        }
    }, mkdev(r, i, a) {
      return typeof a > "u" && (a = i, i = 438), i |= 8192, u.mknod(r, i, a);
    }, symlink(r, i) {
      if (!Qe.resolve(r))
        throw new u.ErrnoError(44);
      var a = u.lookupPath(i, { parent: !0 }), o = a.node;
      if (!o)
        throw new u.ErrnoError(44);
      var l = j.basename(i), h = u.mayCreate(o, l);
      if (h)
        throw new u.ErrnoError(h);
      if (!o.node_ops.symlink)
        throw new u.ErrnoError(63);
      return o.node_ops.symlink(o, l, r);
    }, rename(r, i) {
      var a = j.dirname(r), o = j.dirname(i), l = j.basename(r), h = j.basename(i), d, f, v;
      if (d = u.lookupPath(r, { parent: !0 }), f = d.node, d = u.lookupPath(i, { parent: !0 }), v = d.node, !f || !v) throw new u.ErrnoError(44);
      if (f.mount !== v.mount)
        throw new u.ErrnoError(75);
      var M = u.lookupNode(f, l), y = Qe.relative(r, o);
      if (y.charAt(0) !== ".")
        throw new u.ErrnoError(28);
      if (y = Qe.relative(i, a), y.charAt(0) !== ".")
        throw new u.ErrnoError(55);
      var C;
      try {
        C = u.lookupNode(v, h);
      } catch {
      }
      if (M !== C) {
        var P = u.isDir(M.mode), I = u.mayDelete(f, l, P);
        if (I)
          throw new u.ErrnoError(I);
        if (I = C ? u.mayDelete(v, h, P) : u.mayCreate(v, h), I)
          throw new u.ErrnoError(I);
        if (!f.node_ops.rename)
          throw new u.ErrnoError(63);
        if (u.isMountpoint(M) || C && u.isMountpoint(C))
          throw new u.ErrnoError(10);
        if (v !== f && (I = u.nodePermissions(f, "w"), I))
          throw new u.ErrnoError(I);
        u.hashRemoveNode(M);
        try {
          f.node_ops.rename(M, v, h), M.parent = v;
        } catch (b) {
          throw b;
        } finally {
          u.hashAddNode(M);
        }
      }
    }, rmdir(r) {
      var i = u.lookupPath(r, { parent: !0 }), a = i.node, o = j.basename(r), l = u.lookupNode(a, o), h = u.mayDelete(a, o, !0);
      if (h)
        throw new u.ErrnoError(h);
      if (!a.node_ops.rmdir)
        throw new u.ErrnoError(63);
      if (u.isMountpoint(l))
        throw new u.ErrnoError(10);
      a.node_ops.rmdir(a, o), u.destroyNode(l);
    }, readdir(r) {
      var i = u.lookupPath(r, { follow: !0 }), a = i.node, o = u.checkOpExists(a.node_ops.readdir, 54);
      return o(a);
    }, unlink(r) {
      var i = u.lookupPath(r, { parent: !0 }), a = i.node;
      if (!a)
        throw new u.ErrnoError(44);
      var o = j.basename(r), l = u.lookupNode(a, o), h = u.mayDelete(a, o, !1);
      if (h)
        throw new u.ErrnoError(h);
      if (!a.node_ops.unlink)
        throw new u.ErrnoError(63);
      if (u.isMountpoint(l))
        throw new u.ErrnoError(10);
      a.node_ops.unlink(a, o), u.destroyNode(l);
    }, readlink(r) {
      var i = u.lookupPath(r), a = i.node;
      if (!a)
        throw new u.ErrnoError(44);
      if (!a.node_ops.readlink)
        throw new u.ErrnoError(28);
      return a.node_ops.readlink(a);
    }, stat(r, i) {
      var a = u.lookupPath(r, { follow: !i }), o = a.node, l = u.checkOpExists(o.node_ops.getattr, 63);
      return l(o);
    }, fstat(r) {
      var i = u.getStreamChecked(r), a = i.node, o = i.stream_ops.getattr, l = o ? i : a;
      return o ??= a.node_ops.getattr, u.checkOpExists(o, 63), o(l);
    }, lstat(r) {
      return u.stat(r, !0);
    }, doChmod(r, i, a, o) {
      u.doSetAttr(r, i, { mode: a & 4095 | i.mode & -4096, ctime: Date.now(), dontFollow: o });
    }, chmod(r, i, a) {
      var o;
      if (typeof r == "string") {
        var l = u.lookupPath(r, { follow: !a });
        o = l.node;
      } else
        o = r;
      u.doChmod(null, o, i, a);
    }, lchmod(r, i) {
      u.chmod(r, i, !0);
    }, fchmod(r, i) {
      var a = u.getStreamChecked(r);
      u.doChmod(a, a.node, i, !1);
    }, doChown(r, i, a) {
      u.doSetAttr(r, i, { timestamp: Date.now(), dontFollow: a });
    }, chown(r, i, a, o) {
      var l;
      if (typeof r == "string") {
        var h = u.lookupPath(r, { follow: !o });
        l = h.node;
      } else
        l = r;
      u.doChown(null, l, o);
    }, lchown(r, i, a) {
      u.chown(r, i, a, !0);
    }, fchown(r, i, a) {
      var o = u.getStreamChecked(r);
      u.doChown(o, o.node, !1);
    }, doTruncate(r, i, a) {
      if (u.isDir(i.mode))
        throw new u.ErrnoError(31);
      if (!u.isFile(i.mode))
        throw new u.ErrnoError(28);
      var o = u.nodePermissions(i, "w");
      if (o)
        throw new u.ErrnoError(o);
      u.doSetAttr(r, i, { size: a, timestamp: Date.now() });
    }, truncate(r, i) {
      if (i < 0)
        throw new u.ErrnoError(28);
      var a;
      if (typeof r == "string") {
        var o = u.lookupPath(r, { follow: !0 });
        a = o.node;
      } else
        a = r;
      u.doTruncate(null, a, i);
    }, ftruncate(r, i) {
      var a = u.getStreamChecked(r);
      if (i < 0 || (a.flags & 2097155) === 0)
        throw new u.ErrnoError(28);
      u.doTruncate(a, a.node, i);
    }, utime(r, i, a) {
      var o = u.lookupPath(r, { follow: !0 }), l = o.node, h = u.checkOpExists(l.node_ops.setattr, 63);
      h(l, { atime: i, mtime: a });
    }, open(r, i, a = 438) {
      if (r === "")
        throw new u.ErrnoError(44);
      i = typeof i == "string" ? $i(i) : i, i & 64 ? a = a & 4095 | 32768 : a = 0;
      var o, l;
      if (typeof r == "object")
        o = r;
      else {
        l = r.endsWith("/");
        var h = u.lookupPath(r, { follow: !(i & 131072), noent_okay: !0 });
        o = h.node, r = h.path;
      }
      var d = !1;
      if (i & 64)
        if (o) {
          if (i & 128)
            throw new u.ErrnoError(20);
        } else {
          if (l)
            throw new u.ErrnoError(31);
          o = u.mknod(r, a | 511, 0), d = !0;
        }
      if (!o)
        throw new u.ErrnoError(44);
      if (u.isChrdev(o.mode) && (i &= -513), i & 65536 && !u.isDir(o.mode))
        throw new u.ErrnoError(54);
      if (!d) {
        var f = u.mayOpen(o, i);
        if (f)
          throw new u.ErrnoError(f);
      }
      i & 512 && !d && u.truncate(o, 0), i &= -131713;
      var v = u.createStream({ node: o, path: u.getPath(o), flags: i, seekable: !0, position: 0, stream_ops: o.stream_ops, ungotten: [], error: !1 });
      return v.stream_ops.open && v.stream_ops.open(v), d && u.chmod(o, a & 511), t.logReadFiles && !(i & 1) && (r in u.readFiles || (u.readFiles[r] = 1)), v;
    }, close(r) {
      if (u.isClosed(r))
        throw new u.ErrnoError(8);
      r.getdents && (r.getdents = null);
      try {
        r.stream_ops.close && r.stream_ops.close(r);
      } catch (i) {
        throw i;
      } finally {
        u.closeStream(r.fd);
      }
      r.fd = null;
    }, isClosed(r) {
      return r.fd === null;
    }, llseek(r, i, a) {
      if (u.isClosed(r))
        throw new u.ErrnoError(8);
      if (!r.seekable || !r.stream_ops.llseek)
        throw new u.ErrnoError(70);
      if (a != 0 && a != 1 && a != 2)
        throw new u.ErrnoError(28);
      return r.position = r.stream_ops.llseek(r, i, a), r.ungotten = [], r.position;
    }, read(r, i, a, o, l) {
      if (o < 0 || l < 0)
        throw new u.ErrnoError(28);
      if (u.isClosed(r))
        throw new u.ErrnoError(8);
      if ((r.flags & 2097155) === 1)
        throw new u.ErrnoError(8);
      if (u.isDir(r.node.mode))
        throw new u.ErrnoError(31);
      if (!r.stream_ops.read)
        throw new u.ErrnoError(28);
      var h = typeof l < "u";
      if (!h)
        l = r.position;
      else if (!r.seekable)
        throw new u.ErrnoError(70);
      var d = r.stream_ops.read(r, i, a, o, l);
      return h || (r.position += d), d;
    }, write(r, i, a, o, l, h) {
      if (o < 0 || l < 0)
        throw new u.ErrnoError(28);
      if (u.isClosed(r))
        throw new u.ErrnoError(8);
      if ((r.flags & 2097155) === 0)
        throw new u.ErrnoError(8);
      if (u.isDir(r.node.mode))
        throw new u.ErrnoError(31);
      if (!r.stream_ops.write)
        throw new u.ErrnoError(28);
      r.seekable && r.flags & 1024 && u.llseek(r, 0, 2);
      var d = typeof l < "u";
      if (!d)
        l = r.position;
      else if (!r.seekable)
        throw new u.ErrnoError(70);
      var f = r.stream_ops.write(r, i, a, o, l, h);
      return d || (r.position += f), f;
    }, mmap(r, i, a, o, l) {
      if ((o & 2) !== 0 && (l & 2) === 0 && (r.flags & 2097155) !== 2)
        throw new u.ErrnoError(2);
      if ((r.flags & 2097155) === 1)
        throw new u.ErrnoError(2);
      if (!r.stream_ops.mmap)
        throw new u.ErrnoError(43);
      if (!i)
        throw new u.ErrnoError(28);
      return r.stream_ops.mmap(r, i, a, o, l);
    }, msync(r, i, a, o, l) {
      return r.stream_ops.msync ? r.stream_ops.msync(r, i, a, o, l) : 0;
    }, ioctl(r, i, a) {
      if (!r.stream_ops.ioctl)
        throw new u.ErrnoError(59);
      return r.stream_ops.ioctl(r, i, a);
    }, readFile(r, i = {}) {
      if (i.flags = i.flags || 0, i.encoding = i.encoding || "binary", i.encoding !== "utf8" && i.encoding !== "binary")
        throw new Error(`Invalid encoding type "${i.encoding}"`);
      var a, o = u.open(r, i.flags), l = u.stat(r), h = l.size, d = new Uint8Array(h);
      return u.read(o, d, 0, h, 0), i.encoding === "utf8" ? a = Je(d) : i.encoding === "binary" && (a = d), u.close(o), a;
    }, writeFile(r, i, a = {}) {
      a.flags = a.flags || 577;
      var o = u.open(r, a.flags, a.mode);
      if (typeof i == "string") {
        var l = new Uint8Array(Ye(i) + 1), h = Nt(i, l, 0, l.length);
        u.write(o, l, 0, h, void 0, a.canOwn);
      } else if (ArrayBuffer.isView(i))
        u.write(o, i, 0, i.byteLength, void 0, a.canOwn);
      else
        throw new Error("Unsupported data type");
      u.close(o);
    }, cwd: () => u.currentPath, chdir(r) {
      var i = u.lookupPath(r, { follow: !0 });
      if (i.node === null)
        throw new u.ErrnoError(44);
      if (!u.isDir(i.node.mode))
        throw new u.ErrnoError(54);
      var a = u.nodePermissions(i.node, "x");
      if (a)
        throw new u.ErrnoError(a);
      u.currentPath = i.path;
    }, createDefaultDirectories() {
      u.mkdir("/tmp"), u.mkdir("/home"), u.mkdir("/home/web_user");
    }, createDefaultDevices() {
      u.mkdir("/dev"), u.registerDevice(u.makedev(1, 3), { read: () => 0, write: (o, l, h, d, f) => d, llseek: () => 0 }), u.mkdev("/dev/null", u.makedev(1, 3)), Ue.register(u.makedev(5, 0), Ue.default_tty_ops), Ue.register(u.makedev(6, 0), Ue.default_tty1_ops), u.mkdev("/dev/tty", u.makedev(5, 0)), u.mkdev("/dev/tty1", u.makedev(6, 0));
      var r = new Uint8Array(1024), i = 0, a = () => (i === 0 && (Wt(r), i = r.byteLength), r[--i]);
      u.createDevice("/dev", "random", a), u.createDevice("/dev", "urandom", a), u.mkdir("/dev/shm"), u.mkdir("/dev/shm/tmp");
    }, createSpecialDirectories() {
      u.mkdir("/proc");
      var r = u.mkdir("/proc/self");
      u.mkdir("/proc/self/fd"), u.mount({ mount() {
        var i = u.createNode(r, "fd", 16895, 73);
        return i.stream_ops = { llseek: F.stream_ops.llseek }, i.node_ops = { lookup(a, o) {
          var l = +o, h = u.getStreamChecked(l), d = { parent: null, mount: { mountpoint: "fake" }, node_ops: { readlink: () => h.path }, id: l + 1 };
          return d.parent = d, d;
        }, readdir() {
          return Array.from(u.streams.entries()).filter(([a, o]) => o).map(([a, o]) => a.toString());
        } }, i;
      } }, {}, "/proc/self/fd");
    }, createStandardStreams(r, i, a) {
      r ? u.createDevice("/dev", "stdin", r) : u.symlink("/dev/tty", "/dev/stdin"), i ? u.createDevice("/dev", "stdout", null, i) : u.symlink("/dev/tty", "/dev/stdout"), a ? u.createDevice("/dev", "stderr", null, a) : u.symlink("/dev/tty1", "/dev/stderr"), u.open("/dev/stdin", 0), u.open("/dev/stdout", 1), u.open("/dev/stderr", 1);
    }, staticInit() {
      u.nameTable = new Array(4096), u.mount(F, {}, "/"), u.createDefaultDirectories(), u.createDefaultDevices(), u.createSpecialDirectories(), u.filesystems = { MEMFS: F };
    }, init(r, i, a) {
      u.initialized = !0, r ??= t.stdin, i ??= t.stdout, a ??= t.stderr, u.createStandardStreams(r, i, a);
    }, quit() {
      u.initialized = !1;
      for (var r of u.streams)
        r && u.close(r);
    }, findObject(r, i) {
      var a = u.analyzePath(r, i);
      return a.exists ? a.object : null;
    }, analyzePath(r, i) {
      try {
        var a = u.lookupPath(r, { follow: !i });
        r = a.path;
      } catch {
      }
      var o = { isRoot: !1, exists: !1, error: 0, name: null, path: null, object: null, parentExists: !1, parentPath: null, parentObject: null };
      try {
        var a = u.lookupPath(r, { parent: !0 });
        o.parentExists = !0, o.parentPath = a.path, o.parentObject = a.node, o.name = j.basename(r), a = u.lookupPath(r, { follow: !i }), o.exists = !0, o.path = a.path, o.object = a.node, o.name = a.node.name, o.isRoot = a.path === "/";
      } catch (l) {
        o.error = l.errno;
      }
      return o;
    }, createPath(r, i, a, o) {
      r = typeof r == "string" ? r : u.getPath(r);
      for (var l = i.split("/").reverse(); l.length; ) {
        var h = l.pop();
        if (h) {
          var d = j.join2(r, h);
          try {
            u.mkdir(d);
          } catch (f) {
            if (f.errno != 20) throw f;
          }
          r = d;
        }
      }
      return d;
    }, createFile(r, i, a, o, l) {
      var h = j.join2(typeof r == "string" ? r : u.getPath(r), i), d = zt(o, l);
      return u.create(h, d);
    }, createDataFile(r, i, a, o, l, h) {
      var d = i;
      r && (r = typeof r == "string" ? r : u.getPath(r), d = i ? j.join2(r, i) : r);
      var f = zt(o, l), v = u.create(d, f);
      if (a) {
        if (typeof a == "string") {
          for (var M = new Array(a.length), y = 0, C = a.length; y < C; ++y) M[y] = a.charCodeAt(y);
          a = M;
        }
        u.chmod(v, f | 146);
        var P = u.open(v, 577);
        u.write(P, a, 0, a.length, 0, h), u.close(P), u.chmod(v, f);
      }
    }, createDevice(r, i, a, o) {
      var l = j.join2(typeof r == "string" ? r : u.getPath(r), i), h = zt(!!a, !!o);
      u.createDevice.major ??= 64;
      var d = u.makedev(u.createDevice.major++, 0);
      return u.registerDevice(d, { open(f) {
        f.seekable = !1;
      }, close(f) {
        o?.buffer?.length && o(10);
      }, read(f, v, M, y, C) {
        for (var P = 0, I = 0; I < y; I++) {
          var b;
          try {
            b = a();
          } catch {
            throw new u.ErrnoError(29);
          }
          if (b === void 0 && P === 0)
            throw new u.ErrnoError(6);
          if (b == null) break;
          P++, v[M + I] = b;
        }
        return P && (f.node.atime = Date.now()), P;
      }, write(f, v, M, y, C) {
        for (var P = 0; P < y; P++)
          try {
            o(v[M + P]);
          } catch {
            throw new u.ErrnoError(29);
          }
        return y && (f.node.mtime = f.node.ctime = Date.now()), P;
      } }), u.mkdev(l, h, d);
    }, forceLoadFile(r) {
      if (r.isDevice || r.isFolder || r.link || r.contents) return !0;
      if (typeof XMLHttpRequest < "u")
        throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
      try {
        r.contents = xe(r.url), r.usedBytes = r.contents.length;
      } catch {
        throw new u.ErrnoError(29);
      }
    }, createLazyFile(r, i, a, o, l) {
      class h {
        lengthKnown = !1;
        chunks = [];
        get(I) {
          if (!(I > this.length - 1 || I < 0)) {
            var b = I % this.chunkSize, H = I / this.chunkSize | 0;
            return this.getter(H)[b];
          }
        }
        setDataGetter(I) {
          this.getter = I;
        }
        cacheLength() {
          var I = new XMLHttpRequest();
          if (I.open("HEAD", a, !1), I.send(null), !(I.status >= 200 && I.status < 300 || I.status === 304)) throw new Error("Couldn't load " + a + ". Status: " + I.status);
          var b = Number(I.getResponseHeader("Content-length")), H, ee = (H = I.getResponseHeader("Accept-Ranges")) && H === "bytes", J = (H = I.getResponseHeader("Content-Encoding")) && H === "gzip", te = 1024 * 1024;
          ee || (te = b);
          var K = (ge, Ie) => {
            if (ge > Ie) throw new Error("invalid range (" + ge + ", " + Ie + ") or no bytes requested!");
            if (Ie > b - 1) throw new Error("only " + b + " bytes available! programmer error!");
            var Z = new XMLHttpRequest();
            if (Z.open("GET", a, !1), b !== te && Z.setRequestHeader("Range", "bytes=" + ge + "-" + Ie), Z.responseType = "arraybuffer", Z.overrideMimeType && Z.overrideMimeType("text/plain; charset=x-user-defined"), Z.send(null), !(Z.status >= 200 && Z.status < 300 || Z.status === 304)) throw new Error("Couldn't load " + a + ". Status: " + Z.status);
            return Z.response !== void 0 ? new Uint8Array(Z.response || []) : yr(Z.responseText || "");
          }, we = this;
          we.setDataGetter((ge) => {
            var Ie = ge * te, Z = (ge + 1) * te - 1;
            if (Z = Math.min(Z, b - 1), typeof we.chunks[ge] > "u" && (we.chunks[ge] = K(Ie, Z)), typeof we.chunks[ge] > "u") throw new Error("doXHR failed!");
            return we.chunks[ge];
          }), (J || !b) && (te = b = 1, b = this.getter(0).length, te = b, Ge("LazyFiles on gzip forces download of the whole file when length is accessed")), this._length = b, this._chunkSize = te, this.lengthKnown = !0;
        }
        get length() {
          return this.lengthKnown || this.cacheLength(), this._length;
        }
        get chunkSize() {
          return this.lengthKnown || this.cacheLength(), this._chunkSize;
        }
      }
      if (typeof XMLHttpRequest < "u") {
        if (!S) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
        var d = new h(), f = { isDevice: !1, contents: d };
      } else
        var f = { isDevice: !1, url: a };
      var v = u.createFile(r, i, f, o, l);
      f.contents ? v.contents = f.contents : f.url && (v.contents = null, v.url = f.url), Object.defineProperties(v, { usedBytes: { get: function() {
        return this.contents.length;
      } } });
      var M = {}, y = Object.keys(v.stream_ops);
      y.forEach((P) => {
        var I = v.stream_ops[P];
        M[P] = (...b) => (u.forceLoadFile(v), I(...b));
      });
      function C(P, I, b, H, ee) {
        var J = P.node.contents;
        if (ee >= J.length) return 0;
        var te = Math.min(J.length - ee, H);
        if (J.slice)
          for (var K = 0; K < te; K++)
            I[b + K] = J[ee + K];
        else
          for (var K = 0; K < te; K++)
            I[b + K] = J.get(ee + K);
        return te;
      }
      return M.read = (P, I, b, H, ee) => (u.forceLoadFile(v), C(P, I, b, H, ee)), M.mmap = (P, I, b, H, ee) => {
        u.forceLoadFile(v);
        var J = Cr(I);
        if (!J)
          throw new u.ErrnoError(48);
        return C(P, q, J, I, b), { ptr: J, allocated: !0 };
      }, v.stream_ops = M, v;
    } }, $t = (r, i) => (r >>>= 0, r ? Je(oe, r, i) : ""), x = { DEFAULT_POLLMASK: 5, calculateAt(r, i, a) {
      if (j.isAbs(i))
        return i;
      var o;
      if (r === -100)
        o = u.cwd();
      else {
        var l = x.getStreamFromFD(r);
        o = l.path;
      }
      if (i.length == 0) {
        if (!a)
          throw new u.ErrnoError(44);
        return o;
      }
      return o + "/" + i;
    }, writeStat(r, i) {
      D[r >>> 2 >>> 0] = i.dev, D[r + 4 >>> 2 >>> 0] = i.mode, L[r + 8 >>> 2 >>> 0] = i.nlink, D[r + 12 >>> 2 >>> 0] = i.uid, D[r + 16 >>> 2 >>> 0] = i.gid, D[r + 20 >>> 2 >>> 0] = i.rdev, _e[r + 24 >>> 3] = BigInt(i.size), D[r + 32 >>> 2 >>> 0] = 4096, D[r + 36 >>> 2 >>> 0] = i.blocks;
      var a = i.atime.getTime(), o = i.mtime.getTime(), l = i.ctime.getTime();
      return _e[r + 40 >>> 3] = BigInt(Math.floor(a / 1e3)), L[r + 48 >>> 2 >>> 0] = a % 1e3 * 1e3 * 1e3, _e[r + 56 >>> 3] = BigInt(Math.floor(o / 1e3)), L[r + 64 >>> 2 >>> 0] = o % 1e3 * 1e3 * 1e3, _e[r + 72 >>> 3] = BigInt(Math.floor(l / 1e3)), L[r + 80 >>> 2 >>> 0] = l % 1e3 * 1e3 * 1e3, _e[r + 88 >>> 3] = BigInt(i.ino), 0;
    }, writeStatFs(r, i) {
      D[r + 4 >>> 2 >>> 0] = i.bsize, D[r + 40 >>> 2 >>> 0] = i.bsize, D[r + 8 >>> 2 >>> 0] = i.blocks, D[r + 12 >>> 2 >>> 0] = i.bfree, D[r + 16 >>> 2 >>> 0] = i.bavail, D[r + 20 >>> 2 >>> 0] = i.files, D[r + 24 >>> 2 >>> 0] = i.ffree, D[r + 28 >>> 2 >>> 0] = i.fsid, D[r + 44 >>> 2 >>> 0] = i.flags, D[r + 36 >>> 2 >>> 0] = i.namelen;
    }, doMsync(r, i, a, o, l) {
      if (!u.isFile(i.node.mode))
        throw new u.ErrnoError(43);
      if (o & 2)
        return 0;
      var h = oe.slice(r, r + a);
      u.msync(i, h, l, a, o);
    }, getStreamFromFD(r) {
      var i = u.getStreamChecked(r);
      return i;
    }, varargs: void 0, getStr(r) {
      var i = $t(r);
      return i;
    } };
    function Hi(r, i) {
      r >>>= 0;
      try {
        return r = x.getStr(r), u.chmod(r, i), 0;
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return -a.errno;
      }
    }
    function Yi(r) {
      try {
        var i = x.getStreamFromFD(r);
        return u.dupStream(i).fd;
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return -a.errno;
      }
    }
    function Ui(r, i, a, o) {
      i >>>= 0;
      try {
        if (i = x.getStr(i), i = x.calculateAt(r, i), a & -8)
          return -28;
        var l = u.lookupPath(i, { follow: !0 }), h = l.node;
        if (!h)
          return -44;
        var d = "";
        return a & 4 && (d += "r"), a & 2 && (d += "w"), a & 1 && (d += "x"), d && u.nodePermissions(h, d) ? -2 : 0;
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return -f.errno;
      }
    }
    function Xi(r, i, a, o) {
      a = ye(a), o = ye(o);
      try {
        if (isNaN(a)) return 61;
        if (i != 0)
          return -138;
        if (a < 0 || o < 0)
          return -28;
        var l = u.fstat(r).size, h = a + o;
        return h > l && u.ftruncate(r, h), 0;
      } catch (d) {
        if (typeof u > "u" || d.name !== "ErrnoError") throw d;
        return -d.errno;
      }
    }
    function ji(r, i) {
      try {
        return u.fchmod(r, i), 0;
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return -a.errno;
      }
    }
    var pt = () => {
      var r = D[+x.varargs >>> 2 >>> 0];
      return x.varargs += 4, r;
    }, Oe = pt;
    function Vi(r, i, a) {
      a >>>= 0, x.varargs = a;
      try {
        var o = x.getStreamFromFD(r);
        switch (i) {
          case 0: {
            var l = pt();
            if (l < 0)
              return -28;
            for (; u.streams[l]; )
              l++;
            var h;
            return h = u.dupStream(o, l), h.fd;
          }
          case 1:
          case 2:
            return 0;
          case 3:
            return o.flags;
          case 4: {
            var l = pt();
            return o.flags |= l, 0;
          }
          case 12: {
            var l = Oe(), d = 0;
            return ue[l + d >>> 1 >>> 0] = 2, 0;
          }
          case 13:
          case 14:
            return 0;
        }
        return -28;
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return -f.errno;
      }
    }
    function qi(r, i) {
      i >>>= 0;
      try {
        return x.writeStat(i, u.fstat(r));
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return -a.errno;
      }
    }
    var ve = (r, i, a) => Nt(r, oe, i, a);
    function Ki(r, i) {
      r >>>= 0, i >>>= 0;
      try {
        if (i === 0) return -28;
        var a = u.cwd(), o = Ye(a) + 1;
        return i < o ? -68 : (ve(a, r, i), o);
      } catch (l) {
        if (typeof u > "u" || l.name !== "ErrnoError") throw l;
        return -l.errno;
      }
    }
    function Qi(r, i, a) {
      i >>>= 0, a >>>= 0;
      try {
        var o = x.getStreamFromFD(r);
        o.getdents ||= u.readdir(o.path);
        for (var l = 280, h = 0, d = u.llseek(o, 0, 1), f = Math.floor(d / l), v = Math.min(o.getdents.length, f + Math.floor(a / l)), M = f; M < v; M++) {
          var y, C, P = o.getdents[M];
          if (P === ".")
            y = o.node.id, C = 4;
          else if (P === "..") {
            var I = u.lookupPath(o.path, { parent: !0 });
            y = I.node.id, C = 4;
          } else {
            var b;
            try {
              b = u.lookupNode(o.node, P);
            } catch (H) {
              if (H?.errno === 28)
                continue;
              throw H;
            }
            y = b.id, C = u.isChrdev(b.mode) ? 2 : u.isDir(b.mode) ? 4 : u.isLink(b.mode) ? 10 : 8;
          }
          _e[i + h >>> 3] = BigInt(y), _e[i + h + 8 >>> 3] = BigInt((M + 1) * l), ue[i + h + 16 >>> 1 >>> 0] = 280, q[i + h + 18 >>> 0] = C, ve(P, i + h + 19, 256), h += l;
        }
        return u.llseek(o, M * l, 0), h;
      } catch (H) {
        if (typeof u > "u" || H.name !== "ErrnoError") throw H;
        return -H.errno;
      }
    }
    function Ji(r, i, a) {
      a >>>= 0, x.varargs = a;
      try {
        var o = x.getStreamFromFD(r);
        switch (i) {
          case 21509:
            return o.tty ? 0 : -59;
          case 21505: {
            if (!o.tty) return -59;
            if (o.tty.ops.ioctl_tcgets) {
              var l = o.tty.ops.ioctl_tcgets(o), h = Oe();
              D[h >>> 2 >>> 0] = l.c_iflag || 0, D[h + 4 >>> 2 >>> 0] = l.c_oflag || 0, D[h + 8 >>> 2 >>> 0] = l.c_cflag || 0, D[h + 12 >>> 2 >>> 0] = l.c_lflag || 0;
              for (var d = 0; d < 32; d++)
                q[h + d + 17 >>> 0] = l.c_cc[d] || 0;
              return 0;
            }
            return 0;
          }
          case 21510:
          case 21511:
          case 21512:
            return o.tty ? 0 : -59;
          case 21506:
          case 21507:
          case 21508: {
            if (!o.tty) return -59;
            if (o.tty.ops.ioctl_tcsets) {
              for (var h = Oe(), f = D[h >>> 2 >>> 0], v = D[h + 4 >>> 2 >>> 0], M = D[h + 8 >>> 2 >>> 0], y = D[h + 12 >>> 2 >>> 0], C = [], d = 0; d < 32; d++)
                C.push(q[h + d + 17 >>> 0]);
              return o.tty.ops.ioctl_tcsets(o.tty, i, { c_iflag: f, c_oflag: v, c_cflag: M, c_lflag: y, c_cc: C });
            }
            return 0;
          }
          case 21519: {
            if (!o.tty) return -59;
            var h = Oe();
            return D[h >>> 2 >>> 0] = 0, 0;
          }
          case 21520:
            return o.tty ? -28 : -59;
          case 21531: {
            var h = Oe();
            return u.ioctl(o, i, h);
          }
          case 21523: {
            if (!o.tty) return -59;
            if (o.tty.ops.ioctl_tiocgwinsz) {
              var P = o.tty.ops.ioctl_tiocgwinsz(o.tty), h = Oe();
              ue[h >>> 1 >>> 0] = P[0], ue[h + 2 >>> 1 >>> 0] = P[1];
            }
            return 0;
          }
          case 21524:
            return o.tty ? 0 : -59;
          case 21515:
            return o.tty ? 0 : -59;
          default:
            return -28;
        }
      } catch (I) {
        if (typeof u > "u" || I.name !== "ErrnoError") throw I;
        return -I.errno;
      }
    }
    function Oi(r, i) {
      r >>>= 0, i >>>= 0;
      try {
        return r = x.getStr(r), x.writeStat(i, u.lstat(r));
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return -a.errno;
      }
    }
    function Zi(r, i, a, o) {
      i >>>= 0, a >>>= 0;
      try {
        i = x.getStr(i);
        var l = o & 256, h = o & 4096;
        return o = o & -6401, i = x.calculateAt(r, i, h), x.writeStat(a, l ? u.lstat(i) : u.stat(i));
      } catch (d) {
        if (typeof u > "u" || d.name !== "ErrnoError") throw d;
        return -d.errno;
      }
    }
    function en(r, i, a, o) {
      i >>>= 0, o >>>= 0, x.varargs = o;
      try {
        i = x.getStr(i), i = x.calculateAt(r, i);
        var l = o ? pt() : 0;
        return u.open(i, a, l).fd;
      } catch (h) {
        if (typeof u > "u" || h.name !== "ErrnoError") throw h;
        return -h.errno;
      }
    }
    function tn(r, i, a, o) {
      i >>>= 0, a >>>= 0, o >>>= 0;
      try {
        if (i = x.getStr(i), i = x.calculateAt(r, i), o <= 0) return -28;
        var l = u.readlink(i), h = Math.min(o, Ye(l)), d = q[a + h >>> 0];
        return ve(l, a, o + 1), q[a + h >>> 0] = d, h;
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return -f.errno;
      }
    }
    function rn(r, i, a, o) {
      i >>>= 0, o >>>= 0;
      try {
        return i = x.getStr(i), o = x.getStr(o), i = x.calculateAt(r, i), o = x.calculateAt(a, o), u.rename(i, o), 0;
      } catch (l) {
        if (typeof u > "u" || l.name !== "ErrnoError") throw l;
        return -l.errno;
      }
    }
    function nn(r) {
      r >>>= 0;
      try {
        return r = x.getStr(r), u.rmdir(r), 0;
      } catch (i) {
        if (typeof u > "u" || i.name !== "ErrnoError") throw i;
        return -i.errno;
      }
    }
    function an(r, i) {
      r >>>= 0, i >>>= 0;
      try {
        return r = x.getStr(r), x.writeStat(i, u.stat(r));
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return -a.errno;
      }
    }
    function sn(r, i, a) {
      r >>>= 0, a >>>= 0;
      try {
        return r = x.getStr(r), a = x.getStr(a), a = x.calculateAt(i, a), u.symlink(r, a), 0;
      } catch (o) {
        if (typeof u > "u" || o.name !== "ErrnoError") throw o;
        return -o.errno;
      }
    }
    function on(r, i, a) {
      i >>>= 0;
      try {
        return i = x.getStr(i), i = x.calculateAt(r, i), a === 0 ? u.unlink(i) : a === 512 ? u.rmdir(i) : st("Invalid flags passed to unlinkat"), 0;
      } catch (o) {
        if (typeof u > "u" || o.name !== "ErrnoError") throw o;
        return -o.errno;
      }
    }
    var _n = () => st(""), mt = {}, Ht = (r) => {
      for (; r.length; ) {
        var i = r.pop(), a = r.pop();
        a(i);
      }
    };
    function ot(r) {
      return this.fromWireType(L[r >>> 2 >>> 0]);
    }
    var Ze = {}, Xe = {}, vt = {}, cn = t.InternalError = class extends Error {
      constructor(i) {
        super(i), this.name = "InternalError";
      }
    }, wt = (r) => {
      throw new cn(r);
    }, Yt = (r, i, a) => {
      r.forEach((f) => vt[f] = i);
      function o(f) {
        var v = a(f);
        v.length !== r.length && wt("Mismatched type converter count");
        for (var M = 0; M < r.length; ++M)
          fe(r[M], v[M]);
      }
      var l = new Array(i.length), h = [], d = 0;
      i.forEach((f, v) => {
        Xe.hasOwnProperty(f) ? l[v] = Xe[f] : (h.push(f), Ze.hasOwnProperty(f) || (Ze[f] = []), Ze[f].push(() => {
          l[v] = Xe[f], ++d, d === h.length && o(l);
        }));
      }), h.length === 0 && o(l);
    }, ln = function(r) {
      r >>>= 0;
      var i = mt[r];
      delete mt[r];
      var a = i.rawConstructor, o = i.rawDestructor, l = i.fields, h = l.map((d) => d.getterReturnType).concat(l.map((d) => d.setterArgumentType));
      Yt([r], h, (d) => {
        var f = {};
        return l.forEach((v, M) => {
          var y = v.fieldName, C = d[M], P = d[M].optional, I = v.getter, b = v.getterContext, H = d[M + l.length], ee = v.setter, J = v.setterContext;
          f[y] = { read: (te) => C.fromWireType(I(b, te)), write: (te, K) => {
            var we = [];
            ee(J, te, H.toWireType(we, K)), Ht(we);
          }, optional: P };
        }), [{ name: i.name, fromWireType: (v) => {
          var M = {};
          for (var y in f)
            M[y] = f[y].read(v);
          return o(v), M;
        }, toWireType: (v, M) => {
          for (var y in f)
            if (!(y in M) && !f[y].optional)
              throw new TypeError(`Missing field: "${y}"`);
          var C = a();
          for (y in f)
            f[y].write(C, M[y]);
          return v !== null && v.push(o, C), C;
        }, argPackAdvance: pe, readValueFromPointer: ot, destructorFunction: o }];
      });
    }, kt = (r) => {
      if (r === null)
        return "null";
      var i = typeof r;
      return i === "object" || i === "array" || i === "function" ? r.toString() : "" + r;
    }, un = () => {
      for (var r = new Array(256), i = 0; i < 256; ++i)
        r[i] = String.fromCharCode(i);
      Pr = r;
    }, Pr, ne = (r) => {
      for (var i = "", a = r; oe[a >>> 0]; )
        i += Pr[oe[a++ >>> 0]];
      return i;
    }, Mt = t.BindingError = class extends Error {
      constructor(i) {
        super(i), this.name = "BindingError";
      }
    }, U = (r) => {
      throw new Mt(r);
    };
    function hn(r, i, a = {}) {
      var o = i.name;
      if (r || U(`type "${o}" must have a positive integer typeid pointer`), Xe.hasOwnProperty(r)) {
        if (a.ignoreDuplicateRegistrations)
          return;
        U(`Cannot register type '${o}' twice`);
      }
      if (Xe[r] = i, delete vt[r], Ze.hasOwnProperty(r)) {
        var l = Ze[r];
        delete Ze[r], l.forEach((h) => h());
      }
    }
    function fe(r, i, a = {}) {
      return hn(r, i, a);
    }
    var Dr = (r, i, a) => {
      switch (i) {
        case 1:
          return a ? (o) => q[o >>> 0] : (o) => oe[o >>> 0];
        case 2:
          return a ? (o) => ue[o >>> 1 >>> 0] : (o) => nt[o >>> 1 >>> 0];
        case 4:
          return a ? (o) => D[o >>> 2 >>> 0] : (o) => L[o >>> 2 >>> 0];
        case 8:
          return a ? (o) => _e[o >>> 3] : (o) => hr[o >>> 3];
        default:
          throw new TypeError(`invalid integer width (${i}): ${r}`);
      }
    };
    function gn(r, i, a, o, l) {
      r >>>= 0, i >>>= 0, a >>>= 0, i = ne(i);
      var h = i.indexOf("u") != -1;
      fe(r, { name: i, fromWireType: (d) => d, toWireType: function(d, f) {
        if (typeof f != "bigint" && typeof f != "number")
          throw new TypeError(`Cannot convert "${kt(f)}" to ${this.name}`);
        return typeof f == "number" && (f = BigInt(f)), f;
      }, argPackAdvance: pe, readValueFromPointer: Dr(i, a, !h), destructorFunction: null });
    }
    var pe = 8;
    function dn(r, i, a, o) {
      r >>>= 0, i >>>= 0, i = ne(i), fe(r, { name: i, fromWireType: function(l) {
        return !!l;
      }, toWireType: function(l, h) {
        return h ? a : o;
      }, argPackAdvance: pe, readValueFromPointer: function(l) {
        return this.fromWireType(oe[l >>> 0]);
      }, destructorFunction: null });
    }
    var fn = (r) => ({ count: r.count, deleteScheduled: r.deleteScheduled, preservePointerOnDelete: r.preservePointerOnDelete, ptr: r.ptr, ptrType: r.ptrType, smartPtr: r.smartPtr, smartPtrType: r.smartPtrType }), Ut = (r) => {
      function i(a) {
        return a.$$.ptrType.registeredClass.name;
      }
      U(i(r) + " instance already deleted");
    }, Xt = !1, Er = (r) => {
    }, pn = (r) => {
      r.smartPtr ? r.smartPtrType.rawDestructor(r.smartPtr) : r.ptrType.registeredClass.rawDestructor(r.ptr);
    }, Tr = (r) => {
      r.count.value -= 1;
      var i = r.count.value === 0;
      i && pn(r);
    }, _t = (r) => typeof FinalizationRegistry > "u" ? (_t = (i) => i, r) : (Xt = new FinalizationRegistry((i) => {
      Tr(i.$$);
    }), _t = (i) => {
      var a = i.$$, o = !!a.smartPtr;
      if (o) {
        var l = { $$: a };
        Xt.register(i, l, i);
      }
      return i;
    }, Er = (i) => Xt.unregister(i), _t(r)), mn = () => {
      let r = yt.prototype;
      Object.assign(r, { isAliasOf(a) {
        if (!(this instanceof yt) || !(a instanceof yt))
          return !1;
        var o = this.$$.ptrType.registeredClass, l = this.$$.ptr;
        a.$$ = a.$$;
        for (var h = a.$$.ptrType.registeredClass, d = a.$$.ptr; o.baseClass; )
          l = o.upcast(l), o = o.baseClass;
        for (; h.baseClass; )
          d = h.upcast(d), h = h.baseClass;
        return o === h && l === d;
      }, clone() {
        if (this.$$.ptr || Ut(this), this.$$.preservePointerOnDelete)
          return this.$$.count.value += 1, this;
        var a = _t(Object.create(Object.getPrototypeOf(this), { $$: { value: fn(this.$$) } }));
        return a.$$.count.value += 1, a.$$.deleteScheduled = !1, a;
      }, delete() {
        this.$$.ptr || Ut(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && U("Object already scheduled for deletion"), Er(this), Tr(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
      }, isDeleted() {
        return !this.$$.ptr;
      }, deleteLater() {
        return this.$$.ptr || Ut(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && U("Object already scheduled for deletion"), this.$$.deleteScheduled = !0, this;
      } });
      const i = Symbol.dispose;
      i && (r[i] = r.delete);
    };
    function yt() {
    }
    var St = (r, i) => Object.defineProperty(i, "name", { value: r }), br = {}, vn = (r, i, a) => {
      if (r[i].overloadTable === void 0) {
        var o = r[i];
        r[i] = function(...l) {
          return r[i].overloadTable.hasOwnProperty(l.length) || U(`Function '${a}' called with an invalid number of arguments (${l.length}) - expects one of (${r[i].overloadTable})!`), r[i].overloadTable[l.length].apply(this, l);
        }, r[i].overloadTable = [], r[i].overloadTable[o.argCount] = o;
      }
    }, jt = (r, i, a) => {
      t.hasOwnProperty(r) ? ((a === void 0 || t[r].overloadTable !== void 0 && t[r].overloadTable[a] !== void 0) && U(`Cannot register public name '${r}' twice`), vn(t, r, r), t[r].overloadTable.hasOwnProperty(a) && U(`Cannot register multiple overloads of a function with the same number of arguments (${a})!`), t[r].overloadTable[a] = i) : (t[r] = i, t[r].argCount = a);
    }, wn = 48, kn = 57, Mn = (r) => {
      r = r.replace(/[^a-zA-Z0-9_]/g, "$");
      var i = r.charCodeAt(0);
      return i >= wn && i <= kn ? `_${r}` : r;
    };
    function yn(r, i, a, o, l, h, d, f) {
      this.name = r, this.constructor = i, this.instancePrototype = a, this.rawDestructor = o, this.baseClass = l, this.getActualType = h, this.upcast = d, this.downcast = f, this.pureVirtualFunctions = [];
    }
    var Vt = (r, i, a) => {
      for (; i !== a; )
        i.upcast || U(`Expected null or instance of ${a.name}, got an instance of ${i.name}`), r = i.upcast(r), i = i.baseClass;
      return r;
    };
    function Sn(r, i) {
      if (i === null)
        return this.isReference && U(`null is not a valid ${this.name}`), 0;
      i.$$ || U(`Cannot pass "${kt(i)}" as a ${this.name}`), i.$$.ptr || U(`Cannot pass deleted object as a pointer of type ${this.name}`);
      var a = i.$$.ptrType.registeredClass, o = Vt(i.$$.ptr, a, this.registeredClass);
      return o;
    }
    function Cn(r, i) {
      var a;
      if (i === null)
        return this.isReference && U(`null is not a valid ${this.name}`), this.isSmartPointer ? (a = this.rawConstructor(), r !== null && r.push(this.rawDestructor, a), a) : 0;
      (!i || !i.$$) && U(`Cannot pass "${kt(i)}" as a ${this.name}`), i.$$.ptr || U(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && i.$$.ptrType.isConst && U(`Cannot convert argument of type ${i.$$.smartPtrType ? i.$$.smartPtrType.name : i.$$.ptrType.name} to parameter type ${this.name}`);
      var o = i.$$.ptrType.registeredClass;
      if (a = Vt(i.$$.ptr, o, this.registeredClass), this.isSmartPointer)
        switch (i.$$.smartPtr === void 0 && U("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
          case 0:
            i.$$.smartPtrType === this ? a = i.$$.smartPtr : U(`Cannot convert argument of type ${i.$$.smartPtrType ? i.$$.smartPtrType.name : i.$$.ptrType.name} to parameter type ${this.name}`);
            break;
          case 1:
            a = i.$$.smartPtr;
            break;
          case 2:
            if (i.$$.smartPtrType === this)
              a = i.$$.smartPtr;
            else {
              var l = i.clone();
              a = this.rawShare(a, he.toHandle(() => l.delete())), r !== null && r.push(this.rawDestructor, a);
            }
            break;
          default:
            U("Unsupporting sharing policy");
        }
      return a;
    }
    function In(r, i) {
      if (i === null)
        return this.isReference && U(`null is not a valid ${this.name}`), 0;
      i.$$ || U(`Cannot pass "${kt(i)}" as a ${this.name}`), i.$$.ptr || U(`Cannot pass deleted object as a pointer of type ${this.name}`), i.$$.ptrType.isConst && U(`Cannot convert argument of type ${i.$$.ptrType.name} to parameter type ${this.name}`);
      var a = i.$$.ptrType.registeredClass, o = Vt(i.$$.ptr, a, this.registeredClass);
      return o;
    }
    var Ar = (r, i, a) => {
      if (i === a)
        return r;
      if (a.baseClass === void 0)
        return null;
      var o = Ar(r, i, a.baseClass);
      return o === null ? null : a.downcast(o);
    }, Pn = {}, Dn = (r, i) => {
      for (i === void 0 && U("ptr should not be undefined"); r.baseClass; )
        i = r.upcast(i), r = r.baseClass;
      return i;
    }, En = (r, i) => (i = Dn(r, i), Pn[i]), Ct = (r, i) => {
      (!i.ptrType || !i.ptr) && wt("makeClassHandle requires ptr and ptrType");
      var a = !!i.smartPtrType, o = !!i.smartPtr;
      return a !== o && wt("Both smartPtrType and smartPtr must be specified"), i.count = { value: 1 }, _t(Object.create(r, { $$: { value: i, writable: !0 } }));
    };
    function Tn(r) {
      var i = this.getPointee(r);
      if (!i)
        return this.destructor(r), null;
      var a = En(this.registeredClass, i);
      if (a !== void 0) {
        if (a.$$.count.value === 0)
          return a.$$.ptr = i, a.$$.smartPtr = r, a.clone();
        var o = a.clone();
        return this.destructor(r), o;
      }
      function l() {
        return this.isSmartPointer ? Ct(this.registeredClass.instancePrototype, { ptrType: this.pointeeType, ptr: i, smartPtrType: this, smartPtr: r }) : Ct(this.registeredClass.instancePrototype, { ptrType: this, ptr: r });
      }
      var h = this.registeredClass.getActualType(i), d = br[h];
      if (!d)
        return l.call(this);
      var f;
      this.isConst ? f = d.constPointerType : f = d.pointerType;
      var v = Ar(i, this.registeredClass, f.registeredClass);
      return v === null ? l.call(this) : this.isSmartPointer ? Ct(f.registeredClass.instancePrototype, { ptrType: f, ptr: v, smartPtrType: this, smartPtr: r }) : Ct(f.registeredClass.instancePrototype, { ptrType: f, ptr: v });
    }
    var bn = () => {
      Object.assign(It.prototype, { getPointee(r) {
        return this.rawGetPointee && (r = this.rawGetPointee(r)), r;
      }, destructor(r) {
        this.rawDestructor?.(r);
      }, argPackAdvance: pe, readValueFromPointer: ot, fromWireType: Tn });
    };
    function It(r, i, a, o, l, h, d, f, v, M, y) {
      this.name = r, this.registeredClass = i, this.isReference = a, this.isConst = o, this.isSmartPointer = l, this.pointeeType = h, this.sharingPolicy = d, this.rawGetPointee = f, this.rawConstructor = v, this.rawShare = M, this.rawDestructor = y, !l && i.baseClass === void 0 ? o ? (this.toWireType = Sn, this.destructorFunction = null) : (this.toWireType = In, this.destructorFunction = null) : this.toWireType = Cn;
    }
    var Rr = (r, i, a) => {
      t.hasOwnProperty(r) || wt("Replacing nonexistent public symbol"), t[r].overloadTable !== void 0 && a !== void 0 ? t[r].overloadTable[a] = i : (t[r] = i, t[r].argCount = a);
    }, An = (r, i, a = [], o = !1) => {
      var l = W(i), h = l(...a);
      return r[0] == "p" ? h >>> 0 : h;
    }, Rn = (r, i, a = !1) => (...o) => An(r, i, o, a), Se = (r, i, a = !1) => {
      r = ne(r);
      function o() {
        if (r.includes("p"))
          return Rn(r, i, a);
        var h = W(i);
        return h;
      }
      var l = o();
      return typeof l != "function" && U(`unknown function pointer with signature ${r}: ${i}`), l;
    };
    class xn extends Error {
    }
    var xr = (r) => {
      var i = us(r), a = ne(i);
      return je(i), a;
    }, Gr = (r, i) => {
      var a = [], o = {};
      function l(h) {
        if (!o[h] && !Xe[h]) {
          if (vt[h]) {
            vt[h].forEach(l);
            return;
          }
          a.push(h), o[h] = !0;
        }
      }
      throw i.forEach(l), new xn(`${r}: ` + a.map(xr).join([", "]));
    };
    function Gn(r, i, a, o, l, h, d, f, v, M, y, C, P) {
      r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0, l >>>= 0, h >>>= 0, d >>>= 0, f >>>= 0, v >>>= 0, M >>>= 0, y >>>= 0, C >>>= 0, P >>>= 0, y = ne(y), h = Se(l, h), f &&= Se(d, f), M &&= Se(v, M), P = Se(C, P);
      var I = Mn(y);
      jt(I, function() {
        Gr(`Cannot construct ${y} due to unbound types`, [o]);
      }), Yt([r, i, a], o ? [o] : [], (b) => {
        b = b[0];
        var H, ee;
        o ? (H = b.registeredClass, ee = H.instancePrototype) : ee = yt.prototype;
        var J = St(y, function(...Z) {
          if (Object.getPrototypeOf(this) !== te)
            throw new Mt(`Use 'new' to construct ${y}`);
          if (K.constructor_body === void 0)
            throw new Mt(`${y} has no accessible constructor`);
          var Kr = K.constructor_body[Z.length];
          if (Kr === void 0)
            throw new Mt(`Tried to invoke ctor of ${y} with invalid number of parameters (${Z.length}) - expected (${Object.keys(K.constructor_body).toString()}) parameters instead!`);
          return Kr.apply(this, Z);
        }), te = Object.create(ee, { constructor: { value: J } });
        J.prototype = te;
        var K = new yn(y, J, te, P, H, h, f, M);
        K.baseClass && (K.baseClass.__derivedClasses ??= [], K.baseClass.__derivedClasses.push(K));
        var we = new It(y, K, !0, !1, !1), ge = new It(y + "*", K, !1, !1, !1), Ie = new It(y + " const*", K, !1, !0, !1);
        return br[r] = { pointerType: ge, constPointerType: Ie }, Rr(I, J), [we, ge, Ie];
      });
    }
    var qt = [], Ce = [];
    function Kt(r) {
      r >>>= 0, r > 9 && --Ce[r + 1] === 0 && (Ce[r] = void 0, qt.push(r));
    }
    var Fn = () => Ce.length / 2 - 5 - qt.length, Ln = () => {
      Ce.push(0, 1, void 0, 1, null, 1, !0, 1, !1, 1), t.count_emval_handles = Fn;
    }, he = { toValue: (r) => (r || U(`Cannot use deleted val. handle = ${r}`), Ce[r]), toHandle: (r) => {
      switch (r) {
        case void 0:
          return 2;
        case null:
          return 4;
        case !0:
          return 6;
        case !1:
          return 8;
        default: {
          const i = qt.pop() || Ce.length;
          return Ce[i] = r, Ce[i + 1] = 1, i;
        }
      }
    } }, Wn = { name: "emscripten::val", fromWireType: (r) => {
      var i = he.toValue(r);
      return Kt(r), i;
    }, toWireType: (r, i) => he.toHandle(i), argPackAdvance: pe, readValueFromPointer: ot, destructorFunction: null };
    function Bn(r) {
      return r >>>= 0, fe(r, Wn);
    }
    var Nn = (r, i, a) => {
      switch (i) {
        case 1:
          return a ? function(o) {
            return this.fromWireType(q[o >>> 0]);
          } : function(o) {
            return this.fromWireType(oe[o >>> 0]);
          };
        case 2:
          return a ? function(o) {
            return this.fromWireType(ue[o >>> 1 >>> 0]);
          } : function(o) {
            return this.fromWireType(nt[o >>> 1 >>> 0]);
          };
        case 4:
          return a ? function(o) {
            return this.fromWireType(D[o >>> 2 >>> 0]);
          } : function(o) {
            return this.fromWireType(L[o >>> 2 >>> 0]);
          };
        default:
          throw new TypeError(`invalid integer width (${i}): ${r}`);
      }
    };
    function zn(r, i, a, o) {
      r >>>= 0, i >>>= 0, a >>>= 0, i = ne(i);
      function l() {
      }
      l.values = {}, fe(r, { name: i, constructor: l, fromWireType: function(h) {
        return this.constructor.values[h];
      }, toWireType: (h, d) => d.value, argPackAdvance: pe, readValueFromPointer: Nn(i, a, o), destructorFunction: null }), jt(i, l);
    }
    var Qt = (r, i) => {
      var a = Xe[r];
      return a === void 0 && U(`${i} has unknown type ${xr(r)}`), a;
    };
    function $n(r, i, a) {
      r >>>= 0, i >>>= 0;
      var o = Qt(r, "enum");
      i = ne(i);
      var l = o.constructor, h = Object.create(o.constructor.prototype, { value: { value: a }, constructor: { value: St(`${o.name}_${i}`, function() {
      }) } });
      l.values[a] = h, l[i] = h;
    }
    var Hn = (r, i) => {
      switch (i) {
        case 4:
          return function(a) {
            return this.fromWireType(gt[a >>> 2 >>> 0]);
          };
        case 8:
          return function(a) {
            return this.fromWireType(dt[a >>> 3 >>> 0]);
          };
        default:
          throw new TypeError(`invalid float width (${i}): ${r}`);
      }
    }, Yn = function(r, i, a) {
      r >>>= 0, i >>>= 0, a >>>= 0, i = ne(i), fe(r, { name: i, fromWireType: (o) => o, toWireType: (o, l) => l, argPackAdvance: pe, readValueFromPointer: Hn(i, a), destructorFunction: null });
    };
    function Un(r) {
      for (var i = 1; i < r.length; ++i)
        if (r[i] !== null && r[i].destructorFunction === void 0)
          return !0;
      return !1;
    }
    var Xn = { ftf: function(r, i, a, o, l, h, d) {
      return function() {
        var f = a(o), v = h.fromWireType(f);
        return v;
      };
    }, ftft: function(r, i, a, o, l, h, d, f, v) {
      return function(M) {
        var y = f.toWireType(null, M), C = a(o, y);
        v(y);
        var P = h.fromWireType(C);
        return P;
      };
    }, ftfn: function(r, i, a, o, l, h, d, f) {
      return function(v) {
        var M = f.toWireType(null, v), y = a(o, M), C = h.fromWireType(y);
        return C;
      };
    }, ftfnn: function(r, i, a, o, l, h, d, f, v) {
      return function(M, y) {
        var C = f.toWireType(null, M), P = v.toWireType(null, y), I = a(o, C, P), b = h.fromWireType(I);
        return b;
      };
    }, fffn: function(r, i, a, o, l, h, d, f) {
      return function(v) {
        var M = f.toWireType(null, v);
        a(o, M);
      };
    }, ftfnnn: function(r, i, a, o, l, h, d, f, v, M) {
      return function(y, C, P) {
        var I = f.toWireType(null, y), b = v.toWireType(null, C), H = M.toWireType(null, P), ee = a(o, I, b, H), J = h.fromWireType(ee);
        return J;
      };
    }, ftfnt: function(r, i, a, o, l, h, d, f, v, M) {
      return function(y, C) {
        var P = f.toWireType(null, y), I = v.toWireType(null, C), b = a(o, P, I);
        M(I);
        var H = h.fromWireType(b);
        return H;
      };
    } };
    function jn(r, i, a, o) {
      const l = ["f", a ? "t" : "f", o ? "t" : "f"];
      for (let h = 2; h < r.length; ++h) {
        const d = r[h];
        let f = "";
        d.destructorFunction === void 0 ? f = "u" : d.destructorFunction === null ? f = "n" : f = "t", l.push(f);
      }
      return l.join("");
    }
    function Vn(r, i, a, o, l, h) {
      var d = i.length;
      d < 2 && U("argTypes array size mismatch! Must at least get return value and 'this' types!");
      for (var f = i[1] !== null && a !== null, v = Un(i), M = i[0].name !== "void", y = [r, U, o, l, Ht, i[0], i[1]], C = 0; C < d - 2; ++C)
        y.push(i[C + 2]);
      if (!v)
        for (var C = 2; C < i.length; ++C)
          i[C].destructorFunction !== null && y.push(i[C].destructorFunction);
      var P = jn(i, f, M, h), I = Xn[P](...y);
      return St(r, I);
    }
    var qn = (r, i) => {
      for (var a = [], o = 0; o < r; o++)
        a.push(L[i + o * 4 >>> 2 >>> 0]);
      return a;
    }, Kn = (r) => {
      r = r.trim();
      const i = r.indexOf("(");
      return i === -1 ? r : r.slice(0, i);
    };
    function Qn(r, i, a, o, l, h, d, f) {
      r >>>= 0, a >>>= 0, o >>>= 0, l >>>= 0, h >>>= 0;
      var v = qn(i, a);
      r = ne(r), r = Kn(r), l = Se(o, l, d), jt(r, function() {
        Gr(`Cannot call ${r} due to unbound types`, v);
      }, i - 1), Yt([], v, (M) => {
        var y = [M[0], null].concat(M.slice(1));
        return Rr(r, Vn(r, y, null, l, h, d), i - 1), [];
      });
    }
    function Jn(r, i, a, o, l) {
      r >>>= 0, i >>>= 0, a >>>= 0, i = ne(i);
      var h = (y) => y;
      if (o === 0) {
        var d = 32 - 8 * a;
        h = (y) => y << d >>> d;
      }
      var f = i.includes("unsigned"), v = (y, C) => {
      }, M;
      f ? M = function(y, C) {
        return v(C, this.name), C >>> 0;
      } : M = function(y, C) {
        return v(C, this.name), C;
      }, fe(r, { name: i, fromWireType: h, toWireType: M, argPackAdvance: pe, readValueFromPointer: Dr(i, a, o !== 0), destructorFunction: null });
    }
    function On(r, i, a) {
      r >>>= 0, a >>>= 0;
      var o = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array], l = o[i];
      function h(d) {
        var f = L[d >>> 2 >>> 0], v = L[d + 4 >>> 2 >>> 0];
        return new l(q.buffer, v, f);
      }
      a = ne(a), fe(r, { name: a, fromWireType: h, argPackAdvance: pe, readValueFromPointer: h }, { ignoreDuplicateRegistrations: !0 });
    }
    function Zn(r, i) {
      r >>>= 0, i >>>= 0, i = ne(i), fe(r, { name: i, fromWireType(a) {
        for (var o = L[a >>> 2 >>> 0], l = a + 4, h, d, f = l, d = 0; d <= o; ++d) {
          var v = l + d;
          if (d == o || oe[v >>> 0] == 0) {
            var M = v - f, y = $t(f, M);
            h === void 0 ? h = y : (h += "\0", h += y), f = v + 1;
          }
        }
        return je(a), h;
      }, toWireType(a, o) {
        o instanceof ArrayBuffer && (o = new Uint8Array(o));
        var l, h = typeof o == "string";
        h || ArrayBuffer.isView(o) && o.BYTES_PER_ELEMENT == 1 || U("Cannot pass non-string to std::string"), h ? l = Ye(o) : l = o.length;
        var d = qr(4 + l + 1), f = d + 4;
        return L[d >>> 2 >>> 0] = l, h ? ve(o, f, l + 1) : oe.set(o, f >>> 0), a !== null && a.push(je, d), d;
      }, argPackAdvance: pe, readValueFromPointer: ot, destructorFunction(a) {
        je(a);
      } });
    }
    var Fr = typeof TextDecoder < "u" ? new TextDecoder("utf-16le") : void 0, ea = (r, i) => {
      for (var a = r, o = a >> 1, l = o + i / 2; !(o >= l) && nt[o >>> 0]; ) ++o;
      if (a = o << 1, a - r > 32 && Fr) return Fr.decode(oe.subarray(r >>> 0, a >>> 0));
      for (var h = "", d = 0; !(d >= i / 2); ++d) {
        var f = ue[r + d * 2 >>> 1 >>> 0];
        if (f == 0) break;
        h += String.fromCharCode(f);
      }
      return h;
    }, ta = (r, i, a) => {
      if (a ??= 2147483647, a < 2) return 0;
      a -= 2;
      for (var o = i, l = a < r.length * 2 ? a / 2 : r.length, h = 0; h < l; ++h) {
        var d = r.charCodeAt(h);
        ue[i >>> 1 >>> 0] = d, i += 2;
      }
      return ue[i >>> 1 >>> 0] = 0, i - o;
    }, ra = (r) => r.length * 2, ia = (r, i) => {
      for (var a = 0, o = ""; !(a >= i / 4); ) {
        var l = D[r + a * 4 >>> 2 >>> 0];
        if (l == 0) break;
        if (++a, l >= 65536) {
          var h = l - 65536;
          o += String.fromCharCode(55296 | h >> 10, 56320 | h & 1023);
        } else
          o += String.fromCharCode(l);
      }
      return o;
    }, na = (r, i, a) => {
      if (i >>>= 0, a ??= 2147483647, a < 4) return 0;
      for (var o = i, l = o + a - 4, h = 0; h < r.length; ++h) {
        var d = r.charCodeAt(h);
        if (d >= 55296 && d <= 57343) {
          var f = r.charCodeAt(++h);
          d = 65536 + ((d & 1023) << 10) | f & 1023;
        }
        if (D[i >>> 2 >>> 0] = d, i += 4, i + 4 > l) break;
      }
      return D[i >>> 2 >>> 0] = 0, i - o;
    }, aa = (r) => {
      for (var i = 0, a = 0; a < r.length; ++a) {
        var o = r.charCodeAt(a);
        o >= 55296 && o <= 57343 && ++a, i += 4;
      }
      return i;
    }, sa = function(r, i, a) {
      r >>>= 0, i >>>= 0, a >>>= 0, a = ne(a);
      var o, l, h, d;
      i === 2 ? (o = ea, l = ta, d = ra, h = (f) => nt[f >>> 1 >>> 0]) : i === 4 && (o = ia, l = na, d = aa, h = (f) => L[f >>> 2 >>> 0]), fe(r, { name: a, fromWireType: (f) => {
        for (var v = L[f >>> 2 >>> 0], M, y = f + 4, C = 0; C <= v; ++C) {
          var P = f + 4 + C * i;
          if (C == v || h(P) == 0) {
            var I = P - y, b = o(y, I);
            M === void 0 ? M = b : (M += "\0", M += b), y = P + i;
          }
        }
        return je(f), M;
      }, toWireType: (f, v) => {
        typeof v != "string" && U(`Cannot pass non-string to C++ string type ${a}`);
        var M = d(v), y = qr(4 + M + i);
        return L[y >>> 2 >>> 0] = M / i, l(v, y + 4, M + i), f !== null && f.push(je, y), y;
      }, argPackAdvance: pe, readValueFromPointer: ot, destructorFunction(f) {
        je(f);
      } });
    };
    function oa(r, i, a, o, l, h) {
      r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0, l >>>= 0, h >>>= 0, mt[r] = { name: ne(i), rawConstructor: Se(a, o), rawDestructor: Se(l, h), fields: [] };
    }
    function _a(r, i, a, o, l, h, d, f, v, M) {
      r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0, l >>>= 0, h >>>= 0, d >>>= 0, f >>>= 0, v >>>= 0, M >>>= 0, mt[r].fields.push({ fieldName: ne(i), getterReturnType: a, getter: Se(o, l), getterContext: h, setterArgumentType: d, setter: Se(f, v), setterContext: M });
    }
    var ca = function(r, i) {
      r >>>= 0, i >>>= 0, i = ne(i), fe(r, { isVoid: !0, name: i, argPackAdvance: 0, fromWireType: () => {
      }, toWireType: (a, o) => {
      } });
    }, Lr = 0, la = () => {
      Gt = !1, Lr = 0;
    };
    function ua(r) {
      return r >>>= 0, r ? -52 : 0;
    }
    var ha = () => {
      throw 1 / 0;
    }, ga = {}, Wr = (r) => {
      var i = ga[r];
      return i === void 0 ? ne(r) : i;
    }, Jt = [];
    function da(r, i, a, o, l) {
      return r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0, l >>>= 0, r = Jt[r], i = he.toValue(i), a = Wr(a), r(i, i[a], o, l);
    }
    var fa = (r) => {
      var i = Jt.length;
      return Jt.push(r), i;
    }, pa = (r, i) => {
      for (var a = new Array(r), o = 0; o < r; ++o)
        a[o] = Qt(L[i + o * 4 >>> 2 >>> 0], `parameter ${o}`);
      return a;
    }, ma = (r, i, a) => {
      var o = [], l = r.toWireType(o, a);
      return o.length && (L[i >>> 2 >>> 0] = he.toHandle(o)), l;
    }, va = Reflect.construct, wa = function(r, i, a) {
      i >>>= 0;
      var o = pa(r, i), l = o.shift();
      r--;
      var h = new Array(r), d = (v, M, y, C) => {
        for (var P = 0, I = 0; I < r; ++I)
          h[I] = o[I].readValueFromPointer(C + P), P += o[I].argPackAdvance;
        var b = a === 1 ? va(M, h) : M.apply(v, h);
        return ma(l, y, b);
      }, f = `methodCaller<(${o.map((v) => v.name).join(", ")}) => ${l.name}>`;
      return fa(St(f, d));
    };
    function ka(r) {
      r >>>= 0, r > 9 && (Ce[r + 1] += 1);
    }
    function Ma() {
      return he.toHandle([]);
    }
    function ya(r) {
      return r >>>= 0, he.toHandle(Wr(r));
    }
    function Sa() {
      return he.toHandle({});
    }
    function Ca(r) {
      r >>>= 0;
      var i = he.toValue(r);
      Ht(i), Kt(r);
    }
    function Ia(r, i, a) {
      r >>>= 0, i >>>= 0, a >>>= 0, r = he.toValue(r), i = he.toValue(i), a = he.toValue(a), r[i] = a;
    }
    function Pa(r, i) {
      r >>>= 0, i >>>= 0, r = Qt(r, "_emval_take_value");
      var a = r.readValueFromPointer(i);
      return he.toHandle(a);
    }
    function Da(r, i) {
      r = ye(r), i >>>= 0;
      var a = new Date(r * 1e3);
      D[i >>> 2 >>> 0] = a.getUTCSeconds(), D[i + 4 >>> 2 >>> 0] = a.getUTCMinutes(), D[i + 8 >>> 2 >>> 0] = a.getUTCHours(), D[i + 12 >>> 2 >>> 0] = a.getUTCDate(), D[i + 16 >>> 2 >>> 0] = a.getUTCMonth(), D[i + 20 >>> 2 >>> 0] = a.getUTCFullYear() - 1900, D[i + 24 >>> 2 >>> 0] = a.getUTCDay();
      var o = Date.UTC(a.getUTCFullYear(), 0, 1, 0, 0, 0, 0), l = (a.getTime() - o) / (1e3 * 60 * 60 * 24) | 0;
      D[i + 28 >>> 2 >>> 0] = l;
    }
    var Ea = (r) => r % 4 === 0 && (r % 100 !== 0 || r % 400 === 0), Ta = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], ba = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], Br = (r) => {
      var i = Ea(r.getFullYear()), a = i ? Ta : ba, o = a[r.getMonth()] + r.getDate() - 1;
      return o;
    };
    function Aa(r, i) {
      r = ye(r), i >>>= 0;
      var a = new Date(r * 1e3);
      D[i >>> 2 >>> 0] = a.getSeconds(), D[i + 4 >>> 2 >>> 0] = a.getMinutes(), D[i + 8 >>> 2 >>> 0] = a.getHours(), D[i + 12 >>> 2 >>> 0] = a.getDate(), D[i + 16 >>> 2 >>> 0] = a.getMonth(), D[i + 20 >>> 2 >>> 0] = a.getFullYear() - 1900, D[i + 24 >>> 2 >>> 0] = a.getDay();
      var o = Br(a) | 0;
      D[i + 28 >>> 2 >>> 0] = o, D[i + 36 >>> 2 >>> 0] = -(a.getTimezoneOffset() * 60);
      var l = new Date(a.getFullYear(), 0, 1), h = new Date(a.getFullYear(), 6, 1).getTimezoneOffset(), d = l.getTimezoneOffset(), f = (h != d && a.getTimezoneOffset() == Math.min(d, h)) | 0;
      D[i + 32 >>> 2 >>> 0] = f;
    }
    var Ra = function(r) {
      r >>>= 0;
      var i = (() => {
        var a = new Date(D[r + 20 >>> 2 >>> 0] + 1900, D[r + 16 >>> 2 >>> 0], D[r + 12 >>> 2 >>> 0], D[r + 8 >>> 2 >>> 0], D[r + 4 >>> 2 >>> 0], D[r >>> 2 >>> 0], 0), o = D[r + 32 >>> 2 >>> 0], l = a.getTimezoneOffset(), h = new Date(a.getFullYear(), 0, 1), d = new Date(a.getFullYear(), 6, 1).getTimezoneOffset(), f = h.getTimezoneOffset(), v = Math.min(f, d);
        if (o < 0)
          D[r + 32 >>> 2 >>> 0] = +(d != f && v == l);
        else if (o > 0 != (v == l)) {
          var M = Math.max(f, d), y = o > 0 ? v : M;
          a.setTime(a.getTime() + (y - l) * 6e4);
        }
        D[r + 24 >>> 2 >>> 0] = a.getDay();
        var C = Br(a) | 0;
        D[r + 28 >>> 2 >>> 0] = C, D[r >>> 2 >>> 0] = a.getSeconds(), D[r + 4 >>> 2 >>> 0] = a.getMinutes(), D[r + 8 >>> 2 >>> 0] = a.getHours(), D[r + 12 >>> 2 >>> 0] = a.getDate(), D[r + 16 >>> 2 >>> 0] = a.getMonth(), D[r + 20 >>> 2 >>> 0] = a.getYear();
        var P = a.getTime();
        return isNaN(P) ? -1 : P / 1e3;
      })();
      return BigInt(i);
    };
    function xa(r, i, a, o, l, h, d) {
      r >>>= 0, l = ye(l), h >>>= 0, d >>>= 0;
      try {
        if (isNaN(l)) return 61;
        var f = x.getStreamFromFD(o), v = u.mmap(f, r, l, i, a), M = v.ptr;
        return D[h >>> 2 >>> 0] = v.allocated, L[d >>> 2 >>> 0] = M, 0;
      } catch (y) {
        if (typeof u > "u" || y.name !== "ErrnoError") throw y;
        return -y.errno;
      }
    }
    function Ga(r, i, a, o, l, h) {
      r >>>= 0, i >>>= 0, h = ye(h);
      try {
        var d = x.getStreamFromFD(l);
        a & 2 && x.doMsync(r, d, i, o, h);
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return -f.errno;
      }
    }
    var Fa = function(r, i, a, o) {
      r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0;
      var l = (/* @__PURE__ */ new Date()).getFullYear(), h = new Date(l, 0, 1), d = new Date(l, 6, 1), f = h.getTimezoneOffset(), v = d.getTimezoneOffset(), M = Math.max(f, v);
      L[r >>> 2 >>> 0] = M * 60, D[i >>> 2 >>> 0] = +(f != v);
      var y = (I) => {
        var b = I >= 0 ? "-" : "+", H = Math.abs(I), ee = String(Math.floor(H / 60)).padStart(2, "0"), J = String(H % 60).padStart(2, "0");
        return `UTC${b}${ee}${J}`;
      }, C = y(f), P = y(v);
      v < f ? (ve(C, a, 17), ve(P, o, 17)) : (ve(C, o, 17), ve(P, a, 17));
    }, Nr = () => performance.now(), zr = () => Date.now(), La = (r) => r >= 0 && r <= 3;
    function Wa(r, i, a) {
      if (a >>>= 0, !La(r))
        return 28;
      var o;
      r === 0 ? o = zr() : o = Nr();
      var l = Math.round(o * 1e3 * 1e3);
      return _e[a >>> 3] = BigInt(l), 0;
    }
    var $r = () => 4294901760;
    function Ba() {
      return $r();
    }
    var Na = (r) => {
      var i = ht.buffer, a = (r - i.byteLength + 65535) / 65536 | 0;
      try {
        return ht.grow(a), dr(), 1;
      } catch {
      }
    };
    function za(r) {
      r >>>= 0;
      var i = oe.length, a = $r();
      if (r > a)
        return !1;
      for (var o = 1; o <= 4; o *= 2) {
        var l = i * (1 + 0.2 / o);
        l = Math.min(l, r + 100663296);
        var h = Math.min(a, Sr(Math.max(r, l), 65536)), d = Na(h);
        if (d)
          return !0;
      }
      return !1;
    }
    var Ot = {}, $a = () => R || "./this.program", ct = () => {
      if (!ct.strings) {
        var r = (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", i = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: r, _: $a() };
        for (var a in Ot)
          Ot[a] === void 0 ? delete i[a] : i[a] = Ot[a];
        var o = [];
        for (var a in i)
          o.push(`${a}=${i[a]}`);
        ct.strings = o;
      }
      return ct.strings;
    };
    function Ha(r, i) {
      r >>>= 0, i >>>= 0;
      var a = 0, o = 0;
      for (var l of ct()) {
        var h = i + a;
        L[r + o >>> 2 >>> 0] = h, a += ve(l, h, 1 / 0) + 1, o += 4;
      }
      return 0;
    }
    function Ya(r, i) {
      r >>>= 0, i >>>= 0;
      var a = ct();
      L[r >>> 2 >>> 0] = a.length;
      var o = 0;
      for (var l of a)
        o += Ye(l) + 1;
      return L[i >>> 2 >>> 0] = o, 0;
    }
    var Ua = () => Gt || Lr > 0, Hr = (r) => {
      Ua() || (t.onExit?.(r), At = !0), $(r, new ki(r));
    }, Xa = (r, i) => {
      Hr(r);
    }, ja = Xa;
    function Va(r) {
      try {
        var i = x.getStreamFromFD(r);
        return u.close(i), 0;
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return a.errno;
      }
    }
    function qa(r, i) {
      i >>>= 0;
      try {
        var a = 0, o = 0, l = 0, h = x.getStreamFromFD(r), d = h.tty ? 2 : u.isDir(h.mode) ? 3 : u.isLink(h.mode) ? 7 : 4;
        return q[i >>> 0] = d, ue[i + 2 >>> 1 >>> 0] = l, _e[i + 8 >>> 3] = BigInt(a), _e[i + 16 >>> 3] = BigInt(o), 0;
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return f.errno;
      }
    }
    var Yr = (r, i, a, o) => {
      for (var l = 0, h = 0; h < a; h++) {
        var d = L[i >>> 2 >>> 0], f = L[i + 4 >>> 2 >>> 0];
        i += 8;
        var v = u.read(r, q, d, f, o);
        if (v < 0) return -1;
        if (l += v, v < f) break;
        typeof o < "u" && (o += v);
      }
      return l;
    };
    function Ka(r, i, a, o, l) {
      i >>>= 0, a >>>= 0, o = ye(o), l >>>= 0;
      try {
        if (isNaN(o)) return 61;
        var h = x.getStreamFromFD(r), d = Yr(h, i, a, o);
        return L[l >>> 2 >>> 0] = d, 0;
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return f.errno;
      }
    }
    var Ur = (r, i, a, o) => {
      for (var l = 0, h = 0; h < a; h++) {
        var d = L[i >>> 2 >>> 0], f = L[i + 4 >>> 2 >>> 0];
        i += 8;
        var v = u.write(r, q, d, f, o);
        if (v < 0) return -1;
        if (l += v, v < f)
          break;
        typeof o < "u" && (o += v);
      }
      return l;
    };
    function Qa(r, i, a, o, l) {
      i >>>= 0, a >>>= 0, o = ye(o), l >>>= 0;
      try {
        if (isNaN(o)) return 61;
        var h = x.getStreamFromFD(r), d = Ur(h, i, a, o);
        return L[l >>> 2 >>> 0] = d, 0;
      } catch (f) {
        if (typeof u > "u" || f.name !== "ErrnoError") throw f;
        return f.errno;
      }
    }
    function Ja(r, i, a, o) {
      i >>>= 0, a >>>= 0, o >>>= 0;
      try {
        var l = x.getStreamFromFD(r), h = Yr(l, i, a);
        return L[o >>> 2 >>> 0] = h, 0;
      } catch (d) {
        if (typeof u > "u" || d.name !== "ErrnoError") throw d;
        return d.errno;
      }
    }
    function Oa(r, i, a, o) {
      i = ye(i), o >>>= 0;
      try {
        if (isNaN(i)) return 61;
        var l = x.getStreamFromFD(r);
        return u.llseek(l, i, a), _e[o >>> 3] = BigInt(l.position), l.getdents && i === 0 && a === 0 && (l.getdents = null), 0;
      } catch (h) {
        if (typeof u > "u" || h.name !== "ErrnoError") throw h;
        return h.errno;
      }
    }
    function Za(r) {
      try {
        var i = x.getStreamFromFD(r);
        return i.stream_ops?.fsync ? i.stream_ops.fsync(i) : 0;
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return a.errno;
      }
    }
    function es(r, i, a, o) {
      i >>>= 0, a >>>= 0, o >>>= 0;
      try {
        var l = x.getStreamFromFD(r), h = Ur(l, i, a);
        return L[o >>> 2 >>> 0] = h, 0;
      } catch (d) {
        if (typeof u > "u" || d.name !== "ErrnoError") throw d;
        return d.errno;
      }
    }
    function ts(r) {
      return r >>>= 0, r;
    }
    function rs(r, i) {
      r >>>= 0, i >>>= 0;
      try {
        return Wt(oe.subarray(r >>> 0, r + i >>> 0)), 0;
      } catch (a) {
        if (typeof u > "u" || a.name !== "ErrnoError") throw a;
        return a.errno;
      }
    }
    var Xr = (r, i) => {
      r < 128 ? i.push(r) : i.push(r % 128 | 128, r >> 7);
    }, is = (r) => {
      for (var i = { i: "i32", j: "i64", f: "f32", d: "f64", e: "externref", p: "i32" }, a = { parameters: [], results: r[0] == "v" ? [] : [i[r[0]]] }, o = 1; o < r.length; ++o)
        a.parameters.push(i[r[o]]);
      return a;
    }, ns = (r, i) => {
      var a = r.slice(0, 1), o = r.slice(1), l = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };
      i.push(96), Xr(o.length, i);
      for (var h of o)
        i.push(l[h]);
      a == "v" ? i.push(0) : i.push(1, l[a]);
    }, as = (r, i) => {
      if (typeof WebAssembly.Function == "function")
        return new WebAssembly.Function(is(i), r);
      var a = [1];
      ns(i, a);
      var o = [0, 97, 115, 109, 1, 0, 0, 0, 1];
      Xr(a.length, o), o.push(...a), o.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
      var l = new WebAssembly.Module(new Uint8Array(o)), h = new WebAssembly.Instance(l, { e: { f: r } }), d = h.exports.f;
      return d;
    }, ss = (r, i) => {
      if (et)
        for (var a = r; a < r + i; a++) {
          var o = W(a);
          o && et.set(o, a);
        }
    }, et, os = (r) => (et || (et = /* @__PURE__ */ new WeakMap(), ss(0, $e.length)), et.get(r) || 0), jr = [], _s = () => {
      if (jr.length)
        return jr.pop();
      try {
        $e.grow(1);
      } catch (r) {
        throw r instanceof RangeError ? "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH." : r;
      }
      return $e.length - 1;
    }, Vr = (r, i) => {
      $e.set(r, i), Ft[r] = $e.get(r);
    }, cs = (r, i) => {
      var a = os(r);
      if (a)
        return a;
      var o = _s();
      try {
        Vr(o, r);
      } catch (h) {
        if (!(h instanceof TypeError))
          throw h;
        var l = as(r, i);
        Vr(o, l);
      }
      return et.set(r, o), o;
    };
    u.createPreloadedFile = zi, u.staticInit(), F.doesNotExistError = new u.ErrnoError(44), F.doesNotExistError.stack = "<generic error, no stack>", un(), mn(), bn(), Ln(), t.noExitRuntime && (Gt = t.noExitRuntime), t.preloadPlugins && (Ir = t.preloadPlugins), t.print && (Ge = t.print), t.printErr && (me = t.printErr), t.wasmBinary && (Ne = t.wasmBinary), t.arguments && t.arguments, t.thisProgram && (R = t.thisProgram), t.addFunction = cs, t.setValue = Ci, t.getValue = Si, t.UTF8ToString = $t, t.stringToUTF8 = ve, t.lengthBytesUTF8 = Ye, t.FS = u;
    var ls = { cb: Di, za: Ei, R: Ti, z: bi, Ba: Ai, a: Ri, y: xi, sa: Hi, qa: Yi, ta: Ui, $: Xi, pa: ji, H: Vi, oa: qi, ja: Ki, bb: Qi, wa: Ji, la: Oi, ma: Zi, F: en, ab: tn, _a: rn, $a: nn, na: an, Za: sn, _: on, ua: _n, Oa: ln, U: gn, Ia: dn, M: Gn, Ga: Bn, x: zn, e: $n, T: Yn, m: Qn, w: Jn, p: On, Ha: Zn, J: sa, Pa: oa, L: _a, Ja: ca, db: la, Xa: ua, Va: ha, La: da, l: Kt, Ma: wa, Na: ka, K: Ma, t: ya, D: Sa, Ka: Ca, r: Ia, o: Pa, ca: Da, da: Aa, ea: Ra, aa: xa, ba: Ga, fa: Fa, ra: Wa, P: zr, Ya: Ba, E: Nr, Wa: za, xa: Ha, ya: Ya, C: ja, B: Va, O: qa, fb: Ka, eb: Qa, Q: Ja, ga: Oa, ka: Za, G: es, Sa: Ws, A: xs, c: Ss, d: ys, h: Ms, j: Ds, Z: Ls, b: As, N: zs, n: bs, Ra: $s, Qa: Us, Fa: qs, Ea: Ks, s: Rs, Ua: Gs, I: Qs, u: Ts, ha: Es, v: Bs, k: Cs, f: Is, Y: Hs, X: Ys, i: ks, g: Ps, q: Ns, V: js, S: Vs, Da: Js, W: Xs, Ca: Os, Ta: Fs, Aa: ts, va: Hr, ia: rs }, s = await wi();
    s.hb;
    var us = s.ib;
    t._MagickColor_Create = s.jb, t._MagickColor_Dispose = s.kb, t._MagickColor_Count_Get = s.lb, t._MagickColor_Red_Get = s.mb, t._MagickColor_Red_Set = s.nb, t._MagickColor_Green_Get = s.ob, t._MagickColor_Green_Set = s.pb, t._MagickColor_Blue_Get = s.qb, t._MagickColor_Blue_Set = s.rb, t._MagickColor_Alpha_Get = s.sb, t._MagickColor_Alpha_Set = s.tb, t._MagickColor_Black_Get = s.ub, t._MagickColor_Black_Set = s.vb, t._MagickColor_IsCMYK_Get = s.wb, t._MagickColor_IsCMYK_Set = s.xb, t._MagickColor_Clone = s.yb, t._MagickColor_FuzzyEquals = s.zb, t._MagickColor_Initialize = s.Ab, t._MagickColorCollection_DisposeList = s.Cb, t._MagickColorCollection_GetInstance = s.Db, t._DrawingWand_Create = s.Eb, t._DrawingWand_Dispose = s.Fb, t._DrawingWand_Affine = s.Gb, t._DrawingWand_Alpha = s.Hb, t._DrawingWand_Arc = s.Ib, t._DrawingWand_Bezier = s.Jb, t._DrawingWand_BorderColor = s.Kb, t._DrawingWand_Circle = s.Lb, t._DrawingWand_ClipPath = s.Mb, t._DrawingWand_ClipRule = s.Nb, t._DrawingWand_ClipUnits = s.Ob, t._DrawingWand_Color = s.Pb, t._DrawingWand_Composite = s.Qb, t._DrawingWand_Density = s.Rb, t._DrawingWand_Ellipse = s.Sb, t._DrawingWand_FillColor = s.Tb, t._DrawingWand_FillOpacity = s.Ub, t._DrawingWand_FillPatternUrl = s.Vb, t._DrawingWand_FillRule = s.Wb, t._DrawingWand_Font = s.Xb, t._DrawingWand_FontFamily = s.Yb, t._DrawingWand_FontPointSize = s.Zb, t._DrawingWand_FontTypeMetrics = s._b, t._TypeMetric_Create = s.$b, t._DrawingWand_Gravity = s.ac, t._DrawingWand_Line = s.bc, t._DrawingWand_PathArcAbs = s.cc, t._DrawingWand_PathArcRel = s.dc, t._DrawingWand_PathClose = s.ec, t._DrawingWand_PathCurveToAbs = s.fc, t._DrawingWand_PathCurveToRel = s.gc, t._DrawingWand_PathFinish = s.hc, t._DrawingWand_PathLineToAbs = s.ic, t._DrawingWand_PathLineToHorizontalAbs = s.jc, t._DrawingWand_PathLineToHorizontalRel = s.kc, t._DrawingWand_PathLineToRel = s.lc, t._DrawingWand_PathLineToVerticalAbs = s.mc, t._DrawingWand_PathLineToVerticalRel = s.nc, t._DrawingWand_PathMoveToAbs = s.oc, t._DrawingWand_PathMoveToRel = s.pc, t._DrawingWand_PathQuadraticCurveToAbs = s.qc, t._DrawingWand_PathQuadraticCurveToRel = s.rc, t._DrawingWand_PathSmoothCurveToAbs = s.sc, t._DrawingWand_PathSmoothCurveToRel = s.tc, t._DrawingWand_PathSmoothQuadraticCurveToAbs = s.uc, t._DrawingWand_PathSmoothQuadraticCurveToRel = s.vc, t._DrawingWand_PathStart = s.wc, t._DrawingWand_Point = s.xc, t._DrawingWand_Polygon = s.yc, t._DrawingWand_Polyline = s.zc, t._DrawingWand_PopClipPath = s.Ac, t._DrawingWand_PopGraphicContext = s.Bc, t._DrawingWand_PopPattern = s.Cc, t._DrawingWand_PushClipPath = s.Dc, t._DrawingWand_PushGraphicContext = s.Ec, t._DrawingWand_PushPattern = s.Fc, t._DrawingWand_Rectangle = s.Gc, t._DrawingWand_Render = s.Hc, t._DrawingWand_Rotation = s.Ic, t._DrawingWand_RoundRectangle = s.Jc, t._DrawingWand_Scaling = s.Kc, t._DrawingWand_SkewX = s.Lc, t._DrawingWand_SkewY = s.Mc, t._DrawingWand_StrokeAntialias = s.Nc, t._DrawingWand_StrokeColor = s.Oc, t._DrawingWand_StrokeDashArray = s.Pc, t._DrawingWand_StrokeDashOffset = s.Qc, t._DrawingWand_StrokeLineCap = s.Rc, t._DrawingWand_StrokeLineJoin = s.Sc, t._DrawingWand_StrokeMiterLimit = s.Tc, t._DrawingWand_StrokeOpacity = s.Uc, t._DrawingWand_StrokePatternUrl = s.Vc, t._DrawingWand_StrokeWidth = s.Wc, t._DrawingWand_Text = s.Xc, t._DrawingWand_TextAlignment = s.Yc, t._DrawingWand_TextAntialias = s.Zc, t._DrawingWand_TextDecoration = s._c, t._DrawingWand_TextDirection = s.$c, t._DrawingWand_TextEncoding = s.ad, t._DrawingWand_TextInterlineSpacing = s.bd, t._DrawingWand_TextInterwordSpacing = s.cd, t._DrawingWand_TextKerning = s.dd, t._DrawingWand_TextUnderColor = s.ed, t._DrawingWand_Translation = s.fd, t._DrawingWand_Viewbox = s.gd, t._MagickExceptionHelper_Description = s.hd, t._MagickExceptionHelper_Dispose = s.id, t._MagickExceptionHelper_Related = s.jd, t._MagickExceptionHelper_RelatedCount = s.kd, t._MagickExceptionHelper_Message = s.ld, t._MagickExceptionHelper_Severity = s.md, t._PdfInfo_PageCount = s.nd, t._Environment_Initialize = s.od, t._Environment_GetEnv = s.pd, t._Environment_SetEnv = s.qd, t._MagickMemory_Relinquish = s.rd, t._Magick_Delegates_Get = s.sd, t._Magick_Features_Get = s.td, t._Magick_ImageMagickVersion_Get = s.ud, t._Magick_GetFonts = s.vd, t._Magick_GetFontFamily = s.wd, t._Magick_GetFontName = s.xd, t._Magick_GetWindowsResource = s.yd, t._Magick_DisposeFonts = s.zd, t._Magick_ResetRandomSeed = s.Ad, t._Magick_SetDefaultFontFile = s.Bd, t._Magick_SetRandomSeed = s.Cd, t._Magick_SetLogDelegate = s.Dd, t._Magick_SetLogEvents = s.Ed, t._MagickFormatInfo_CreateList = s.Fd, t._MagickFormatInfo_DisposeList = s.Gd, t._MagickFormatInfo_CanReadMultithreaded_Get = s.Hd, t._MagickFormatInfo_CanWriteMultithreaded_Get = s.Id, t._MagickFormatInfo_Description_Get = s.Jd, t._MagickFormatInfo_Format_Get = s.Kd, t._MagickFormatInfo_MimeType_Get = s.Ld, t._MagickFormatInfo_Module_Get = s.Md, t._MagickFormatInfo_SupportsMultipleFrames_Get = s.Nd, t._MagickFormatInfo_SupportsReading_Get = s.Od, t._MagickFormatInfo_SupportsWriting_Get = s.Pd, t._MagickFormatInfo_GetInfo = s.Qd, t._MagickFormatInfo_GetInfoByName = s.Rd, t._MagickFormatInfo_GetInfoWithBlob = s.Sd, t._MagickFormatInfo_Unregister = s.Td, t._MagickImage_Create = s.Ud, t._MagickImage_Dispose = s.Vd, t._MagickImage_AnimationDelay_Get = s.Wd, t._MagickImage_AnimationDelay_Set = s.Xd, t._MagickImage_AnimationIterations_Get = s.Yd, t._MagickImage_AnimationIterations_Set = s.Zd, t._MagickImage_AnimationTicksPerSecond_Get = s._d, t._MagickImage_AnimationTicksPerSecond_Set = s.$d, t._MagickImage_BackgroundColor_Get = s.ae, t._MagickImage_BackgroundColor_Set = s.be, t._MagickImage_BaseHeight_Get = s.ce, t._MagickImage_BaseWidth_Get = s.de, t._MagickImage_BlackPointCompensation_Get = s.ee, t._MagickImage_BlackPointCompensation_Set = s.fe, t._MagickImage_BorderColor_Get = s.ge, t._MagickImage_BorderColor_Set = s.he, t._MagickImage_BoundingBox_Get = s.ie, t._MagickRectangle_Create = s.je, t._MagickImage_ChannelCount_Get = s.ke, t._MagickImage_ChromaBlue_Get = s.le, t._PrimaryInfo_Create = s.me, t._MagickImage_ChromaBlue_Set = s.ne, t._MagickImage_ChromaGreen_Get = s.oe, t._MagickImage_ChromaGreen_Set = s.pe, t._MagickImage_ChromaRed_Get = s.qe, t._MagickImage_ChromaRed_Set = s.re, t._MagickImage_ChromaWhite_Get = s.se, t._MagickImage_ChromaWhite_Set = s.te, t._MagickImage_ClassType_Get = s.ue, t._MagickImage_ClassType_Set = s.ve, t._QuantizeSettings_Create = s.we, t._QuantizeSettings_Dispose = s.xe, t._MagickImage_ColorFuzz_Get = s.ye, t._MagickImage_ColorFuzz_Set = s.ze, t._MagickImage_ColormapSize_Get = s.Ae, t._MagickImage_ColormapSize_Set = s.Be, t._MagickImage_ColorSpace_Get = s.Ce, t._MagickImage_ColorSpace_Set = s.De, t._MagickImage_ColorType_Get = s.Ee, t._MagickImage_ColorType_Set = s.Fe, t._MagickImage_Compose_Get = s.Ge, t._MagickImage_Compose_Set = s.He, t._MagickImage_Compression_Get = s.Ie, t._MagickImage_Compression_Set = s.Je, t._MagickImage_Depth_Get = s.Ke, t._MagickImage_Depth_Set = s.Le, t._MagickImage_EncodingGeometry_Get = s.Me, t._MagickImage_Endian_Get = s.Ne, t._MagickImage_Endian_Set = s.Oe, t._MagickImage_FileName_Get = s.Pe, t._MagickImage_FileName_Set = s.Qe, t._MagickImage_FilterType_Get = s.Re, t._MagickImage_FilterType_Set = s.Se, t._MagickImage_Format_Get = s.Te, t._MagickImage_Format_Set = s.Ue, t._MagickImage_Gamma_Get = s.Ve, t._MagickImage_GifDisposeMethod_Get = s.We, t._MagickImage_GifDisposeMethod_Set = s.Xe, t._MagickImage_HasAlpha_Get = s.Ye, t._MagickImage_HasAlpha_Set = s.Ze, t._MagickImage_Height_Get = s._e, t._MagickImage_Interlace_Get = s.$e, t._MagickImage_Interlace_Set = s.af, t._MagickImage_Interpolate_Get = s.bf, t._MagickImage_Interpolate_Set = s.cf, t._MagickImage_IsOpaque_Get = s.df, t._MagickImage_MatteColor_Get = s.ef, t._MagickImage_MatteColor_Set = s.ff, t._MagickImage_MeanErrorPerPixel_Get = s.gf, t._MagickImage_MetaChannelCount_Get = s.hf, t._MagickImage_MetaChannelCount_Set = s.jf, t._MagickImage_NormalizedMaximumError_Get = s.kf, t._MagickImage_NormalizedMeanError_Get = s.lf, t._MagickImage_Orientation_Get = s.mf, t._MagickImage_Orientation_Set = s.nf, t._MagickImage_Page_Get = s.of, t._MagickImage_Page_Set = s.pf, t._MagickImage_Quality_Get = s.qf, t._MagickImage_Quality_Set = s.rf, t._MagickImage_RenderingIntent_Get = s.sf, t._MagickImage_RenderingIntent_Set = s.tf, t._MagickImage_ResolutionUnits_Get = s.uf, t._MagickImage_ResolutionUnits_Set = s.vf, t._MagickImage_ResolutionX_Get = s.wf, t._MagickImage_ResolutionX_Set = s.xf, t._MagickImage_ResolutionY_Get = s.yf, t._MagickImage_ResolutionY_Set = s.zf, t._MagickImage_Signature_Get = s.Af, t._MagickImage_TotalColors_Get = s.Bf, t._MagickImage_VirtualPixelMethod_Get = s.Cf, t._MagickImage_VirtualPixelMethod_Set = s.Df, t._MagickImage_Width_Get = s.Ef, t._MagickImage_AdaptiveBlur = s.Ff, t._MagickImage_AdaptiveResize = s.Gf, t._MagickImage_AdaptiveSharpen = s.Hf, t._MagickImage_AdaptiveThreshold = s.If, t._MagickImage_AddNoise = s.Jf, t._MagickImage_AffineTransform = s.Kf, t._MagickImage_Annotate = s.Lf, t._MagickImage_AutoGamma = s.Mf, t._MagickImage_AutoLevel = s.Nf, t._MagickImage_AutoOrient = s.Of, t._MagickImage_AutoThreshold = s.Pf, t._MagickImage_BilateralBlur = s.Qf, t._MagickImage_BlackThreshold = s.Rf, t._MagickImage_BlueShift = s.Sf, t._MagickImage_Blur = s.Tf, t._MagickImage_Border = s.Uf, t._MagickImage_BrightnessContrast = s.Vf, t._MagickImage_CannyEdge = s.Wf, t._MagickImage_ChannelOffset = s.Xf, t._MagickImage_Charcoal = s.Yf, t._MagickImage_Chop = s.Zf, t._MagickImage_Clahe = s._f, t._MagickImage_Clamp = s.$f, t._MagickImage_ClipPath = s.ag, t._MagickImage_Clone = s.bg, t._MagickImage_CloneArea = s.cg, t._MagickImage_Clut = s.dg, t._MagickImage_ColorDecisionList = s.eg, t._MagickImage_Colorize = s.fg, t._MagickImage_ColorMatrix = s.gg, t._MagickImage_ColorThreshold = s.hg, t._MagickImage_Compare = s.ig, t._MagickImage_CompareDistortion = s.jg, t._MagickImage_Composite = s.kg, t._MagickImage_CompositeGravity = s.lg, t._MagickImage_ConnectedComponents = s.mg, t._MagickImage_Contrast = s.ng, t._MagickImage_ContrastStretch = s.og, t._MagickImage_ConvexHull = s.pg, t._MagickImage_Convolve = s.qg, t._MagickImage_CopyPixels = s.rg, t._MagickImage_Crop = s.sg, t._MagickImage_CropToTiles = s.tg, t._MagickImage_CycleColormap = s.ug, t._MagickImage_Decipher = s.vg, t._MagickImage_Deskew = s.wg, t._MagickImage_Despeckle = s.xg, t._MagickImage_DetermineBitDepth = s.yg, t._MagickImage_DetermineColorType = s.zg, t._MagickImage_Distort = s.Ag, t._MagickImage_Edge = s.Bg, t._MagickImage_Emboss = s.Cg, t._MagickImage_Encipher = s.Dg, t._MagickImage_Enhance = s.Eg, t._MagickImage_Equalize = s.Fg, t._MagickImage_Equals = s.Gg, t._MagickImage_EvaluateFunction = s.Hg, t._MagickImage_EvaluateGeometry = s.Ig, t._MagickImage_EvaluateOperator = s.Jg, t._MagickImage_Extent = s.Kg, t._MagickImage_Flip = s.Lg, t._MagickImage_FloodFill = s.Mg, t._MagickImage_Flop = s.Ng, t._MagickImage_FontTypeMetrics = s.Og, t._MagickImage_FormatExpression = s.Pg, t._MagickImage_Frame = s.Qg, t._MagickImage_Fx = s.Rg, t._MagickImage_GammaCorrect = s.Sg, t._MagickImage_GaussianBlur = s.Tg, t._MagickImage_GetArtifact = s.Ug, t._MagickImage_GetAttribute = s.Vg, t._MagickImage_GetColormapColor = s.Wg, t._MagickImage_GetNext = s.Xg, t._MagickImage_GetNextArtifactName = s.Yg, t._MagickImage_GetNextAttributeName = s.Zg, t._MagickImage_GetNextProfileName = s._g, t._MagickImage_GetProfile = s.$g, t._MagickImage_GetReadMask = s.ah, t._MagickImage_GetWriteMask = s.bh, t._MagickImage_Grayscale = s.ch, t._MagickImage_HaldClut = s.dh, t._MagickImage_HasChannel = s.eh, t._MagickImage_HasProfile = s.fh, t._MagickImage_Histogram = s.gh, t._MagickImage_HoughLine = s.hh, t._MagickImage_Implode = s.ih, t._MagickImage_ImportPixels = s.jh, t._MagickImage_Integral = s.kh, t._MagickImage_InterpolativeResize = s.lh, t._MagickImage_InverseLevel = s.mh, t._MagickImage_Kmeans = s.nh, t._MagickImage_Kuwahara = s.oh, t._MagickImage_Level = s.ph, t._MagickImage_LevelColors = s.qh, t._MagickImage_LinearStretch = s.rh, t._MagickImage_LiquidRescale = s.sh, t._MagickImage_LocalContrast = s.th, t._MagickImage_Magnify = s.uh, t._MagickImage_MeanShift = s.vh, t._MagickImage_Minify = s.wh, t._MagickImage_MinimumBoundingBox = s.xh, t._MagickImage_Modulate = s.yh, t._MagickImage_Moments = s.zh, t._MagickImage_Morphology = s.Ah, t._MagickImage_MotionBlur = s.Bh, t._MagickImage_Negate = s.Ch, t._MagickImage_Normalize = s.Dh, t._MagickImage_OilPaint = s.Eh, t._MagickImage_Opaque = s.Fh, t._MagickImage_OrderedDither = s.Gh, t._MagickImage_Perceptible = s.Hh, t._MagickImage_PerceptualHash = s.Ih, t._MagickImage_Quantize = s.Jh, t._MagickImage_Polaroid = s.Kh, t._MagickImage_Posterize = s.Lh, t._MagickImage_RaiseOrLower = s.Mh, t._MagickImage_RandomThreshold = s.Nh, t._MagickImage_RangeThreshold = s.Oh, t._MagickImage_ReadBlob = s.Ph, t._MagickImage_ReadFile = s.Qh, t._MagickImage_ReadPixels = s.Rh, t._MagickImage_ReadStream = s.Sh, t._MagickImage_RegionMask = s.Th, t._MagickImage_Remap = s.Uh, t._MagickImage_RemoveArtifact = s.Vh, t._MagickImage_RemoveAttribute = s.Wh, t._MagickImage_RemoveProfile = s.Xh, t._MagickImage_ResetArtifactIterator = s.Yh, t._MagickImage_ResetAttributeIterator = s.Zh, t._MagickImage_ResetProfileIterator = s._h, t._MagickImage_Resample = s.$h, t._MagickImage_Resize = s.ai, t._MagickImage_Roll = s.bi, t._MagickImage_Rotate = s.ci, t._MagickImage_RotationalBlur = s.di, t._MagickImage_Sample = s.ei, t._MagickImage_Scale = s.fi, t._MagickImage_Segment = s.gi, t._MagickImage_SelectiveBlur = s.hi, t._MagickImage_Separate = s.ii, t._MagickImage_SepiaTone = s.ji, t._MagickImage_SetAlpha = s.ki, t._MagickImage_SetArtifact = s.li, t._MagickImage_SetAttribute = s.mi, t._MagickImage_SetBitDepth = s.ni, t._MagickImage_SetClientData = s.oi, t._MagickImage_SetColormapColor = s.pi, t._MagickImage_SetColorMetric = s.qi, t._MagickImage_SetNext = s.ri, t._MagickImage_SetProfile = s.si, t._MagickImage_SetProgressDelegate = s.ti, t._MagickImage_SetReadMask = s.ui, t._MagickImage_SetWriteMask = s.vi, t._MagickImage_Shade = s.wi, t._MagickImage_Shadow = s.xi, t._MagickImage_Sharpen = s.yi, t._MagickImage_Shave = s.zi, t._MagickImage_Shear = s.Ai, t._MagickImage_SigmoidalContrast = s.Bi, t._MagickImage_SparseColor = s.Ci, t._MagickImage_Spread = s.Di, t._MagickImage_Sketch = s.Ei, t._MagickImage_Solarize = s.Fi, t._MagickImage_SortPixels = s.Gi, t._MagickImage_Splice = s.Hi, t._MagickImage_Statistic = s.Ii, t._MagickImage_Statistics = s.Ji, t._MagickImage_Stegano = s.Ki, t._MagickImage_Stereo = s.Li, t._MagickImage_Strip = s.Mi, t._MagickImage_SubImageSearch = s.Ni, t._MagickImage_Swirl = s.Oi, t._MagickImage_Texture = s.Pi, t._MagickImage_Threshold = s.Qi, t._MagickImage_Thumbnail = s.Ri, t._MagickImage_Tint = s.Si, t._MagickImage_Transparent = s.Ti, t._MagickImage_TransparentChroma = s.Ui, t._MagickImage_Transpose = s.Vi, t._MagickImage_Transverse = s.Wi, t._MagickImage_Trim = s.Xi, t._MagickImage_UniqueColors = s.Yi, t._MagickImage_UnsharpMask = s.Zi, t._MagickImage_Vignette = s._i, t._MagickImage_Wave = s.$i, t._MagickImage_WaveletDenoise = s.aj, t._MagickImage_WhiteBalance = s.bj, t._MagickImage_WhiteThreshold = s.cj, t._MagickImage_WriteBlob = s.dj, t._MagickImage_WriteFile = s.ej, t._MagickImage_WriteStream = s.fj, t._MagickImageCollection_Append = s.gj, t._MagickImageCollection_Coalesce = s.hj, t._MagickImageCollection_Combine = s.ij, t._MagickImageCollection_Complex = s.jj, t._MagickImageCollection_Deconstruct = s.kj, t._MagickImageCollection_Dispose = s.lj, t._MagickImageCollection_Evaluate = s.mj, t._MagickImageCollection_Fx = s.nj, t._MagickImageCollection_Merge = s.oj, t._MagickImageCollection_Montage = s.pj, t._MagickImageCollection_Morph = s.qj, t._MagickImageCollection_Optimize = s.rj, t._MagickImageCollection_OptimizePlus = s.sj, t._MagickImageCollection_OptimizeTransparency = s.tj, t._MagickImageCollection_Polynomial = s.uj, t._MagickImageCollection_Quantize = s.vj, t._MagickImageCollection_ReadBlob = s.wj, t._MagickImageCollection_ReadFile = s.xj, t._MagickImageCollection_ReadStream = s.yj, t._MagickImageCollection_Remap = s.zj, t._MagickImageCollection_Smush = s.Aj, t._MagickImageCollection_WriteFile = s.Bj, t._MagickImageCollection_WriteStream = s.Cj, t._DoubleMatrix_Create = s.Dj, t._DoubleMatrix_Dispose = s.Ej, t._OpenCL_GetDevices = s.Fj, t._OpenCL_GetDevice = s.Gj, t._OpenCL_GetEnabled = s.Hj, t._OpenCL_SetEnabled = s.Ij, t._OpenCLDevice_DeviceType_Get = s.Jj, t._OpenCLDevice_BenchmarkScore_Get = s.Kj, t._OpenCLDevice_IsEnabled_Get = s.Lj, t._OpenCLDevice_IsEnabled_Set = s.Mj, t._OpenCLDevice_Name_Get = s.Nj, t._OpenCLDevice_Version_Get = s.Oj, t._OpenCLDevice_GetKernelProfileRecords = s.Pj, t._OpenCLDevice_GetKernelProfileRecord = s.Qj, t._OpenCLDevice_SetProfileKernels = s.Rj, t._OpenCLKernelProfileRecord_Count_Get = s.Sj, t._OpenCLKernelProfileRecord_Name_Get = s.Tj, t._OpenCLKernelProfileRecord_MaximumDuration_Get = s.Uj, t._OpenCLKernelProfileRecord_MinimumDuration_Get = s.Vj, t._OpenCLKernelProfileRecord_TotalDuration_Get = s.Wj, t._JpegOptimizer_CompressFile = s.Xj, t._JpegOptimizer_CompressStream = s.Yj;
    var qr = t._malloc = s.Zj, je = t._free = s._j;
    t._PixelCollection_Create = s.$j, t._PixelCollection_Dispose = s.ak, t._PixelCollection_GetArea = s.bk, t._PixelCollection_GetReadOnlyArea = s.ck, t._PixelCollection_SetArea = s.dk, t._PixelCollection_ToByteArray = s.ek, t._PixelCollection_ToShortArray = s.fk, t._Quantum_Depth_Get = s.gk, t._Quantum_Max_Get = s.hk, t._ResourceLimits_Area_Get = s.ik, t._ResourceLimits_Area_Set = s.jk, t._ResourceLimits_Disk_Get = s.kk, t._ResourceLimits_Disk_Set = s.lk, t._ResourceLimits_Height_Get = s.mk, t._ResourceLimits_Height_Set = s.nk, t._ResourceLimits_ListLength_Get = s.ok, t._ResourceLimits_ListLength_Set = s.pk, t._ResourceLimits_MaxMemoryRequest_Get = s.qk, t._ResourceLimits_MaxMemoryRequest_Set = s.rk, t._ResourceLimits_MaxProfileSize_Get = s.sk, t._ResourceLimits_MaxProfileSize_Set = s.tk, t._ResourceLimits_Memory_Get = s.uk, t._ResourceLimits_Memory_Set = s.vk, t._ResourceLimits_Thread_Get = s.wk, t._ResourceLimits_Thread_Set = s.xk, t._ResourceLimits_Throttle_Get = s.yk, t._ResourceLimits_Throttle_Set = s.zk, t._ResourceLimits_Time_Get = s.Ak, t._ResourceLimits_Time_Set = s.Bk, t._ResourceLimits_Width_Get = s.Ck, t._ResourceLimits_Width_Set = s.Dk, t._ResourceLimits_LimitMemory = s.Ek, t._ResourceLimits_TrimMemory = s.Fk, t._DrawingSettings_Create = s.Gk, t._DrawingSettings_Dispose = s.Hk, t._DrawingSettings_BorderColor_Get = s.Ik, t._DrawingSettings_BorderColor_Set = s.Jk, t._DrawingSettings_FillColor_Get = s.Kk, t._DrawingSettings_FillColor_Set = s.Lk, t._DrawingSettings_FillRule_Get = s.Mk, t._DrawingSettings_FillRule_Set = s.Nk, t._DrawingSettings_Font_Get = s.Ok, t._DrawingSettings_Font_Set = s.Pk, t._DrawingSettings_FontFamily_Get = s.Qk, t._DrawingSettings_FontFamily_Set = s.Rk, t._DrawingSettings_FontPointsize_Get = s.Sk, t._DrawingSettings_FontPointsize_Set = s.Tk, t._DrawingSettings_FontStyle_Get = s.Uk, t._DrawingSettings_FontStyle_Set = s.Vk, t._DrawingSettings_FontWeight_Get = s.Wk, t._DrawingSettings_FontWeight_Set = s.Xk, t._DrawingSettings_StrokeAntiAlias_Get = s.Yk, t._DrawingSettings_StrokeAntiAlias_Set = s.Zk, t._DrawingSettings_StrokeColor_Get = s._k, t._DrawingSettings_StrokeColor_Set = s.$k, t._DrawingSettings_StrokeDashOffset_Get = s.al, t._DrawingSettings_StrokeDashOffset_Set = s.bl, t._DrawingSettings_StrokeLineCap_Get = s.cl, t._DrawingSettings_StrokeLineCap_Set = s.dl, t._DrawingSettings_StrokeLineJoin_Get = s.el, t._DrawingSettings_StrokeLineJoin_Set = s.fl, t._DrawingSettings_StrokeMiterLimit_Get = s.gl, t._DrawingSettings_StrokeMiterLimit_Set = s.hl, t._DrawingSettings_StrokeWidth_Get = s.il, t._DrawingSettings_StrokeWidth_Set = s.jl, t._DrawingSettings_TextAntiAlias_Get = s.kl, t._DrawingSettings_TextAntiAlias_Set = s.ll, t._DrawingSettings_TextDirection_Get = s.ml, t._DrawingSettings_TextDirection_Set = s.nl, t._DrawingSettings_TextEncoding_Get = s.ol, t._DrawingSettings_TextEncoding_Set = s.pl, t._DrawingSettings_TextGravity_Get = s.ql, t._DrawingSettings_TextGravity_Set = s.rl, t._DrawingSettings_TextInterlineSpacing_Get = s.sl, t._DrawingSettings_TextInterlineSpacing_Set = s.tl, t._DrawingSettings_TextInterwordSpacing_Get = s.ul, t._DrawingSettings_TextInterwordSpacing_Set = s.vl, t._DrawingSettings_TextKerning_Get = s.wl, t._DrawingSettings_TextKerning_Set = s.xl, t._DrawingSettings_TextUnderColor_Get = s.yl, t._DrawingSettings_TextUnderColor_Set = s.zl, t._DrawingSettings_SetAffine = s.Al, t._DrawingSettings_SetFillPattern = s.Bl, t._DrawingSettings_SetStrokeDashArray = s.Cl, t._DrawingSettings_SetStrokePattern = s.Dl, t._DrawingSettings_SetText = s.El, t._MagickSettings_Create = s.Fl, t._MagickSettings_Dispose = s.Gl, t._MagickSettings_AntiAlias_Get = s.Hl, t._MagickSettings_AntiAlias_Set = s.Il, t._MagickSettings_BackgroundColor_Get = s.Jl, t._MagickSettings_BackgroundColor_Set = s.Kl, t._MagickSettings_ColorSpace_Get = s.Ll, t._MagickSettings_ColorSpace_Set = s.Ml, t._MagickSettings_ColorType_Get = s.Nl, t._MagickSettings_ColorType_Set = s.Ol, t._MagickSettings_Compression_Get = s.Pl, t._MagickSettings_Compression_Set = s.Ql, t._MagickSettings_Debug_Get = s.Rl, t._MagickSettings_Debug_Set = s.Sl, t._MagickSettings_Density_Get = s.Tl, t._MagickSettings_Density_Set = s.Ul, t._MagickSettings_Depth_Get = s.Vl, t._MagickSettings_Depth_Set = s.Wl, t._MagickSettings_Endian_Get = s.Xl, t._MagickSettings_Endian_Set = s.Yl, t._MagickSettings_Extract_Get = s.Zl, t._MagickSettings_Extract_Set = s._l, t._MagickSettings_Format_Get = s.$l, t._MagickSettings_Format_Set = s.am, t._MagickSettings_FontPointsize_Get = s.bm, t._MagickSettings_FontPointsize_Set = s.cm, t._MagickSettings_Interlace_Get = s.dm, t._MagickSettings_Interlace_Set = s.em, t._MagickSettings_Monochrome_Get = s.fm, t._MagickSettings_Monochrome_Set = s.gm, t._MagickSettings_Verbose_Get = s.hm, t._MagickSettings_Verbose_Set = s.im, t._MagickSettings_SetColorFuzz = s.jm, t._MagickSettings_SetFileName = s.km, t._MagickSettings_SetFont = s.lm, t._MagickSettings_SetNumberScenes = s.mm, t._MagickSettings_SetOption = s.nm, t._MagickSettings_SetPage = s.om, t._MagickSettings_SetPing = s.pm, t._MagickSettings_SetQuality = s.qm, t._MagickSettings_SetScenes = s.rm, t._MagickSettings_SetScene = s.sm, t._MagickSettings_SetSize = s.tm, t._MontageSettings_Create = s.um, t._MontageSettings_Dispose = s.vm, t._MontageSettings_SetBackgroundColor = s.wm, t._MontageSettings_SetBorderColor = s.xm, t._MontageSettings_SetBorderWidth = s.ym, t._MontageSettings_SetFillColor = s.zm, t._MontageSettings_SetFont = s.Am, t._MontageSettings_SetFontPointsize = s.Bm, t._MontageSettings_SetFrameGeometry = s.Cm, t._MontageSettings_SetGeometry = s.Dm, t._MontageSettings_SetGravity = s.Em, t._MontageSettings_SetShadow = s.Fm, t._MontageSettings_SetStrokeColor = s.Gm, t._MontageSettings_SetTextureFileName = s.Hm, t._MontageSettings_SetTileGeometry = s.Im, t._MontageSettings_SetTitle = s.Jm, t._QuantizeSettings_SetColors = s.Km, t._QuantizeSettings_SetColorSpace = s.Lm, t._QuantizeSettings_SetDitherMethod = s.Mm, t._QuantizeSettings_SetMeasureErrors = s.Nm, t._QuantizeSettings_SetTreeDepth = s.Om, t._ChannelMoments_Centroid_Get = s.Pm, t._ChannelMoments_EllipseAngle_Get = s.Qm, t._ChannelMoments_EllipseAxis_Get = s.Rm, t._ChannelMoments_EllipseEccentricity_Get = s.Sm, t._ChannelMoments_EllipseIntensity_Get = s.Tm, t._ChannelMoments_GetHuInvariants = s.Um, t._ChannelPerceptualHash_GetHuPhash = s.Vm, t._ChannelStatistics_Depth_Get = s.Wm, t._ChannelStatistics_Entropy_Get = s.Xm, t._ChannelStatistics_Kurtosis_Get = s.Ym, t._ChannelStatistics_Maximum_Get = s.Zm, t._ChannelStatistics_Mean_Get = s._m, t._ChannelStatistics_Minimum_Get = s.$m, t._ChannelStatistics_Skewness_Get = s.an, t._ChannelStatistics_StandardDeviation_Get = s.bn, t._Moments_DisposeList = s.cn, t._Moments_GetInstance = s.dn, t._PerceptualHash_DisposeList = s.en, t._PerceptualHash_GetInstance = s.fn, t._Statistics_DisposeList = s.gn, t._Statistics_GetInstance = s.hn, t._ConnectedComponent_DisposeList = s.jn, t._ConnectedComponent_GetArea = s.kn, t._ConnectedComponent_GetCentroid = s.ln, t._ConnectedComponent_GetColor = s.mn, t._ConnectedComponent_GetHeight = s.nn, t._ConnectedComponent_GetId = s.on, t._ConnectedComponent_GetWidth = s.pn, t._ConnectedComponent_GetX = s.qn, t._ConnectedComponent_GetY = s.rn, t._ConnectedComponent_GetInstance = s.sn, t._MagickGeometry_Create = s.tn, t._MagickGeometry_Dispose = s.un, t._MagickGeometry_X_Get = s.vn, t._MagickGeometry_Y_Get = s.wn, t._MagickGeometry_Width_Get = s.xn, t._MagickGeometry_Height_Get = s.yn, t._MagickGeometry_Initialize = s.zn, t._MagickRectangle_Dispose = s.An, t._MagickRectangle_X_Get = s.Bn, t._MagickRectangle_X_Set = s.Cn, t._MagickRectangle_Y_Get = s.Dn, t._MagickRectangle_Y_Set = s.En, t._MagickRectangle_Width_Get = s.Fn, t._MagickRectangle_Width_Set = s.Gn, t._MagickRectangle_Height_Get = s.Hn, t._MagickRectangle_Height_Set = s.In, t._MagickRectangle_FromPageSize = s.Jn, t._OffsetInfo_Create = s.Kn, t._OffsetInfo_Dispose = s.Ln, t._OffsetInfo_SetX = s.Mn, t._OffsetInfo_SetY = s.Nn, t._PointInfo_X_Get = s.On, t._PointInfo_Y_Get = s.Pn, t._PointInfoCollection_Create = s.Qn, t._PointInfoCollection_Dispose = s.Rn, t._PointInfoCollection_GetX = s.Sn, t._PointInfoCollection_GetY = s.Tn, t._PointInfoCollection_Set = s.Un, t._PrimaryInfo_Dispose = s.Vn, t._PrimaryInfo_X_Get = s.Wn, t._PrimaryInfo_X_Set = s.Xn, t._PrimaryInfo_Y_Get = s.Yn, t._PrimaryInfo_Y_Set = s.Zn, t._PrimaryInfo_Z_Get = s._n, t._PrimaryInfo_Z_Set = s.$n, t._StringInfo_Length_Get = s.ao, t._StringInfo_Datum_Get = s.bo, t._TypeMetric_Dispose = s.co, t._TypeMetric_Ascent_Get = s.eo, t._TypeMetric_Descent_Get = s.fo, t._TypeMetric_MaxHorizontalAdvance_Get = s.go, t._TypeMetric_TextHeight_Get = s.ho, t._TypeMetric_TextWidth_Get = s.io, t._TypeMetric_UnderlinePosition_Get = s.jo, t._TypeMetric_UnderlineThickness_Get = s.ko;
    var hs = s.lo, B = s.mo, gs = s.no, ds = s.oo, fs = s.po, ps = s.qo, ms = s.ro, vs = s.so, ws = s.to;
    function ks(r, i, a, o) {
      var l = z();
      try {
        W(r)(i, a, o);
      } catch (h) {
        if (N(l), h !== h + 0) throw h;
        B(1, 0);
      }
    }
    function Ms(r, i, a, o) {
      var l = z();
      try {
        return W(r)(i, a, o);
      } catch (h) {
        if (N(l), h !== h + 0) throw h;
        B(1, 0);
      }
    }
    function ys(r, i, a) {
      var o = z();
      try {
        return W(r)(i, a);
      } catch (l) {
        if (N(o), l !== l + 0) throw l;
        B(1, 0);
      }
    }
    function Ss(r, i) {
      var a = z();
      try {
        return W(r)(i);
      } catch (o) {
        if (N(a), o !== o + 0) throw o;
        B(1, 0);
      }
    }
    function Cs(r, i) {
      var a = z();
      try {
        W(r)(i);
      } catch (o) {
        if (N(a), o !== o + 0) throw o;
        B(1, 0);
      }
    }
    function Is(r, i, a) {
      var o = z();
      try {
        W(r)(i, a);
      } catch (l) {
        if (N(o), l !== l + 0) throw l;
        B(1, 0);
      }
    }
    function Ps(r, i, a, o, l) {
      var h = z();
      try {
        W(r)(i, a, o, l);
      } catch (d) {
        if (N(h), d !== d + 0) throw d;
        B(1, 0);
      }
    }
    function Ds(r, i, a, o, l) {
      var h = z();
      try {
        return W(r)(i, a, o, l);
      } catch (d) {
        if (N(h), d !== d + 0) throw d;
        B(1, 0);
      }
    }
    function Es(r, i, a, o) {
      var l = z();
      try {
        return W(r)(i, a, o);
      } catch (h) {
        if (N(l), h !== h + 0) throw h;
        return B(1, 0), 0n;
      }
    }
    function Ts(r, i) {
      var a = z();
      try {
        return W(r)(i);
      } catch (o) {
        if (N(a), o !== o + 0) throw o;
        return B(1, 0), 0n;
      }
    }
    function bs(r, i, a, o, l, h, d, f, v) {
      var M = z();
      try {
        return W(r)(i, a, o, l, h, d, f, v);
      } catch (y) {
        if (N(M), y !== y + 0) throw y;
        B(1, 0);
      }
    }
    function As(r, i, a, o, l, h, d) {
      var f = z();
      try {
        return W(r)(i, a, o, l, h, d);
      } catch (v) {
        if (N(f), v !== v + 0) throw v;
        B(1, 0);
      }
    }
    function Rs(r, i, a, o, l) {
      var h = z();
      try {
        return W(r)(i, a, o, l);
      } catch (d) {
        if (N(h), d !== d + 0) throw d;
        B(1, 0);
      }
    }
    function xs(r) {
      var i = z();
      try {
        return W(r)();
      } catch (a) {
        if (N(i), a !== a + 0) throw a;
        B(1, 0);
      }
    }
    function Gs(r, i, a) {
      var o = z();
      try {
        return W(r)(i, a);
      } catch (l) {
        if (N(o), l !== l + 0) throw l;
        B(1, 0);
      }
    }
    function Fs(r, i, a) {
      var o = z();
      try {
        W(r)(i, a);
      } catch (l) {
        if (N(o), l !== l + 0) throw l;
        B(1, 0);
      }
    }
    function Ls(r, i, a, o, l, h) {
      var d = z();
      try {
        return W(r)(i, a, o, l, h);
      } catch (f) {
        if (N(d), f !== f + 0) throw f;
        B(1, 0);
      }
    }
    function Ws(r, i, a) {
      var o = z();
      try {
        return W(r)(i, a);
      } catch (l) {
        if (N(o), l !== l + 0) throw l;
        B(1, 0);
      }
    }
    function Bs(r) {
      var i = z();
      try {
        W(r)();
      } catch (a) {
        if (N(i), a !== a + 0) throw a;
        B(1, 0);
      }
    }
    function Ns(r, i, a, o, l, h) {
      var d = z();
      try {
        W(r)(i, a, o, l, h);
      } catch (f) {
        if (N(d), f !== f + 0) throw f;
        B(1, 0);
      }
    }
    function zs(r, i, a, o, l, h, d, f) {
      var v = z();
      try {
        return W(r)(i, a, o, l, h, d, f);
      } catch (M) {
        if (N(v), M !== M + 0) throw M;
        B(1, 0);
      }
    }
    function $s(r, i, a, o, l, h, d, f, v, M) {
      var y = z();
      try {
        return W(r)(i, a, o, l, h, d, f, v, M);
      } catch (C) {
        if (N(y), C !== C + 0) throw C;
        B(1, 0);
      }
    }
    function Hs(r, i, a, o) {
      var l = z();
      try {
        W(r)(i, a, o);
      } catch (h) {
        if (N(l), h !== h + 0) throw h;
        B(1, 0);
      }
    }
    function Ys(r, i, a, o, l, h, d, f, v, M, y) {
      var C = z();
      try {
        W(r)(i, a, o, l, h, d, f, v, M, y);
      } catch (P) {
        if (N(C), P !== P + 0) throw P;
        B(1, 0);
      }
    }
    function Us(r, i, a, o, l, h, d, f, v, M, y) {
      var C = z();
      try {
        return W(r)(i, a, o, l, h, d, f, v, M, y);
      } catch (P) {
        if (N(C), P !== P + 0) throw P;
        B(1, 0);
      }
    }
    function Xs(r, i, a, o, l, h, d, f, v, M) {
      var y = z();
      try {
        W(r)(i, a, o, l, h, d, f, v, M);
      } catch (C) {
        if (N(y), C !== C + 0) throw C;
        B(1, 0);
      }
    }
    function js(r, i, a, o, l, h, d) {
      var f = z();
      try {
        W(r)(i, a, o, l, h, d);
      } catch (v) {
        if (N(f), v !== v + 0) throw v;
        B(1, 0);
      }
    }
    function Vs(r, i, a, o, l, h, d, f) {
      var v = z();
      try {
        W(r)(i, a, o, l, h, d, f);
      } catch (M) {
        if (N(v), M !== M + 0) throw M;
        B(1, 0);
      }
    }
    function qs(r, i, a, o, l, h, d, f, v, M, y, C) {
      var P = z();
      try {
        return W(r)(i, a, o, l, h, d, f, v, M, y, C);
      } catch (I) {
        if (N(P), I !== I + 0) throw I;
        B(1, 0);
      }
    }
    function Ks(r, i, a, o, l, h) {
      var d = z();
      try {
        return W(r)(i, a, o, l, h);
      } catch (f) {
        if (N(d), f !== f + 0) throw f;
        B(1, 0);
      }
    }
    function Qs(r, i) {
      var a = z();
      try {
        return W(r)(i);
      } catch (o) {
        if (N(a), o !== o + 0) throw o;
        B(1, 0);
      }
    }
    function Js(r, i, a, o, l, h, d, f, v) {
      var M = z();
      try {
        W(r)(i, a, o, l, h, d, f, v);
      } catch (y) {
        if (N(M), y !== y + 0) throw y;
        B(1, 0);
      }
    }
    function Os(r, i, a, o, l, h, d, f, v, M, y, C) {
      var P = z();
      try {
        W(r)(i, a, o, l, h, d, f, v, M, y, C);
      } catch (I) {
        if (N(P), I !== I + 0) throw I;
        B(1, 0);
      }
    }
    function Zs(r) {
      r = Object.assign({}, r);
      var i = (l) => (h) => l(h) >>> 0, a = (l) => (h, d) => l(h, d) >>> 0, o = (l) => () => l() >>> 0;
      return r.ib = i(r.ib), r.Zj = i(r.Zj), r.lo = a(r.lo), r._emscripten_stack_alloc = i(r._emscripten_stack_alloc), r.po = o(r.po), r.to = i(r.to), r;
    }
    function Zt() {
      if (ze > 0) {
        at = Zt;
        return;
      }
      if (li(), ze > 0) {
        at = Zt;
        return;
      }
      function r() {
        t.calledRun = !0, !At && (ui(), _(t), t.onRuntimeInitialized?.(), hi());
      }
      t.setStatus ? (t.setStatus("Running..."), setTimeout(() => {
        setTimeout(() => t.setStatus(""), 1), r();
      }, 1)) : r();
    }
    function eo() {
      if (t.preInit)
        for (typeof t.preInit == "function" && (t.preInit = [t.preInit]); t.preInit.length > 0; )
          t.preInit.shift()();
    }
    return eo(), Zt(), n = p, n;
  });
})();
class Ro {
  constructor(e) {
    if (e instanceof URL) {
      if (e.protocol !== "http:" && e.protocol !== "https:")
        throw new Y("Only http/https protocol is supported");
      this.locateFile = () => e.href;
    } else e instanceof WebAssembly.Module ? this.instantiateWasm = (n, t) => {
      const _ = new WebAssembly.Instance(e, n);
      t(_);
    } : this.wasmBinary = e;
  }
  wasmBinary;
  instantiateWasm;
  locateFile;
}
class c {
  loader;
  api;
  /** @internal */
  constructor() {
    this.loader = (e, n) => new Promise((t, _) => {
      if (this.api !== void 0) {
        t();
        return;
      }
      const g = new Ro(e);
      Ao(g).then((p) => {
        try {
          this.writeConfigurationFiles(p, n), ir(p, "MAGICK_CONFIGURE_PATH", (m) => {
            ir(p, "/xml", (S) => {
              p._Environment_SetEnv(m, S), p._Environment_Initialize(), this.api = p, t();
            });
          });
        } catch (m) {
          _(m);
        }
      });
    });
  }
  /** @internal */
  async _initialize(e, n) {
    await this.loader(e, n);
  }
  /** @internal */
  static get _api() {
    if (!Dt.api)
      throw new Y("`await initializeImageMagick` should be called to initialize the library");
    return Dt.api;
  }
  /** @internal */
  static set _api(e) {
    Dt.api = e;
  }
  static read(e, n, t, _) {
    return ie._create((g) => {
      let p = _;
      if (typeof e != "string" && !ii(e))
        typeof n == "number" && typeof t == "number" && g.read(e, n, t);
      else if (typeof n != "number" && typeof t != "number") {
        p = t;
        let m;
        n instanceof be ? m = n : typeof n == "string" ? (m = new be(), m.format = n) : p = n, g.read(e, m);
      }
      return p(g);
    });
  }
  static readCollection(e, n, t) {
    return ke.use((_) => {
      let g = t, p;
      return n instanceof be ? p = n : typeof n == "string" ? (p = new be(), p.format = n) : g = n, _.read(e, p), g(_);
    });
  }
  static readFromCanvas(e, n, t) {
    return ie._create((_) => (_.readFromCanvas(e, t), n(_)));
  }
  writeConfigurationFiles(e, n) {
    e.FS.analyzePath("/xml").exists || e.FS.mkdir("/xml");
    for (const _ of n.all()) {
      const g = e.FS.open(`/xml/${_.fileName}`, "w"), p = new TextEncoder().encode(_.data);
      e.FS.write(g, p, 0, p.length), e.FS.close(g);
    }
  }
}
const Dt = new c();
async function g_(w, e) {
  await Dt._initialize(w, e ?? ar.default);
}
class xo {
  /** @internal */
  constructor(e, n, t) {
    this.origin = e, this.progress = new re((n + 1) / (t * 100));
  }
  /**
   * Gets the originator of this event.
   */
  origin;
  /**
   * Gets the progress percentage.
   */
  progress;
  /**
   * Gets or sets a value indicating whether the current operation will be canceled.
   */
  cancel = !1;
}
class se {
  static _logDelegate = 0;
  static _onLog;
  static _progressDelegate = 0;
  static _images = {};
  static setLogDelegate(e) {
    se._logDelegate === 0 && e !== void 0 && (se._logDelegate = c._api.addFunction(se.logDelegate, "vii")), c._api._Magick_SetLogDelegate(e === void 0 ? 0 : se._logDelegate), se._onLog = e;
  }
  static setProgressDelegate(e) {
    se._progressDelegate === 0 && (this._progressDelegate = c._api.addFunction(se.progressDelegate, "iijji")), this._images[e._instance] = e, c._api._MagickImage_SetClientData(e._instance, e._instance), c._api._MagickImage_SetProgressDelegate(e._instance, se._progressDelegate);
  }
  static removeProgressDelegate(e) {
    c._api._MagickImage_SetClientData(e._instance, 0), c._api._MagickImage_SetProgressDelegate(e._instance, 0), delete se._images[e._instance];
  }
  static logDelegate(e, n) {
    if (se._onLog === void 0)
      return;
    const t = ce(n, "");
    se._onLog(new _o(e, t));
  }
  static progressDelegate(e, n, t, _) {
    const g = se._images[_];
    if (g === void 0 || g.onProgress === void 0)
      return 1;
    const p = Number(n), m = Number(t), S = ce(e), R = new xo(S, p, m);
    return g.onProgress(R), R.cancel ? 0 : 1;
  }
}
class De {
  static _allFormats;
  constructor(e, n, t, _, g, p, m) {
    this.format = e, this.description = n, this.mimeType = t, this.moduleFormat = _, this.supportsMultipleFrames = g, this.supportsReading = p, this.supportsWriting = m;
  }
  description;
  format;
  mimeType;
  moduleFormat;
  supportsMultipleFrames;
  supportsReading;
  supportsWriting;
  static get all() {
    return De._allFormats === void 0 && (De._allFormats = De.loadFormats()), De._allFormats;
  }
  static loadFormats() {
    return E.usePointer((e) => Re.use((n) => {
      const t = c._api._MagickFormatInfo_CreateList(n.ptr, e), _ = n.value;
      try {
        const g = new Array(_), p = Object.values(Le);
        for (let m = 0; m < _; m++) {
          const S = c._api._MagickFormatInfo_GetInfo(t, m, e), R = ce(c._api._MagickFormatInfo_Format_Get(S)), $ = De.convertFormat(R, p), V = ce(c._api._MagickFormatInfo_Description_Get(S), ""), We = ce(c._api._MagickFormatInfo_MimeType_Get(S)), Be = ce(c._api._MagickFormatInfo_Module_Get(S)), xe = De.convertFormat(Be, p), Ge = c._api._MagickFormatInfo_SupportsMultipleFrames_Get(S) == 1, me = c._api._MagickFormatInfo_SupportsReading_Get(S) == 1, Ne = c._api._MagickFormatInfo_SupportsWriting_Get(S) == 1;
          g[m] = new De($, V, We, xe, Ge, me, Ne);
        }
        return g;
      } finally {
        c._api._MagickFormatInfo_DisposeList(t, _);
      }
    }));
  }
  static convertFormat(e, n) {
    return e === null ? Le.Unknown : n.includes(e) ? e : Le.Unknown;
  }
}
const Q = {
  /**
   * None.
   */
  None: 0,
  /**
   * Accelerate.
   */
  Accelerate: 1,
  /**
   * Annotate.
   */
  Annotate: 2,
  /**
   * Blob.
   */
  Blob: 4,
  /**
   * Cache.
   */
  Cache: 8,
  /**
   * Coder.
   */
  Coder: 16,
  /**
   * Configure.
   */
  Configure: 32,
  /**
   * Deprecate.
   */
  Deprecate: 64,
  /**
   * Draw.
   */
  Draw: 128,
  /**
   * Exception.
   */
  Exception: 256,
  /**
   * Image.
   */
  Image: 512,
  /**
   * Locale.
   */
  Locale: 1024,
  /**
   * Module.
   */
  Module: 2048,
  /**
   * Pixel.
   */
  Pixel: 4096,
  /**
   * Policy.
   */
  Policy: 8192,
  /**
   * Resource.
   */
  Resource: 16384,
  /**
   * Trace.
   */
  Trace: 32768,
  /**
   * Transform.
   */
  Transform: 65536,
  /**
   * User.
   */
  User: 131072,
  /**
   * Wand.
   */
  Wand: 262144,
  /**
   * Detailed.
   */
  Detailed: 2147450879,
  /**
   * All.
   */
  get All() {
    return this.Detailed | this.Trace;
  }
};
class Ae {
  /**
   * Gets the ImageMagick delegate libraries.
   */
  static get delegates() {
    return ce(c._api._Magick_Delegates_Get(), "Unknown");
  }
  /**
   * Gets the ImageMagick features.
   */
  static get features() {
    return ce(c._api._Magick_Features_Get(), " ").slice(0, -1);
  }
  /**
   * Gets the ImageMagick version.
   */
  static get imageMagickVersion() {
    return ce(c._api._Magick_ImageMagickVersion_Get(), "Unknown");
  }
  /**
   * Gets information about the supported formats.
   */
  static get supportedFormats() {
    return De.all;
  }
  /**
   * Function that will be executed when something is logged by ImageMagick.
   */
  static onLog;
  /**
   * Registers a font.
   * @param name The name of the font.
   * @param data The byte array containing the font.
   */
  static addFont(e, n) {
    const t = c._api.FS;
    t.analyzePath("/fonts").exists || t.mkdir("/fonts");
    const g = t.open(`/fonts/${e}`, "w");
    t.write(g, n, 0, n.length), t.close(g);
  }
  /**
   * Sets the pseudo-random number generator secret key.
   * @param seed The secret key.
   */
  static resetRandomSeed = () => c._api._Magick_ResetRandomSeed();
  /**
   * Sets the pseudo-random number generator secret key.
   * @param seed The secret key.
   */
  static setRandomSeed = (e) => c._api._Magick_SetRandomSeed(e);
  /**
   * Set the events that will be written to the log. The log will be written to the Log event
   * and the debug window in VisualStudio. To change the log settings you must use a custom
   * log.xml file.
   * @param eventTypes The events that should be logged.
   */
  static setLogEvents(e) {
    const n = e == Q.None ? void 0 : Ae.logDelegate;
    se.setLogDelegate(n);
    const t = Ae.getEventTypeString(e);
    A(t, (_) => c._api._Magick_SetLogEvents(_));
  }
  /** @internal */
  static _getFontFileName(e) {
    const n = `/fonts/${e}`;
    if (!c._api.FS.analyzePath(n).exists)
      throw `Unable to find a font with the name '${e}', register it with the addFont method of the Magick class.`;
    return n;
  }
  static getEventTypeString(e) {
    if (e == Q.All)
      return "All,Trace";
    if (e == Q.Detailed)
      return "All";
    switch (e) {
      case Q.Accelerate:
        return "Accelerate";
      case Q.Annotate:
        return "Annotate";
      case Q.Blob:
        return "Blob";
      case Q.Cache:
        return "Cache";
      case Q.Coder:
        return "Coder";
      case Q.Configure:
        return "Configure";
      case Q.Deprecate:
        return "Deprecate";
      case Q.Draw:
        return "Draw";
      case Q.Exception:
        return "Exception";
      case Q.Image:
        return "Image";
      case Q.Locale:
        return "Locale";
      case Q.Module:
        return "Module";
      case Q.Pixel:
        return "Pixel";
      case Q.Policy:
        return "Policy";
      case Q.Resource:
        return "Resource";
      case Q.Trace:
        return "Trace";
      case Q.Transform:
        return "Transform";
      case Q.User:
        return "User";
      case Q.Wand:
        return "Wand";
      case Q.None:
      default:
        return "None";
    }
  }
  static logDelegate(e) {
    Ae.onLog !== void 0 && Ae.onLog(e);
  }
}
class Go {
  _font;
  /**
   * Initializes a new instance of the {@link DrawableFont} class.
   * @param opacity The name of the font that was registered.
   */
  constructor(e) {
    this._font = e;
  }
  /**
   * Gets the name of the font that was registered.
   */
  get font() {
    return this._font;
  }
  draw(e) {
    const n = Ae._getFontFileName(this._font);
    e.font(n);
  }
}
class Fo {
  _gravity;
  /**
   * Initializes a new instance of the {@link DrawableGravity} class.
   * @param gravity The gravity to use.
   */
  constructor(e) {
    this._gravity = e;
  }
  /**
   * Gets the gravity to use.
   */
  get gravity() {
    return this._gravity;
  }
  draw(e) {
    e.gravity(this._gravity);
  }
}
class Lo {
  _startX;
  _startY;
  _endX;
  _endY;
  /**
   * Initializes a new instance of the {@link DrawableLine} class.
   * @param startX The starting X coordinate.
   * @param startY The starting Y coordinate.
   * @param endX The ending X coordinate.
   * @param endY The ending Y coordinate.
   */
  constructor(e, n, t, _) {
    this._startX = e, this._startY = n, this._endX = t, this._endY = _;
  }
  /**
   * Gets the starting X coordinate.
   */
  get startX() {
    return this._startX;
  }
  /**
   * Gets the starting Y coordinate.
   */
  get startY() {
    return this._startY;
  }
  /**
   * Gets the ending X coordinate.
   */
  get endX() {
    return this._endX;
  }
  /**
   * Gets the ending Y coordinate.
   */
  get endY() {
    return this._endY;
  }
  draw(e) {
    e.line(this._startX, this._startY, this._endX, this._endY);
  }
}
class Wo {
  _paths = [];
  /**
   * Initializes a new instance of the {@link DrawablePath} class.
   * @param paths The paths to use.
   */
  constructor(e) {
    this._paths = e;
  }
  draw(e) {
    e.pathStart();
    for (const n of this._paths)
      n.draw(e);
    e.pathFinish();
  }
}
class Bo {
  _x;
  _y;
  /**
   * Initializes a new instance of the {@link DrawablePoint} class.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   */
  constructor(e, n) {
    this._x = e, this._y = n;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  draw(e) {
    e.point(this._x, this._y);
  }
}
class No {
  _upperLeftX;
  _upperLeftY;
  _lowerRightX;
  _lowerRightY;
  /**
    * Initializes a new instance of the {@link DrawablePoint} class.
    * @param upperLeftX The upper left X coordinate.
    * @param upperLeftY The upper left Y coordinate.
    * @param lowerRightX The lower right X coordinate.
    * @param lowerRightY The lower right Y coordinate.
    */
  constructor(e, n, t, _) {
    this._upperLeftX = e, this._upperLeftY = n, this._lowerRightX = t, this._lowerRightY = _;
  }
  /**
   * Gets the upper left X coordinate.
   */
  get upperLeftX() {
    return this._upperLeftX;
  }
  /**
   * Gets the upper left Y coordinate.
   */
  get upperLeftY() {
    return this._upperLeftY;
  }
  /**
   * Gets the lower right X coordinate.
   */
  get lowerRightX() {
    return this._lowerRightX;
  }
  /**
   * Gets the lower right Y coordinate.
   */
  get lowerRightY() {
    return this._lowerRightY;
  }
  draw(e) {
    e.rectangle(this._upperLeftX, this._upperLeftY, this._lowerRightX, this._lowerRightY);
  }
}
class zo {
  _upperLeftX;
  _upperLeftY;
  _lowerRightX;
  _lowerRightY;
  _cornerWidth;
  _cornerHeight;
  /**
   * Initializes a new instance of the {@link DrawableRoundRectangle} class.
   * @param upperLeftX The upper left X coordinate.
   * @param upperLeftY The upper left Y coordinate.
   * @param lowerRightX The lower right X coordinate.
   * @param lowerRightY The lower right Y coordinate.
   * @param cornerWidth The corner width.
   * @param cornerHeight The corner height.
   */
  constructor(e, n, t, _, g, p) {
    this._upperLeftX = e, this._upperLeftY = n, this._lowerRightX = t, this._lowerRightY = _, this._cornerWidth = g, this._cornerHeight = p;
  }
  /**
   * Gets the upper left X coordinate.
   */
  get upperLeftX() {
    return this._upperLeftX;
  }
  /**
   * Gets the upper left Y coordinate.
   */
  get upperLeftY() {
    return this._upperLeftY;
  }
  /**
   * Gets the lower right X coordinate.
   */
  get lowerRightX() {
    return this._lowerRightX;
  }
  /**
   * Gets the lower right Y coordinate.
   */
  get lowerRightY() {
    return this._lowerRightY;
  }
  /**
   * Gets the corner width.
   */
  get cornerWidth() {
    return this._cornerWidth;
  }
  /**
   * Gets the corner height.
   */
  get cornerHeight() {
    return this._cornerHeight;
  }
  draw(e) {
    e.roundRectangle(this._upperLeftX, this._upperLeftY, this._lowerRightX, this._lowerRightY, this._cornerWidth, this._cornerHeight);
  }
}
class $o {
  _color;
  /**
   * Initializes a new instance of the {@link DrawableStrokeColor} class.
   * @param color The color to use.
   */
  constructor(e) {
    this._color = e;
  }
  /**
   * Gets the color to use.
   */
  get color() {
    return this._color;
  }
  draw(e) {
    e.strokeColor(this._color);
  }
}
class Ho {
  _dash = [];
  /**
   * Initializes a new instance of the {@link DrawableStrokeDashArray} class.
   * @param dash An array containing the dash information.
   */
  constructor(e) {
    this._dash = [...e];
  }
  /**
   * Gets the dash array.
   */
  get dash() {
    return this._dash;
  }
  draw(e) {
    e.strokeDashArray(this._dash);
  }
}
class Yo {
  _offset;
  /**
   * Initializes a new instance of the {@link DrawableStrokeDashArray} class.
   * @param dash The dash offset.
   */
  constructor(e) {
    this._offset = e;
  }
  /**
   * Gets the dash offset.
   */
  get offset() {
    return this._offset;
  }
  draw(e) {
    e.strokeDashOffset(this._offset);
  }
}
class Uo {
  _width;
  /**
   * Initializes a new instance of the {@link DrawableStrokeWidth} class.
   * @param width The width.
   */
  constructor(e) {
    this._width = e;
  }
  /**
   * Gets the width.
   */
  get width() {
    return this._width;
  }
  draw(e) {
    e.strokeWidth(this._width);
  }
}
class Xo {
  _alignment;
  /**
   * Initializes a new instance of the {@link DrawableFillColor} class.
   * @param alignment The text alignment
   */
  constructor(e) {
    this._alignment = e;
  }
  /**
   * Gets the text alignment.
   */
  get alignment() {
    return this._alignment;
  }
  draw(e) {
    e.textAlignment(this._alignment);
  }
}
class ut {
  _isEnabled;
  constructor(e) {
    this._isEnabled = e;
  }
  /**
   * Initializes a new instance of the {@link DrawableTextAntiAlias} class with antialias disabled.
   */
  static get disabled() {
    return new ut(!1);
  }
  /**
   * Initializes a new instance of the {@link DrawableTextAntiAlias} class with antialias enabled.
   */
  static get enabled() {
    return new ut(!0);
  }
  /**
   * Gets a value indicating whether antialias is enabled.
   */
  get isEnabled() {
    return this._isEnabled;
  }
  draw(e) {
    e.textAntialias(this._isEnabled);
  }
}
class jo {
  _decoration;
  /**
   * Initializes a new instance of the {@link DrawableTextDecoration} class.
   * @param decoration The text decoration.
   */
  constructor(e) {
    this._decoration = e;
  }
  /**
   * Gets the text decoration.
   */
  get decoration() {
    return this._decoration;
  }
  draw(e) {
    e.textDecoration(this._decoration);
  }
}
class Vo {
  _spacing;
  /**
   * Initializes a new instance of the {@link DrawableTextInterlineSpacing} class.
   * @param decoration The spacing to use.
   */
  constructor(e) {
    this._spacing = e;
  }
  /**
   * Gets the spacing to use.
   */
  get spacing() {
    return this._spacing;
  }
  draw(e) {
    e.textInterlineSpacing(this._spacing);
  }
}
class qo {
  _spacing;
  /**
   * Initializes a new instance of the {@link DrawableTextInterwordSpacing} class.
   * @param decoration The spacing to use.
   */
  constructor(e) {
    this._spacing = e;
  }
  /**
   * Gets the spacing to use.
   */
  get spacing() {
    return this._spacing;
  }
  draw(e) {
    e.textInterwordspacing(this._spacing);
  }
}
class Ko {
  _kerning;
  /**
   * Initializes a new instance of the {@link DrawableTextKerning} class.
   * @param kerning The kerning to use.
   */
  constructor(e) {
    this._kerning = e;
  }
  /**
   * Gets the kerning to use.
   */
  get kerning() {
    return this._kerning;
  }
  draw(e) {
    e.textKerning(this._kerning);
  }
}
class Qo {
  _color;
  /**
   * Initializes a new instance of the {@link DrawableTextUnderColor} class.
   * @param decoration The color to use.
   */
  constructor(e) {
    this._color = e;
  }
  /**
   * Gets the color to use.
   */
  get color() {
    return this._color;
  }
  draw(e) {
    e.textUnderColor(this._color);
  }
}
class Jo {
  _x;
  _y;
  _value;
  /**
   * Initializes a new instance of the {@link DrawableTextUnderColor} class.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   * @param value The text to draw.
   */
  constructor(e, n, t) {
    this._x = e, this._y = n, this._value = t;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  /**
   * Gets the text to draw.
   */
  get value() {
    return this._value;
  }
  draw(e) {
    e.text(this._x, this._y, this._value);
  }
}
class Oo {
  /**
   * Gets a system-defined color that has an RGBA value of #00000000.
  */
  static get None() {
    return new k(0, 0, 0, 0);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00000000.
  */
  static get Transparent() {
    return new k(0, 0, 0, 0);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F0F8FFFF.
  */
  static get AliceBlue() {
    return new k(240, 248, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FAEBD7FF.
  */
  static get AntiqueWhite() {
    return new k(250, 235, 215, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00FFFFFF.
  */
  static get Aqua() {
    return new k(0, 255, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #7FFFD4FF.
  */
  static get Aquamarine() {
    return new k(127, 255, 212, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F0FFFFFF.
  */
  static get Azure() {
    return new k(240, 255, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F5F5DCFF.
  */
  static get Beige() {
    return new k(245, 245, 220, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFE4C4FF.
  */
  static get Bisque() {
    return new k(255, 228, 196, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #000000FF.
  */
  static get Black() {
    return new k(0, 0, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFEBCDFF.
  */
  static get BlanchedAlmond() {
    return new k(255, 235, 205, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #0000FFFF.
  */
  static get Blue() {
    return new k(0, 0, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #8A2BE2FF.
  */
  static get BlueViolet() {
    return new k(138, 43, 226, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #A52A2AFF.
  */
  static get Brown() {
    return new k(165, 42, 42, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DEB887FF.
  */
  static get BurlyWood() {
    return new k(222, 184, 135, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #5F9EA0FF.
  */
  static get CadetBlue() {
    return new k(95, 158, 160, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #7FFF00FF.
  */
  static get Chartreuse() {
    return new k(127, 255, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #D2691EFF.
  */
  static get Chocolate() {
    return new k(210, 105, 30, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF7F50FF.
  */
  static get Coral() {
    return new k(255, 127, 80, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #6495EDFF.
  */
  static get CornflowerBlue() {
    return new k(100, 149, 237, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFF8DCFF.
  */
  static get Cornsilk() {
    return new k(255, 248, 220, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DC143CFF.
  */
  static get Crimson() {
    return new k(220, 20, 60, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00FFFFFF.
  */
  static get Cyan() {
    return new k(0, 255, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00008BFF.
  */
  static get DarkBlue() {
    return new k(0, 0, 139, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #008B8BFF.
  */
  static get DarkCyan() {
    return new k(0, 139, 139, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #B8860BFF.
  */
  static get DarkGoldenrod() {
    return new k(184, 134, 11, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #A9A9A9FF.
  */
  static get DarkGray() {
    return new k(169, 169, 169, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #006400FF.
  */
  static get DarkGreen() {
    return new k(0, 100, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #BDB76BFF.
  */
  static get DarkKhaki() {
    return new k(189, 183, 107, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #8B008BFF.
  */
  static get DarkMagenta() {
    return new k(139, 0, 139, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #556B2FFF.
  */
  static get DarkOliveGreen() {
    return new k(85, 107, 47, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF8C00FF.
  */
  static get DarkOrange() {
    return new k(255, 140, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #9932CCFF.
  */
  static get DarkOrchid() {
    return new k(153, 50, 204, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #8B0000FF.
  */
  static get DarkRed() {
    return new k(139, 0, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #E9967AFF.
  */
  static get DarkSalmon() {
    return new k(233, 150, 122, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #8FBC8FFF.
  */
  static get DarkSeaGreen() {
    return new k(143, 188, 143, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #483D8BFF.
  */
  static get DarkSlateBlue() {
    return new k(72, 61, 139, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #2F4F4FFF.
  */
  static get DarkSlateGray() {
    return new k(47, 79, 79, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00CED1FF.
  */
  static get DarkTurquoise() {
    return new k(0, 206, 209, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #9400D3FF.
  */
  static get DarkViolet() {
    return new k(148, 0, 211, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF1493FF.
  */
  static get DeepPink() {
    return new k(255, 20, 147, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00BFFFFF.
  */
  static get DeepSkyBlue() {
    return new k(0, 191, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #696969FF.
  */
  static get DimGray() {
    return new k(105, 105, 105, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #1E90FFFF.
  */
  static get DodgerBlue() {
    return new k(30, 144, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #B22222FF.
  */
  static get Firebrick() {
    return new k(178, 34, 34, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFAF0FF.
  */
  static get FloralWhite() {
    return new k(255, 250, 240, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #228B22FF.
  */
  static get ForestGreen() {
    return new k(34, 139, 34, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF00FFFF.
  */
  static get Fuchsia() {
    return new k(255, 0, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DCDCDCFF.
  */
  static get Gainsboro() {
    return new k(220, 220, 220, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F8F8FFFF.
  */
  static get GhostWhite() {
    return new k(248, 248, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFD700FF.
  */
  static get Gold() {
    return new k(255, 215, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DAA520FF.
  */
  static get Goldenrod() {
    return new k(218, 165, 32, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #808080FF.
  */
  static get Gray() {
    return new k(128, 128, 128, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #008000FF.
  */
  static get Green() {
    return new k(0, 128, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #ADFF2FFF.
  */
  static get GreenYellow() {
    return new k(173, 255, 47, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F0FFF0FF.
  */
  static get Honeydew() {
    return new k(240, 255, 240, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF69B4FF.
  */
  static get HotPink() {
    return new k(255, 105, 180, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #CD5C5CFF.
  */
  static get IndianRed() {
    return new k(205, 92, 92, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #4B0082FF.
  */
  static get Indigo() {
    return new k(75, 0, 130, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFFF0FF.
  */
  static get Ivory() {
    return new k(255, 255, 240, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F0E68CFF.
  */
  static get Khaki() {
    return new k(240, 230, 140, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #E6E6FAFF.
  */
  static get Lavender() {
    return new k(230, 230, 250, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFF0F5FF.
  */
  static get LavenderBlush() {
    return new k(255, 240, 245, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #7CFC00FF.
  */
  static get LawnGreen() {
    return new k(124, 252, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFACDFF.
  */
  static get LemonChiffon() {
    return new k(255, 250, 205, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #ADD8E6FF.
  */
  static get LightBlue() {
    return new k(173, 216, 230, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F08080FF.
  */
  static get LightCoral() {
    return new k(240, 128, 128, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #E0FFFFFF.
  */
  static get LightCyan() {
    return new k(224, 255, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FAFAD2FF.
  */
  static get LightGoldenrodYellow() {
    return new k(250, 250, 210, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #90EE90FF.
  */
  static get LightGreen() {
    return new k(144, 238, 144, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #D3D3D3FF.
  */
  static get LightGray() {
    return new k(211, 211, 211, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFB6C1FF.
  */
  static get LightPink() {
    return new k(255, 182, 193, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFA07AFF.
  */
  static get LightSalmon() {
    return new k(255, 160, 122, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #20B2AAFF.
  */
  static get LightSeaGreen() {
    return new k(32, 178, 170, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #87CEFAFF.
  */
  static get LightSkyBlue() {
    return new k(135, 206, 250, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #778899FF.
  */
  static get LightSlateGray() {
    return new k(119, 136, 153, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #B0C4DEFF.
  */
  static get LightSteelBlue() {
    return new k(176, 196, 222, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFFE0FF.
  */
  static get LightYellow() {
    return new k(255, 255, 224, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00FF00FF.
  */
  static get Lime() {
    return new k(0, 255, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #32CD32FF.
  */
  static get LimeGreen() {
    return new k(50, 205, 50, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FAF0E6FF.
  */
  static get Linen() {
    return new k(250, 240, 230, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF00FFFF.
  */
  static get Magenta() {
    return new k(255, 0, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #800000FF.
  */
  static get Maroon() {
    return new k(128, 0, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #66CDAAFF.
  */
  static get MediumAquamarine() {
    return new k(102, 205, 170, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #0000CDFF.
  */
  static get MediumBlue() {
    return new k(0, 0, 205, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #BA55D3FF.
  */
  static get MediumOrchid() {
    return new k(186, 85, 211, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #9370DBFF.
  */
  static get MediumPurple() {
    return new k(147, 112, 219, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #3CB371FF.
  */
  static get MediumSeaGreen() {
    return new k(60, 179, 113, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #7B68EEFF.
  */
  static get MediumSlateBlue() {
    return new k(123, 104, 238, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00FA9AFF.
  */
  static get MediumSpringGreen() {
    return new k(0, 250, 154, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #48D1CCFF.
  */
  static get MediumTurquoise() {
    return new k(72, 209, 204, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #C71585FF.
  */
  static get MediumVioletRed() {
    return new k(199, 21, 133, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #191970FF.
  */
  static get MidnightBlue() {
    return new k(25, 25, 112, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F5FFFAFF.
  */
  static get MintCream() {
    return new k(245, 255, 250, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFE4E1FF.
  */
  static get MistyRose() {
    return new k(255, 228, 225, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFE4B5FF.
  */
  static get Moccasin() {
    return new k(255, 228, 181, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFDEADFF.
  */
  static get NavajoWhite() {
    return new k(255, 222, 173, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #000080FF.
  */
  static get Navy() {
    return new k(0, 0, 128, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FDF5E6FF.
  */
  static get OldLace() {
    return new k(253, 245, 230, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #808000FF.
  */
  static get Olive() {
    return new k(128, 128, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #6B8E23FF.
  */
  static get OliveDrab() {
    return new k(107, 142, 35, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFA500FF.
  */
  static get Orange() {
    return new k(255, 165, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF4500FF.
  */
  static get OrangeRed() {
    return new k(255, 69, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DA70D6FF.
  */
  static get Orchid() {
    return new k(218, 112, 214, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #EEE8AAFF.
  */
  static get PaleGoldenrod() {
    return new k(238, 232, 170, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #98FB98FF.
  */
  static get PaleGreen() {
    return new k(152, 251, 152, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #AFEEEEFF.
  */
  static get PaleTurquoise() {
    return new k(175, 238, 238, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DB7093FF.
  */
  static get PaleVioletRed() {
    return new k(219, 112, 147, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFEFD5FF.
  */
  static get PapayaWhip() {
    return new k(255, 239, 213, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFDAB9FF.
  */
  static get PeachPuff() {
    return new k(255, 218, 185, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #CD853FFF.
  */
  static get Peru() {
    return new k(205, 133, 63, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFC0CBFF.
  */
  static get Pink() {
    return new k(255, 192, 203, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #DDA0DDFF.
  */
  static get Plum() {
    return new k(221, 160, 221, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #B0E0E6FF.
  */
  static get PowderBlue() {
    return new k(176, 224, 230, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #800080FF.
  */
  static get Purple() {
    return new k(128, 0, 128, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #663399FF.
  */
  static get RebeccaPurple() {
    return new k(102, 51, 153, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF0000FF.
  */
  static get Red() {
    return new k(255, 0, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #BC8F8FFF.
  */
  static get RosyBrown() {
    return new k(188, 143, 143, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #4169E1FF.
  */
  static get RoyalBlue() {
    return new k(65, 105, 225, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #8B4513FF.
  */
  static get SaddleBrown() {
    return new k(139, 69, 19, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FA8072FF.
  */
  static get Salmon() {
    return new k(250, 128, 114, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F4A460FF.
  */
  static get SandyBrown() {
    return new k(244, 164, 96, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #2E8B57FF.
  */
  static get SeaGreen() {
    return new k(46, 139, 87, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFF5EEFF.
  */
  static get SeaShell() {
    return new k(255, 245, 238, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #A0522DFF.
  */
  static get Sienna() {
    return new k(160, 82, 45, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #C0C0C0FF.
  */
  static get Silver() {
    return new k(192, 192, 192, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #87CEEBFF.
  */
  static get SkyBlue() {
    return new k(135, 206, 235, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #6A5ACDFF.
  */
  static get SlateBlue() {
    return new k(106, 90, 205, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #708090FF.
  */
  static get SlateGray() {
    return new k(112, 128, 144, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFAFAFF.
  */
  static get Snow() {
    return new k(255, 250, 250, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #00FF7FFF.
  */
  static get SpringGreen() {
    return new k(0, 255, 127, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #4682B4FF.
  */
  static get SteelBlue() {
    return new k(70, 130, 180, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #D2B48CFF.
  */
  static get Tan() {
    return new k(210, 180, 140, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #008080FF.
  */
  static get Teal() {
    return new k(0, 128, 128, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #D8BFD8FF.
  */
  static get Thistle() {
    return new k(216, 191, 216, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FF6347FF.
  */
  static get Tomato() {
    return new k(255, 99, 71, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #40E0D0FF.
  */
  static get Turquoise() {
    return new k(64, 224, 208, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #EE82EEFF.
  */
  static get Violet() {
    return new k(238, 130, 238, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F5DEB3FF.
  */
  static get Wheat() {
    return new k(245, 222, 179, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFFFFFF.
  */
  static get White() {
    return new k(255, 255, 255, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #F5F5F5FF.
  */
  static get WhiteSmoke() {
    return new k(245, 245, 245, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #FFFF00FF.
  */
  static get Yellow() {
    return new k(255, 255, 0, 255);
  }
  /**
   * Gets a system-defined color that has an RGBA value of #9ACD32FF.
  */
  static get YellowGreen() {
    return new k(154, 205, 50, 255);
  }
}
class Zo {
  _x;
  _y;
  /**
   * Initializes a new instance of the {@link PathLineToAbs} class.
   * @param opacity The opacity.
   */
  constructor(e, n) {
    this._x = e, this._y = n;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  draw(e) {
    e.pathLineToAbs(this._x, this._y);
  }
}
class e_ {
  _x;
  _y;
  /**
   * Initializes a new instance of the {@link PathLineToRel} class.
   * @param opacity The opacity.
   */
  constructor(e, n) {
    this._x = e, this._y = n;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  draw(e) {
    e.pathLineToRel(this._x, this._y);
  }
}
class t_ {
  _x;
  _y;
  /**
   * Initializes a new instance of the {@link IPathMoveToAbs} class.
   * @param opacity The opacity.
   */
  constructor(e, n) {
    this._x = e, this._y = n;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  draw(e) {
    e.pathMoveToAbs(this._x, this._y);
  }
}
class r_ {
  _x;
  _y;
  /**
   * Initializes a new instance of the {@link IPathMoveToAbs} class.
   * @param opacity The opacity.
   */
  constructor(e, n) {
    this._x = e, this._y = n;
  }
  /**
   * Gets the X coordinate.
   */
  get x() {
    return this._x;
  }
  /**
   * Gets the Y coordinate.
   */
  get y() {
    return this._y;
  }
  draw(e) {
    e.pathMoveToRel(this._x, this._y);
  }
}
class i_ {
  _drawables;
  _paths = [];
  /**
   * Initializes a new instance of the {@link Paths} class.
   */
  constructor(e) {
    this._drawables = e;
  }
  /**
   * Converts this instance to a {@link Drawables} instance.
   */
  drawables() {
    return this._drawables === void 0 ? new n_().path(this._paths) : this._drawables.path(this._paths);
  }
  /**
   * Adds a {@link PathLineToAbs} to the paths.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   */
  lineToAbs(e, n) {
    return this._paths.push(new Zo(e, n)), this;
  }
  /**
   * Adds a {@link PathLineToRel} to the paths.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   */
  lineToRel(e, n) {
    return this._paths.push(new e_(e, n)), this;
  }
  /**
   * Adds a {@link PathMoveToAbs} to the paths.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   */
  moveToAbs(e, n) {
    return this._paths.push(new t_(e, n)), this;
  }
  /**
   * Adds a {@link PathMoveToRel} to the paths.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   */
  moveToRel(e, n) {
    return this._paths.push(new r_(e, n)), this;
  }
}
class n_ {
  _drawables = [];
  /**
   * Adds a {@link DrawableAffine} to the drawables.
   * @param scaleX The X coordinate scaling element.
   * @param scaleY The Y coordinate scaling element.
   * @param shearX The X coordinate shearing element.
   * @param shearY The Y coordinate shearing element.
   * @param translateX The X coordinate of the translation element.
   * @param translateY The Y coordinate of the translation element.
   */
  affine(e = 1, n = 1, t = 0, _ = 0, g = 0, p = 0) {
    return this._drawables.push(new de(e, n, t, _, g, p)), this;
  }
  color(e, n, t) {
    return this._drawables.push(new io(e, n, t)), this;
  }
  /**
   * Adds a {@link DrawableBorderColor} to the drawables.
   * @param color The color to use.
   */
  borderColor(e) {
    return this._drawables.push(new ro(e)), this;
  }
  /**
   * Adds {@link DrawableTextAntiAlias.enabled} to the drawables.
   */
  disableTextAntiAlias() {
    return this._drawables.push(ut.disabled), this;
  }
  /**
   * Draw on the specified image.
   * @param image The image to draw on.
   */
  draw(e) {
    return e.draw(this._drawables), this;
  }
  /**
   * Adds {@link DrawableTextAntiAlias.enabled} to the drawables.
   */
  enableTextAntiAlias() {
    return this._drawables.push(ut.enabled), this;
  }
  /**
   * Adds a {@link DrawableFillColor} to the drawables.
   * @param color The color to use.
   */
  fillColor(e) {
    return this._drawables.push(new no(e)), this;
  }
  /**
   * Adds a {@link DrawableFillOpacity} to the drawables.
   * @param opacity The opacity.
   */
  fillOpacity(e) {
    return this._drawables.push(new ao(e)), this;
  }
  /**
   * Adds a {@link DrawableFillRule} to the drawables.
   * @param fillRule The rule to use when filling drawn objects.
   */
  fillRule(e) {
    return this._drawables.push(new so(e)), this;
  }
  /**
   * Adds a {@link DrawableFont} to the drawables.
   * @param font The name of the font that was registered.
   */
  font(e) {
    return this._drawables.push(new Go(e)), this;
  }
  /**
   * Adds a {@link DrawableFontPointSize} to the drawables.
   * @param pointSize The point size.
   */
  fontPointSize(e) {
    return this._drawables.push(new oo(e)), this;
  }
  /**
   * Obtain font metrics for text string given current font, pointsize, and density settings.
   * @param text The text to get the metrics for.
   * @param ignoreNewlines A value indicating whether newlines should be ignored.
   */
  fontTypeMetrics(e, n = !1) {
    return ie._create((t) => (t.read(Oo.Transparent, 1, 1), Tt._use(t, (_) => (_.draw(this._drawables), _.fontTypeMetrics(e, n)))));
  }
  /**
   * Adds a {@link DrawableGravity} to the drawables.
   * @param value The gravity to use.
   */
  gravity(e) {
    return this._drawables.push(new Fo(e)), this;
  }
  /**
   * Adds a {@link DrawableLine} to the drawables.
   * @param startX The starting X coordinate.
   * @param startY The starting Y coordinate.
   * @param endX The ending X coordinate.
   * @param endY The ending Y coordinate.
   */
  line(e, n, t, _) {
    return this._drawables.push(new Lo(e, n, t, _)), this;
  }
  /**
   * Draws a set of paths.
   * @param paths The paths to draw.
   */
  path(e) {
    return this._drawables.push(new Wo(e)), this;
  }
  paths() {
    return new i_(this);
  }
  /**
   * Adds a {@link DrawablePoint} to the drawables.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   */
  point(e, n) {
    return this._drawables.push(new Bo(e, n)), this;
  }
  /**
   * Adds a {@link DrawableRectangle} to the drawables.
   * @param upperLeftX The upper left X coordinate.
   * @param upperLeftY The upper left Y coordinate.
   * @param lowerRightX The lower right X coordinate.
   * @param lowerRightY The lower right Y coordinate.
   */
  rectangle(e, n, t, _) {
    return this._drawables.push(new No(e, n, t, _)), this;
  }
  /**
   * Adds a {@link DrawableRoundRectangle} to the drawables.
   * @param upperLeftX The upper left X coordinate.
   * @param upperLeftY The upper left Y coordinate.
   * @param lowerRightX The lower right X coordinate.
   * @param lowerRightY The lower right Y coordinate.
   * @param cornerWidth The corner width.
   * @param cornerHeight The corner height.
   */
  roundRectangle(e, n, t, _, g, p) {
    return this._drawables.push(new zo(e, n, t, _, g, p)), this;
  }
  /**
   * Adds a {@link DrawableStrokeColor} to the drawables.
   * @param color The color to use.
   */
  strokeColor(e) {
    return this._drawables.push(new $o(e)), this;
  }
  /**
   * Adds a {@link DrawableStrokeDashArray} to the drawables.
   * @param dash An array containing the dash information.
   */
  strokeDashArray(e) {
    return this._drawables.push(new Ho(e)), this;
  }
  /**
   * Adds a {@link DrawableStrokeDashOffset} to the drawables.
   * @param offset The dash offset.
   */
  strokeDashOffset(e) {
    return this._drawables.push(new Yo(e)), this;
  }
  /**
   * Adds a {@link DrawableStrokeWidth} to the drawables.
   * @param width The width.
   */
  strokeWidth(e) {
    return this._drawables.push(new Uo(e)), this;
  }
  /**
   * Adds a {@link DrawableText} to the drawables.
   * @param x The X coordinate.
   * @param y The Y coordinate.
   * @param value The text to draw.
   */
  text(e, n, t) {
    return this._drawables.push(new Jo(e, n, t)), this;
  }
  /**
   * Adds a {@link DrawableTextAlignment} to the drawables.
   * @param alignment The text alignment.
   */
  textAlignment(e) {
    return this._drawables.push(new Xo(e)), this;
  }
  /**
   * Adds a {@link DrawableTextDecoration} to the drawables.
   * @param decoration The text decoration.
   */
  textDecoration(e) {
    return this._drawables.push(new jo(e)), this;
  }
  /**
   * Adds a {@link DrawableTextInterlineSpacing} to the drawables.
   * @param spacing The spacing to use.
   */
  textInterlineSpacing(e) {
    return this._drawables.push(new Vo(e)), this;
  }
  /**
   * Adds a {@link DrawableTextInterlineSpacing} to the drawables.
   * @param spacing The spacing to use.
   */
  textInterwordSpacing(e) {
    return this._drawables.push(new qo(e)), this;
  }
  /**
   * Adds a {@link DrawableTextKerning} to the drawables.
   * @param kerning The kerning to use.
   */
  textKerning(e) {
    return this._drawables.push(new Ko(e)), this;
  }
  /**
   * Adds a {@link DrawableTextUnderColor} to the drawables.
   * @param color The color to use.
   */
  textUnderColor(e) {
    return this._drawables.push(new Qo(e)), this;
  }
}
const d_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Kapur.
   */
  Kapur: 1,
  /**
   * OTSU.
   */
  OTSU: 2,
  /**
   * Triangle.
   */
  Triangle: 3
}, f_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Direct.
   */
  Direct: 1,
  /**
   * Pseudo.
   */
  Pseudo: 2
}, p_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Bilevel.
   */
  Bilevel: 1,
  /**
   * Grayscale.
   */
  Grayscale: 2,
  /**
   * Grayscale alpha.
   */
  GrayscaleAlpha: 3,
  /**
   * Palette.
   */
  Palette: 4,
  /**
   * Palette alpha.
   */
  PaletteAlpha: 5,
  /**
   * Truecolor.
   */
  TrueColor: 6,
  /**
   * Truecolor alpha.
   */
  TrueColorAlpha: 7,
  /**
   * Color separation.
   */
  ColorSeparation: 8,
  /**
   * Color separation alpha.
   */
  ColorSeparationAlpha: 9,
  /**
   * Optimize.
   */
  Optimize: 10,
  /**
   * Palette bilevel alpha.
   */
  PaletteBilevelAlpha: 11
}, m_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Add.
   */
  Add: 1,
  /**
   * Conjugate.
   */
  Conjugate: 2,
  /**
   * Divide.
   */
  Divide: 3,
  /**
   * Magnitude phase.
   */
  MagnitudePhase: 4,
  /**
   * Multiply.
   */
  Multiply: 5,
  /**
   * Real imaginary.
   */
  RealImaginary: 6,
  /**
   * Subtract.
   */
  Subtract: 7
}, a_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * B44A.
   */
  B44A: 1,
  /**
   * B44.
   */
  B44: 2,
  /**
   * BZip.
   */
  BZip: 3,
  /**
   * DXT1.
   */
  DXT1: 4,
  /**
   * DXT3.
   */
  DXT3: 5,
  /**
   * DXT5.
   */
  DXT5: 6,
  /**
   * Fax.
   */
  Fax: 7,
  /**
   * Group4.
   */
  Group4: 8,
  /**
   * JBIG1.
   */
  JBIG1: 9,
  /**
   * JBIG2.
   */
  JBIG2: 10,
  /**
   * JPEG2000.
   */
  JPEG2000: 11,
  /**
   * JPEG.
   */
  JPEG: 12,
  /**
   * Lossless JPEG.
   */
  LosslessJPEG: 13,
  /**
   * LZMA.
   */
  LZMA: 14,
  /**
   * LZW.
   */
  LZW: 15,
  /**
   * No compression.
   */
  NoCompression: 16,
  /**
   * Piz.
   */
  Piz: 17,
  /**
   * Pxr24.
   */
  Pxr24: 18,
  /**
   * RLE.
   */
  RLE: 19,
  /**
   * Zip.
   */
  Zip: 20,
  /**
   * ZipS.
   */
  ZipS: 21,
  /**
   * Zstd.
   */
  Zstd: 22,
  /**
   * WebP.
   */
  WebP: 23,
  /**
   * DWAA.
   */
  DWAA: 24,
  /**
   * DWAB.
   */
  DWAB: 25,
  /**
   * BC7.
   */
  BC7: 26,
  /**
   * BC6.
   */
  BC5: 27
}, v_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Affine.
   */
  Affine: 1,
  /**
   * Affine projection.
   */
  AffineProjection: 2,
  /**
   * Scale rotate translate.
   */
  ScaleRotateTranslate: 3,
  /**
   * Perspective.
   */
  Perspective: 4,
  /**
   * Perspective projection.
   */
  PerspectiveProjection: 5,
  /**
   * Bilinear forward.
   */
  BilinearForward: 6,
  /**
   * Bilinear reverse.
   */
  BilinearReverse: 7,
  /**
   * Polynomial.
   */
  Polynomial: 8,
  /**
   * Arc.
   */
  Arc: 9,
  /**
   * Polar.
   */
  Polar: 10,
  /**
   * De-polar.
   */
  DePolar: 11,
  /**
   * Cylinder 2 plane.
   */
  Cylinder2Plane: 12,
  /**
   * Plane 2 cylinder.
   */
  Plane2Cylinder: 13,
  /**
   * Barrel.
   */
  Barrel: 14,
  /**
   * Barrel inverse.
   */
  BarrelInverse: 15,
  /**
   * Shepards.
   */
  Shepards: 16,
  /**
   * Resize.
   */
  Resize: 17,
  /**
   * Sentinel.
   */
  Sentinel: 18,
  /**
   * Rigid affine.
   */
  RigidAffine: 19
}, w_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Least significant bit, byte 0 is least significant.
   */
  LSB: 1,
  /**
   * Most significant bit, byte 0 is most significant.
   */
  MSB: 2
}, k_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Absolute.
   */
  Absolute: 1,
  /**
   * Fuzz.
   */
  Fuzz: 2,
  /**
   * Mean absolute.
   */
  MeanAbsolute: 3,
  /**
   * Mean error per pixel.
   */
  MeanErrorPerPixel: 4,
  /**
   * Mean squared.
   */
  MeanSquared: 5,
  /**
   * Normalized cross correlation.
   */
  NormalizedCrossCorrelation: 6,
  /**
   * Peak absolute.
   */
  PeakAbsolute: 7,
  /**
   * Peak signal to noise ratio.
   */
  PeakSignalToNoiseRatio: 8,
  /**
   * Perceptual hash.
   */
  PerceptualHash: 9,
  /**
   * Root mean squared.
   */
  RootMeanSquared: 10,
  /**
   * Structural similarity.
   */
  StructuralSimilarity: 11,
  /**
   * Structural dissimilarity.
   */
  StructuralDissimilarity: 12
}, M_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Abs.
   */
  Abs: 1,
  /**
   * Add.
   */
  Add: 2,
  /**
   * Add modulus.
   */
  AddModulus: 3,
  /**
   * And.
   */
  And: 4,
  /**
   * Cosine.
   */
  Cosine: 5,
  /**
   * Divide.
   */
  Divide: 6,
  /**
   * Exponential.
   */
  Exponential: 7,
  /**
   * Gaussian noise.
   */
  GaussianNoise: 8,
  /**
   * Impulse noise.
   */
  ImpulseNoise: 9,
  /**
   * Laplacian noise.
   */
  LaplacianNoise: 10,
  /**
   * Left shift.
   */
  LeftShift: 11,
  /**
   * Log.
   */
  Log: 12,
  /**
   * Max.
   */
  Max: 13,
  /**
   * Mean.
   */
  Mean: 14,
  /**
   * Median.
   */
  Median: 15,
  /**
   * Min.
   */
  Min: 16,
  /**
   * Multiplicative noise.
   */
  MultiplicativeNoise: 17,
  /**
   * Multiply.
   */
  Multiply: 18,
  /**
   * Or.
   */
  Or: 19,
  /**
   * Poisson noise.
   */
  PoissonNoise: 20,
  /**
   * Pow.
   */
  Pow: 21,
  /**
   * Right shift.
   */
  RightShift: 22,
  /**
   * Root mean square.
   */
  RootMeanSquare: 23,
  /**
   * Set.
   */
  Set: 24,
  /**
   * Sine.
   */
  Sine: 25,
  /**
   * Subtract.
   */
  Subtract: 26,
  /**
   * Sum.
   */
  Sum: 27,
  /**
   * Threshold black.
   */
  ThresholdBlack: 28,
  /**
   * Threshold.
   */
  Threshold: 29,
  /**
   * Threshold white.
   */
  ThresholdWhite: 30,
  /**
   * Uniform noise.
   */
  UniformNoise: 31,
  /**
   * Xor.
   */
  Xor: 32,
  /**
   * Inverse log.
   */
  InverseLog: 33
}, y_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Point.
   */
  Point: 1,
  /**
   * Box.
   */
  Box: 2,
  /**
   * Triangle.
   */
  Triangle: 3,
  /**
   * Hermite.
   */
  Hermite: 4,
  /**
   * Hann.
   */
  Hann: 5,
  /**
   * Hamming.
   */
  Hamming: 6,
  /**
   * Blackman.
   */
  Blackman: 7,
  /**
   * Gaussian.
   */
  Gaussian: 8,
  /**
   * Quadratic.
   */
  Quadratic: 9,
  /**
   * Cubic.
   */
  Cubic: 10,
  /**
   * Catrom.
   */
  Catrom: 11,
  /**
   * Mitchell.
   */
  Mitchell: 12,
  /**
   * Jinc.
   */
  Jinc: 13,
  /**
   * Sinc.
   */
  Sinc: 14,
  /**
   * Sinc fast.
   */
  SincFast: 15,
  /**
   * Kaiser.
   */
  Kaiser: 16,
  /**
   * Welch.
   */
  Welch: 17,
  /**
   * Parzen.
   */
  Parzen: 18,
  /**
   * Bohman.
   */
  Bohman: 19,
  /**
   * Bartlett.
   */
  Bartlett: 20,
  /**
   * Lagrange.
   */
  Lagrange: 21,
  /**
   * Lanczos.
   */
  Lanczos: 22,
  /**
   * Lanczos sharp.
   */
  LanczosSharp: 23,
  /**
   * Lanczos 2.
   */
  Lanczos2: 24,
  /**
   * Lanczos 2 sharp.
   */
  Lanczos2Sharp: 25,
  /**
   * Robidoux.
   */
  Robidoux: 26,
  /**
   * Robidoux sharp.
   */
  RobidouxSharp: 27,
  /**
   * Cosine.
   */
  Cosine: 28,
  /**
   * Spline.
   */
  Spline: 29,
  /**
   * Lanczos radius.
   */
  LanczosRadius: 30,
  /**
   * Cubic spline.
   */
  CubicSpline: 31,
  /**
   * Magic kernel sharp 2013.
   */
  MagicKernelSharp2013: 32,
  /**
   * Magic kernel sharp 2021.
   */
  MagicKernelSharp2021: 33
}, S_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * None.
   */
  None: 1,
  /**
   * Background.
   */
  Background: 2,
  /**
   * Previous.
   */
  Previous: 3
}, s_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * No interlacing.
   */
  NoInterlace: 1,
  /**
   * Line.
   */
  Line: 2,
  /**
   * Plane.
   */
  Plane: 3,
  /**
   * Partition.
   */
  Partition: 4,
  /**
   * Gif.
   */
  Gif: 5,
  /**
   * Jpeg.
   */
  Jpeg: 6,
  /**
   * Png.
   */
  Png: 7
}, C_ = {
  /**
   * Undefined.
   */
  Undefined: "Undefined",
  /**
   * Unity.
   */
  Unity: "Unity",
  /**
   * Gaussian.
   */
  Gaussian: "Gaussian",
  /**
   * DoG.
   */
  DoG: "DoG",
  /**
   * LoG.
   */
  LoG: "LoG",
  /**
   * Blur.
   */
  Blur: "Blur",
  /**
   * Comet.
   */
  Comet: "Comet",
  /**
   * Binomial.
   */
  Binomial: "Binomial",
  /**
   * Laplacian.
   */
  Laplacian: "Laplacian",
  /**
   * Sobel.
   */
  Sobel: "Sobel",
  /**
   * Frei chen.
   */
  FreiChen: "FreiChen",
  /**
   * Roberts.
   */
  Roberts: "Roberts",
  /**
   * Prewitt.
   */
  Prewitt: "Prewitt",
  /**
   * Compass.
   */
  Compass: "Compass",
  /**
   * Kirsch.
   */
  Kirsch: "Kirsch",
  /**
   * Diamond.
   */
  Diamond: "Diamond",
  /**
   * Square.
   */
  Square: "Square",
  /**
   * Rectangle.
   */
  Rectangle: "Rectangle",
  /**
   * Octagon.
   */
  Octagon: "Octagon",
  /**
   * Disk.
   */
  Disk: "Disk",
  /**
   * Plus.
   */
  Plus: "Plus",
  /**
   * Cross.
   */
  Cross: "Cross",
  /**
   * Ring.
   */
  Ring: "Ring",
  /**
   * Peaks.
   */
  Peaks: "Peaks",
  /**
   * Edges.
   */
  Edges: "Edges",
  /**
   * Corners.
   */
  Corners: "Corners",
  /**
   * Diagonals.
   */
  Diagonals: "Diagonals",
  /**
   * Line ends.
   */
  LineEnds: "LineEnds",
  /**
   * Line junctions.
   */
  LineJunctions: "LineJunctions",
  /**
   * Ridges.
   */
  Ridges: "Ridges",
  /**
   * Convex hull.
   */
  ConvexHull: "ConvexHull",
  /**
   * Thin SE.
   */
  ThinSE: "ThinSE",
  /**
   * Skeleton.
   */
  Skeleton: "Skeleton",
  /**
   * Chebyshev.
   */
  Chebyshev: "Chebyshev",
  /**
   * Manhattan.
   */
  Manhattan: "Manhattan",
  /**
   * Octagonal.
   */
  Octagonal: "Octagonal",
  /**
   * Euclidean.
   */
  Euclidean: "Euclidean",
  /**
   * User defined.
   */
  UserDefined: "UserDefined"
}, I_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Convolve.
   */
  Convolve: 1,
  /**
   * Correlate.
   */
  Correlate: 2,
  /**
   * Erode.
   */
  Erode: 3,
  /**
   * Dilate.
   */
  Dilate: 4,
  /**
   * Erode intensity.
   */
  ErodeIntensity: 5,
  /**
   * Dilate intensity.
   */
  DilateIntensity: 6,
  /**
   * Iterative distance.
   */
  IterativeDistance: 7,
  /**
   * Open.
   */
  Open: 8,
  /**
   * Close.
   */
  Close: 9,
  /**
   * Open intensity.
   */
  OpenIntensity: 10,
  /**
   * Close intensity.
   */
  CloseIntensity: 11,
  /**
   * Smooth.
   */
  Smooth: 12,
  /**
   * Edge in.
   */
  EdgeIn: 13,
  /**
   * Edge out.
   */
  EdgeOut: 14,
  /**
   * Edge.
   */
  Edge: 15,
  /**
   * Top hat.
   */
  TopHat: 16,
  /**
   * Bottom hat.
   */
  BottomHat: 17,
  /**
   * Hit and miss.
   */
  HitAndMiss: 18,
  /**
   * Thinning.
   */
  Thinning: 19,
  /**
   * Thicken.
   */
  Thicken: 20,
  /**
   * Distance.
   */
  Distance: 21,
  /**
   * Voronoi.
   */
  Voronoi: 22
}, P_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Uniform.
   */
  Uniform: 1,
  /**
   * Gaussian.
   */
  Gaussian: 2,
  /**
   * Multiplicative Gaussian.
   */
  MultiplicativeGaussian: 3,
  /**
   * Impulse.
   */
  Impulse: 4,
  /**
   * Laplacian.
   */
  Laplacian: 5,
  /**
   * Poisson.
   */
  Poisson: 6,
  /**
   * Random.
   */
  Random: 7
}, o_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Top left.
   */
  TopLeft: 1,
  /**
   * Top right.
   */
  TopRight: 2,
  /**
   * Bottom right.
   */
  BottomRight: 3,
  /**
   * Bottom left.
   */
  BottomLeft: 4,
  /**
   * Left top.
   */
  LeftTop: 5,
  /**
   * Right top.
   */
  RightTop: 6,
  /**
   * Right bottom.
   */
  RightBottom: 7,
  /**
   * Left bottom.
   */
  LeftBottom: 8
}, D_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Select the target pixel.
   */
  Point: 1,
  /**
   * Select any pixel that matches the target pixel.
   */
  Replace: 2,
  /**
   * Select the target pixel and matching neighbors.
   */
  Floodfill: 3,
  /**
   * Select the target pixel and neighbors not matching border color.
   */
  FillToBorder: 4,
  /**
   * Select all pixels.
   */
  Reset: 5
}, E_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Saturation.
   */
  Saturation: 1,
  /**
   * Perceptual.
   */
  Perceptual: 2,
  /**
   * Absolute.
   */
  Absolute: 3,
  /**
   * Relative.
   */
  Relative: 4
}, T_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Left.
   */
  Left: 1,
  /**
   * Center.
   */
  Center: 2,
  /**
   * Right.
   */
  Right: 3
}, b_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * None.
   */
  None: 1,
  /**
   * Underline.
   */
  Underline: 2,
  /**
   * Overline.
   */
  Overline: 3,
  /**
   * Line through.
   */
  LineThrough: 4
}, A_ = {
  /**
   * Undefined.
   */
  Undefined: 0,
  /**
   * Background.
   */
  Background: 1,
  /**
   * Dither.
   */
  Dither: 2,
  /**
   * Edge.
   */
  Edge: 3,
  /**
   * Mirror.
   */
  Mirror: 4,
  /**
   * Random.
   */
  Random: 5,
  /**
   * Tile.
   */
  Tile: 6,
  /**
   * Transparent.
   */
  Transparent: 7,
  /**
   * Mask.
   */
  Mask: 8,
  /**
   * Black.
   */
  Black: 9,
  /**
   * Gray.
   */
  Gray: 10,
  /**
   * White.
   */
  White: 11,
  /**
   * Horizontal tile.
   */
  HorizontalTile: 12,
  /**
   * Vertical tile.
   */
  VerticalTile: 13,
  /**
   * Horizontal tile edge.
   */
  HorizontalTileEdge: 14,
  /**
   * Vertical tile edge.
   */
  VerticalTileEdge: 15,
  /**
   * Checker tile.
   */
  CheckerTile: 16
};
var __ = /* @__PURE__ */ ((w) => (w[w.Disabled = -1] = "Disabled", w[w.Linear = 0] = "Linear", w[w.Vng = 1] = "Vng", w[w.Ppg = 2] = "Ppg", w[w.Ahd = 3] = "Ahd", w[w.DCB = 4] = "DCB", w[w.Dht = 11] = "Dht", w[w.ModifiedAhd = 12] = "ModifiedAhd", w))(__ || {}), c_ = /* @__PURE__ */ ((w) => (w[w.Raw = 0] = "Raw", w[w.SRGB = 1] = "SRGB", w[w.AdobeRGB = 2] = "AdobeRGB", w[w.WideGamutRGB = 3] = "WideGamutRGB", w[w.KodakProPhotoRGB = 4] = "KodakProPhotoRGB", w[w.XYZ = 5] = "XYZ", w[w.ACES = 6] = "ACES", w))(c_ || {});
class R_ extends to {
  constructor() {
    super(Le.Dng);
  }
  /**
   * Gets or sets a value indicating wether auto brightness should be used (dng:no-auto-bright).
   */
  disableAutoBrightness;
  /**
   * Gets or sets a value indicating the interpolation quality (dng:interpolation-quality).
   */
  interpolationQuality;
  /**
   * Gets or sets the output color (dng:output-color).
   */
  outputColor;
  /**
  * Gets or sets a value indicating wether auto whitebalance should be used (dng:use-auto-wb).
  */
  useAutoWhitebalance;
  /**
   * Gets or sets a value indicating wether the whitebalance of the camera should be used (dng:use-camera-wb).
   */
  useCameraWhitebalance;
  getDefines() {
    const e = [];
    return this.hasValue(this.interpolationQuality) && e.push(this.createDefine("interpolation-quality", this.interpolationQuality)), this.hasValue(this.disableAutoBrightness) && e.push(this.createDefine("no-auto-bright", this.disableAutoBrightness)), this.hasValue(this.outputColor) && e.push(this.createDefine("output-color", this.outputColor)), this.hasValue(this.useCameraWhitebalance) && e.push(this.createDefine("use-camera-wb", this.useCameraWhitebalance)), this.hasValue(this.useAutoWhitebalance) && e.push(this.createDefine("use-auto-wb", this.useAutoWhitebalance)), e;
  }
}
class ci {
  _colorSpace = T.Undefined;
  _compression = a_.Undefined;
  _density = new rt(0, 0);
  _format = Le.Unknown;
  _height = 0;
  _interlace = s_.Undefined;
  _orientation = o_.Undefined;
  _quality = 0;
  _width = 0;
  get colorSpace() {
    return this._colorSpace;
  }
  get compression() {
    return this._compression;
  }
  get density() {
    return this._density;
  }
  get format() {
    return this._format;
  }
  get height() {
    return this._height;
  }
  get interlace() {
    return this._interlace;
  }
  get orientation() {
    return this._orientation;
  }
  get quality() {
    return this._quality;
  }
  get width() {
    return this._width;
  }
  constructor() {
  }
  read(e, n) {
    ie._create((t) => {
      t.ping(e, n), this._colorSpace = t.colorSpace, this._compression = t.compression, this._density = t.density, this._format = t.format, this._height = t.height, this._interlace = t.interlace, this._orientation = t.orientation, this._quality = t.quality, this._width = t.width;
    });
  }
  static create(e, n) {
    const t = new ci();
    return t.read(e, n), t;
  }
}
class x_ {
  /**
   * Initializes a new instance of the {@link ComplexSettings} class.
   * @param complexOperator The complex operator.
   */
  constructor(e) {
    this.complexOperator = e;
  }
  /**
   * Gets or sets the complex operator.
   */
  complexOperator;
  /**
   * Gets or sets the signal to noise ratio.
   */
  signalToNoiseRatio;
  /** @internal */
  _setArtifacts(e) {
    this.signalToNoiseRatio !== void 0 && e.setArtifact("complex:snr", this.signalToNoiseRatio);
  }
}
class G_ {
  constructor(e) {
    this.method = e;
  }
  /**
   * Gets the distortion method to use.
   */
  method;
  /**
   * Gets or sets a value indicating whether distort attempt to 'bestfit' the size of the resulting image.
   */
  bestFit = !1;
  /**
   * Gets or sets a value to scale the size of the output canvas by this amount to provide a method of
   * Zooming, and for super-sampling the results.
   */
  scale;
  /**
   * Gets or sets the viewport that directly set the output image canvas area and offest to use for the
   * resulting image, rather than use the original images canvas, or a calculated 'bestfit' canvas.
   */
  viewport;
  /** @internal */
  _setArtifacts(e) {
    this.scale !== void 0 && e.setArtifact("distort:scale", this.scale.toString()), this.viewport !== void 0 && e.setArtifact("distort:viewport", this.viewport.toString());
  }
}
class l_ extends Ke {
  constructor(e) {
    const n = c._api._MontageSettings_Create(), t = c._api._MontageSettings_Dispose;
    if (super(n, t), e.backgroundColor !== void 0 && e.backgroundColor._use((_) => {
      c._api._MontageSettings_SetBackgroundColor(this._instance, _);
    }), e.borderColor !== void 0 && e.borderColor._use((_) => {
      c._api._MontageSettings_SetBorderColor(this._instance, _);
    }), e.borderWidth !== void 0 && c._api._MontageSettings_SetBorderWidth(this._instance, e.borderWidth), e.fillColor !== void 0 && e.fillColor._use((_) => {
      c._api._MontageSettings_SetFillColor(this._instance, _);
    }), e.font !== void 0) {
      const _ = Ae._getFontFileName(e.font);
      A(_, (g) => {
        c._api._MontageSettings_SetFont(this._instance, g);
      });
    }
    e.fontPointsize !== void 0 && c._api._MontageSettings_SetFontPointsize(this._instance, e.fontPointsize), e.frameGeometry !== void 0 && A(e.frameGeometry.toString(), (_) => {
      c._api._MontageSettings_SetFrameGeometry(this._instance, _);
    }), e.geometry !== void 0 && A(e.geometry.toString(), (_) => {
      c._api._MontageSettings_SetGeometry(this._instance, _);
    }), e.gravity !== void 0 && c._api._MontageSettings_SetGravity(this._instance, e.gravity), e.shadow !== void 0 && c._api._MontageSettings_SetShadow(this._instance, e.shadow ? 1 : 0), e.strokeColor !== void 0 && e.strokeColor._use((_) => {
      c._api._MontageSettings_SetStrokeColor(this._instance, _);
    }), e.textureFileName !== void 0 && A(e.textureFileName, (_) => {
      c._api._MontageSettings_SetTextureFileName(this._instance, _);
    }), e.tileGeometry !== void 0 && A(e.tileGeometry.toString(), (_) => {
      c._api._MontageSettings_SetTileGeometry(this._instance, _);
    }), e.title !== void 0 && A(e.title, (_) => {
      c._api._MontageSettings_SetTitle(this._instance, _);
    });
  }
}
class F_ {
  /**
   * Gets or sets the color of the background that thumbnails are composed on.
   */
  backgroundColor;
  /**
   * Gets or sets the frame border color.
   */
  borderColor;
  /**
   * Gets or sets the pixels between thumbnail and surrounding frame.
   */
  borderWidth;
  /**
   * Gets or sets the fill color.
   */
  fillColor;
  /**
   * Gets or sets the label font.
   */
  font;
  /**
   * Gets or sets the font point size.
   */
  fontPointsize;
  /**
   * Gets or sets the frame geometry (width & height frame thickness).
   */
  frameGeometry;
  /**
   * Gets or sets the thumbnail width & height plus border width &amp; height.
   */
  geometry;
  /**
   * Gets or sets the thumbnail position (e.g. Southwest).
   */
  gravity;
  /**
   * Gets or sets the thumbnail label (applied to image prior to montage).
   */
  label;
  /**
   * Gets or sets a value indicating whether drop-shadows on thumbnails are enabled or disabled.
   */
  shadow;
  /**
   * Gets or sets the outline color.
   */
  strokeColor;
  /**
   * Gets or sets the background texture image.
   */
  textureFileName;
  /**
   * Gets or sets the frame geometry (width &amp; height frame thickness).
   */
  tileGeometry;
  /**
   * Gets or sets the montage title.
   */
  title;
  /**
   * Gets or sets the transparent color.
   */
  transparentColor;
  _use(e) {
    const n = new l_(this);
    return le._disposeAfterExecution(n, e);
  }
}
class L_ {
  constructor(e, n, t) {
    this.method = e, this.kernel = n, t !== void 0 && (this.kernel += `:${t}`);
  }
  /**
   * Gets or sets the channels to apply the kernel to.
   */
  channels = X.Composite;
  /**
   * Gets or sets the bias to use when the method is Convolve.
   */
  convolveBias;
  /**
   * Gets or sets the scale to use when the method is Convolve.
   */
  convolveScale;
  /**
   * Gets or sets the number of iterations.
   */
  iterations = 1;
  /**
   * Gets or sets built-in kernel.
   */
  kernel;
  /**
   * Gets or sets the morphology method.
   */
  method;
}
class W_ {
  /**
   * Initializes a new instance of the {@link Threshold} class.
   * @param minimum The minimum value of the threshold.
   * @param maximum The maximum value of the threshold (or 0 if no maximum).
   */
  constructor(e, n = 0) {
    this.minimum = e, this.maximum = n;
  }
  /**
   * Gets the minimum of this threshold.
   */
  minimum;
  /**
  * Gets the maximum of this threshold.
  */
  maximum;
  /**
   * Convert the threshold to a string.
   */
  toString() {
    return this.maximum === 0 ? this.minimum.toString() : `${this.minimum}-${this.maximum}`;
  }
}
export {
  co as AlphaAction,
  d_ as AutoThresholdMethod,
  tt as ChannelPerceptualHash,
  To as ChannelStatistics,
  X as Channels,
  lo as ChromaticityInfo,
  f_ as ClassType,
  go as ColorProfile,
  T as ColorSpace,
  Or as ColorSpaceNames,
  Zr as ColorTransformMode,
  p_ as ColorType,
  or as CompareResult,
  fo as CompareSettings,
  m_ as ComplexOperator,
  x_ as ComplexSettings,
  tr as CompositeOperator,
  a_ as CompressionMethod,
  Qr as ConfigurationFile,
  ar as ConfigurationFiles,
  _r as ConnectedComponent,
  mo as ConnectedComponentsSettings,
  to as DefinesCreator,
  rt as Density,
  Ve as DensityUnit,
  v_ as DistortMethod,
  G_ as DistortSettings,
  _i as DitherMethod,
  __ as DngInterpolation,
  c_ as DngOutputColor,
  R_ as DngReadDefines,
  de as DrawableAffine,
  ro as DrawableBorderColor,
  io as DrawableColor,
  no as DrawableFillColor,
  ao as DrawableFillOpacity,
  so as DrawableFillRule,
  Go as DrawableFont,
  oo as DrawableFontPointSize,
  Fo as DrawableGravity,
  Lo as DrawableLine,
  Wo as DrawablePath,
  Bo as DrawablePoint,
  No as DrawableRectangle,
  zo as DrawableRoundRectangle,
  $o as DrawableStrokeColor,
  Ho as DrawableStrokeDashArray,
  Yo as DrawableStrokeDashOffset,
  Uo as DrawableStrokeWidth,
  Jo as DrawableText,
  Xo as DrawableTextAlignment,
  ut as DrawableTextAntiAlias,
  jo as DrawableTextDecoration,
  Vo as DrawableTextInterlineSpacing,
  qo as DrawableTextInterwordSpacing,
  Ko as DrawableTextKerning,
  Qo as DrawableTextUnderColor,
  n_ as Drawables,
  Tt as DrawingWand,
  w_ as Endian,
  k_ as ErrorMetric,
  M_ as EvaluateOperator,
  So as FillRule,
  y_ as FilterType,
  S_ as GifDisposeMethod,
  O as Gravity,
  c as ImageMagick,
  ni as ImageProfile,
  s_ as Interlace,
  C_ as Kernel,
  _o as LogEvent,
  Q as LogEventTypes,
  Ae as Magick,
  k as MagickColor,
  Oo as MagickColors,
  er as MagickDefine,
  Y as MagickError,
  bt as MagickErrorInfo,
  rr as MagickErrorSeverity,
  Le as MagickFormat,
  De as MagickFormatInfo,
  ae as MagickGeometry,
  ie as MagickImage,
  ke as MagickImageCollection,
  ci as MagickImageInfo,
  be as MagickReadSettings,
  lt as MagickSettings,
  F_ as MontageSettings,
  I_ as MorphologyMethod,
  L_ as MorphologySettings,
  Ke as NativeInstance,
  P_ as NoiseType,
  Po as OffsetInfo,
  o_ as Orientation,
  D_ as PaintMethod,
  Zo as PathLineToAbs,
  e_ as PathLineToRel,
  t_ as PathMoveToAbs,
  r_ as PathMoveToRel,
  i_ as Paths,
  re as Percentage,
  Me as PerceptualHash,
  G as PixelChannel,
  it as PixelCollection,
  Do as PixelIntensityMethod,
  Eo as PixelInterpolateMethod,
  Te as Point,
  qe as PrimaryInfo,
  xo as ProgressEvent,
  nr as QuantizeSettings,
  Fe as Quantum,
  E_ as RenderingIntent,
  ur as Statistics,
  T_ as TextAlignment,
  b_ as TextDecoration,
  W_ as Threshold,
  cr as TypeMetric,
  A_ as VirtualPixelMethod,
  ri as WarningEvent,
  wo as _getGravityEdges,
  ko as _getGravityName,
  ii as _isByteArray,
  g_ as initializeImageMagick
};
