/**
 * src/figma-inbox.js — макет, присланный плагином Figma, ждёт открытую студию.
 *
 * Зачем это вообще нужно. У корпоративной Figma путь по токену закрыт не
 * технически, а по смыслу: персональный токен нельзя ограничить одним файлом,
 * он открывает ВСЁ, что видит его владелец, — то есть всю базу макетов
 * компании. Поэтому рабочий путь один: плагин, который живёт внутри Figma под
 * собственным доступом человека и шлёт разобранный фрейм на его же машину.
 *
 * Чего не хватало. Плагин слал макет на `POST /api/figma/import`, сервер
 * отвечал плагину — и всё. Человек нажимал «Отправить в студию», переключался
 * в студию и не видел там ничего: студия о посылке не знала. Путь без токена
 * формально работал и практически был бесполезен.
 *
 * Что делает ящик. Принимает посылку, прогоняет её через ТОТ ЖЕ разбор, что и
 * вставка через Ctrl+V (`planFromFigmaImport` + подбор блоков), и держит
 * результат, пока студия за ним не придёт. Номер ревизии растёт с каждой
 * посылкой: открытое окно вставки по нему понимает, что приехало новое, а не
 * показывает одно и то же дважды.
 *
 * Ящик живёт в памяти процесса и это осознанно: макет — не документ, а
 * секундная передача из соседнего окна. Переживать перезапуск ему незачем, а
 * писать чужие макеты на диск студии — лишняя ответственность там, где её не
 * просили.
 */

import { planFromFigmaImport, describePlan } from "./figma-intake.js";
import { matchSectionsToBlocks, describeMatches } from "./design-to-blocks.js";

/** Сколько посылок помним. Нужна по сути последняя: ящик — не история. */
const KEEP = 1;

let revision = 0;
let box = null;

/** Забыть принятое (для тестов и для «начали сначала»). */
export function resetFigmaInbox() {
  revision = 0;
  box = null;
}

/**
 * Принять посылку от плагина.
 *
 * @param {object} payload — `figmaImport` из плагина: sections/texts/images
 *                           с координатами. Форма совпадает с тем, что
 *                           отдаёт `figma.importFromUrl`, — поэтому разбор
 *                           один и тот же, а не «почти такой же».
 * @param {object} [opts]
 * @param {() => Array} [opts.blocks] — каталог блоков для подбора
 * @returns {{ok:boolean, revision:number, reason?:string}}
 */
export function receiveFigmaPluginImport(payload, opts = {}) {
  const sections = Array.isArray(payload?.sections) ? payload.sections : [];
  if (!sections.length) {
    // Пустая посылка — это не поломка: плагин мог прислать одну ссылку или
    // один снимок. Просто в ящик класть нечего, и врать об этом не надо.
    return { ok: false, revision, reason: "в посылке нет секций макета" };
  }

  let plan;
  try {
    plan = planFromFigmaImport(payload);
  } catch (error) {
    return { ok: false, revision, reason: `разбор макета не удался: ${error.message}` };
  }

  let match = null;
  try {
    const blocks = typeof opts.blocks === "function" ? opts.blocks() : [];
    if (Array.isArray(blocks) && blocks.length) match = matchSectionsToBlocks({ plan, blocks });
  } catch {
    // Подбор блоков — подсказка, а не условие приёмки. Каталог мог не
    // прогрузиться; макет из-за этого терять незачем.
    match = null;
  }

  revision += 1;
  box = {
    revision,
    receivedAt: new Date().toISOString(),
    source: String(payload?.source || "figma-plugin"),
    selection: {
      name: String(payload?.selectionName || ""),
      page: String(payload?.pageName || ""),
      file: String(payload?.fileName || ""),
      preview: String(payload?.previewImage?.url || payload?.previewImage?.dataUrl || ""),
    },
    // Чужой макет приходит ссылкой на файл «только просмотр», а плагины в
    // таком файле не работают: человек делает Duplicate и запускает плагин в
    // копии. Копия остаётся у него в Drafts и там копится — чужой макет,
    // который никто не просил хранить. Напомнить про неё дешевле, чем потом
    // разгребать.
    looksLikeCopy: isDuplicateName(payload?.fileName),
    plan,
    summary: describePlan(plan),
    ...(match ? { match, matchSummary: describeMatches(match) } : {}),
  };
  return { ok: true, revision };
}

/**
 * Что лежит в ящике.
 *
 * @param {number} [since] — ревизия, которую студия уже видела. Меньше или
 *                           равно — значит нового нет, и показывать нечего.
 */
export function peekFigmaInbox(since = 0) {
  const seen = Number(since) || 0;
  if (!box || box.revision <= seen) return { revision, fresh: false, design: null };
  return { revision, fresh: true, design: box };
}

/**
 * Похоже ли имя файла на копию, сделанную ради плагина.
 *
 * Figma называет дубликат «Имя (Copy)»; русский интерфейс даёт «Копия Имя».
 * Точность здесь не нужна — нужна подсказка: имя файла человек видит рядом и
 * решает сам.
 */
function isDuplicateName(name) {
  const value = String(name || "");
  if (!value) return false;
  // \b здесь не годится: для JS кириллица — не «слово», и граница после
  // «копия» не срабатывает. Проверяем разделитель явно.
  return /\((?:copy|копия)\)/i.test(value) || /^(?:копия|copy of)[\s:_-]/i.test(value.trim());
}

/** Сколько посылок ящик вообще принял — для диагностики и тестов. */
export function figmaInboxRevision() { return revision; }

export const FIGMA_INBOX_KEEP = KEEP;
