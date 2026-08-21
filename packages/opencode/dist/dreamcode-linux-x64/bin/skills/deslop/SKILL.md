---
name: deslop
description: "Anti-slop frontend skill — reads the brief, infers design direction, ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check. Covers typography, layout, motion, accessibility, dark mode, and premium design taste. Ported from leonxlnx/taste-skill (53k★ GitHub)."
chains_with: [frontend, lint-fixer, automated-learning]
---

# /deslop — Anti-Slop Frontend Skill

> Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

---

## 0. BRIEF INFERENCE (Read the Room Before Anything Else)

Before touching code or tweaking dials, **infer what the user actually wants**.

### 0.A Read these signals first
1. **Page kind** — landing (SaaS / consumer / agency / event), portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. **Vibe words** — "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. **Reference signals** — URLs linked, screenshots pasted, products named, brands competing with.
4. **Audience** — B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio.
5. **Brand assets that already exist** — logo, color, type, photography. For redesigns, these are starting material.
6. **Quiet constraints** — accessibility-first, public-sector, regulated industries, trust-first commerce, kids' products.

### 0.B Output a one-line "Design Read" before generating
State in one line: **"Reading this as: \<page kind> for \<audience>, with a \<vibe> language, leaning toward \<design system or aesthetic family>."**

### 0.C If ambiguous, ask ONE question
Never a multi-question dump. Only when the design read genuinely diverges.

### 0.D Anti-Default Discipline
Do NOT default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900.

---

## 1. THE THREE DIALS

```
DESIGN_VARIANCE: 8    # 1 = Perfect Symmetry, 10 = Artsy Chaos
MOTION_INTENSITY: 6   # 1 = Static, 10 = Cinematic / Physics
VISUAL_DENSITY: 4     # 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data
```

### Dial Inference
| Signal | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| "minimalist / clean / calm / editorial" | 5-6 | 3-4 | 2-3 |
| "premium consumer / Apple-y / luxury" | 7-8 | 5-7 | 3-4 |
| "playful / Dribbble / Awwwards" | 9-10 | 8-10 | 3-4 |
| "trust-first / public-sector / regulated" | 3-4 | 2-3 | 4-5 |
| "redesign - preserve" | match | +1 | match |
| "redesign - overhaul" | +2 | +2 | match |

---

## 2. BRIEF → DESIGN SYSTEM MAP

### Real Design Systems (use official packages)
| Brief reads as… | Reach for |
|---|---|
| Microsoft / enterprise SaaS | `@fluentui/react-components` |
| Google / Material-flavored | `@material/web` + Material 3 |
| IBM-style B2B / enterprise | `@carbon/react` |
| GitHub-style devtool | `@primer/css` |
| Public-sector UK | `govuk-frontend` |
| Modern accessible React | `@radix-ui/themes` |
| Modern SaaS own-components | shadcn/ui (`npx shadcn@latest add ...`) |
| Tailwind-based modern SaaS | Tailwind v4 utilities + `dark:` variant |

**One system per project. Honesty rule:** install official packages, don't recreate by hand.

### Aesthetic Directions (no single package)
| Aesthetic | Implementation |
|---|---|
| Glassmorphism | `backdrop-filter`, layered borders, highlight overlays |
| Bento grids | CSS Grid with mixed cell sizes |
| Brutalism | Native CSS, monospace, raw borders |
| Editorial / magazine | Serif type, asymmetric grid, generous whitespace |
| Dark tech / hacker | Mono + accent neon, terminal motifs |
| Kinetic typography | Native CSS animations, scroll-driven animations |

---

## 3. STACK & CONVENTIONS

- **Framework:** React / Next.js. Server Components by default.
- **Styling:** Tailwind v4 (`@tailwindcss/postcss` or Vite plugin — NOT `tailwindcss` in postcss.config.js).
- **Animation:** Motion (`import { motion } from "motion/react"`) — replaces `framer-motion`.
- **Icons (priority order):** `@phosphor-icons/react`, `hugeicons-react`, `@radix-ui/react-icons`. NEVER hand-roll SVG icons.
- **Fonts:** `next/font` or self-host with `@font-face` + `font-display: swap`. NEVER Google Fonts `<link>`.
- **State:** `useState`/`useReducer` for local. Motion's `useMotionValue` for continuous values (mouse, scroll, physics). Zustand/Jotai for global. NEVER `useState` for scroll/pointer/physics.
- **Responsiveness:** `min-h-[100dvh]` not `h-screen`. CSS Grid not flex percentage math. Standard breakpoints.

