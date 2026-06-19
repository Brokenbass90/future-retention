/**
 * src/locale-conventions.js — кодифицированные конвенции локалей (zero-AI).
 *
 * Правила домена (источник: ретеншн-команда, 2026-06-11):
 *
 * 1. ${{ ns.block_NN }}$  — плейсхолдеры ТЕКСТА студии, живут в HTML.
 * 2. {{identifier}}       — СКВОЗНЫЕ переменные платформы ({{embedded.company_email}},
 *    {{user_name}}, {{Level_Name}}...). Распознаются эвристикой: идентификатор без
 *    пробелов, содержащий точку или подчёркивание. Их НЕЛЬЗЯ переводить и НЕЛЬЗЯ
 *    держать внутри текстовых блоков TXT — текст разбивается вокруг них:
 *       было:  {{...contact your manager or {{embedded.company_email}}.}}
 *       стало: {{...contact your manager or}} {{embedded.company_email}}{{.}}
 *    В HTML переменная остаётся ЛИТЕРАЛОМ (её подставляет платформа рассылки).
 * 3. Строка `Subject: ...` в начале TXT — служебная (для админки), живёт ВНЕ блоков.
 * 4. @@жирность@@ в блоке зеркалит <b>/<strong> в вёрстке.
 *
 * Экспорт:
 *   isSystemVariable(inner)            — токен похож на переменную платформы?
 *   tokenizeLocaleTxt(raw)             — nesting-aware токенизатор (не ленивый!)
 *   normalizeLocaleConventions(raw)    — детерминированная починка файла
 *   buildAnchorUnits(raw, ns)          — юниты для placeholderize: текст+вар+хвост
 *                                        одного абзаца = один анкер
 */

// Сквозная переменная платформы — её НЕ переводят и не держат внутри текстовых
// блоков. Два вида (подтверждено ретеншн-командой):
//   1) с точкой/подчёркиванием: embedded.company_email, user_full_name, op_id
//   2) «голое» имя-плейсхолдер: amount, currency, reason — одно слово в нижнем
//      регистре без пробелов/пунктуации.
// Текстовые блоки так НЕ выглядят: это фразы/предложения (есть пробелы) или
// слова с заглавной/пунктуацией (Hi, Reason:, Terms and Conditions, «,»).
// После каждой точки/подчёркивания ОБЯЗАН идти хотя бы один символ — иначе
// «anytime.», «info.», «below.» (слово с точкой в конце) ошибочно считались
// переменными и ломали матчинг абзаца.
const VAR_DOTUS_RE = /^[A-Za-z][A-Za-z0-9-]*(?:[._][A-Za-z0-9-]+)+$/; // есть . или _, без хвостовых разделителей
const VAR_BARE_RE  = /^[a-z][a-z0-9]+$/;                              // голое слово в нижнем регистре, ≥2 симв.

export function isSystemVariable(inner) {
  const t = String(inner || "").trim();
  return VAR_DOTUS_RE.test(t) || VAR_BARE_RE.test(t);
}

export function isSubjectLine(line) {
  return /^\s*subject\s*:/i.test(String(line || ""));
}

/**
 * Nesting-aware токенизатор. В отличие от ленивого /\{\{[\s\S]*?\}\}/ корректно
 * захватывает блок с вложенной переменной целиком (считает глубину скобок).
 * @returns {Array<{type:'outside'|'block', text?:string, inner?:string, unclosed?:boolean}>}
 */
export function tokenizeLocaleTxt(raw) {
  const s = String(raw || "").replace(/\r\n?/g, "\n");
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("{{", i);
    if (open === -1) {
      tokens.push({ type: "outside", text: s.slice(i) });
      break;
    }
    if (open > i) tokens.push({ type: "outside", text: s.slice(i, open) });
    let j = open + 2;
    let depth = 1;
    while (j < s.length && depth > 0) {
      if (s.startsWith("{{", j)) { depth += 1; j += 2; }
      else if (s.startsWith("}}", j)) { depth -= 1; j += 2; }
      else j += 1;
    }
    if (depth > 0) {
      tokens.push({ type: "block", inner: s.slice(open + 2), unclosed: true });
      i = s.length;
    } else {
      tokens.push({ type: "block", inner: s.slice(open + 2, j - 2) });
      i = j;
    }
  }
  return tokens;
}

