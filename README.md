# stallpack — market stall & craft fair inventory tracker

**Pack out in the morning, count back in the evening — sold, expected cash and variance
fall out of two counts.**

stallpack is a free, dependency-free web app for weekly-haat and street-market vendors,
flea-market, craft-fair and pop-up sellers — the "craft fair inventory spreadsheet" crowd
who hand-roll the pack → sell → return loop today. It replaces the spreadsheet with two
physical counts:

1. **Morning:** list what you carry out — item, quantity, unit price.
2. **Evening:** count what came back with big +/− steppers (or one-tap "Sold out").

From those two counts the day sheet computes, in **exact integer paise**:

- **Sold** = carried − returned, per item
- **Expected takings** = Σ sold × list price
- **Variance** = (cash in box + digital payments) − expected

Live app: **https://sreenivas-sadhu-prabhakara.github.io/stallpack/**

## Features

- **Markets directory** — name recurring markets ("Tuesday haat", "Sunday craft fair");
  every day record is tagged to one market so history compares like with like.
- **Copy last day** — one tap pre-fills today's pack list from your last day at that market.
- **90-second return count** — the packed list reappears with big steppers, one-tap
  "Sold out", and a progress strip. Untouched items default conservatively to
  *returned = carried* (0 sold).
- **Day sheet** — per-item sold and expected takings, cash-in-box plus one manual
  digital-payments (UPI/card) total, and a variance verdict band.
- **Per-market history** — per-item sold-per-day, sell-through %, and a
  "best day sold N" badge used as the suggested pack quantity next time.
- **Print** — a pack checklist to tick while loading, and a printable day sheet.
- **CSV export** (RFC 4180) — the only way data leaves the app, and your only backup.
- **Money done right** — integer paise everywhere, Indian digit grouping
  (₹1,23,456.75), display-only $/€/£ option, prices validated to max 2 decimals,
  returned quantity clamped to carried.
- **Accessible** — keyboard-operable, WCAG-AA light and dark themes, no state shown by
  colour alone, reduced-motion respected.

## Privacy — your data never leaves this browser

There is no server, no account, no analytics and no network call. The page ships a strict
Content-Security-Policy with `connect-src 'none'`, so **the browser itself blocks any
attempt to send data anywhere**. Everything is stored in this browser's `localStorage`
under the key `stallpack.v1`. Clearing site data or switching devices loses history —
export CSV regularly (the app reminds you every 5 saved days).

## Quickstart

No build step, no dependencies.

```sh
git clone https://github.com/Sreenivas-Sadhu-Prabhakara/stallpack.git
cd stallpack
open index.html        # or serve statically: python3 -m http.server 8000
```

Run the self-tests (Node 20+):

```sh
node --test
```

The tests re-derive the reconciliation and money engine against hand-computed fixtures
(sold units, day expected in paise, variance, Indian digit grouping, rupee parsing,
sell-through rounding, RFC 4180 quoting, ISO/leap dates) plus a 2000-run seeded property
test of the paise identities.

## Honest limits

- The reconciliation is only as good as your two physical counts — a miscount at either
  end shows up as variance, and the app cannot tell which count was wrong.
- **Variance is pure arithmetic** (actual takings − expected at list price). Discounts,
  haggling, freebies, breakage, miscounts and theft are indistinguishable in it. The
  verdict band says so explicitly and never accuses. **This is not theft detection.**
- Expected cash assumes list prices; if you routinely haggle, expected will overstate and
  variance will run negative — that is a feature to see, not an error.
- Pack suggestions are "your best day sold N at this market" — a simple history lookup,
  **not demand forecasting**, and there is no AI anywhere in this app.
- Deliberately a two-count tool, not a POS: no per-sale entry, no expense/profit
  tracking, no barcode catalog, no payment-app integration, no multi-device sync.

## Disclaimer

stallpack is a record-keeping aid provided **"as is"**, without warranty of any kind.
It is not accounting, tax, or professional business advice, and its figures are only as
accurate as the counts and amounts you enter. Verify important numbers yourself. The
author accepts no liability for decisions made using this tool.

## License

[MIT](LICENSE) © 2026 Sreenivas Sadhu Prabhakara
