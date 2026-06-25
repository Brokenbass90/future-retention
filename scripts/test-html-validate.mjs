import { validateHtml } from "../src/html-validate.js";
import assert from "node:assert";
let pass=0,fail=0; const t=(n,c)=>{c?pass++:fail++;console.log(c?'✓':'✗',n);};

t("clean html ok", validateHtml('<div><p>hi</p></div>').ok);
t("void tags ignored", validateHtml('<div><img src="x"><br></div>').ok);
const u = validateHtml('<div><p>hi</div>');
t("unclosed <p> detected", u.issues.some(i=>(i.inner||[]).includes('p') || /p/.test(i.message)));
t("stray close flagged", validateHtml('<p>hi</p></div>').issues.some(i=>i.kind==='stray_close'));
t("brace mismatch", validateHtml('text {{embedded.x}').issues.some(i=>i.kind==='brace_mismatch'));
t("placeholder mismatch", validateHtml('${{ ns.block_00 }}').issues.some(i=>i.kind==='placeholder_mismatch'));
t("bold unbalanced", validateHtml('@@bold text').issues.some(i=>i.kind==='bold_unbalanced'));
t("comments ignored", validateHtml('<!-- <div> --><p>x</p>').ok);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
