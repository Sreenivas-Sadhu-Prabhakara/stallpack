'use strict';
/*
 * stallpack engine — pure reconciliation + money math.
 * Every number in the app is user-entered; this module ships ZERO external facts.
 * All money is computed in INTEGER PAISE (minor units). Rupees are display-only.
 * Dual environment: exported for `node --test`, attached to globalThis for the browser.
 */

/** Tolerance for the "matches" verdict band: ±₹1.00 (100 paise). */
const MATCH_TOLERANCE_PAISE = 100;

/** How many saved days between CSV-export reminders. */
const EXPORT_NAG_EVERY = 5;

function isInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

/** sold = carried − returned. Both must be non-negative integers, returned ≤ carried. */
function soldUnits(carried, returned) {
  if (!isInt(carried) || !isInt(returned) || carried < 0 || returned < 0 || returned > carried) {
    throw new RangeError('soldUnits: need integers 0 ≤ returned ≤ carried');
  }
  return carried - returned;
}

/** Expected takings for one line, in paise. */
function lineExpectedPaise(sold, pricePaise) {
  if (!isInt(sold) || !isInt(pricePaise) || sold < 0 || pricePaise < 0) {
    throw new RangeError('lineExpectedPaise: need non-negative integers');
  }
  return sold * pricePaise;
}

/** Expected takings for the whole day: Σ sold × price, integer paise. lines: [{sold, pricePaise}] */
function dayExpectedPaise(lines) {
  if (!Array.isArray(lines)) throw new TypeError('dayExpectedPaise: need an array');
  return lines.reduce((sum, l) => sum + lineExpectedPaise(l.sold, l.pricePaise), 0);
}

/** variance = (cash + digital) − expected. Negative = short, positive = over. */
function variancePaise(expectedPaise, cashPaise, digitalPaise) {
  if (!isInt(expectedPaise) || !isInt(cashPaise) || !isInt(digitalPaise)) {
    throw new RangeError('variancePaise: need integer paise');
  }
  return cashPaise + digitalPaise - expectedPaise;
}

/** Verdict band for a variance: 'match' | 'short' | 'over'. Arithmetic only — never an accusation. */
function varianceBand(vPaise, tolerancePaise) {
  const tol = isInt(tolerancePaise) ? tolerancePaise : MATCH_TOLERANCE_PAISE;
  if (Math.abs(vPaise) <= tol) return 'match';
  return vPaise < 0 ? 'short' : 'over';
}

/**
 * Parse a rupee string ('120.50', '35', '0.75') into integer paise.
 * Max 2 decimals; anything else (including '12.345', '', '-5', '1,200') → null.
 */
function parseRupees(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const rupees = parseInt(m[1], 10);
  const frac = m[2] === undefined ? 0 : parseInt(m[2].padEnd(2, '0'), 10);
  if (!Number.isSafeInteger(rupees * 100 + frac)) return null;
  return rupees * 100 + frac;
}

/** Indian digit grouping for a plain integer string: '123456' → '1,23,456'. */
function groupIndian(s) {
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** Western grouping: '123456' → '123,456'. */
function groupPlain(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format integer paise as money. Default: Indian grouping with ₹.
 * formatPaise(12345675) === '₹1,23,456.75'
 * symbol is display-only ('₹','$','€','£'); grouping: 'in' | 'plain'.
 */
function formatPaise(paise, symbol, grouping) {
  if (!isInt(paise)) throw new RangeError('formatPaise: need integer paise');
  const sym = symbol === undefined ? '₹' : symbol;
  const grp = grouping === undefined ? 'in' : grouping;
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = grp === 'in' ? groupIndian(rupees) : groupPlain(rupees);
  return sign + sym + grouped + '.' + frac;
}

/** A return count is valid only when it is an integer with 0 ≤ returned ≤ carried. */
function validateReturn(carried, returned) {
  return isInt(carried) && isInt(returned) && carried >= 0 && returned >= 0 && returned <= carried;
}

/** Clamp a raw returned count into [0, carried]. */
function clampReturn(carried, returned) {
  if (!isInt(carried) || carried < 0) throw new RangeError('clampReturn: bad carried');
  const r = isInt(returned) ? returned : 0;
  return Math.min(Math.max(0, r), carried);
}

/** Sell-through %, rounded to nearest integer. sellThroughPct(33, 74) === 45. */
function sellThroughPct(sold, carried) {
  if (!isInt(sold) || !isInt(carried) || carried < 0 || sold < 0 || sold > carried) {
    throw new RangeError('sellThroughPct: need integers 0 ≤ sold ≤ carried');
  }
  if (carried === 0) return 0;
  return Math.round((sold / carried) * 100);
}

/**
 * Suggested pack qty = your best day sold N at that market.
 * A simple history maximum — NOT demand forecasting. Empty history → null.
 */
function suggestedQty(soldHistory) {
  if (!Array.isArray(soldHistory) || soldHistory.length === 0) return null;
  let best = 0;
  for (const n of soldHistory) {
    if (!isInt(n) || n < 0) throw new RangeError('suggestedQty: need non-negative integers');
    if (n > best) best = n;
  }
  return best;
}

/** RFC 4180 field: quote when the value contains comma, quote, CR or LF; double inner quotes. */
function csvField(value) {
  const s = String(value === null || value === undefined ? '' : value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Join fields into one RFC 4180 row (no terminator). */
function csvRow(fields) {
  return fields.map(csvField).join(',');
}

/** Strict ISO YYYY-MM-DD check with real month lengths and leap-year handling. */
function isValidISODate(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** Days in a month, leap-aware (divisible by 4, not 100 unless 400). */
function daysInMonth(year, month) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return lengths[month - 1];
}

/** Local-date ISO string for a Date (defaults to now). */
function todayISO(d) {
  const dt = d instanceof Date ? d : new Date();
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + da;
}

const ENGINE = {
  MATCH_TOLERANCE_PAISE,
  EXPORT_NAG_EVERY,
  soldUnits,
  lineExpectedPaise,
  dayExpectedPaise,
  variancePaise,
  varianceBand,
  parseRupees,
  formatPaise,
  groupIndian,
  groupPlain,
  validateReturn,
  clampReturn,
  sellThroughPct,
  suggestedQty,
  csvField,
  csvRow,
  isValidISODate,
  daysInMonth,
  todayISO
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ENGINE;
}
if (typeof window !== 'undefined') {
  window.STALLPACK_ENGINE = ENGINE;
}
