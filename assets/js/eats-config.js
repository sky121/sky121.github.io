/* ==========================================================================
   eats-config.js — site-wide switches for Tableau. Plain script, loaded
   BEFORE eats.js (see eats.html). No logic here, only settings.

   beta
     true  = first public beta: only Find + Visited are shown. The Feed,
             Friends and Popular tabs are placeholder-data surfaces; they are
             removed from the tab bar (and the accessibility tree), the app
             opens on Find, and nothing links into them. Fully reversible.
     false = the full five-tab app (Feed opens first). NOTE: that brings back
             the placeholder Feed / Friends / Popular data, which conflicts with
             the "no demo, no sample data" rule - keep true until real data exists.

   visited
     false = the Visited tab is hidden everywhere (tab, panel, "rate this
             place" / "I ate here" prompts, "You rated this" pills, the
             landing's last-visit line, the backup reminder and export/import
             rows, and the welcome/privacy copy that mentions ratings). Use
             this until ratings can sync across devices (no database yet).
             With beta:true that leaves only Find, so the tab bar is hidden
             too. Data already saved in this browser (localStorage
             `eats-visited`) is never read, changed or deleted while hidden.
     true  = (or omitted) Visited behaves exactly as before. Fully reversible.

   mapsKey
     A site-wide Google Maps key so visitors get live restaurants without
     making their own. '' (the default, and what must be committed until you
     have one) means every visitor sees the "Connect Google" key gate first
     (there is no demo mode).
     Resolution order at runtime: a key the visitor saved in settings wins,
     else this one, else the key gate.

   sweepRadiusM / sweepMaxCalls / sweepRefillAt   (live mode only)
     The "see every restaurant nearby" sweep. Google's Nearby Search returns
     at most 20 places per call and cannot page, so Tableau starts with ONE
     call (the 20 nearest) and, as you swipe, quietly runs more calls from
     other points around you until the radius is covered. Every place is
     ordered by its distance from YOU, closest first. Each call is billed.
       sweepRadiusM    how far out the sweep goes, in metres. Default 1500
                       (about 0.9 mi). Clamped to 300..20000. A user who
                       reaches the end can extend it in steps of this size
                       up to max(5000, sweepRadiusM).
       sweepMaxCalls   cap on Nearby calls per search session (the first
                       call included). Default 6. Clamped to 1..200. At the
                       cap the deck ends with a plain message that the
                       search stopped at its limit, and offers "Keep
                       looking": each tap grants ANOTHER sweepMaxCalls
                       calls, at most 3 times. So the absolute worst case
                       per search is 6 + 3 x 6 = 24 calls (~$0.84 at the
                       estimated $0.035 a call), and only if the person
                       keeps asking.
       sweepRefillAt   fetch more when fewer than this many un-swiped cards
                       remain behind the current one. Default 6. Clamped to
                       1..50. Lower = fewer calls wasted on people who stop
                       early; higher = less chance of waiting at the end.
     Worst case spend per search session = sweepMaxCalls x 4 calls (24 by
     default), because "Keep looking" can grant three more batches.

   detailsDelayMs
     How long a card must stay in front before its Place Details (photos,
     reviews, phone: one billed call) are requested. Default 600, clamped
     0..5000. Fast swipe-throughs cost nothing; raise it to spend less.

   costSearchUsd / costDetailsUsd / costPhotoUsd / dailyBudgetUsd
     The client-side SPENDING GUARD. Tableau counts every billed Google call
     this device makes (searches, details, photo loads; localStorage key
     `eats-usage`, reset each local day) and prices them with these rates.
     The rates are ESTIMATES of the site owner's own Google bill, not Google's
     real prices (check Google's pricing page and Billing reports, which are
     the source of truth). Defaults: search 0.035, details 0.025, photo 0.007
     (US dollars per call). At or over dailyBudgetUsd (default 1.00) NOTHING
     more is requested from Google on this device until tomorrow, unless the
     person taps "Raise by $1" (stored for that day). It cannot see other
     browsers or devices, so it does not replace a quota cap in the Cloud
     Console (see below). The key-validation call is counted but never blocked.

   !!! READ BEFORE PASTING A KEY HERE !!!
   A browser Maps key is PUBLIC BY DESIGN: anyone can read it from this file
   or from the network tab. It is only safe if you restrict it in the Google
   Cloud Console FIRST:
     1. Application restriction: HTTP referrers = https://sky121.github.io/*
        (add http://localhost:8000/* only on a separate dev key).
     2. API restriction: Places API (New) + Maps JavaScript API, nothing else.
     3. Quotas: cap the daily requests for those APIs at a number you are
        happy to pay for in the worst case (APIs & Services -> Places API
        (New) -> Quotas). This is the only limit that actually stops Google
        from billing you.
     4. Billing: set a budget with email alerts on the project. A budget
        alert only emails you; it does NOT stop spending.
   Never use an unrestricted key here, and never reuse a key from a project
   that has other APIs enabled.
   ========================================================================== */
window.TABLEAU_CONFIG = {
  beta: true,
  visited: false,
  mapsKey: '',
  sweepRadiusM: 1500,
  sweepMaxCalls: 6,
  sweepRefillAt: 6,
  detailsDelayMs: 600,
  costSearchUsd: 0.035,
  costDetailsUsd: 0.025,
  costPhotoUsd: 0.007,
  dailyBudgetUsd: 1.00
};
