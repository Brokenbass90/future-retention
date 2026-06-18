/**
 * test-placeholder-infer.mjs — regression test for the deterministic
 * placeholder inference pass (src/placeholder-inference.js).
 *
 * Covers the three placement bugs fixed in 2026-06:
 *   1. Distinct values of one category must get distinct tokens (no collision).
 *   2. Generic salutations ("Dear Customer") must NOT become user_name.
 *   3. A literal repeated across the email is tokenized in ALL positions.
 *
 * Zero-AI, no network — runnable any time. Exit 0 = pass.
 */
import { inferPlaceholders, applyPlaceholderProposals } from "../src/placeholder-inference.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("✓", name); }
  else { fail++; console.log("✗ FAIL", name); }
}

// 1) Collision: two distinct amounts must get distinct tokens.
const r1 = inferPlaceholders("<p>Deposit $100 today and get a $500 bonus.</p>", { mailNamespace: "promo" });
const amts = r1.proposals.filter((p) => p.category === "amount").map((p) => p.suggested);
check("two distinct amounts -> two distinct tokens", new Set(amts).size === amts.length && amts.length === 2);

// 2) Generic greeting must NOT be a user_name; a real name must be.
check("'Dear Customer' is NOT user_name",
  !inferPlaceholders("<p>Dear Customer, welcome!</p>").proposals.some((p) => p.category === "user_name"));
check("'Dear Maria' IS user_name",
  inferPlaceholders("<p>Dear Maria, welcome!</p>").proposals.some((p) => p.category === "user_name" && p.original === "Maria"));
check("'Уважаемый клиент' is NOT user_name",
  !inferPlaceholders("<p>Уважаемый клиент, добрый день</p>").proposals.some((p) => p.category === "user_name"));

// 3) Same brand repeated -> one shared token, applied to ALL occurrences.
const html3 = "<p>Quotex is great. Trade on Quotex. Love Quotex!</p>";
const brandProps = inferPlaceholders(html3).proposals.filter((p) => p.category === "brand_name");
check("repeated brand -> single shared token", new Set(brandProps.map((p) => p.suggested)).size === 1);
const applied = applyPlaceholderProposals(html3, brandProps);
check("all 3 brand occurrences replaced", (applied.html.match(/\$\{\{/g) || []).length === 3);
check("apply reports occurrences=3", applied.applied[0]?.occurrences === 3);

console.log("\n" + (fail === 0 ? `✓ ALL PASS (${pass})` : `✗ ${fail} FAILED, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
