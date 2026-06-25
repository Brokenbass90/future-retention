import { TOOL_HANDLERS } from "../src/ai-tools.js";
import { parseNormalizedBlocks } from "../src/locale-conventions.js";
import assert from "node:assert";
let pass=0,fail=0;
const t=(n,f)=>{try{f();pass++;console.log("✓",n);}catch(e){fail++;console.error("✗",n,"→",e.message);}};

// Reference EN: 3 text blocks around a platform variable.
const enTxt = `Subject: Test\n\n{{Welcome aboard}}\n\n{{Your code is {{embedded.code}}}}\n\n{{Thanks for joining}}`;
// RU: missing the middle text, variable present → fewer blocks, drifted.
const ruTxt = `{{مرحبا}}\n\n{{embedded.code}}\n\n{{شكرا}}`;
// AR: extra trailing block.
const arTxt = `{{أهلا}}\n\n{{رمزك هو {{embedded.code}}}}\n\n{{شكرا لانضمامك}}\n\n{{بلوك زائد}}`;

const ns = {
  name: "promo", namespace: "promo", referenceLocale: "en",
  localeRaw: { en: enTxt, ru: ruTxt, ar: arTxt },
  locales: {
    en: parseNormalizedBlocks(enTxt),
    ru: parseNormalizedBlocks(ruTxt),
    ar: parseNormalizedBlocks(arTxt),
  },
};
const ctx = { namespaces: [ns], activeNamespace: ns, pendingLocaleUpdates: [] };

const r = await TOOL_HANDLERS.align_locales_to_reference({}, ctx);
const refN = r.refBlockCount;  // normalized reference block count
console.log("ref blocks:", refN, "| report:", JSON.stringify(r.report));

t("refCode resolved to en", ()=>assert.equal(r.refCode,"en"));
t("ru aligned to ref block count", ()=>assert.equal(ns.locales.ru.length, refN));
t("ar aligned to ref block count", ()=>assert.equal(ns.locales.ar.length, refN));
t("ru was padded (had fewer)", ()=>assert.ok(r.report.ru.after === refN));
t("ar dropped/trimmed extra", ()=>assert.ok(r.report.ar.after === refN));
t("updates staged for ru & ar", ()=>{
  const codes = ctx.pendingLocaleUpdates.map(u=>u.locale);
  assert.ok(codes.includes("ru") && codes.includes("ar"));
});
t("platform var stays at same index across locales", ()=>{
  const varIdx = ns.locales.en.findIndex(b=>/embedded\.code/.test(b));
  assert.ok(varIdx >= 0);
  assert.ok(/embedded\.code/.test(ns.locales.ru[varIdx]||""));
  assert.ok(/embedded\.code/.test(ns.locales.ar[varIdx]||""));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
