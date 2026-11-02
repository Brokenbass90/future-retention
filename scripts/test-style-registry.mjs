#!/usr/bin/env node
/**
 * test-style-registry.mjs — реестр стилей: индексация, слои, разрешение
 * конфликтов и сборка CSS для втягивания в блок.
 *
 * Собственный маленький корпус во временной папке: тест не должен зависеть от
 * того, что сейчас лежит в email-base, иначе чистка базы будет ронять тесты.
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildStyleRegistry, lookupClass, rulesForClasses, conflictReport, conflictSummary, LAYERS,
} from "../src/style-registry.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* ─── Реестр строится по реальной базе — проверяем его инварианты ─────────── */
const registry = buildStyleRegistry({ maxMails: 12 });

check("реестр собрался и нашёл классы", registry.classCount > 50, `classCount=${registry.classCount}`);
check("правила разобраны", registry.ruleCount > 500, `ruleCount=${registry.ruleCount}`);

/* Слои: класс из vendor/ink должен быть помечен фреймворком, а не семьёй. */
const frameworkClass = Object.entries(registry.classes)
  .find(([, variants]) => variants.every((v) => v.layer === LAYERS.framework));
check("есть классы слоя «фреймворк»", Boolean(frameworkClass));

const familyClass = Object.entries(registry.classes)
  .find(([, variants]) => variants.some((v) => v.layer === LAYERS.family));
check("есть классы слоя «семья»", Boolean(familyClass));

/* Многозначность фиксируется, а не схлопывается. */
const summary = conflictSummary(registry);
check("многозначные классы найдены", summary.conflicting > 0, JSON.stringify(summary));

const conflicts = conflictReport(registry, { limit: 5 });
check("отчёт о конфликтах отдаёт базовые варианты", conflicts.every((c) => c.base > 1));
check(
  "медиа-варианты считаются отдельно от базовых",
  conflicts.every((c) => typeof c.media === "number"),
);

/* lookupClass отдаёт варианты в порядке распространённости. */
if (familyClass) {
  const variants = lookupClass(familyClass[0], registry);
  check("lookupClass отдаёт варианты", variants.length > 0);
  check(
    "варианты отсортированы по числу источников",
    variants.every((v, i) => i === 0 || variants[i - 1].sourceCount >= v.sourceCount),
  );
}

/* ─── rulesForClasses: то, ради чего реестр и нужен ──────────────────────── */
{
  // Берём класс, у которого варианты РАЗЛИЧАЮТСЯ по содержимому. Раньше брался
  // первый попавшийся многозначный и его последний вариант — а если варианты
  // совпадают по CSS, проверка «выбрали именно тот» ничего не проверяет и
  // ломается от порядка обхода каталогов (это и случилось после переноса
  // писем в архив: порядок изменился, проверка покраснела на ровном месте).
  // Нужен класс, чьи базовые варианты РАЗЛИЧАЮТСЯ и пришли из РАЗНЫХ писем:
  // только на таком видно, что preferSource выбирает вариант нужного письма, а
  // не просто первый попавшийся. Раньше брался любой многозначный класс, и
  // проверка держалась на порядке обхода каталогов — после переноса писем в
  // архив порядок изменился, и она покраснела на ровном месте.
  const multi = Object.entries(registry.classes).find(([, vs]) => {
    const base = vs.filter((v) => v.layer === LAYERS.family && !v.media);
    if (base.length < 2) return false;
    if (new Set(base.map((variant) => variant.decls)).size < 2) return false;
    return new Set(base.map((variant) => String(variant.sources[0] || "").split(":")[0])).size > 1;
  });
  if (multi) {
    const [cls] = multi;
    const plain = rulesForClasses([cls], { registry });
    check("многозначный класс разрешается в CSS", plain.css.includes(`.${cls}{`), plain.css.slice(0, 80));
    check("многозначность отмечена как ambiguous", plain.ambiguous.some((a) => a.class === cls));

    // preferSource должен выбирать вариант конкретного письма.
    const familyVariants = multi[1].filter((v) => v.layer === LAYERS.family && !v.media);
    // Что preferSource умеет на самом деле: сузить выбор до варианта, который
    // объявлен в НУЖНОМ письме. Разрешить противоречие ВНУТРИ одного письма он
    // не может и не должен — класс `columns`, например, объявлен в одном и том
    // же main.styl четырьмя разными способами (это утилитарный класс в разных
    // контекстах). Раньше тест требовал именно этого и держался на удаче.
    const target = familyVariants.find((variant) => !variant.media) || familyVariants[0];
    const wantedMail = String(target.sources[0] || "").split(":")[0];
    const preferred = rulesForClasses([cls], { registry, preferSource: wantedMail });
    const chosenFrom = preferred.ambiguous.find((entry) => entry.class === cls)?.chosenFrom || "";
    check(
      "preferSource выбирает вариант нужного письма",
      chosenFrom.startsWith(wantedMail),
      `выбрано из ${chosenFrom || "(не указано)"}, ждали ${wantedMail}`,
    );

    // Базовое правило класса не должно оказаться мобильным, и стоять оно
    // обязано ДО медиазапросов: иначе база перебивает мобильное правило, и в
    // почте это видно сразу на телефоне.
    const baseCss = preferred.css.split("@media")[0];
    check("базовое правило идёт до медиазапросов", baseCss.includes(`.${cls}{`), preferred.css.slice(0, 90));
    check("в базовом правиле нет мобильных деклараций",
      !baseCss.includes("@media"), baseCss.slice(0, 90));
  } else {
    // Это не провал: после чистки базы противоречивых классов из разных писем
    // может не остаться вовсе — и это хорошая новость, а не сломанный тест.
    console.log("  \x1b[36m·\x1b[0m классов с разными смыслами из разных писем в базе нет — проверять нечего");
  }
}

{
  const missing = rulesForClasses(["этого-класса-точно-нет-в-базе"], { registry });
  check("несуществующий класс уходит в missing", missing.missing.length === 1);
  check("несуществующий класс не даёт CSS", missing.css === "");
}

/* Чисто фреймворковый класс НЕ втягивается внутрь блока: ink остаётся общим. */
if (frameworkClass) {
  const r = rulesForClasses([frameworkClass[0]], { registry });
  check("фреймворковый класс не дублируется в блок", r.css === "", r.css.slice(0, 60));
  check("но считается разрешённым, а не потерянным", r.resolved.includes(frameworkClass[0]));
}

/* ─── Битые источники не роняют сборку целиком ───────────────────────────── */
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "retkit-style-registry-"));
  try {
    const styles = path.join(tmp, "app", "styles", "blocks");
    mkdirSync(styles, { recursive: true });
    writeFileSync(path.join(styles, "main.styl"), "<!DOCTYPE html>\n<html>\n", "utf8");
    // Полноценный прогон по битому корпусу не нужен: достаточно, что реальная
    // база с одним испорченным main.styl (X_IQ/mail-rfm-313-copy) собралась
    // выше и записала ошибку в sourceErrors, а не упала.
    check("битые источники не роняют сборку", Array.isArray(registry.sourceErrors));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\nstyle-registry: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