---

## 4. DESIGN ENGINEERING (Bias Correction)

### 4.1 Typography
- Display/Headlines: `text-4xl md:text-6xl tracking-tighter leading-none`
- Body: `text-base leading-relaxed max-w-[65ch]`
- **Discouraged as default:** `Inter`. Pick `Geist`, `Outfit`, `Satoshi`, `Cabinet Grotesk` first.
- **Serif (discouraged as default):** Only when brief literally names a serif font, or genuinely editorial/luxury. Banned defaults: `Fraunces`, `Instrument_Serif`.
- **Italic descender clearance:** Use `leading-[1.1]` minimum + `pb-1` on italic display words.

### 4.2 Color
- Max 1 accent color. Saturation < 80%.
- **No AI-purple.** Use neutral bases (Zinc/Slate/Stone) + high-contrast accents (Emerald, Electric Blue, Deep Rose).
- **One palette per project.** Locked. Don't fluctuate warm/cool grays.
- **Premium-consumer palette ban:** No default beige/cream/brass/ochre/espresso. Rotate: Cold Luxury, Forest, Cobalt+Cream, Terracotta+Slate, pure monochrome.

### 4.3 Layout
- **Anti-center bias:** `DESIGN_VARIANCE > 4` → split screen, left-aligned, asymmetric, scroll-pinned. Not centered hero.
- **Cards only when elevation communicates hierarchy.** Otherwise use `border-t`, `divide-y`, or negative space.
- **Shape consistency lock:** ONE corner-radius scale for the whole page.
- **Hero max 2-line headline, 20-word subtext.** CTA visible without scroll.
- **Navigation: single line, max 80px height.**
- **Section-layout-repetition ban:** Once a layout family is used, it can appear at most ONCE per page. 8 sections → at least 4 different layout families.
- **Zigzag alternation cap:** Max 2 consecutive image+text split sections. 3rd = Pre-Flight Fail.
- **Eyebrow restraint:** Max 1 eyebrow per 3 sections. Count instances of `uppercase tracking`.

### 4.4 Motion
- Animate ONLY `transform` and `opacity`.
- Honor `prefers-reduced-motion` (mandatory for `MOTION_INTENSITY > 3`).
- **Motion must be motivated:** Each animation needs a reason (hierarchy, storytelling, feedback, state transition).
- **Marquee max one per page.**
- **GSAP Sticky-Stack:** `start: "top top"`, `pin: true`, `scrub: true`. See canonical skeletons.
- **GSAP Horizontal-Pan:** `start: "top top"`, `pin: true`, `scrub: 1`, `end: "+=${distance}"`.
- **Forbidden:** `window.addEventListener("scroll", ...)`, custom scrollY in React state, `requestAnimationFrame` touching React state.

### 4.5 AI Tells (Forbidden)
- Neon/outer glows by default. Use inner borders or tinted shadows.
- Pure black (`#000000`). Use off-black/zinc-950.
- Oversaturated accents.
- Custom mouse cursors.
- Pure white (`#ffffff`). Use off-white.
- Inter as default font.
- AI-purple gradients.
- "Beige + brass" premium default.
- Em-dashes inside quote text as design flourish.
- Slogans in multi-line badges.

---

## 5. PERFORMANCE & ACCESSIBILITY

- **LCP < 2.5s:** Hero image `next/image priority` or preloaded.
- **INP < 200ms:** Heavy work off main thread.
- **CLS < 0.1:** Reserve space for images, fonts, embeds.
- **Reduced motion:** Gate animations behind `prefers-reduced-motion: no-preference`.
- **Dark mode:** Design for both from start. Tailwind `dark:` variant or CSS variables. Respect `prefers-color-scheme`.
- **WCAG AA contrast:** Audit every CTA button, form input, placeholder, error text before shipping.
- **Z-index restraint:** Document scale in project constants. No arbitrary `z-50`.

