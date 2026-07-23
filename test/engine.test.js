'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../data/engine.js');

/* ---------- brief fixtures, asserted exactly ---------- */

test('soldUnits: carried − returned', () => {
  assert.equal(E.soldUnits(30, 12), 18);
  assert.equal(E.soldUnits(24, 24), 0);
  assert.equal(E.soldUnits(0, 0), 0);
});

test('lineExpectedPaise: sold × price in integer paise', () => {
  assert.equal(E.lineExpectedPaise(18, 5000), 90000);
  assert.equal(E.lineExpectedPaise(0, 3500), 0);
});

test('dayExpectedPaise: fixture [18×5000, 15×12000, 0×3500] === 270000', () => {
  const lines = [
    { sold: 18, pricePaise: 5000 },
    { sold: 15, pricePaise: 12000 },
    { sold: 0, pricePaise: 3500 }
  ];
  assert.equal(E.dayExpectedPaise(lines), 270000);
  assert.equal(E.dayExpectedPaise([]), 0);
});

test('variancePaise: expected 270000, cash 210000 + digital 46000 === -14000 (₹140.00 short)', () => {
  const v = E.variancePaise(270000, 210000, 46000);
  assert.equal(v, -14000);
  assert.equal(E.varianceBand(v), 'short');
  assert.equal(E.formatPaise(Math.abs(v)), '₹140.00');
});

test('parseRupees: valid forms and max-2-decimals rejection', () => {
  assert.equal(E.parseRupees('120.50'), 12050);
  assert.equal(E.parseRupees('35'), 3500);
  assert.equal(E.parseRupees('12.345'), null);
  assert.equal(E.parseRupees('12.5'), 1250);
  assert.equal(E.parseRupees('0'), 0);
  assert.equal(E.parseRupees(''), null);
  assert.equal(E.parseRupees('-5'), null);
  assert.equal(E.parseRupees('1,200'), null);
  assert.equal(E.parseRupees('abc'), null);
  assert.equal(E.parseRupees('12.'), null);
});

test('formatPaise: Indian digit grouping ₹1,23,456.75', () => {
  assert.equal(E.formatPaise(12345675), '₹1,23,456.75');
  assert.equal(E.formatPaise(0), '₹0.00');
  assert.equal(E.formatPaise(5000), '₹50.00');
  assert.equal(E.formatPaise(100000000), '₹10,00,000.00');
  assert.equal(E.formatPaise(-14000), '-₹140.00');
  assert.equal(E.formatPaise(12345675, '$', 'plain'), '$123,456.75');
});

test('validateReturn: returned must be an integer, ≥ 0 and ≤ carried', () => {
  assert.equal(E.validateReturn(30, 31), false); // brief fixture: rejected
  assert.equal(E.validateReturn(30, -1), false);
  assert.equal(E.validateReturn(30, 30), true);
  assert.equal(E.validateReturn(30, 0), true);
  assert.equal(E.validateReturn(30, 12.5), false);
  assert.equal(E.clampReturn(30, 31), 30);
  assert.equal(E.clampReturn(30, -4), 0);
});

test('sellThroughPct: rounds 44.59 → 45', () => {
  assert.equal(E.sellThroughPct(33, 74), 45);
  assert.equal(E.sellThroughPct(0, 10), 0);
  assert.equal(E.sellThroughPct(10, 10), 100);
  assert.equal(E.sellThroughPct(0, 0), 0);
});

test('suggestedQty: best day at that market (max of history), not forecasting', () => {
  assert.equal(E.suggestedQty([18, 22, 15]), 22);
  assert.equal(E.suggestedQty([7]), 7);
  assert.equal(E.suggestedQty([]), null);
});

test('csvField: RFC 4180 quoting', () => {
  assert.equal(E.csvField('Glass bangles, red'), '"Glass bangles, red"');
  assert.equal(E.csvField('plain'), 'plain');
  assert.equal(E.csvField('say "hi"'), '"say ""hi"""');
  assert.equal(E.csvField('line\nbreak'), '"line\nbreak"');
  assert.equal(E.csvRow(['a,b', 'c']), '"a,b",c');
});

/* ---------- engine invariants ---------- */

