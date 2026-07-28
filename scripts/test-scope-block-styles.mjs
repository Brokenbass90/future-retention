#!/usr/bin/env node
/**
 * test-scope-block-styles.mjs — автоскоуп стилей блока.
 *
 * Проверяем на синтетических блоках, а не на живой библиотеке: тест не должен
 * краснеть от того, что кто-то поправил iq-gray-step.
 *
 * Ключевые обещания:
 *   – свои классы блока переименовываются и больше не могут столкнуться с чужими;
 *   – правила, которые блок брал из семьи, втягиваются внутрь;
 *   – многозначный класс разрешается по решению из style-decisions.json;
 *   – фреймворковые классы (ink) НЕ переименовываются — иначе рассыплется скелет;
 *   – если блок дописывает поверх фреймворкового класса, остаются ОБА имени;
 *   – текст, ссылки и токены слотов не задеваются.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import {
  scopeBlockStyles, classifyBlockClasses, renameClassesInPug, renameClassesInStyl,
  classesUsedInPug, classesDefinedInStyl, scopedName,
} from "../src/scope-block-styles.js";
import { LAYERS } from "../src/style-registry.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* Синтетический реестр: .row — фреймворк, .gray-block — семья (однозначен),
   .m-w — семья с двумя смыслами, .logo — фреймворк, который блок дописывает. */
const registry = {
  classes: {
    row: [{ hash: "f1", decls: "display:table", media: null, layer: LAYERS.framework, selectors: [".row"], sourceCount: 90, sources: ["vendor/ink.styl"] }],
    logo: [{ hash: "f2", decls: "max-width:120px", media: null, layer: LAYERS.framework, selectors: [".logo"], sourceCount: 90, sources: ["vendor/ink.styl"] }],
    "gray-block": [{ hash: "a1", decls: "background:#F9F9F9;border-radius:12px", media: null, layer: LAYERS.family, selectors: [".gray-block"], sourceCount: 52, sources: ["X_IQ/mail-a:blocks/main.styl"] }],
    "m-w": [
      { hash: "b1", decls: "width:49px !important", media: null, layer: LAYERS.family, selectors: [".m-w"], sourceCount: 20, sources: ["X_IQ/mail-other:blocks/main.styl"] },
      { hash: "b2", decls: "width:78px !important;vertical-align:middle", media: null, layer: LAYERS.family, selectors: [".m-w"], sourceCount: 3, sources: ["X_assembled/mail-233-demo:blocks/main.styl"] },
    ],
    "hero-bg": [
      { hash: "c1", decls: "background:url(a.png)", media: null, layer: LAYERS.family, selectors: [".hero-bg"], sourceCount: 5, sources: ["X_IQ/mail-a:blocks/main.styl"] },
      { hash: "c2", decls: "background:url(b.png)", media: null, layer: LAYERS.family, selectors: [".hero-bg"], sourceCount: 3, sources: ["X_IQ/mail-b:blocks/main.styl"] },
    ],
  },
};

const decisions = {
  classes: {
    "m-w": { prefer: "X_assembled/mail-233-demo" },
    "hero-bg": { slot: { id: "background_image", kind: "image", label: "Фоновая картинка" }, why: "разные картинки кампаний" },
  },
};

const BLOCK = {
  id: "demo-step",
  source: "canonical",
  version: 3,
  pug: [
    'table.row.gray-block(role="presentation")',
    "  tr",
    '    td.m-w.pb0(style="color:{{ text_color }}")',
    '      img.logo(src="{{ logo_src }}" alt="logo")',
    '      p.step-text(class="step-text muted") Текст с .gray-block внутри строки',
  ].join("\n"),
  styl: ".step-text{font-size:16px}\n.logo{margin:0 auto}\n.muted{color:#888}",
  slots: [{ id: "text_color", kind: "color", default: "#000000" }],
};

/* ─── Извлечение ─────────────────────────────────────────────────────────── */
{
  const used = classesUsedInPug(BLOCK.pug);
  check("классы из pug-сокращений найдены", ["row", "gray-block", "m-w", "pb0", "logo", "step-text"].every((c) => used.includes(c)), used.join(","));
  check("класс из атрибута class найден", used.includes("muted"));
  check("слот-токен не принят за класс", !used.some((c) => c.includes("{{")));

  const own = classesDefinedInStyl(BLOCK.styl);
  check("классы из styl найдены", ["step-text", "logo", "muted"].every((c) => own.includes(c)), own.join(","));
}

/* ─── Классификация ──────────────────────────────────────────────────────── */
{
  const c = classifyBlockClasses(BLOCK, registry);
  check("фреймворковый .row остаётся фреймворковым", c.framework.includes("row"));
  check("семейные классы отделены", c.family.includes("gray-block") && c.family.includes("m-w"), JSON.stringify(c.family));
  check("свои классы отделены", c.own.includes("step-text") && c.own.includes("muted"));
  check(".logo — своё поверх фреймворка", c.ownOverFramework.includes("logo"), JSON.stringify(c.ownOverFramework));
  check("класс без CSS попал в missing", c.missing.includes("pb0"), JSON.stringify(c.missing));
}

