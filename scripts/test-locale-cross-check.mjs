import { compareLocales } from "../src/locale-cross-check.js";
import assert from "node:assert";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("✓", name); } catch (e) { fail++; console.error("✗", name, "→", e.message); } };

// Reference EN, three locales with seeded problems.
const locales = {
  en: [
    "Hello {{user_name}}, welcome!",
    "Your balance is {{embedded.amount}} now.",
    "Click the @@big button@@ below.",
    "Terms apply.",
  ],
  ru: [
    "Привет, {{user_name}}, добро пожаловать!",
    "Ваш баланс теперь {{embedded.amount}}.",
    "Нажми @@большую кнопку@@ ниже.",
    "Действуют условия.",
  ],
  ar: [
    "مرحبا {{user_name}}",
    "رصيدك الآن.",                      // missing {{embedded.amount}}
    "اضغط الزر @@ بالأسفل.",            // unbalanced @@ (single)
    // missing 4th block → block_count
  ],
  de: [
    "Hello {{user_name}}, welcome!",   // untranslated copy of EN block 0
    "Ihr Guthaben ist jetzt {{embedded.amount}}.",
    "",                                // empty block
    "Es gelten Bedingungen.",
  ],
};

const res = compareLocales({ locales });

t("reference resolves to en", () => assert.equal(res.refCode, "en"));
t("ref block count = 4", () => assert.equal(res.refBlockCount, 4));
t("ru is clean", () => assert.equal(res.summary.byLocale.ru, 0));

const kinds = (code) => res.issues.filter(i => i.locale === code).map(i => i.kind);

t("ar: block_count flagged", () => assert.ok(kinds("ar").includes("block_count")));
t("ar: missing_var flagged", () => assert.ok(kinds("ar").includes("missing_var")));
t("ar: unbalanced_bold flagged", () => assert.ok(kinds("ar").includes("unbalanced_bold")));

t("de: empty_block flagged", () => assert.ok(kinds("de").includes("empty_block")));
t("de: untranslated_copy flagged", () => assert.ok(kinds("de").includes("untranslated_copy")));

t("explicit refLocale honored", () => {
  const r2 = compareLocales({ locales, refCode: "ru" });
  assert.equal(r2.refCode, "ru");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