/** Починить незакрытые переменные ВНУТРИ текста блока: `{{embedded.x` → `{{embedded.x}}`. */
function closeUnclosedVariables(inner) {
  let out = "";
  let i = 0;
  let closed = 0;
  const s = String(inner || "");
  while (i < s.length) {
    const open = s.indexOf("{{", i);
    if (open === -1) { out += s.slice(i); break; }
    out += s.slice(i, open);
    const close = s.indexOf("}}", open + 2);
    const candidateEnd = close === -1 ? s.length : close;
    const candidate = s.slice(open + 2, candidateEnd);
    // Имя переменной — идентификатор-префикс кандидата (без пробелов).
    const lead = /^\s*/.exec(candidate)[0];
    const nameMatch = /^[A-Za-z][A-Za-z0-9._-]*/.exec(candidate.slice(lead.length));
    const name = nameMatch ? nameMatch[0] : "";
    const rest = candidate.slice(lead.length + name.length);

    if (close === -1) {
      // Незакрытая `{{name...` до конца блока.
      if (isSystemVariable(name)) {
        out += "{{" + name + "}}" + rest;
        closed += 1;
      } else {
        out += s.slice(open);
      }
      i = s.length;
    } else if (isSystemVariable(name) && rest.trim() && !isSystemVariable(candidate.trim())) {
      // `{{embedded.x …текст…}}` — скобка закрылась, но не там: переменная была
      // не закрыта, а найденный `}}` принадлежит внешнему блоку (токенизатор
      // пометил его unclosed и нормализатор закроет заново). Закрываем переменную
      // сразу после имени, хвост оставляем текстом, осиротевший `}}` выбрасываем.
      out += "{{" + name + "}}" + rest;
      closed += 1;
      i = close + 2;
    } else {
      // Закрытая вложенная пара — копируем как есть.
      out += s.slice(open, close + 2);
      i = close + 2;
    }
  }
  return { inner: out, closed };
}

/**
 * Разбить текст блока на части вокруг переменных платформы.
 * @returns {Array<{kind:'text'|'var', text:string, sepBefore:string}>}
 *   sepBefore — пробельный разделитель ПЕРЕД этой частью (попадает МЕЖДУ токенами).
 */
function splitBlockAroundVariables(inner) {
  const s = String(inner || "");
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (!isSystemVariable(m[1])) continue; // не переменная — оставить в тексте
    const before = s.slice(last, m.index);
    pushTextPart(parts, before);
    parts.push({ kind: "var", text: m[1].trim(), sepBefore: trailingWs(before) });
    last = re.lastIndex;
  }
  pushTextPart(parts, s.slice(last));
  return parts;
}

function trailingWs(s) {
  const m = /\s+$/.exec(String(s || ""));
  return m ? " " : "";
}
function leadingWs(s) {
  const m = /^\s+/.exec(String(s || ""));
  return m ? " " : "";
}
function pushTextPart(parts, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  parts.push({ kind: "text", text: trimmed, sepBefore: leadingWs(text) });
}

/**
 * Детерминированная починка локали по конвенциям.
 * - Блоки с вложенными переменными разбиваются: {{text}} {{var}}{{tail}}
 * - Незакрытые `{{var` внутри блока закрываются.
 * - Subject-строка и прочий внеблочный текст не трогаются.
 * @returns {{ txt: string, changed: boolean, changes: Array<object> }}
 */
export function normalizeLocaleConventions(raw) {
  const tokens = tokenizeLocaleTxt(raw);
  const changes = [];
  const out = [];

  for (const t of tokens) {
    if (t.type === "outside") { out.push(t.text); continue; }

    let inner = t.inner;
    if (t.unclosed) {
      changes.push({ type: "closed_block", preview: inner.slice(0, 60) });
    }
    const repaired = closeUnclosedVariables(inner);
    if (repaired.closed > 0) {
      changes.push({ type: "closed_variable", count: repaired.closed, preview: inner.slice(0, 60) });
      inner = repaired.inner;
    }

    if (isSystemVariable(inner)) {
      out.push("{{" + inner.trim() + "}}");
      continue;
    }

    const hasNestedVar = /\{\{\s*[^{}]+?\s*\}\}/.test(inner) && splitBlockAroundVariables(inner).some((p) => p.kind === "var");
    if (!hasNestedVar) {
      out.push("{{" + inner + "}}");
      continue;
    }

    const parts = splitBlockAroundVariables(inner);
    const seq = parts.map((p, idx) => {
      const sep = idx === 0 ? "" : p.sepBefore;
      return sep + "{{" + (p.kind === "var" ? p.text : p.text) + "}}";
    }).join("");
    changes.push({
      type: "split_variables",
      before: ("{{" + inner + "}}").slice(0, 100),
      after: seq.slice(0, 100),
      partCount: parts.length,
    });
    out.push(seq);
  }

  const txt = out.join("");
  return { txt, changed: changes.length > 0, changes };
}