/* ─── Скоуп ──────────────────────────────────────────────────────────────── */
const { block: scoped, report } = scopeBlockStyles(BLOCK, { registry, decisions });

{
  check("блок помечен как изменённый", report.changed);
  check("версия поднята", scoped.version === 4, String(scoped.version));
  check("блок помечен scoped", scoped.scoped === true);

  check("свой класс переименован",
    scoped.pug.includes(".demo-step--step-text") && scoped.styl.includes(".demo-step--step-text"));
  check("класс из атрибута class тоже переименован",
    /class="demo-step--step-text demo-step--muted"/.test(scoped.pug), scoped.pug.split("\n").pop());

  check("фреймворковый .row НЕ переименован", /table\.row\./.test(scoped.pug), scoped.pug.split("\n")[0]);
  check("у .logo остались оба имени",
    scoped.pug.includes("img.logo.demo-step--logo"),
    scoped.pug.split("\n").find((l) => l.includes("logo")));
  check("правило .logo в styl стало скоупным",
    scoped.styl.includes(".demo-step--logo{margin:0 auto}") && !/(^|\n)\.logo\{/.test(scoped.styl));

  check("класс без CSS остался как был", scoped.pug.includes(".pb0"));
  check("текст внутри строки не задет", scoped.pug.includes("Текст с .gray-block внутри строки"));
  check("токен слота не задет", scoped.pug.includes("{{ text_color }}") && scoped.pug.includes("{{ logo_src }}"));
}

/* ─── Втягивание правил семьи ────────────────────────────────────────────── */
{
  check("однозначный класс семьи втянут",
    scoped.styl.includes(".demo-step--gray-block") && scoped.styl.includes("#F9F9F9"),
    scoped.styl.slice(-220));
  check("в отчёте отмечено, что втянули", report.pulled.includes("gray-block") && report.pulled.includes("m-w"));

  check("многозначный класс решён по decisions (78px, а не 49px)",
    scoped.styl.includes("78px") && !scoped.styl.includes("49px"),
    scoped.styl.slice(-260));
  check("решение зафиксировано в отчёте",
    report.ambiguousResolved.some((a) => a.class === "m-w" && a.decided === true),
    JSON.stringify(report.ambiguousResolved));
}

/* ─── Класс, ставший слотом ──────────────────────────────────────────────── */
{
  const heroBlock = {
    id: "demo-hero", source: "canonical", version: 1,
    pug: "div.hero-bg\n  p.title Заголовок",
    styl: ".title{font-size:32px}",
    slots: [],
  };
  const { block: heroScoped, report: heroReport } = scopeBlockStyles(heroBlock, { registry, decisions });
  check("класс с десятками картинок не втянут значением",
    !heroScoped.styl.includes("url(a.png)") && !heroScoped.styl.includes("url(b.png)"),
    heroScoped.styl);
  // Слот НЕ создаётся: поле в инспекторе, не протянутое в pug, ничего бы не
  // меняло. Класс пока остаётся глобальным, а решение видно в отчёте.
  check("неподключённый слот не создаётся",
    !(heroScoped.slots || []).some((s) => s.id === "background_image"),
    JSON.stringify(heroScoped.slots));
  check("в отчёте видно решение и что оно отложено",
    heroReport.turnedIntoSlots.some((t) => t.class === "hero-bg" && t.pending),
    JSON.stringify(heroReport.turnedIntoSlots));
}

/* ─── Идемпотентность ────────────────────────────────────────────────────── */
{
  const { block: twice, report: r2 } = scopeBlockStyles(scoped, { registry, decisions });
  check("повторный скоуп ничего не ломает", !twice.pug.includes("demo-step--demo-step--"),
    twice.pug.split("\n").find((l) => l.includes("demo-step--demo-step--")) || "");
  check("повторный скоуп не поднимает версию бесконечно", twice.version <= scoped.version + 1,
    `${scoped.version} → ${twice.version}`);
  check("отчёт второго прогона пуст по переименованиям семьи", r2.pulled.length === 0,
    JSON.stringify(r2.pulled));
}

/* ─── Точечные хелперы ───────────────────────────────────────────────────── */
{
  const renames = new Map([["a", "x--a"]]);
  check("renameClassesInStyl не трогает чужие имена",
    renameClassesInStyl(".a{c:1}\n.ab{c:2}", renames) === ".x--a{c:1}\n.ab{c:2}",
    renameClassesInStyl(".a{c:1}\n.ab{c:2}", renames));
  check("renameClassesInPug не трогает комментарии",
    renameClassesInPug("//- .a комментарий\ndiv.a", renames).startsWith("//- .a комментарий"));
  check("scopedName чистит небезопасные символы", scopedName("a b/c", "x") === "a-b-c--x", scopedName("a b/c", "x"));
}

console.log(`\nscope-block-styles: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
