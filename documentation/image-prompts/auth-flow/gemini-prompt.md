# iDEP Desktop — Auth Flow — Gemini image-generation prompt

Audience: both a developer and a curious, non-technical CEO. Format: 16:9 slide.
Paste the block below into Gemini's image generation.

```
Create a clean, modern flat-design infographic (16:9, suitable for a slide deck)
that explains how a desktop scientific app logs a user in and starts up.
Audience: both software developers and non-technical executives — so it should
look polished and friendly, not like a dense engineering schematic.

LAYOUT — two labeled zones side by side, connected by arrows:

LEFT ZONE, titled "YOUR COMPUTER":
  • A desktop-app icon built on Electron/Node.js — show the green Node.js
    hexagon logo. Label: "iDEP Desktop App".
  • Below it, the R programming language logo (the blue/grey "R"). Label:
    "R Analysis Engine".
  • A flow of 4 numbered steps with short labels:
      1  "Check for saved pass"
      2  "Login with Google"   (show the Google 'G' logo)
      3  "Start R + share secret key"   (show a small key icon)
      4  "Signed pass on every action"   (show a small ticket/badge icon)

RIGHT ZONE, titled "THE CLOUD":
  • A box labeled "Entitlement Service" with three short bullets:
      "Verify Google login"
      "Check subscription"   (show the Stripe logo next to this line)
      "Issue signed pass"
  • The Stripe logo and a small Google Cloud icon.

ARROWS (label them with short text):
  • From step 2 in YOUR COMPUTER across to THE CLOUD: "Google login".
  • From THE CLOUD back to YOUR COMPUTER: "Signed pass (Free / Pro)".

BOTTOM CAPTION STRIP, full width, two simple icons with one line each:
  • A cloud-key icon: "Cloud pass — proves your plan (Free or Pro)".
  • A lock icon: "Local pass — proves it's really the app talking to R".

STYLE:
  • Flat, modern, lots of white space, rounded rectangles, soft drop shadows.
  • Friendly color palette: greens, blues, a warm accent. Node.js green and
    R blue should feel native to the palette.
  • Clear, legible sans-serif text. Keep ALL text short and exactly as written
    above — do not invent extra labels or technical jargon.
  • Make the flow read left-to-right, with obvious directional arrows.
  • No code, no JSON, no cryptographic detail — keep it conceptual.
```

## Notes
- AI image models approximate brand logos (Node.js, R, Google, Stripe) and may
  garble dense text — expect 2–3 generations; drop real logo PNGs on top afterward
  (PowerPoint/Figma/Canva) if exact branding matters.
- The detailed, source-of-truth version is the ASCII in `diagram.md` and in
  `documentation/architecture/auth-and-entitlement.md` §2.