test('verdict bands: short / match / over with ±₹1 tolerance', () => {
  assert.equal(E.MATCH_TOLERANCE_PAISE, 100);
  assert.equal(E.varianceBand(-14000), 'short');
  assert.equal(E.varianceBand(0), 'match');
  assert.equal(E.varianceBand(100), 'match');
  assert.equal(E.varianceBand(-100), 'match');
  assert.equal(E.varianceBand(101), 'over');
  assert.equal(E.varianceBand(-101), 'short');
});

test('guards: bad inputs throw instead of returning wrong money', () => {
  assert.throws(() => E.soldUnits(30, 31), RangeError);
  assert.throws(() => E.soldUnits(3.5, 1), RangeError);
  assert.throws(() => E.lineExpectedPaise(2, 49.99), RangeError);
  assert.throws(() => E.variancePaise(100.5, 0, 0), RangeError);
  assert.throws(() => E.formatPaise(12.34), RangeError);
  assert.throws(() => E.sellThroughPct(5, 4), RangeError);
});

test('ISO dates: month-end clamp and leap-year handling', () => {
  assert.equal(E.isValidISODate('2026-07-23'), true);
  assert.equal(E.isValidISODate('2024-02-29'), true);  // leap
  assert.equal(E.isValidISODate('2025-02-29'), false); // not leap
  assert.equal(E.isValidISODate('2000-02-29'), true);  // 400 rule
  assert.equal(E.isValidISODate('1900-02-29'), false); // 100 rule
  assert.equal(E.isValidISODate('2026-04-31'), false); // April has 30
  assert.equal(E.isValidISODate('2026-13-01'), false);
  assert.equal(E.isValidISODate('2026-00-10'), false);
  assert.equal(E.isValidISODate('26-07-23'), false);
  assert.equal(E.daysInMonth(2024, 2), 29);
  assert.equal(E.daysInMonth(2026, 2), 28);
  assert.equal(E.todayISO(new Date(2026, 6, 23)), '2026-07-23');
});

/* ---------- property test: seeded random days ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('property: 2000 seeded random days keep every paise identity', () => {
  const rand = mulberry32(20260723);
  for (let run = 0; run < 2000; run++) {
    const n = 1 + Math.floor(rand() * 12);
    const lines = [];
    for (let i = 0; i < n; i++) {
      const carried = Math.floor(rand() * 200);
      const returned = E.clampReturn(carried, Math.floor(rand() * 220) - 10);
      const pricePaise = Math.floor(rand() * 500000); // up to ₹5,000.00
      assert.ok(E.validateReturn(carried, returned));
      const sold = E.soldUnits(carried, returned);
      assert.ok(sold >= 0 && sold <= carried);
      lines.push({ sold, pricePaise, carried });
    }
    const expected = E.dayExpectedPaise(lines);
    // Σ parts === total, all integer paise
    const manual = lines.reduce((s, l) => s + l.sold * l.pricePaise, 0);
    assert.equal(expected, manual);
    assert.ok(Number.isInteger(expected));
    // variance identity: expected + variance === cash + digital, exactly
    const cash = Math.floor(rand() * expected * 1.2) || 0;
    const digital = Math.floor(rand() * 100000);
    const v = E.variancePaise(expected, cash, digital);
    assert.equal(expected + v, cash + digital);
    // format → strip symbol/commas → parse round-trips every non-negative amount
    const amounts = [expected, cash, digital];
    for (const a of amounts) {
      const plain = E.formatPaise(a).replace(/[₹,]/g, '');
      assert.equal(E.parseRupees(plain), a);
    }
    // determinism: same inputs, same output
    assert.equal(E.dayExpectedPaise(lines), expected);
  }
});

test('property: Indian grouping always round-trips digits', () => {
  const rand = mulberry32(42);
  for (let i = 0; i < 500; i++) {
    const digits = String(Math.floor(rand() * 1e12));
    assert.equal(E.groupIndian(digits).replace(/,/g, ''), digits);
    assert.equal(E.groupPlain(digits).replace(/,/g, ''), digits);
    assert.ok(!/^,|,$|,,/.test(E.groupIndian(digits)));
  }
});
