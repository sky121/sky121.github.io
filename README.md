# Skylar Hoffman — Portfolio

**Live site:** [https://sky121.github.io/](https://sky121.github.io/)

A personal portfolio site with a watercolor-inspired visual design. It covers an about section, skills, experience, selected work, projects, and contact details, plus a printable one-page résumé. Your cursor leaves soft blooms of pigment as you move, and there's a dark theme that follows your system preference.

## Tech Notes

- **Hand-built, zero frameworks** — no build step, no dependencies, just HTML, CSS, and JavaScript.
- **Vanilla JS canvas painting engine** — the cursor-as-paintbrush effect is rendered on a `<canvas>` with custom blending and decay logic, loaded on the homepage and every page.
- **SVG turbulence filters** — `feTurbulence` and `feDisplacementMap` give borders and edges their hand-painted wobble.
- **Dark theme** — follows your system's `prefers-color-scheme` by default and remembers your choice in `localStorage`, applied before first paint so there's no flash.
- **Printable résumé** — `catalogue.html` is a print-friendly one-page résumé of selected work.
- **Typography** — [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) for headings and [Karla](https://fonts.google.com/specimen/Karla) for body text.
- **Extras** — Open Graph social card, SVG/ICO favicons with apple-touch icon and web manifest, and a custom 404.

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
├── index.html               # Main page (about, skills, experience, work, projects, contact)
├── catalogue.html           # Printable one-page résumé
├── assets/
│   ├── css/
│   │   ├── gallery.css      # Home page layout and components
│   │   ├── exhibit-page.css # Shared styles for the project detail pages
│   │   └── catalogue.css    # Résumé layout + print styles
│   └── js/
│       └── gallery.js       # Cursor canvas effect, dark theme, scroll reveals
├── images/                  # Project screenshots + og-card.png social card
├── Cprojects.html           # Project page: C/C++
├── PythonProjects.html      # Project page: Python
├── JavaProjects.html        # Project page: Java
├── ClassChecker.html        # Project page: Class Alert
├── SunBasket.html           # Project page: Sun Basket
├── 404.html                 # Custom 404 page
├── favicon.svg              # Monogram mark (with favicon.ico + apple-touch-icon.png)
├── site.webmanifest
├── robots.txt
└── sitemap.xml
```

## About

Skylar Hoffman — software engineer focused on AI/ML. B.S. in Computer Science from UC Irvine; M.Eng in Computer Science at Cornell University. Based in the San Francisco Bay Area.
