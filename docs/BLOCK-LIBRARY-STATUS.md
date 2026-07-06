# Block Library — Validation Report

Generated: 2026-07-06T07:45:04.682Z

**Hand-crafted blocks** (`data/block-library/canonical/*.json`): 14
**Legacy auto-extracted blocks** (`data/block-snippets.json`): 11

**Pass:** 25 · **Fail:** 0 · **Skipped (corrupted):** 0

Pass criteria: block scaffolds into a minimal mail wrapper, compiles via `build-mail.js` without errors, produces a dist HTML with a `<body>` containing ≥200 chars of content.

## ✓ Passed blocks

| id | section | pug size | output | build time |
|---|---|---|---|---|
| `button-primary` | cta | 157 B | 8759 B (body: 6651 B) | 1645 ms |
| `content-card` | text | 164 B | 8798 B (body: 6692 B) | 1650 ms |
| `cta-banner` | cta | 364 B | 9855 B (body: 7751 B) | 1627 ms |
| `divider-spacer` | utility | 136 B | 8312 B (body: 6204 B) | 1593 ms |
| `footer-legal` | footer | 327 B | 9213 B (body: 7107 B) | 1720 ms |
| `header-logo` | header | 228 B | 8785 B (body: 6650 B) | 1681 ms |
| `hero-image` | hero | 264 B | 8699 B (body: 6595 B) | 1601 ms |
| `hero-stack` | hero | 581 B | 10177 B (body: 8073 B) | 1638 ms |
| `paragraph` | text | 77 B | 7935 B (body: 5832 B) | 1621 ms |
| `pill-label` | text | 118 B | 8384 B (body: 6280 B) | 1609 ms |
| `social-icons` | footer | 1055 B | 10757 B (body: 8581 B) | 1618 ms |
| `store-badges` | footer | 372 B | 8954 B (body: 6848 B) | 1609 ms |
| `text-block` | text | 139 B | 8770 B (body: 6666 B) | 1660 ms |
| `two-cta-row` | cta | 502 B | 10673 B (body: 8568 B) | 1651 ms |
| `header-logo-row` | image | 1263 B | 13281 B (body: 10903 B) | 1656 ms |
| `hero-image-block` | hero | 3259 B | 24231 B (body: 21434 B) | 1723 ms |
| `plain-copy-text-card` | text | 1263 B | 13286 B (body: 10903 B) | 1684 ms |
| `single-button-cta-card` | cta | 1772 B | 17625 B (body: 15167 B) | 1624 ms |
| `social-links-row` | footer | 2259 B | 16252 B (body: 13873 B) | 1816 ms |
| `bullet-proof-list-card` | feature-list | 3392 B | 18839 B (body: 16454 B) | 1746 ms |
| `numbered-feature-stack` | feature-list | 3912 B | 23064 B (body: 20679 B) | 1715 ms |
| `store-badges-row` | footer | 4538 B | 24495 B (body: 21732 B) | 1760 ms |
| `three-promo-column-row` | feature-list | 3767 B | 21193 B (body: 18742 B) | 1806 ms |
| `legal-unsubscribe-footer` | footer | 4229 B | 22576 B (body: 20080 B) | 1794 ms |
| `dark-banner-cta-block` | hero | 1541 B | 14225 B (body: 11703 B) | 1700 ms |

## ✗ Failed blocks

_(none — all clean!)_

## ⚠ Skipped (need manual rebuild)

_(none)_

## Next steps

1. Each **passed** block can be promoted to `data/block-library/canonical/<id>.json` in the new schema. A separate script (`scripts/promote-blocks.mjs`) does that — see Phase 0 of the DnD roadmap.
2. Each **failed** block needs investigation — most likely missing surrounding helpers or unresolvable mixin reference. Reason column hints at the fix.
3. **Skipped** blocks have pug > 50 KB, meaning the original extractor captured an entire mail instead of a single section. Re-extract them by hand from their `sourceFile`.

Re-run with `node scripts/test-blocks.mjs` after any change.