/** Блоки нормализованного TXT (без вложенных переменных — ленивый парс безопасен). */
export function parseNormalizedBlocks(txt) {
  return tokenizeLocaleTxt(txt).filter((t) => t.type === "block").map((t) => String(t.inner).trim());
}

/** Текст ПЕРЕД первым блоком (служебная строка Subject и т.п.). */
export function localePrefix(txt) {
  const i = String(txt || "").indexOf("{{");
  return i === -1 ? "" : String(txt).slice(0, i);
}

/** Сериализовать выровненные блоки обратно в TXT, сохранив prefix (Subject). */
export function serializeAligned(prefix, blocks) {
  const body = (blocks || []).map((b) => `{{${b}}}`).join("\n\n");
  const pfx = prefix && prefix.trim() ? prefix.replace(/\s+$/, "") + "\n\n" : "";
  return pfx + body;
}

/**
 * Split a plural placeholder sequence around a standalone platform variable.
 *
 * Source convention used by retention templates:
 *   {{text before {{days}} plural/singular/ tail}}
 * becomes:
 *   {{text before}} {{days}} {{plural}} {{singular}} {{tail}}
 *
 * Every locale is split from its own translated source, so words such as
 * `hari`/`1 hari` are never copied from EN or generated by AI.
 */
export function splitPluralPlaceholderBlocks(raw, { variableName = "days" } = {}) {
  const normalized = normalizeLocaleConventions(raw);
  const blocks = parseNormalizedBlocks(normalized.txt);
  const changes = [...normalized.changes];
  let changed = normalized.changed;

  for (let i = 0; i < blocks.length - 1; i += 1) {
    if (String(blocks[i]).trim() !== variableName) continue;
    const tail = String(blocks[i + 1] || "").trim();
    let parts = null;

    // Most locales: `days/1 day/ and the rest`.
    const twoSlash = /^\s*([^/]+?)\s*\/\s*([^/]+?)\s*\/\s*([\s\S]+?)\s*$/.exec(tail);
    if (twoSlash) {
      parts = [twoSlash[1], twoSlash[2], twoSlash[3]];
    } else {
      // Some compact locales omit the second slash: `일/1일 후 ...`.
      const oneSlash = /^\s*([^/]+?)\s*\/\s*(\S+)\s+([\s\S]+?)\s*$/.exec(tail);
      if (oneSlash) parts = [oneSlash[1], oneSlash[2], oneSlash[3]];
    }

    if (!parts || parts.some((part) => !String(part).trim())) continue;
    blocks.splice(i + 1, 1, ...parts.map((part) => String(part).trim()));
    changes.push({ type: "split_plural_placeholder", variableName, index: i, parts: parts.length });
    changed = true;
    i += parts.length;
  }

  return {
    txt: serializeAligned(localePrefix(raw), blocks) + "\n",
    blocks,
    changed,
    changes,
  };
}

/**
 * Выровнять блоки локали по СТРУКТУРЕ эталона (reference).
 *
 * Зачем: плейсхолдеры в HTML позиционные (block_NN). Чтобы перевод вставал на
 * своё место, у всех локалей должна быть ОДНА И ТА ЖЕ последовательность блоков:
 * тот же набор позиций, переменные на тех же местах. Где у локали нет текста на
 * позицию эталона — ставим пустой блок-спейсер (рендерится как &nbsp;).
 *
 * Алгоритм (выравнивание по якорям-переменным):
 *   1. И эталон, и локаль режутся на сегменты по системным переменным
 *      ({{embedded.*}} и т.п.) — переменные одинаковы во всех локалях, служат якорями.
 *   2. Внутри каждого сегмента текстовые блоки локали раскладываются по текстовым
 *      слотам эталона по порядку; не хватило — пустой блок; перебор — лишнее
 *      дописывается в последний слот сегмента (контент не теряется).
 *   3. На месте переменной — значение переменной ИЗ ЭТАЛОНА (verbatim).
 * Результат всегда длиной refBlocks.length — одинаково для всех локалей.
 *
 * @param {string[]} refBlocks  блоки эталона (после normalizeLocaleConventions)
 * @param {string[]} locBlocks  блоки локали (после normalizeLocaleConventions)
 * @returns {{ blocks: string[], padded: number, dropped: number }}
 */
