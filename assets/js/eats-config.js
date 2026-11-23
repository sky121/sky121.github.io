/* ==========================================================================
   eats-config.js — site-wide switches for Tableau. Plain script, loaded
   BEFORE eats.js (see eats.html). No logic here, only settings.

   beta
     true  = first public beta: only Find + Visited are shown. The Feed,
             Friends and Popular tabs are demo/sample-data surfaces; they are
             removed from the tab bar (and the accessibility tree), the app
             opens on Find, and nothing links into them. Fully reversible.
     false = the full five-tab app (Feed opens first).

   mapsKey
     A site-wide Google Maps key so visitors get live restaurants without
     making their own. '' (the default, and what must be committed until you
     have one) means demo mode, exactly as before.
     Resolution order at runtime: a key the visitor saved in settings wins,
     else this one, else demo mode.

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
  mapsKey: ''
};
