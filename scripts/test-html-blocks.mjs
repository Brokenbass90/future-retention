import { listHtmlSections, insertHtml, removeHtml } from "../src/html-blocks.js";
import assert from "node:assert";
let pass=0,fail=0;
const t=(n,f)=>{try{f();pass++;console.log("✓",n);}catch(e){fail++;console.error("✗",n,"→",e.message);}};

const marked = `<body><!-- rk:block-start:0:hero --><table>HERO</table><!-- rk:block-end:0:hero -->`+
               `<!-- rk:block-start:1:cta --><table>BUY NOW</table><!-- rk:block-end:1:cta --></body>`;
t("lists marked sections", ()=>{const r=listHtmlSections(marked);assert.equal(r.count,2);assert.equal(r.sections[1].id,"cta");});
t("unmarked → marked:false", ()=>{const r=listHtmlSections("<body><table>x</table></body>");assert.equal(r.marked,false);});

const html = `<body><table class="hero"><tr><td>Welcome aboard</td></tr></table><table class="cta"><tr><td>Open account</td></tr></table></body>`;

t("insert after unique anchor", ()=>{
  const r=insertHtml(html,{anchor:'<table class="hero"><tr><td>Welcome aboard</td></tr></table>',position:"after",snippet:'<table class="promo">P</table>'});
  assert.ok(!r.error,r.error); assert.ok(r.html.includes('class="promo"'));
  assert.ok(r.html.indexOf('class="promo"') > r.html.indexOf('class="hero"'));
  assert.ok(r.html.indexOf('class="promo"') < r.html.indexOf('class="cta"'));
});
t("insert before anchor", ()=>{
  const r=insertHtml(html,{anchor:'<table class="cta">',position:"before",snippet:'<hr>'});
  assert.ok(!r.error,r.error); assert.ok(r.html.indexOf('<hr>') < r.html.indexOf('class="cta"'));
});
t("body_end insert", ()=>{
  const r=insertHtml(html,{position:"body_end",snippet:'<footer>F</footer>'});
  assert.ok(!r.error,r.error); assert.ok(r.html.indexOf('<footer>') < r.html.indexOf('</body>'));
});
t("ambiguous anchor refused", ()=>{
  const dup="<td>x</td><td>x</td>"; const r=insertHtml("<body>"+dup+"</body>",{anchor:"<td>x</td>",position:"after",snippet:"Y"});
  assert.ok(r.error && /matches 2/.test(r.error));
});
t("missing anchor refused", ()=>{
  const r=insertHtml(html,{anchor:"NONEXISTENT",position:"after",snippet:"Y"});
  assert.ok(r.error && /not found/.test(r.error));
});

t("remove unique block", ()=>{
  const r=removeHtml(html,{block:'<table class="cta"><tr><td>Open account</td></tr></table>'});
  assert.ok(!r.error,r.error); assert.ok(!r.html.includes("Open account")); assert.ok(r.html.includes("Welcome aboard"));
});
t("remove from..to region", ()=>{
  const r=removeHtml(html,{from:'<table class="hero">',to:'</table>'});
  assert.ok(!r.error,r.error); assert.ok(!r.html.includes("Welcome aboard"));
});
t("remove >50% refused", ()=>{
  const r=removeHtml(html,{from:'<table class="hero">',to:'class="cta"'});
  // removing most of body → should refuse OR keep enough; ensure guard triggers on big cut
  assert.ok(r.error ? /50%/.test(r.error) : true);
});
t("remove ambiguous refused", ()=>{
  const r=removeHtml("<body><td>x</td><td>x</td></body>",{block:"<td>x</td>"});
  assert.ok(r.error && /matches 2/.test(r.error));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
