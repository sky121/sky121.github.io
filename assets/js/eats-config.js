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
       sweepMaxCalls   hard cap on Nearby calls per search session (the
                       first call included). Default 30. Clamped to 1..200.
                       At the cap the deck ends with a plain message that
                       the search stopped at its limit.
       sweepRefillAt   fetch more when fewer than this many un-swiped cards
                       remain behind the current one. Default 6. Clamped to
                       1..50. Lower = fewer calls wasted on people who stop
                       early; higher = less chance of waiting at the end.
     Worst case spend per search session = sweepMaxCalls calls (30 default).

   !!! READ BEFORE PASTING A KEY HERE !!!
   A browser Maps key is PUBLIC BY DESIGN: anyone can read it from this file
   or from the network tab. It is only safe if you restrict it in the Google
   Cloud Console FIRST:
     1. Application restriction: HTTP referrers = https://sky121.github.io/*
        (add http://localhost:8000/* only on a separate dev key).
     2. API restriction: Places API (New) + Maps JavaScript API, nothing else.
     3. Quotas: cap the daily requests for those APIs at a number you are
        happy to pay for in the worst case.
     4. Billing: set a budget with email alerts on the project.
   Never use an unrestricted key here, and never reuse a key from a project
   that has other APIs enabled.
   ========================================================================== */
window.TABLEAU_CONFIG = {
  beta: true,
  visited: false,
  mapsKey: '',
  sweepRadiusM: 1500,
  sweepMaxCalls: 30,
  sweepRefillAt: 6
};
