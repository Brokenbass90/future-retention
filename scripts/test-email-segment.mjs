import { segmentEmailIntoBlocks, removeEmailBlock, moveEmailBlock } from "../src/email-segment.js";
import assert from "node:assert";
let pass=0,fail=0; const t=(n,c)=>{c?pass++:fail++;console.log(c?'✓':'✗',n);};

const html = `<center><table class="container"><tbody><tr><td>` +
  `<table class="row header"><tr><td>LOGO</td></tr></table>` +
  `<table class="row border-full"><tr><td><table class="ten columns"><tr><td>HERO TITLE</td></tr></table></td></tr></table>` +
  `<table class="row footer"><tr><td>FOOTER terms</td></tr></table>` +
  `</td></tr></tbody></table></center>`;

const blocks = segmentEmailIntoBlocks(html);
t('found 3 top-level row blocks', blocks.length === 3);
t('labels: header/border-full/footer', blocks.map(b=>b.label).join('|') === 'header|border-full|footer');
t('nested .ten.columns NOT counted as a block', !blocks.some(b=>b.label.includes('columns')));
t('preview has text', /HERO TITLE/.test(blocks[1].preview));

const removed = removeEmailBlock(html, 2);   // drop footer
const b2 = segmentEmailIntoBlocks(removed);
t('remove footer → 2 blocks', b2.length === 2 && !/FOOTER/.test(removed));

const moved = moveEmailBlock(html, 2, 0);    // footer to top
const b3 = segmentEmailIntoBlocks(moved);
t('move footer to top → footer first', b3[0].label === 'footer');
t('move keeps 3 blocks', b3.length === 3);
t('move keeps hero intact', /HERO TITLE/.test(moved));

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