export function alignLocaleToReference(refBlocks, locBlocks) {
  const isVar = (b) => isSystemVariable(String(b || "").trim());
  const segment = (blocks) => {
    const segs = [];
    let cur = [];
    for (const b of blocks) {
      if (isVar(b)) { segs.push({ texts: cur, varAfter: String(b).trim() }); cur = []; }
      else cur.push(String(b));
    }
    segs.push({ texts: cur, varAfter: null });
    return segs;
  };

  const refSegs = segment(refBlocks);
  const locSegs = segment(locBlocks);
  const out = [];
  let padded = 0;
  let dropped = 0;

  for (let i = 0; i < refSegs.length; i += 1) {
    const rs = refSegs[i];
    const ls = locSegs[i] || { texts: [], varAfter: rs.varAfter };
    const slots = rs.texts.length;
    for (let j = 0; j < slots; j += 1) {
      if (j === slots - 1 && ls.texts.length > slots) {
        // Перебор текста локали в этом сегменте — склеиваем хвост в последний слот.
        out.push(ls.texts.slice(j).join(" "));
      } else if (j < ls.texts.length) {
        out.push(ls.texts[j]);
      } else {
        out.push(""); // пустой блок-спейсер
        padded += 1;
      }
    }
    if (slots === 0 && ls.texts.length) dropped += ls.texts.length; // текст без слота (редко)
    if (rs.varAfter !== null) out.push(rs.varAfter);
  }
  return { blocks: out, padded, dropped };
}

/**
 * Анкер-юниты для placeholderize.
 *
 * Блоки, стоящие на одной строке (разделитель без перевода строки), образуют
 * ОДИН юнит — это разбитый вокруг переменных абзац. В HTML такой юнит — один
 * элемент, в котором переменная стоит литералом:
 *   visibleText:  "…contact your manager or {{embedded.company_email}}."
 *   replacement:  "${{ ns.block_06 }}$ {{embedded.company_email}}${{ ns.block_08 }}$"
 *
 * Нумерация block_NN — сквозная по ВСЕМ блокам файла (включая переменные),
 * идентична ленивому парсеру workbench'а на нормализованном файле.
 *
 * @returns {Array<{unitIndex:number, blockIndexes:number[], visibleText:string,
 *                  replacement:string, hasText:boolean, varOnly:boolean}>}
 */
export function buildAnchorUnits(raw, namespace) {
  const ns = String(namespace || "ns");
  const tokens = tokenizeLocaleTxt(raw);
  const pad2 = (n) => String(n).padStart(2, "0");

  // Соберём блоки с их разделителями (только block-токены, нумерация сквозная).
  const blocks = [];
  let pendingSep = "";
  for (const t of tokens) {
    if (t.type === "outside") { pendingSep += t.text; continue; }
    blocks.push({ inner: String(t.inner || "").trim(), sepBefore: pendingSep });
    pendingSep = "";
  }

  const units = [];
  let current = null;
  blocks.forEach((b, i) => {
    const sameLine = current && b.sepBefore.indexOf("\n") === -1;
    if (!sameLine) {
      if (current) units.push(current);
      current = { unitIndex: units.length, blockIndexes: [], visible: [], repl: [], parts: [], hasText: false };
    }
    const sep = current.blockIndexes.length === 0 ? "" : (b.sepBefore ? " " : "");
    if (isSystemVariable(b.inner)) {
      const lit = "{{" + b.inner + "}}";
      current.visible.push(sep + lit);
      current.repl.push(sep + lit);
      // part.source — текст, по которому ищем оборачивающую <a> в HTML (для var
      // это сам литерал, т.к. он стоит литералом и в вёрстке).
      current.parts.push({ kind: "var", token: lit, source: lit, sep });
    } else {
      const ph = "${{ " + ns + ".block_" + pad2(i) + " }}$";
      current.visible.push(sep + b.inner);
      current.repl.push(sep + ph);
      current.parts.push({ kind: "text", token: ph, source: b.inner, sep });
      current.hasText = true;
    }
    current.blockIndexes.push(i);
  });
  if (current) units.push(current);

  return units.map((u) => ({
    unitIndex: u.unitIndex,
    blockIndexes: u.blockIndexes,
    visibleText: u.visible.join(""),
    replacement: u.repl.join(""),
    parts: u.parts,
    hasText: u.hasText,
    varOnly: !u.hasText,
  }));
}
