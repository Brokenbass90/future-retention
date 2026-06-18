# Block Library — Validation Report

Generated: 2026-06-18T17:44:46.265Z

**Hand-crafted blocks** (`data/block-library/canonical/*.json`): 8
**Legacy auto-extracted blocks** (`data/block-snippets.json`): 15

**Pass:** 19 · **Fail:** 0 · **Skipped (corrupted):** 4

Pass criteria: block scaffolds into a minimal mail wrapper, compiles via `build-mail.js` without errors, produces a dist HTML with a `<body>` containing ≥200 chars of content.

## ✓ Passed blocks

| id | section | pug size | output | build time |
|---|---|---|---|---|
| `button-primary` | cta | 157 B | 8667 B (body: 6651 B) | 834 ms |
| `cta-banner` | cta | 364 B | 9763 B (body: 7751 B) | 826 ms |
| `divider-spacer` | utility | 136 B | 8220 B (body: 6204 B) | 574 ms |
| `header-logo` | header | 228 B | 8693 B (body: 6650 B) | 557 ms |
| `hero-stack` | hero | 581 B | 10085 B (body: 8073 B) | 563 ms |
| `paragraph` | text | 77 B | 7843 B (body: 5832 B) | 559 ms |
| `social-icons` | footer | 1055 B | 10665 B (body: 8581 B) | 652 ms |
| `text-block` | text | 139 B | 8678 B (body: 6666 B) | 558 ms |
| `header-logo-row` | image | 1263 B | 13189 B (body: 10903 B) | 584 ms |
| `hero-image-block` | hero | 3259 B | 24139 B (body: 21434 B) | 615 ms |
| `plain-copy-text-card` | text | 1263 B | 13194 B (body: 10903 B) | 582 ms |
| `single-button-cta-card` | cta | 1772 B | 17533 B (body: 15167 B) | 595 ms |
| `social-links-row` | footer | 2259 B | 16160 B (body: 13873 B) | 592 ms |
| `bullet-proof-list-card` | feature-list | 3392 B | 18747 B (body: 16454 B) | 600 ms |
| `numbered-feature-stack` | feature-list | 3912 B | 22972 B (body: 20679 B) | 610 ms |
| `store-badges-row` | footer | 4538 B | 24403 B (body: 21732 B) | 633 ms |
| `three-promo-column-row` | feature-list | 3767 B | 21101 B (body: 18742 B) | 605 ms |
| `legal-unsubscribe-footer` | footer | 4229 B | 22484 B (body: 20080 B) | 609 ms |
| `dark-banner-cta-block` | hero | 1541 B | 14133 B (body: 11703 B) | 602 ms |

## ✗ Failed blocks

_(none — all clean!)_

## ⚠ Skipped (need manual rebuild)

| id | section | pug size | reason |
|---|---|---|---|
| `hero-image-two-cta` | hero | 71064 B | pug > 50KB — needs manual rebuild |
| `switch-cta-row` | cta | 71064 B | pug > 50KB — needs manual rebuild |
| `vml-bottom-hero` | cta | 71064 B | pug > 50KB — needs manual rebuild |
| `vml-bottom-hero-fixed` | cta | 71064 B | pug > 50KB — needs manual rebuild |

## Next steps

1. Each **passed** block can be promoted to `data/block-library/canonical/<id>.json` in the new schema. A separate script (`scripts/promote-blocks.mjs`) does that — see Phase 0 of the DnD roadmap.
2. Each **failed** block needs investigation — most likely missing surrounding helpers or unresolvable mixin reference. Reason column hints at the fix.
3. **Skipped** blocks have pug > 50 KB, meaning the original extractor captured an entire mail instead of a single section. Re-extract them by hand from their `sourceFile`.

Re-run with `node scripts/test-blocks.mjs` after any change.