/**
 * src/agent-vision.js — оператор смотрит на письмо, а не пересказывает его.
 *
 * До этого оператор студии работал вслепую. Он собирал письмо из блоков и
 * отчитывался «готово», ни разу его не увидев: в руках у него был HTML и
 * дерево блоков, а как это выглядит — он додумывал. Отсюда и случай
 * 15.09.2026: агент разложил текст по блокам, оставил образцовую зелёную
 * подсветку и кнопку «Перейти» и сказал, что письмо собрано.
 *
 * Здесь две вещи, которых ему не хватало: снимок собранного письма и снимок
 * блока из библиотеки. Обе отдают картинку — не описание картинки.
 *
 * Картинка попадает в разговор не как результат инструмента (модель туда
 * изображения не принимает), а отдельным сообщением: инструмент кладёт её в
 * ctx.pendingImages, а цикл агента дописывает следующим ходом. Из-за этого
 * порядок важен — снимок появляется ПОСЛЕ ответа инструмента, и в тексте
 * ответа мы прямо говорим модели, что картинка идёт следом.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { renderHtmlShot, ShotUnavailableError } from "./shot.js";

const MAX_IMAGES_PER_RUN = 6;

/** Положить картинку в очередь на показ модели. */
function queueImage(ctx, dataUrl, note) {
  if (!ctx) return false;
  ctx.pendingImages = ctx.pendingImages || [];
  if (ctx.pendingImages.length >= MAX_IMAGES_PER_RUN) return false;
  ctx.pendingImages.push({ dataUrl, note });
  return true;
}

/**
 * Снять письмо, которое сейчас в работе.
 *
 * На поверхности кода снимаем открытый HTML — ровно то, что человек видит
 * справа. На конструкторе — живую вёрстку канваса, которую браузер прислал
 * вместе с запросом.
 *
 * Честная оговорка в ответе: правки, сделанные агентом в этом же разговоре,
 * в снимок не попадут — их применяет браузер. Умолчать об этом нельзя, иначе
 * агент решит, что его правка не сработала, и сделает её второй раз.
 */
export async function seeEmail(args, ctx) {
  const html = String(ctx?.html || "").trim();
  if (!html) {
    return {
      error: "Нечего снимать: в этом разговоре нет вёрстки письма.",
      hint: ctx?.surface === "constructor"
        ? "Соберите письмо на канвасе — снимок берётся с живого превью."
        : "Откройте письмо в редакторе кода.",
    };
  }
  const view = args?.view === "mobile" ? "mobile" : "desktop";
  try {
    const shot = await renderHtmlShot({ html, view });
    const queued = queueImage(
      ctx,
      `data:image/png;base64,${shot.png.toString("base64")}`,
      `письмо, вид ${view}`,
    );
    const pending = Array.isArray(ctx?.canvasOps) && ctx.canvasOps.length;
    return {
      ok: true,
      view,
      width: shot.width,
      height: shot.height,
      note: queued
        ? "Снимок письма идёт следующим сообщением — посмотрите на него, прежде чем судить о вёрстке."
        : "Лимит снимков за один разговор исчерпан.",
      ...(pending ? { warning: `Ваши правки этого разговора (${pending}) в снимок ещё не попали: их применяет браузер.` } : {}),
    };
  } catch (error) {
    if (error instanceof ShotUnavailableError) {
      return { error: error.message, hint: "Работайте без снимка, но не выдумывайте, как письмо выглядит." };
    }
    return { error: String(error?.message || error) };
  }
}

/**
 * Показать блок из библиотеки картинкой.
 *
 * Превью нарисованы заранее (data/block-previews). Нет превью — так и
 * говорим: выдумывать вид блока по имени и слотам нельзя, имена не описывают
 * внешность.
 */
export function seeBlock(args, ctx, { previewRoot, blocks }) {
  const id = String(args?.id || "").trim();
  if (!id) return { error: "id блока обязателен." };
  const block = (blocks || []).find((candidate) => candidate.id === id);
  if (!block) return { error: `Блок "${id}" не найден.`, hint: "Посмотрите list_canonical_blocks." };

  const preview = block.preview || {};
  if (preview.status !== "ok") {
    return {
      error: `У блока "${id}" нет готового превью${preview.error ? ` (${preview.error})` : ""}.`,
      hint: "Как он выглядит — узнаете, поставив его в письмо и сняв see_email. Не описывайте вид по имени.",
    };
  }
  const view = args?.view === "mobile" ? "mobile" : "desktop";
  // Превью описано объектом {url, width, height}: снимок нужен вместе с
  // размером, иначе по картинке нельзя судить, высокий блок или низкий.
  const shot = view === "mobile" ? preview.mobile : preview.desktop;
  const url = typeof shot === "string" ? shot : shot?.url;
  if (!url) return { error: `У блока "${id}" нет снимка «${view}».` };

  // URL превью — это путь раздачи (/block-previews/...). Файл лежит рядом,
  // читаем с диска: гонять картинку по HTTP через самого себя незачем.
  const file = path.join(previewRoot, String(url).replace(/^\/+block-previews\/+/, ""));
  if (!existsSync(file)) return { error: `Файл превью не найден: ${url}` };
  const queued = queueImage(
    ctx,
    `data:image/png;base64,${readFileSync(file).toString("base64")}`,
    `блок ${id}, вид ${view}`,
  );
  return {
    ok: true,
    id,
    view,
    width: typeof shot === "object" ? shot.width : null,
    height: typeof shot === "object" ? shot.height : null,
    note: queued ? "Картинка блока идёт следующим сообщением." : "Лимит снимков за один разговор исчерпан.",
  };
}
