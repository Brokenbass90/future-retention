/**
 * src/router.js — маленький маршрутизатор, чтобы лестница в server.js
 * перестала расти.
 *
 * Сейчас все 85 ручек студии разобраны одной лестницей `if` длиной в
 * девятнадцать тысяч строк. Это не эстетическая беда: чтобы понять, что
 * делает ручка, её надо найти среди сотни соседей; чтобы добавить новую,
 * приходится вклиниваться в середину; а любая правка рядом задевает всё.
 * Каждый этап работы упирался именно в это.
 *
 * Переписывать всё разом нельзя — в лестнице живут ручки, которые никто не
 * трогал год, и их поведение нигде не описано, кроме самого кода. Поэтому
 * маршрутизатор вводится рядом: домены переезжают в него по одному, а
 * оставшаяся лестница работает как работала. Число оставшихся в ней ручек
 * зафиксировано храповиком (scripts/test-api-surface.mjs) и может только
 * уменьшаться.
 *
 * Нарочно без зависимостей и без магии: точное совпадение пути и совпадение
 * по префиксу — всё, что нужно этому серверу. Параметров в пути (`/x/:id`)
 * здесь нет, потому что их нет и в студии: она разбирает хвост сама.
 */

export function createRouter({ name = "routes" } = {}) {
  const exact = new Map();   // "GET /api/me" → handler
  const prefixed = [];       // { method, prefix, handler }

  const key = (method, pathname) => `${String(method).toUpperCase()} ${pathname}`;

  const api = {
    name,

    /** Ручка с точным путём. */
    on(method, pathname, handler) {
      const id = key(method, pathname);
      if (exact.has(id)) throw new Error(`Маршрут ${id} уже зарегистрирован`);
      exact.set(id, handler);
      return api;
    },

    get(pathname, handler) { return api.on("GET", pathname, handler); },
    post(pathname, handler) { return api.on("POST", pathname, handler); },

    /**
     * Ручка, разбирающая хвост пути сама (`/api/drafts/publish`).
     * Хвост отдаётся обработчику отдельным аргументом — чтобы он не резал
     * строку руками и не забывал про `?query`.
     */
    prefix(method, value, handler) {
      prefixed.push({ method: String(method).toUpperCase(), prefix: value, handler });
      return api;
    },

    /** Что зарегистрировано — для тестов и отчётов. */
    list() {
      return [
        ...[...exact.keys()].map((id) => ({ kind: "exact", id })),
        ...prefixed.map((entry) => ({ kind: "prefix", id: `${entry.method} ${entry.prefix}*` })),
      ].sort((a, b) => a.id.localeCompare(b.id));
    },

    /**
     * Отдать запрос подходящей ручке.
     *
     * @returns {Promise<boolean>} обработан ли запрос. false означает «не моё» —
     *   сервер продолжает разбирать запрос старой лестницей. Именно это
     *   позволяет переезжать по одному домену за раз.
     */
    async dispatch(request, response, context = {}) {
      const method = String(request.method || "").toUpperCase();
      const pathname = String(request.url || "").split("?")[0];

      const handler = exact.get(key(method, pathname));
      if (handler) {
        await handler(request, response, { ...context, pathname, tail: "", query: queryOf(request) });
        return true;
      }

      for (const entry of prefixed) {
        if (entry.method !== method) continue;
        if (!pathname.startsWith(entry.prefix)) continue;
        await entry.handler(request, response, {
          ...context,
          pathname,
          tail: pathname.slice(entry.prefix.length),
          query: queryOf(request),
        });
        return true;
      }
      return false;
    },
  };

  return api;
}

function queryOf(request) {
  try {
    return new URL(request.url, "http://localhost").searchParams;
  } catch {
    return new URLSearchParams();
  }
}
