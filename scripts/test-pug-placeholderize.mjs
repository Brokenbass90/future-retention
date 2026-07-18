import assert from "node:assert/strict";
import { placeholderizePugSource, extractPugTextCandidates } from "../src/pug-placeholderize.js";

const source = `//- keep CTA out of comments
table.row
  tr
    td.wrapper
      p.title Welcome to RetKit
      p.copy Try #[b free] mode now
      a.butt-link(href="https://example.com/CTA") CTA
      p.contact Contact support at {{embedded.company_email}}.
      p.already \${{ old.block_00 }}$
`;

const refLocaleTxt = `{{Welcome to RetKit}}

{{Try @@free@@ mode now}}

{{CTA}}

{{Contact support at}} {{embedded.company_email}}{{.}}
`;

const candidates = extractPugTextCandidates(source);
assert.deepEqual(
  candidates.map((item) => item.raw),
  [
    "Welcome to RetKit",
    "Try #[b free] mode now",
    "CTA",
    "Contact support at {{embedded.company_email}}.",
  ],
  "only literal visible Pug tails should be candidates",
);

const result = placeholderizePugSource({
  pug: source,
  refLocaleTxt,
  namespace: "campaign demo",
});

assert.equal(result.anchors, 5, "text blocks around a system variable count independently");
assert.equal(result.total, 5);
assert.deepEqual(result.missed, []);
assert.match(result.pug, /p\.title \$\{\{ campaign_demo\.block_00 \}\}\$/);
assert.match(result.pug, /p\.copy \$\{\{ campaign_demo\.block_01 \}\}\$/);
assert.match(result.pug, /href="https:\/\/example\.com\/CTA"\) \$\{\{ campaign_demo\.block_02 \}\}\$/);
assert.match(
  result.pug,
  /p\.contact \$\{\{ campaign_demo\.block_03 \}\}\$ \{\{embedded\.company_email\}\}\$\{\{ campaign_demo\.block_05 \}\}\$/,
);
assert.match(result.pug, /\/\/- keep CTA out of comments/);
assert.match(result.pug, /p\.already \$\{\{ old\.block_00 \}\}\$/);

const secondPass = placeholderizePugSource({
  pug: result.pug,
  refLocaleTxt,
  namespace: "campaign demo",
});
assert.equal(secondPass.anchors, 0, "already placeholderized Pug must be idempotent");
assert.equal(secondPass.pug, result.pug);

console.log("✓ Pug placeholderize: source-safe, ordered, idempotent");
