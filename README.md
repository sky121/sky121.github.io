# Water Lilies — Skylar Hoffman's Portfolio

**Live site:** [https://sky121.github.io/](https://sky121.github.io/)

An interactive watercolor museum exhibit inspired by Claude Monet. The homepage is a living canvas — your cursor becomes a paintbrush, blooming soft pigment across the page as you move. Projects hang as framed works on the gallery wall, each accompanied by a museum placard describing the piece, and technical skills are presented as a pigment palette: daubs of color you might find on the artist's worktable. The whole site is meant to feel less like a résumé and more like wandering a quiet wing of an impressionist exhibit.

## Tech Notes

- **Hand-built, zero frameworks** — no build step, no dependencies, just HTML, CSS, and JavaScript.
- **Vanilla JS canvas painting engine** — the cursor-as-paintbrush effect is rendered on a `<canvas>` with custom blending and decay logic.
- **SVG turbulence watercolor filters** — `feTurbulence` and `feDisplacementMap` give frames, placards, and edges their hand-painted wobble.
- **Typography** — [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) for exhibit headings and [Karla](https://fonts.google.com/specimen/Karla) for placard text.

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
├── assets/
│   ├── css/
│   │   ├── gallery.css      # Gallery layout, frames, placards, palette
│   │   └── exhibit-page.css # Shared styles for individual exhibit pages
│   └── js/
│       └── gallery.js       # Canvas painting engine + gallery interactions
├── Cprojects.html           # Exhibit: C/C++ works
├── PythonProjects.html      # Exhibit: Python studies
├── JavaProjects.html        # Exhibit: Java works
├── ClassChecker.html        # Exhibit: Class Checker
├── SunBasket.html           # Exhibit: Sun Basket
├── 404.html                 # "This painting is not on display"
└── favicon.svg              # Water lily mark
```

## About

Skylar Hoffman — software engineer focused on AI/ML. B.S. in Computer Science from UC Irvine; M.Eng in Computer Science at Cornell University. Based in the San Francisco Bay Area.
