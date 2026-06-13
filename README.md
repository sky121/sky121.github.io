# Water Lilies — Skylar Hoffman's Portfolio

**Live site:** [https://sky121.github.io/](https://sky121.github.io/)

An interactive watercolor museum exhibit inspired by Claude Monet. Every page is a living canvas — your cursor becomes a paintbrush, blooming soft pigment as you move, following you from the main hall into each exhibit room. Projects hang as framed works on the gallery wall, each accompanied by a museum placard describing the piece, and technical skills are presented as a pigment palette: daubs of color you might find on the artist's worktable. The whole site is meant to feel less like a résumé and more like wandering a quiet wing of an impressionist exhibit — though if you want the résumé after all, the exhibition catalogue is a printable one-pager.

## Tech Notes

- **Hand-built, zero frameworks** — no build step, no dependencies, just HTML, CSS, and JavaScript.
- **Vanilla JS canvas painting engine** — the cursor-as-paintbrush effect is rendered on a `<canvas>` with custom blending and decay logic, loaded on the homepage and every exhibit page.
- **SVG turbulence watercolor filters** — `feTurbulence` and `feDisplacementMap` give frames, placards, and edges their hand-painted wobble.
- **Evening Exhibition** — a dark theme that follows your system's `prefers-color-scheme` by default and remembers your choice in `localStorage`, applied before first paint so there's no flash.
- **Printable exhibition catalogue** — `catalogue.html` is a print-friendly one-page résumé styled as a catalogue of selected works.
- **Typography** — [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) for exhibit headings and [Karla](https://fonts.google.com/specimen/Karla) for placard text.
- **Guest amenities** — Open Graph social card, SVG/ICO favicons with apple-touch icon and web manifest, and a custom 404.

## Local Development

No tooling required. Either open the site directly:

```sh
open index.html
```

or serve it locally:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

## Structure

```
.
├── index.html               # The gallery — main exhibit hall
├── catalogue.html           # Exhibition catalogue — printable one-page résumé
├── assets/
│   ├── css/
│   │   ├── gallery.css      # Gallery layout, frames, placards, palette
│   │   ├── exhibit-page.css # Shared styles for individual exhibit pages
│   │   └── catalogue.css    # Catalogue layout + print styles
│   └── js/
│       └── gallery.js       # Canvas painting engine, loaded on every exhibit page
├── images/                  # Project screenshots + og-card.png social card
├── Cprojects.html           # Exhibit: C/C++ works
├── PythonProjects.html      # Exhibit: Python studies
├── JavaProjects.html        # Exhibit: Java works
├── ClassChecker.html        # Exhibit: Class Checker
├── SunBasket.html           # Exhibit: Sun Basket
├── 404.html                 # "This painting is not on display"
├── favicon.svg              # Water lily mark (with favicon.ico + apple-touch-icon.png)
├── site.webmanifest
├── robots.txt
└── sitemap.xml
```

## About

Skylar Hoffman — software engineer focused on AI/ML. B.S. in Computer Science from UC Irvine; M.Eng in Computer Science at Cornell University. Based in the San Francisco Bay Area.
