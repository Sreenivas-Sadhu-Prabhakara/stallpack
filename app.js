'use strict';
/* stallpack — all UI logic. No inline handlers (CSP), no network (CSP blocks it anyway).
   Money math lives in data/engine.js; this file never re-derives a paise formula. */

(function () {
  const E = window.STALLPACK_ENGINE;
  const LS_KEY = 'stallpack.v1';

  /* ---------------- state ---------------- */

  const defaultState = () => ({
    settings: { symbol: '₹', grouping: 'auto', theme: 'auto' },
    markets: [],   // {id, name}
    days: [],      // {id, marketId, date, status, items:[{name, qty, pricePaise, returned, counted}], cashPaise, digitalPaise, savedAt}
    seq: 1,
    nagDismissedAt: 0 // saved-day count at which the user last exported/dismissed
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.markets) || !Array.isArray(s.days)) return defaultState();
      return Object.assign(defaultState(), s, {
        settings: Object.assign(defaultState().settings, s.settings || {})
      });
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      announce('Could not save — browser storage is full or blocked.');
    }
  }

  function nextId(prefix) {
    return prefix + (state.seq++);
  }

  /* ---------------- helpers ---------------- */

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function effGrouping() {
    const g = state.settings.grouping;
    if (g === 'in' || g === 'plain') return g;
    return state.settings.symbol === '₹' ? 'in' : 'plain';
  }

  function fmt(paise) {
    return E.formatPaise(paise, state.settings.symbol, effGrouping());
  }

  function announce(msg) {
    $('#status').textContent = msg;
  }

  function marketById(id) {
    return state.markets.find((m) => m.id === id) || null;
  }

  function savedDays() {
    return state.days.filter((d) => d.status === 'saved');
  }

  function activeDay() {
    return state.days.find((d) => d.status !== 'saved') || null;
  }

  function daysOfMarket(marketId, savedOnly) {
    return state.days
      .filter((d) => d.marketId === marketId && (!savedOnly || d.status === 'saved'))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function dayExpected(day) {
    return E.dayExpectedPaise(day.items.map((it) => ({
      sold: E.soldUnits(it.qty, it.returned === null ? it.qty : it.returned),
      pricePaise: it.pricePaise
    })));
  }

  /* ---------------- tabs ---------------- */

  const TABS = ['today', 'history', 'markets', 'settings'];
  let currentTab = 'today';

  function showTab(name) {
    currentTab = name;
    for (const t of TABS) {
      const btn = document.getElementById('tab-' + t);
      const panel = document.getElementById('panel-' + t);
      const on = t === name;
      btn.setAttribute('aria-selected', String(on));
      panel.hidden = !on;
    }
    if (name === 'today') renderToday();
    if (name === 'history') renderHistory();
    if (name === 'markets') renderMarkets();
    if (name === 'settings') renderSettings();
  }

  document.querySelector('.tabs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tab');
    if (btn) showTab(btn.dataset.tab);
  });

  /* ---------------- markets ---------------- */

  function renderMarkets() {
    const ul = $('#marketList');
    if (state.markets.length === 0) {
      ul.innerHTML = '<li><span class="hint">No markets yet — add your first one above.</span></li>';
      return;
    }
    ul.innerHTML = state.markets.map((m) => {
      const n = daysOfMarket(m.id, true).length;
      return '<li><span><strong>' + esc(m.name) + '</strong> ' +
        '<span class="market-count">· ' + n + ' saved day' + (n === 1 ? '' : 's') + '</span></span>' +
        '<button type="button" class="btn btn-danger" data-del-market="' + m.id + '">Delete</button></li>';
    }).join('');
  }

  $('#marketForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $('#marketName');
    const name = input.value.trim();
    if (!name) return;
    if (state.markets.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      announce('A market with that name already exists.');
      return;
    }
    state.markets.push({ id: nextId('m'), name });
    input.value = '';
    save();
    renderMarkets();
    announce('Market “' + name + '” added.');
  });

  $('#marketList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del-market]');
    if (!btn) return;
    const id = btn.dataset.delMarket;
    const m = marketById(id);
    if (!m) return;
    const n = state.days.filter((d) => d.marketId === id).length;
    if (n > 0) {
      if (!confirm('Delete “' + m.name + '” AND its ' + n + ' day record(s)? Export CSV first if you need them.')) return;
    } else if (!confirm('Delete market “' + m.name + '”?')) {
      return;
    }
    state.days = state.days.filter((d) => d.marketId !== id);
    state.markets = state.markets.filter((mm) => mm.id !== id);
    save();
    renderMarkets();
    announce('Market deleted.');
  });

  /* ---------------- today flow ---------------- */

  function renderToday() {
    const host = $('#todayFlow');
    const day = activeDay();
    if (!day) { renderStart(host); return; }
    if (day.status === 'packing') renderPackEditor(host, day);
    else if (day.status === 'packed') renderPacked(host, day);
    else if (day.status === 'counting') renderCounting(host, day);
    else renderSheet(host, day, false);
  }

  function renderStart(host) {
    if (state.markets.length === 0) {
      host.innerHTML = '<div class="card"><p>Start by naming the market you sell at — ' +
        'e.g. <strong>“Tuesday haat”</strong> or <strong>“Sunday craft fair”</strong>.</p>' +
        '<div class="field-row"><label for="firstMarket">Market name</label>' +
        '<input type="text" id="firstMarket" maxlength="60" placeholder="e.g. Tuesday haat">' +
        '<button type="button" class="btn btn-primary" data-act="first-market">Create market</button></div></div>';
      return;
    }
    const opts = state.markets.map((m) =>
      '<option value="' + m.id + '">' + esc(m.name) + '</option>').join('');
    const today = E.todayISO();
    host.innerHTML =
      '<div class="card">' +
      '<div class="field-row"><label for="dayMarket">Market</label><select id="dayMarket">' + opts + '</select>' +
      '<label for="dayDate">Date</label><input type="date" id="dayDate" value="' + today + '"></div>' +
      '<div class="field-row">' +
      '<button type="button" class="btn btn-primary" data-act="start-day">Start morning pack list</button>' +
      '<button type="button" class="btn btn-secondary" data-act="copy-last" hidden id="copyLastBtn">Copy last day at this market</button>' +
      '</div><p class="hint">Morning: list item, quantity carried and unit price. Evening: count what came back — sold, expected takings and variance fall out.</p></div>';
    updateCopyLast();
  }

  function updateCopyLast() {
    const sel = $('#dayMarket');
    const btn = $('#copyLastBtn');
    if (!sel || !btn) return;
    const prev = daysOfMarket(sel.value, true);
    btn.hidden = prev.length === 0;
    if (prev.length) btn.textContent = 'Copy last day at this market (' + prev[0].date + ')';
  }

  function startDay(copyLast) {
    const marketId = $('#dayMarket').value;
    const date = $('#dayDate').value;
    if (!marketId) { announce('Pick a market first.'); return; }
    if (!E.isValidISODate(date)) { announce('Enter a valid date (YYYY-MM-DD).'); return; }
    let items = [];
    if (copyLast) {
      const prev = daysOfMarket(marketId, true)[0];
      if (prev) {
        items = prev.items.map((it) => ({
          name: it.name, qty: it.qty, pricePaise: it.pricePaise, returned: null, counted: false
        }));
      }
    }
    state.days.push({
      id: nextId('d'), marketId, date, status: 'packing',
      items, cashPaise: null, digitalPaise: null, savedAt: null
    });
    save();
    renderToday();
    announce(copyLast ? 'Pack list copied from your last day at this market — adjust and save.' : 'New market day started.');
  }

  /* ----- pack editor (morning) ----- */

  let packDraft = null; // [{name, qtyStr, priceStr}]

  function draftFromDay(day) {
    return day.items.map((it) => ({
      name: it.name,
      qtyStr: String(it.qty),
      priceStr: (it.pricePaise / 100).toFixed(it.pricePaise % 100 === 0 ? 0 : 2)
    }));
  }

  function renderPackEditor(host, day) {
    if (!packDraft) {
      packDraft = day.items.length ? draftFromDay(day) : [{ name: '', qtyStr: '', priceStr: '' }];
    }
    const m = marketById(day.marketId);
    const rows = packDraft.map((r, i) =>
      '<tr>' +
      '<td><input type="text" class="pack-input-name" data-i="' + i + '" data-f="name" value="' + esc(r.name) + '" maxlength="80" placeholder="e.g. Glass bangles, red" aria-label="Item ' + (i + 1) + ' name"></td>' +
      '<td class="num"><input type="text" inputmode="numeric" class="pack-input-qty" data-i="' + i + '" data-f="qtyStr" value="' + esc(r.qtyStr) + '" placeholder="0" aria-label="Item ' + (i + 1) + ' quantity carried"></td>' +
      '<td class="num"><input type="text" inputmode="decimal" class="pack-input-price" data-i="' + i + '" data-f="priceStr" value="' + esc(r.priceStr) + '" placeholder="0.00" aria-label="Item ' + (i + 1) + ' unit price"></td>' +
      '<td><button type="button" class="row-del" data-del-row="' + i + '" aria-label="Remove item ' + (i + 1) + '">✕ remove</button></td>' +
      '</tr>').join('');
    host.innerHTML =
      '<div class="card">' +
      '<p><strong>Morning pack list</strong> — ' + esc(m ? m.name : '?') + ' · <span class="num">' + esc(day.date) + '</span></p>' +
      '<div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty carried</th><th class="num">Unit price (' + esc(state.settings.symbol) + ')</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="input-error" id="packError" role="alert"></p>' +
      '<div class="field-row">' +
      '<button type="button" class="btn btn-ghost" data-act="add-row">+ Add item</button>' +
      '<button type="button" class="btn btn-primary" data-act="save-pack">Save pack list</button>' +
      '<button type="button" class="btn btn-danger" data-act="discard-day">Discard day</button>' +
      '</div>' +
      '<p class="hint">Prices take up to 2 decimals. Quantities are whole units.</p></div>';
  }

  function readPackDraft() {
    const errs = [];
    const items = [];
    packDraft.forEach((r, i) => {
      const name = r.name.trim();
      if (!name && !r.qtyStr.trim() && !r.priceStr.trim()) return; // fully blank row: skip
      const qty = /^\d+$/.test(r.qtyStr.trim()) ? parseInt(r.qtyStr.trim(), 10) : NaN;
      const price = E.parseRupees(r.priceStr.trim());
      if (!name) errs.push('Row ' + (i + 1) + ': item name is required.');
      if (!Number.isInteger(qty) || qty < 1 || qty > 9999) errs.push('Row ' + (i + 1) + ': quantity must be a whole number 1–9999.');
      if (price === null) errs.push('Row ' + (i + 1) + ': price must be a number with at most 2 decimals (e.g. 120.50).');
      if (errs.length === 0) items.push({ name, qty, pricePaise: price, returned: null, counted: false });
    });
    return { errs, items };
  }

  function savePack(day) {
    const { errs, items } = readPackDraft();
    if (items.length === 0 && errs.length === 0) errs.push('Add at least one item.');
    if (errs.length) { $('#packError').textContent = errs[0]; return; }
    day.items = items;
    day.status = 'packed';
    packDraft = null;
    save();
    renderToday();
    announce('Pack list saved — ' + items.length + ' item(s). Print the checklist while loading, count back in the evening.');
  }

  /* ----- packed (between counts) ----- */

  function renderPacked(host, day) {
    const m = marketById(day.marketId);
    const rows = day.items.map((it) =>
      '<tr><td>' + esc(it.name) + '</td><td class="num">' + it.qty + '</td><td class="num">' + fmt(it.pricePaise) + '</td></tr>').join('');
    host.innerHTML =
      '<div class="card">' +
      '<p><strong>Packed for ' + esc(m ? m.name : '?') + '</strong> · <span class="num">' + esc(day.date) + '</span> · ' + day.items.length + ' item(s)</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty carried</th><th class="num">Unit price</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="field-row">' +
      '<button type="button" class="btn btn-secondary" data-act="print-pack">Print pack checklist</button>' +
      '<button type="button" class="btn btn-ghost" data-act="edit-pack">Edit pack list</button>' +
      '<button type="button" class="btn btn-primary" data-act="start-count">Start evening return count</button>' +
      '<button type="button" class="btn btn-danger" data-act="discard-day">Discard day</button>' +
      '</div></div>';
  }

  /* ----- return count (evening) ----- */

  function renderCounting(host, day) {
    const counted = day.items.filter((it) => it.counted).length;
    const total = day.items.length;
    const pct = total ? Math.round((counted / total) * 100) : 0;
    const rows = day.items.map((it, i) => {
      const shown = it.returned === null ? it.qty : it.returned;
      const status = it.counted
        ? '<span class="counted-tick">✓ counted</span>'
        : '<span class="uncounted-note">untouched → returned = carried</span>';
      return '<div class="count-item">' +
        '<div><div class="count-name">' + esc(it.name) + '</div>' +
        '<div class="count-meta">carried <span class="num">' + it.qty + '</span> · ' + fmt(it.pricePaise) + ' each · ' + status + '</div></div>' +
        '<div class="count-controls">' +
        '<button type="button" class="stepper" data-step="-1" data-i="' + i + '" aria-label="Decrease returned count for ' + esc(it.name) + '"' + (shown <= 0 ? ' disabled' : '') + '>−</button>' +
        '<span class="count-value" aria-live="off"><span class="num">' + shown + '</span> <span class="of">/ ' + it.qty + ' back</span></span>' +
        '<button type="button" class="stepper" data-step="1" data-i="' + i + '" aria-label="Increase returned count for ' + esc(it.name) + '"' + (shown >= it.qty ? ' disabled' : '') + '>+</button>' +
        '<button type="button" class="btn btn-secondary" data-soldout="' + i + '">Sold out</button>' +
        '<button type="button" class="btn btn-ghost" data-allback="' + i + '"' + (it.counted && shown === it.qty ? ' disabled' : '') + '>All back</button>' +
        '</div></div>';
    }).join('');
    const m = marketById(day.marketId);
    host.innerHTML =
      '<div class="card">' +
      '<p><strong>Evening return count</strong> — ' + esc(m ? m.name : '?') + ' · <span class="num">' + esc(day.date) + '</span></p>' +
      '<div class="progress-strip"><span class="num">' + counted + ' / ' + total + ' counted</span>' +
      '<div class="progress-bar" role="progressbar" aria-valuenow="' + counted + '" aria-valuemin="0" aria-valuemax="' + total + '" aria-label="Items counted">' +
      '<div class="progress-fill" style="width:' + pct + '%"></div></div></div>' +
      rows +
      '<div class="field-row">' +
      '<button type="button" class="btn btn-primary" data-act="finish-count">Finish count → day sheet</button>' +
      '<button type="button" class="btn btn-ghost" data-act="back-to-packed">Back</button>' +
      '</div>' +
      '<p class="hint">Untouched items are counted conservatively as fully returned (0 sold). “Sold out” sets returned to 0 in one tap.</p></div>';
  }

  function stepReturn(day, i, delta) {
    const it = day.items[i];
    const cur = it.returned === null ? it.qty : it.returned;
    const next = E.clampReturn(it.qty, cur + delta);
    if (!E.validateReturn(it.qty, next)) return;
    it.returned = next;
    it.counted = true;
    save();
    renderToday();
  }

  function finishCount(day) {
    for (const it of day.items) {
      if (it.returned === null) { it.returned = it.qty; } // conservative default: all back, 0 sold
      if (!E.validateReturn(it.qty, it.returned)) { it.returned = E.clampReturn(it.qty, it.returned); }
    }
    day.status = 'counted';
    save();
    renderToday();
    announce('Count finished — enter the money you hold to see the variance.');
  }

  /* ----- day sheet ----- */

  function sheetTableHTML(day) {
    let totalCarried = 0, totalSold = 0;
    const rows = day.items.map((it) => {
      const returned = it.returned === null ? it.qty : it.returned;
      const sold = E.soldUnits(it.qty, returned);
      totalCarried += it.qty;
      totalSold += sold;
      const line = E.lineExpectedPaise(sold, it.pricePaise);
      return '<tr><td>' + esc(it.name) + '</td><td class="num">' + it.qty + '</td><td class="num">' + returned +
        '</td><td class="num">' + sold + '</td><td class="num">' + fmt(it.pricePaise) + '</td><td class="num">' + fmt(line) + '</td></tr>';
    }).join('');
    const expected = dayExpected(day);
    return '<div class="table-wrap"><table>' +
      '<thead><tr><th>Item</th><th class="num">Carried</th><th class="num">Returned</th><th class="num">Sold</th><th class="num">List price</th><th class="num">Expected</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td>Total</td><td class="num">' + totalCarried + '</td><td class="num">' + (totalCarried - totalSold) +
      '</td><td class="num">' + totalSold + '</td><td></td><td class="num">' + fmt(expected) + '</td></tr></tfoot>' +
      '</table></div>';
  }

  function verdictHTML(expected, cash, digital) {
    const v = E.variancePaise(expected, cash, digital);
    const band = E.varianceBand(v);
    const icon = band === 'match' ? '=' : band === 'short' ? '▼' : '▲';
    const word = band === 'match'
      ? 'Matches within ' + fmt(E.MATCH_TOLERANCE_PAISE)
      : band === 'short'
        ? 'Short by ' + fmt(Math.abs(v))
        : 'Over by ' + fmt(v);
    return '<div class="verdict verdict--' + band + '">' +
      '<div class="verdict-line"><span class="verdict-icon" aria-hidden="true">' + icon + '</span>' +
      '<span>' + word + ' <span class="num">(' + (v >= 0 ? '+' : '−') + fmt(Math.abs(v)).replace(/^-/, '') + ')</span></span></div>' +
      '<p class="verdict-caption">Variance is arithmetic — discounts, haggling, freebies, miscounts and loss all look the same here; this is not theft detection.</p>' +
      '</div>';
  }

  function renderSheet(host, day, readOnly) {
    const m = marketById(day.marketId);
    const expected = dayExpected(day);
    const cash = day.cashPaise;
    const digital = day.digitalPaise;
    const haveMoney = cash !== null;
    const cashStr = cash === null ? '' : (cash / 100).toFixed(2);
    const digStr = digital === null ? '' : (digital / 100).toFixed(2);
    let moneyHTML;
    if (readOnly) {
      moneyHTML = '<p><strong>Cash in box:</strong> <span class="num">' + (cash === null ? '—' : fmt(cash)) + '</span> · ' +
        '<strong>Digital (UPI/card):</strong> <span class="num">' + (digital === null ? '—' : fmt(digital)) + '</span></p>' +
        (haveMoney ? verdictHTML(expected, cash, digital === null ? 0 : digital) : '<p class="hint">No money entered for this day.</p>');
    } else {
      moneyHTML =
        '<div class="field-row"><label for="cashIn">Cash in box (' + esc(state.settings.symbol) + ')</label>' +
        '<input type="text" inputmode="decimal" id="cashIn" class="pack-input-price" value="' + esc(cashStr) + '" placeholder="0.00">' +
        '<label for="digIn">Digital payments — UPI/card, one total (' + esc(state.settings.symbol) + ')</label>' +
        '<input type="text" inputmode="decimal" id="digIn" class="pack-input-price" value="' + esc(digStr) + '" placeholder="0.00"></div>' +
        '<p class="input-error" id="moneyError" role="alert"></p>' +
        '<div id="verdictLive" aria-live="polite">' +
        (haveMoney ? verdictHTML(expected, cash, digital === null ? 0 : digital)
          : '<p class="hint">Enter the cash you hold (and any digital total) to see the variance. Blank digital counts as ' + esc(state.settings.symbol) + '0.00.</p>') +
        '</div>';
    }
    host.innerHTML =
      '<div class="card">' +
      '<p><strong>Day sheet</strong> — ' + esc(m ? m.name : '?') + ' · <span class="num">' + esc(day.date) + '</span></p>' +
      sheetTableHTML(day) +
      moneyHTML +
      '<div class="field-row">' +
      '<button type="button" class="btn btn-secondary" data-act="print-sheet" data-day="' + day.id + '">Print day sheet</button>' +
      (readOnly
        ? '<button type="button" class="btn btn-danger" data-del-day="' + day.id + '">Delete day</button>'
        : '<button type="button" class="btn btn-ghost" data-act="back-to-count">Back to count</button>' +
          '<button type="button" class="btn btn-primary" data-act="save-day">Save day</button>' +
          '<button type="button" class="btn btn-danger" data-act="discard-day">Discard day</button>') +
      '</div></div>';
  }

  function readMoney(day) {
    const cashRaw = $('#cashIn').value.trim();
    const digRaw = $('#digIn').value.trim();
    const cash = cashRaw === '' ? null : E.parseRupees(cashRaw);
    const dig = digRaw === '' ? 0 : E.parseRupees(digRaw);
    return { cashRaw, digRaw, cash, dig };
  }

  function onMoneyInput(day) {
    const { cashRaw, digRaw, cash, dig } = readMoney(day);
    const err = $('#moneyError');
    const live = $('#verdictLive');
    if ((cashRaw !== '' && cash === null) || (digRaw !== '' && dig === null)) {
      err.textContent = 'Amounts must be numbers with at most 2 decimals (e.g. 2560.00).';
      return;
    }
    err.textContent = '';
    if (cash === null) {
      live.innerHTML = '<p class="hint">Enter the cash you hold (and any digital total) to see the variance. Blank digital counts as ' + esc(state.settings.symbol) + '0.00.</p>';
      day.cashPaise = null;
      return;
    }
    day.cashPaise = cash;
    day.digitalPaise = dig;
    live.innerHTML = verdictHTML(dayExpected(day), cash, dig);
    save();
  }

  function saveDay(day) {
    const { cashRaw, cash, dig, digRaw } = readMoney(day);
    if (cashRaw === '' || cash === null || (digRaw !== '' && dig === null)) {
      $('#moneyError').textContent = 'Enter the cash in box (0 is fine) with at most 2 decimals before saving.';
      return;
    }
    day.cashPaise = cash;
    day.digitalPaise = dig;
    day.status = 'saved';
    day.savedAt = new Date().toISOString();
    save();
    renderToday();
    maybeNag();
    announce('Day saved to history.');
  }

  /* ---------------- actions (delegated) ---------------- */

  $('#todayFlow').addEventListener('click', (ev) => {
    const day = activeDay();
    const actBtn = ev.target.closest('[data-act]');
    const step = ev.target.closest('[data-step]');
    const soldout = ev.target.closest('[data-soldout]');
    const allback = ev.target.closest('[data-allback]');
    if (step && day) { stepReturn(day, parseInt(step.dataset.i, 10), parseInt(step.dataset.step, 10)); return; }
    if (soldout && day) {
      const it = day.items[parseInt(soldout.dataset.soldout, 10)];
      it.returned = 0; it.counted = true; save(); renderToday(); return;
    }
    if (allback && day) {
      const it = day.items[parseInt(allback.dataset.allback, 10)];
      it.returned = it.qty; it.counted = true; save(); renderToday(); return;
    }
    if (!actBtn) return;
    const act = actBtn.dataset.act;
    if (act === 'first-market') {
      const name = $('#firstMarket').value.trim();
      if (!name) { announce('Type a market name first.'); return; }
      state.markets.push({ id: nextId('m'), name });
      save(); renderToday(); announce('Market “' + name + '” created — now start your pack list.');
    } else if (act === 'start-day') startDay(false);
    else if (act === 'copy-last') startDay(true);
    else if (act === 'add-row') { packDraft.push({ name: '', qtyStr: '', priceStr: '' }); renderToday(); }
    else if (act === 'save-pack' && day) savePack(day);
    else if (act === 'edit-pack' && day) { day.status = 'packing'; packDraft = draftFromDay(day); save(); renderToday(); }
    else if (act === 'start-count' && day) { day.status = 'counting'; save(); renderToday(); }
    else if (act === 'back-to-packed' && day) { day.status = 'packed'; save(); renderToday(); }
    else if (act === 'finish-count' && day) finishCount(day);
    else if (act === 'back-to-count' && day) { day.status = 'counting'; save(); renderToday(); }
    else if (act === 'save-day' && day) saveDay(day);
    else if (act === 'discard-day' && day) {
      if (confirm('Discard this unsaved day? Its pack list and counts will be lost.')) {
        state.days = state.days.filter((d) => d.id !== day.id);
        packDraft = null; save(); renderToday(); announce('Day discarded.');
      }
    } else if (act === 'print-pack' && day) printPack(day);
    else if (act === 'print-sheet') {
      const d = state.days.find((dd) => dd.id === actBtn.dataset.day) || day;
      if (d) printSheet(d);
    }
  });

  $('#todayFlow').addEventListener('input', (ev) => {
    const t = ev.target;
    const day = activeDay();
    if (t.dataset && t.dataset.f && packDraft) {
      packDraft[parseInt(t.dataset.i, 10)][t.dataset.f] = t.value;
      return;
    }
    if ((t.id === 'cashIn' || t.id === 'digIn') && day) onMoneyInput(day);
  });

  $('#todayFlow').addEventListener('change', (ev) => {
    if (ev.target.id === 'dayMarket') updateCopyLast();
  });

  // pack editor row delete (delegated separately because rows re-render)
  $('#todayFlow').addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del-row]');
    if (del && packDraft) {
      packDraft.splice(parseInt(del.dataset.delRow, 10), 1);
      if (packDraft.length === 0) packDraft.push({ name: '', qtyStr: '', priceStr: '' });
      renderToday();
    }
  });

  /* ---------------- history ---------------- */

  function renderHistory() {
    const sel = $('#historyMarket');
    const opts = ['<option value="">All markets</option>'].concat(
      state.markets.map((m) => '<option value="' + m.id + '">' + esc(m.name) + '</option>'));
    const keep = sel.value;
    sel.innerHTML = opts.join('');
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
    renderHistoryBody();
  }

  function renderHistoryBody() {
    const marketId = $('#historyMarket').value;
    const host = $('#historyBody');
    const days = savedDays()
      .filter((d) => !marketId || d.marketId === marketId)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (days.length === 0) {
      host.innerHTML = '<p class="hint">No saved days ' + (marketId ? 'for this market yet.' : 'yet — finish and save a market day and it appears here.') + '</p>';
      return;
    }
    const dayItems = days.map((d) => {
      const expected = dayExpected(d);
      const cash = d.cashPaise === null ? 0 : d.cashPaise;
      const dig = d.digitalPaise === null ? 0 : d.digitalPaise;
      const v = E.variancePaise(expected, cash, dig);
      const band = d.cashPaise === null ? 'open' : E.varianceBand(v);
      const pillText = d.cashPaise === null ? 'no money entered'
        : band === 'match' ? '= match'
          : band === 'short' ? '▼ short ' + fmt(Math.abs(v))
            : '▲ over ' + fmt(v);
      const m = marketById(d.marketId);
      const rows = sheetTableHTML(d);
      return '<li><details><summary><span class="num">' + esc(d.date) + '</span> · ' + esc(m ? m.name : '?') +
        ' · expected <span class="num">' + fmt(expected) + '</span>' +
        '<span class="pill pill--' + band + '">' + pillText + '</span></summary>' +
        '<div class="day-detail">' + rows +
        '<p><strong>Cash:</strong> <span class="num">' + (d.cashPaise === null ? '—' : fmt(d.cashPaise)) + '</span> · ' +
        '<strong>Digital:</strong> <span class="num">' + (d.digitalPaise === null ? '—' : fmt(d.digitalPaise)) + '</span></p>' +
        (d.cashPaise !== null ? verdictHTML(expected, cash, dig) : '') +
        '<div class="field-row"><button type="button" class="btn btn-secondary" data-print-day="' + d.id + '">Print day sheet</button>' +
        '<button type="button" class="btn btn-danger" data-del-day="' + d.id + '">Delete day</button></div>' +
        '</div></details></li>';
    }).join('');

    let aggHTML = '';
    if (marketId) {
      aggHTML = itemAggregatesHTML(marketId);
    } else {
      aggHTML = '<p class="hint">Pick a specific market above to see per-item sell-through and the best-day pack suggestion (history compares like with like).</p>';
    }
    host.innerHTML = aggHTML + '<h3>Saved days</h3><ul class="day-list">' + dayItems + '</ul>';
  }

  function itemAggregatesHTML(marketId) {
    const days = daysOfMarket(marketId, true).slice().reverse(); // oldest → newest
    if (days.length === 0) return '';
    const agg = new Map(); // nameKey -> {name, perDay:[{date, sold, carried}]}
    for (const d of days) {
      for (const it of d.items) {
        const key = it.name.trim().toLowerCase();
        if (!agg.has(key)) agg.set(key, { name: it.name, perDay: [] });
        const returned = it.returned === null ? it.qty : it.returned;
        agg.get(key).perDay.push({ date: d.date, sold: E.soldUnits(it.qty, returned), carried: it.qty });
      }
    }
    const rows = [...agg.values()].map((a) => {
      const soldHist = a.perDay.map((p) => p.sold);
      const totSold = soldHist.reduce((s, n) => s + n, 0);
      const totCarried = a.perDay.reduce((s, p) => s + p.carried, 0);
      const st = E.sellThroughPct(totSold, totCarried);
      const best = E.suggestedQty(soldHist);
      const perDayStr = a.perDay.map((p) => '<span class="num">' + esc(p.date.slice(5)) + ':' + p.sold + '</span>').join(', ');
      return '<tr><td>' + esc(a.name) + '</td><td>' + perDayStr + '</td>' +
        '<td class="num">' + st + '%</td>' +
        '<td class="num"><span class="badge-best">best day sold ' + best + '</span></td>' +
        '<td class="num">' + best + '</td></tr>';
    }).join('');
    return '<h3>Items at this market</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Sold per day</th><th class="num">Sell-through</th><th class="num">Best day</th><th class="num">Suggested pack qty</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="hint">Suggested qty = your best day sold N at this market — a simple history lookup, not demand forecasting.</p>';
  }

  $('#historyMarket').addEventListener('change', renderHistoryBody);

  $('#historyBody').addEventListener('click', (ev) => {
    const printBtn = ev.target.closest('[data-print-day]');
    const delBtn = ev.target.closest('[data-del-day]');
    if (printBtn) {
      const d = state.days.find((dd) => dd.id === printBtn.dataset.printDay);
      if (d) printSheet(d);
    } else if (delBtn) {
      const d = state.days.find((dd) => dd.id === delBtn.dataset.delDay);
      if (d && confirm('Delete the saved day ' + d.date + '? This cannot be undone.')) {
        state.days = state.days.filter((dd) => dd.id !== d.id);
        save(); renderHistoryBody(); announce('Day deleted.');
      }
    }
  });

  /* ---------------- CSV export ---------------- */

  function csvContent() {
    const header = E.csvRow(['market', 'date', 'item', 'qty_carried', 'qty_returned', 'sold',
      'unit_price_' + (state.settings.symbol === '₹' ? 'inr' : 'units'), 'line_expected',
      'day_cash', 'day_digital', 'day_expected', 'day_variance', 'status']);
    const lines = [header];
    const sorted = state.days.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const d of sorted) {
      const m = marketById(d.marketId);
      const expected = dayExpected(d);
      const cash = d.cashPaise;
      const dig = d.digitalPaise;
      const v = cash === null ? '' : (E.variancePaise(expected, cash, dig === null ? 0 : dig) / 100).toFixed(2);
      for (const it of d.items) {
        const returned = it.returned === null ? it.qty : it.returned;
        const sold = E.soldUnits(it.qty, returned);
        lines.push(E.csvRow([
          m ? m.name : '', d.date, it.name, it.qty, returned, sold,
          (it.pricePaise / 100).toFixed(2),
          (E.lineExpectedPaise(sold, it.pricePaise) / 100).toFixed(2),
          cash === null ? '' : (cash / 100).toFixed(2),
          dig === null ? '' : (dig / 100).toFixed(2),
          (expected / 100).toFixed(2),
          v, d.status
        ]));
      }
    }
    return lines.join('\r\n') + '\r\n';
  }

  function exportCsv() {
    if (state.days.length === 0) { announce('Nothing to export yet.'); return; }
    const blob = new Blob([csvContent()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stallpack-days-' + E.todayISO() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    state.nagDismissedAt = savedDays().length;
    save();
    $('#nag').hidden = true;
    announce('CSV exported — keep it safe; it is your only backup.');
  }

  $('#exportCsv').addEventListener('click', exportCsv);
  $('#exportCsv2').addEventListener('click', exportCsv);
  $('#nagExport').addEventListener('click', exportCsv);
  $('#nagLater').addEventListener('click', () => {
    state.nagDismissedAt = savedDays().length;
    save();
    $('#nag').hidden = true;
  });

  function maybeNag() {
    const n = savedDays().length;
    if (n > 0 && n % E.EXPORT_NAG_EVERY === 0 && n > state.nagDismissedAt) {
      $('#nagText').textContent = 'You now have ' + n + ' saved market days.';
      $('#nag').hidden = false;
    }
  }

  /* ---------------- print ---------------- */

  function printAwningHeader(title, sub) {
    return '<div class="print-awning"></div><h2>' + esc(title) + '</h2><p class="print-sub">' + sub + '</p>';
  }

  function printPack(day) {
    const m = marketById(day.marketId);
    const rows = day.items.map((it) =>
      '<tr><td><span class="tick"></span></td><td>' + esc(it.name) + '</td><td class="num">' + it.qty +
      '</td><td class="num">' + fmt(it.pricePaise) + '</td></tr>').join('');
    $('#printPack').innerHTML =
      printAwningHeader('stallpack — pack checklist',
        esc(m ? m.name : '') + ' · ' + esc(day.date) + ' · tick each item while loading') +
      '<table><thead><tr><th></th><th>Item</th><th class="num">Qty to carry</th><th class="num">Unit price</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="print-note">Evening: count what came back into stallpack — sold, expected takings and variance fall out of the two counts. Data stays in your browser.</p>';
    document.body.classList.add('print-pack');
    window.print();
  }

  function printSheet(day) {
    const m = marketById(day.marketId);
    const expected = dayExpected(day);
    const cash = day.cashPaise;
    const dig = day.digitalPaise;
    const rows = day.items.map((it) => {
      const returned = it.returned === null ? it.qty : it.returned;
      const sold = E.soldUnits(it.qty, returned);
      return '<tr><td>' + esc(it.name) + '</td><td class="num">' + it.qty + '</td><td class="num">' + returned +
        '</td><td class="num">' + sold + '</td><td class="num">' + fmt(it.pricePaise) +
        '</td><td class="num">' + fmt(E.lineExpectedPaise(sold, it.pricePaise)) + '</td></tr>';
    }).join('');
    let money;
    if (cash !== null) {
      const v = E.variancePaise(expected, cash, dig === null ? 0 : dig);
      const band = E.varianceBand(v);
      const word = band === 'match' ? 'matches within ' + fmt(E.MATCH_TOLERANCE_PAISE)
        : band === 'short' ? 'SHORT by ' + fmt(Math.abs(v)) : 'OVER by ' + fmt(v);
      money = '<p><strong>Expected:</strong> <span class="num">' + fmt(expected) + '</span> · <strong>Cash:</strong> <span class="num">' + fmt(cash) +
        '</span> · <strong>Digital:</strong> <span class="num">' + fmt(dig === null ? 0 : dig) + '</span> · <strong>Variance:</strong> ' + word + '</p>' +
        '<p class="print-note">Variance is arithmetic — discounts, haggling, freebies, miscounts and loss all look the same here; this is not theft detection.</p>';
    } else {
      money = '<p><strong>Expected:</strong> <span class="num">' + fmt(expected) + '</span> · Cash in box: <span class="print-blank"></span> · Digital: <span class="print-blank"></span></p>';
    }
    $('#printSheet').innerHTML =
      printAwningHeader('stallpack — day sheet', esc(m ? m.name : '') + ' · ' + esc(day.date)) +
      '<table><thead><tr><th>Item</th><th class="num">Carried</th><th class="num">Returned</th><th class="num">Sold</th><th class="num">List price</th><th class="num">Expected</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' + money;
    document.body.classList.add('print-sheet');
    window.print();
  }

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-pack', 'print-sheet');
  });

  /* ---------------- settings ---------------- */

  function renderSettings() {
    $('#setSymbol').value = state.settings.symbol;
    $('#setGrouping').value = state.settings.grouping;
    $('#setTheme').value = state.settings.theme;
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  $('#setSymbol').addEventListener('change', (ev) => {
    state.settings.symbol = ev.target.value;
    save(); renderToday(); announce('Currency symbol updated (display only — the maths is unchanged).');
  });
  $('#setGrouping').addEventListener('change', (ev) => {
    state.settings.grouping = ev.target.value;
    save(); renderToday();
  });
  $('#setTheme').addEventListener('change', (ev) => {
    state.settings.theme = ev.target.value;
    save(); applyTheme();
  });

  $('#wipeData').addEventListener('click', () => {
    if (!confirm('Erase ALL stallpack data from this browser? Markets, days and settings will be gone. Export CSV first if you need the history.')) return;
    if (!confirm('Really erase everything? This cannot be undone.')) return;
    localStorage.removeItem(LS_KEY);
    state = defaultState();
    applyTheme();
    showTab('today');
    announce('All stallpack data erased.');
  });

  /* ---------------- boot ---------------- */

  applyTheme();
  showTab('today');
  maybeNag();
})();
