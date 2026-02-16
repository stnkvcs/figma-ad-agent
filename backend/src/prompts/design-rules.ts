/**
 * Design rules for creative ideation quality.
 *
 * Ported from the parent project's .claude/rules/ files:
 * - creative-hierarchy.md (Three Levels, Format Categories, Archetypes, Copy)
 * - design-system.md (Product Photography, Borrowed Interfaces)
 * - quality-gates.md (Concept Questions, Variety Audit)
 * - execution.md (Backgrounds, Product Scale & Positioning)
 */

export const designRules = `
## Creative Hierarchy

Every ad is built in three levels. Make a CONSCIOUS choice at each.

LEVEL 1: ANGLE (the insight)
  -> LEVEL 2: FORMAT CATEGORY (the structure)
      -> LEVEL 3: DESIGN EXECUTION (the visual treatment)

### Level 1: ANGLE
The underlying insight or tension. Sources:
- Pain point / problem
- Audience segment (parents, professionals, skeptics)
- Use case / context
- Desired outcome / failed solution they've tried
- Fear / anxiety / desire / aspiration

Example: "Parents have no time for themselves -- even 2 minutes of brushing feels like theft"

### Level 2: FORMAT CATEGORY
The structural approach. VARY THIS across ads for the same brand.

| Category | What it is |
|----------|-----------|
| Editorial | Headline + body + product (classic layout) |
| Comparison | Side-by-side, before/after, vs competitor, split outcomes |
| Social Proof | Testimonials, reviews, star ratings, expert quotes |
| PR/Media | Article snippet, news headline, Reddit post, tweet, press coverage |
| Feature Callouts | Pointers, arrows, labels, exploded view |
| Borrowed Interface | iOS notification, checklist, receipt, search, alert, app UI |
| UGC Style | Amateur photo, handwritten note, messy/authentic, "real person" energy |
| Data/Stats | Charts, numbers as hero, percentages, metrics |
| Narrative | Story sequence, journey, transformation |
| Provocation | Bold statement, controversy, pattern interrupt |

CRITICAL: If the last 2-3 ads for this brand used the same format category, you MUST pick a different one. Changing angles while keeping the same format = lazy creativity. Use read_brand_data and browse concepts-log to check.

### Level 3: DESIGN EXECUTION
Unlimited visual treatments exist within each format category. The best execution is LED BY THE ANGLE.

CRITICAL: Never default to the simplest execution. If your execution is "[format category] but basically just headline + product + body copy," push harder. Ask: "What are 5 other ways I could visualize this concept?" Pick the most unexpected one that still communicates clearly.

## Ad Archetypes

Use as sparks. Mix them. Subvert them.

| Archetype | Energy |
|-----------|--------|
| Comparison | Two realities, side by side. One wins. |
| Statistic Hook | A number that makes them stop. A claim that makes them care. |
| Borrowed Interface | Hijack familiar patterns. Notifications, alerts, app UI. |
| Provocation | Say what others won't. Make them feel something. |
| Repetition | The same thing, different. Rhythm creates emphasis. |
| Feature Explainer | Product as centerpiece, benefits orbiting. |
| Ingredient Story | Show what's in it. Imply what it replaces. |

## Copy Rules

- Short. Punchy. Opinionated.
- "Your blood is poisoned" > "Support your body's natural detox"
- Questions that sting. Statements that provoke.
- If it could be any brand's copy, rewrite it.

## Product Photography

- Context beats floating. Hands, surfaces, environments.
- Lighting is storytelling. Spotlight = drama. Soft = approachable.
- Scale play: hero-sized or detail-macro, rarely "actual size"
- The product should feel styled, not placed.
- Dynamic > static: hand holding, angled shot, product in use -- almost always better than straight-on floating. Static is acceptable only when INTENTIONAL.

## Borrowed Interfaces

- iOS notifications, checklists, chat bubbles, alerts, content warnings
- Instant recognition + pattern interrupt
- Use native styling accurately -- realism sells the concept
- Show the signal, not the system -- a search box with 4 queries works; a full browser doesn't
- Center the anchor: UI card/element centered in frame (equal margins left/right)

## Product Scale & Positioning

- Go big: make the product HUGE. Bigger is almost always better.
- Off-frame is dynamic: products bleeding off the edge creates energy.
- Create headroom: scale UP the background and reposition, rather than squishing text.
- Never squish: cramped text = adjust the image, not the typography.
- Enlarging = more flexibility: bigger image = more positioning options.
- No cut-off hands/bodies: fully visible or intentionally cropped at a natural point.
- Angled shots are easier to position: more flexible for compositions, create natural energy.

## Background Techniques

Backgrounds are often overlooked. Plan before designing.
- Gradients: linear, radial, angular
- Meshes: soft organic blends for premium feel
- Subtle patterns/textures: grain, noise, halftone, geometric
- Type as background: repeating text pattern IS the concept
- Blur effects: gaussian on shapes, glass morphism
- Two-panel/split: comparison layouts, before/after
- Full-bleed image: generated scene IS the background
Solid color backgrounds must be INTENTIONAL, not default.

## Concept Questions (Self-Check)

Before calling your ad "done," answer these honestly:
1. What's the concept in ONE sentence?
2. Would I stop scrolling?
3. Is there ONE bold move?
4. Could this be any brand? (If yes, it's not done)
5. Does every element serve the concept? (If elements compete, remove until aligned)
6. Can I GET IT in 0.5 seconds? (If paragraph reading required, simplify)
7. Have I done this concept before? (Check concepts-log via read_brand_data)

## Variety Audit

After completing an ad, verify variety against recent work for this brand:

| Element | VARY every ad |
|---------|--------------|
| Product position | Centered-bottom, left-side, right-side, top, full-bleed, off-frame, cropped |
| Product shot type | Static straight-on, hand-held, angled, in-use, close-up, environmental |
| Composition energy | Symmetrical vs asymmetrical, minimal vs dense, horizontal vs vertical flow |
| Background treatment | Solid, gradient, image, texture, split, pattern |
| Text placement | Top-left, centered, bottom, overlapping product, scattered |

If the last 2 ads share product position AND shot type, the next MUST differ.
`;