---

## 6. CONTENT & COPY

- **Hero copy self-audit:** Before declaring done, re-read every visible string. Flag grammatically broken, unclear referents, AI hallucination, fake-craftsmanship.
- **Fake-precise numbers banned:** Either real data or explicitly mock. No AI-invented specs.
- **One copy register per page.**

---

## 7. PRE-FLIGHT CHECK (Mandatory Before Ship)

1. ✅ Design Read declared (Section 0.B)
2. ✅ Dials set (Section 1)
3. ✅ Design system or aesthetic chosen (Section 2)
4. ✅ One corner-radius scale; one accent color locked
5. ✅ Hero headline ≤ 2 lines, subtext ≤ 20 words, CTA visible
6. ✅ Nav single-line, ≤ 80px
7. ✅ At least 4 different layout families if ≥ 8 sections
8. ✅ No zigzag repetition > 2 consecutive
9. ✅ Eyebrow count ≤ ceil(sectionCount / 3)
10. ✅ Contrast audit on all CTAs, forms, inputs (WCAG AA)
11. ✅ Motion motivated, not gratuitous
12. ✅ `prefers-reduced-motion` honored
13. ✅ Dark mode implemented and tested
14. ✅ No AI tells (Section 4.5)
15. ✅ One font family (no serif+sans mix unless deliberate)
16. ✅ `min-h-[100dvh]` not `h-screen` on hero
17. ✅ Copy self-audit done (Section 6)
18. ✅ Dependency verification (no missing packages)

---

## 8. CANONICAL SKELETONS

### Sticky-Stack Cards
```tsx
"use client";
import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";
gsap.registerPlugin(ScrollTrigger);

export function StickyStack({ cards }: { cards: React.ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || !ref.current) return;
    const ctx = gsap.context(() => {
      const cardEls = gsap.utils.toArray<HTMLElement>(".stack-card");
      cardEls.forEach((card, i) => {
        if (i === cardEls.length - 1) return;
        ScrollTrigger.create({ trigger: card, start: "top top", endTrigger: cardEls[cardEls.length - 1], end: "top top", pin: true, pinSpacing: false });
        gsap.to(card, { scale: 0.92, opacity: 0.55, ease: "none", scrollTrigger: { trigger: cardEls[i + 1], start: "top bottom", end: "top top", scrub: true } });
      });
    }, ref);
    return () => ctx.revert();
  }, [reduce]);
  return <div ref={ref} className="relative">{cards.map((card, i) => <div key={i} className="stack-card sticky top-0 min-h-[100dvh] flex items-center justify-center">{card}</div>)}</div>;
}
```

### Horizontal Pan
```tsx
"use client";
import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";
gsap.registerPlugin(ScrollTrigger);
export function HorizontalPan({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || !wrap.current || !track.current) return;
    const ctx = gsap.context(() => {
      const distance = track.current!.scrollWidth - window.innerWidth;
      gsap.to(track.current, { x: -distance, ease: "none", scrollTrigger: { trigger: wrap.current, start: "top top", end: () => `+=${distance}`, pin: true, scrub: 1, invalidateOnRefresh: true } });
    }, wrap);
    return () => ctx.revert();
  }, [reduce]);
  return <section ref={wrap} className="relative overflow-hidden"><div ref={track} className="flex h-[100dvh] items-center">{children}</div></section>;
}
```

### Scroll-Reveal Stagger
```tsx
"use client";
import { motion, useReducedMotion } from "motion/react";
export function RevealStagger({ items }: { items: string[] }) {
  const reduce = useReducedMotion();
  return <ul className="grid gap-6">{items.map((item, i) => (
    <motion.li key={item} initial={reduce ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.6, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}>{item}</motion.li>
  ))}</ul>;
}
```

---

## 9. EXIT CRITERIA

- Design Read declared
- Dials set and consistent with output
- Pre-flight check (Section 7) — ALL items pass
- No AI tells detected
- Page works in light and dark mode
- WCAG AA contrast on all text and interactive elements
- `prefers-reduced-motion` honored
- Hero fits viewport, nav single-line, typography intentional
