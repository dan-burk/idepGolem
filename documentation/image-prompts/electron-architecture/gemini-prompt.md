# iDEP Desktop — Electron Architecture — Gemini image-generation prompt

Audience: both a developer and a curious, non-technical CEO. Format: 16:9 slide.
Paste the block below into Gemini's image generation.

```
Create a polished, flat-modern architecture infographic (16:9, suitable for a slide
deck) that explains how the iDEP desktop app is structured. Audience: both software
developers and a non-technical executive — technically faithful, but clean and
jargon-light. Generous white space, soft shadows, rounded rectangles, a clear
left-to-right reading flow.

LAYOUT — one large rounded container in the center labeled "Electron", spanning most
of the canvas. Inside it, two side-by-side panels:
  • LEFT panel (a confident color, e.g. deep blue), titled "Backend — system access".
  • RIGHT panel (a contrasting muted / dashed-border color, e.g. amber), titled
    "Frontend — sandboxed".

Above the container, a small cloud labeled "npm packages" with an arrow pointing down
into the Backend panel.

Below the container, a row of three small boxes labeled "Files", "APIs", and
"R / Shiny". Three arrows go from the Backend panel down to these three boxes.

A curved arrow goes from the "R / Shiny" box back up into the Frontend panel.

EXACT TEXT LABELS — use only these words, spelled exactly, invent no other text:
  "Electron", "Backend — system access", "Frontend — sandboxed", "npm packages",
  "Files", "APIs", "R / Shiny", "serves the web UI", "needs a browser".

LOGOS / ICONS — place small beside the matching label:
  • Electron logo by "Electron".
  • Node.js + Chromium logos inside the Electron container header.
  • R logo by "R / Shiny".
  • Stripe and Firebase logos inside the "npm packages" cloud.
  • A folder icon by "Files"; a plug / API icon by "APIs".

ARROWS (short labels only):
  • "npm packages" → Backend (no label).
  • Backend → "Files", Backend → "APIs", Backend → "R / Shiny" (three short arrows, no labels).
  • "R / Shiny" → Frontend, labeled "serves the web UI" with a smaller note "needs a browser".
  • A short double-headed arrow between Backend and Frontend inside the container (no label).

STYLE:
  • Flat, modern, rounded corners, a restrained 3-color palette plus neutrals.
  • Crisp, legible sans-serif. Keep ALL text short and exactly as written above —
    do not add, remove, rename, or reword any label, and invent no extra jargon.
  • The Backend panel should read as "powerful / open", the Frontend panel as
    "walled-off / restricted".
  • Beautify layout, color, and icons only — do not change any technical content.
```

## Notes
- AI image models approximate brand logos (Electron, Node.js, R, Stripe, Firebase) and
  may garble dense text — expect 2–3 generations; drop real logo PNGs on top afterward
  (PowerPoint/Figma/Canva) if exact branding matters.
- The detailed, source-of-truth version is the ASCII in `diagram.md`.
