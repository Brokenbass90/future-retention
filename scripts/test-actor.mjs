#!/usr/bin/env node
/**
 * test-actor.mjs — студия знает, чья это рука.
 *
 * Это фундамент разведения по людям: замки на письма и личные черновики без
 * ответа «кто ты» невозможны. Опасны здесь три вещи, и все три тихие.
 *
 * Первая: два человека получают ОДНУ метку — тогда разведение бессмысленно,
 * а замок одного открывает письмо другому.
 * Вторая: человек теряет метку между запросами — тогда его же черновики
 * становятся ему чужими на следующем заходе.
 * Третья: агент притворяется человеком (или наоборот) — тогда «агент не
 * трогает то, что правит человек» перестаёт что-либо значить, потому что это
 * один и тот же актёр.
 *
 * Плюс проверяем, что наружу не утекает сам токен: он — ключ к чужой работе.
 *
 * Zero-AI, без сети, диск только во временной папке. Exit 0 = pass.
 */
import {
  ACTOR_COOKIE,
  ACTOR_HEADER,
  parseCookies,
  newActorToken,
  isActorToken,
  actorFromRequest,
  actorCookieHeader,
  normalizeActorName,
  defaultActorName,
  describeActor,
  resolveActor,
  renameActor,
  readActorRecord,
  listActiveActors,
  publicActor,
} from "../src/actor.js";
import { resolveStudioRuntimeFlags } from "../src/runtime-flags.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const req = (headers = {}) => ({ headers });
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/* ─── 1. Cookie разбирается, а не угадывается ────────────────────────────── */
{
  const jar = parseCookies("a=1; retkit_actor=abc; b=%D0%BA");
  check("несколько пар разбираются", jar.a === "1" && jar.retkit_actor === "abc");
  check("значение раскодируется", jar.b === "к", jar.b);
  const junk = parseCookies("=1; ;; x; broken");
  check("пары без имени пропускаются", !Object.prototype.hasOwnProperty.call(junk, ""), JSON.stringify(junk));
  check("пары без знака равенства пропускаются", Object.keys(junk).length === 0, JSON.stringify(junk));
  check("пустой заголовок — пустая корзина", Object.keys(parseCookies("")).length === 0);
}

/* ─── 2. Метки разные у разных людей ─────────────────────────────────────── */
{
  const tokens = new Set(Array.from({ length: 200 }, () => newActorToken()));
  check("200 меток — 200 разных", tokens.size === 200, String(tokens.size));
  check("метка проходит проверку формы", [...tokens].every(isActorToken));
  for (const bad of ["", "нет", "../../etc/passwd", "ABC123", "a".repeat(31), "a".repeat(33)]) {
    check(`чужая строка не метка: ${JSON.stringify(bad).slice(0, 24)}`, !isActorToken(bad));
  }
}

/* ─── 3. Кто пришёл ──────────────────────────────────────────────────────── */
{
  const token = newActorToken();
  const other = newActorToken();

  const fresh = actorFromRequest(req());
  check("без метки выдаём новую", fresh.fresh === true && isActorToken(fresh.token));
  check("новый по умолчанию — человек", fresh.kind === "human");

  const returning = actorFromRequest(req({ cookie: `${ACTOR_COOKIE}=${token}` }));
  check("метку из cookie узнаём", returning.token === token && returning.fresh === false);

  const agent = actorFromRequest(req({ [ACTOR_HEADER]: token }));
  check("метка в заголовке — это агент", agent.kind === "agent" && agent.token === token);

  // Самое важное различение: у человека открыт браузер, и оттуда же по MCP
  // пришёл его Клод. Если заголовок проиграет cookie, агент станет человеком
  // и сможет молча переписать то, что человек правит прямо сейчас.
  const both = actorFromRequest(req({ cookie: `${ACTOR_COOKIE}=${token}`, [ACTOR_HEADER]: other }));
  check("заголовок агента важнее cookie человека", both.kind === "agent" && both.token === other);

  const demo = actorFromRequest(req(), { demo: true });
  check("на витрине новый — зритель", demo.kind === "demo");

  const cookie = actorCookieHeader(token);
  check("cookie не читается скриптами страницы", cookie.includes("HttpOnly"));
  check("cookie не уходит на чужие сайты", cookie.includes("SameSite=Lax"));
  check("cookie живёт долго", /Max-Age=\d{7,}/.test(cookie), cookie);
  check("по https добавляем Secure", actorCookieHeader(token, { secure: true }).includes("Secure"));
  check("по http Secure не ставим", !cookie.includes("Secure"));
}

/* ─── 4. Имя ─────────────────────────────────────────────────────────────── */
{
  check("лишние пробелы схлопываются", normalizeActorName("  Коля   бро ") === "Коля бро");
  check("перевод строки не ломает имя", normalizeActorName("Ко\nля") === "Ко ля");
  check("управляющие символы вычищены", !normalizeActorName("Коля").includes(""));
  check("длина ограничена", normalizeActorName("я".repeat(200)).length === 40);
  check("пустое имя допустимо", normalizeActorName(null) === "");

  const token = "ab12".padEnd(32, "0");
  check("без имени человек узнаваем", defaultActorName(token) === "Без имени ab12");
  check("агент называется агентом", defaultActorName(token, "agent") === "Агент-ab12");
  check("в интерфейсе агент помечен", describeActor({ token, kind: "agent", name: "Коля" }) === "Коля (агент)");
  check("человек — просто имя", describeActor({ token, kind: "human", name: "Коля" }) === "Коля");
}

/* ─── 5. Карточка живёт на диске ─────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-actor-"));
  try {
    const first = resolveActor(root, req());
    check("новому актёру завели карточку", Boolean(readActorRecord(root, first.actor.token)));
    check("на новую метку выдаём cookie", first.issued === true);

    const cookieHeader = { cookie: `${ACTOR_COOKIE}=${first.actor.token}` };
    const second = resolveActor(root, req(cookieHeader));
    check("вернувшийся — тот же актёр", second.actor.token === first.actor.token);
    check("повторно cookie не шлём", second.issued === false);

    // Ради этого и заведено: человек уходит и приходит, а его имя (а дальше и
    // его черновики) остаются его.
    renameActor(root, first.actor.token, "Коля");
    const third = resolveActor(root, req(cookieHeader), { now: Date.now() + 60_000 });
    check("имя пережило перезаход", third.actor.name === "Коля");

    const beforeTouch = readActorRecord(root, first.actor.token).lastSeenAt;
    resolveActor(root, req(cookieHeader), { now: beforeTouch + 1000 });
    check("карточку не переписываем на каждый запрос",
      readActorRecord(root, first.actor.token).lastSeenAt === beforeTouch);
    resolveActor(root, req(cookieHeader), { now: beforeTouch + 60_000 });
    check("но раз в минуту отмечаем, что актёр живой",
      readActorRecord(root, first.actor.token).lastSeenAt === beforeTouch + 60_000);

    const agent = resolveActor(root, req({ [ACTOR_HEADER]: first.actor.token }));
    check("та же метка заголовком — это агент", agent.actor.kind === "agent");

    const mate = resolveActor(root, req());
    const active = listActiveActors(root);
    check("в студии видно обоих", active.length === 2, String(active.length));
    check("давно ушедших не показываем",
      listActiveActors(root, { now: Date.now() + 10 * 60_000 }).length === 0);
    check("свежая метка отличается от чужой", mate.actor.token !== first.actor.token);

    let rejected = "";
    try { renameActor(root, "не-метка", "Х"); } catch (error) { rejected = error.message; }
    check("переименовать несуществующего нельзя", Boolean(rejected), rejected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 6. Токен наружу не отдаём ──────────────────────────────────────────── */
{
  const token = newActorToken();
  const view = publicActor({ token, kind: "human", name: "Коля" });
  const asText = JSON.stringify(view);
  check("полного токена в публичном виде нет", !asText.includes(token), asText);
  check("но актёра можно отличить", view.id.startsWith("human:") && view.id.length < 20, view.id);
  check("имя отдаём как есть", view.name === "Коля" && view.named === true);
}

/* ─── 7. Витрина ─────────────────────────────────────────────────────────── */
{
  const demo = resolveStudioRuntimeFlags({ STUDIO_PUBLIC_DEMO: "1" });
  check("публичная демка по умолчанию только для чтения", demo.readOnly === true);
  const local = resolveStudioRuntimeFlags({});
  check("локальная студия пишет как обычно", local.readOnly === false);
  const forced = resolveStudioRuntimeFlags({ STUDIO_READONLY: "1" });
  check("режим чтения включается отдельно", forced.readOnly === true);
}

/* ─── 8. Подключение ─────────────────────────────────────────────────────── */
{
  const server = read("server.js");
  check("актёр определяется на каждом запросе", /resolveActor\(__dirname, request/.test(server));
  check("cookie ставим только когда выдали", /if \(issued\)[\s\S]{0,120}actorCookieHeader/.test(server));
  // Домен переехал из лестницы `if` в src/routes/workspace-routes.js — там и
  // проверяем. В server.js остался только вызов маршрутизатора.
  const routes = read("src", "routes", "workspace-routes.js");
  check("есть ручка «кто я»", /router\.get\("\/api\/me"/.test(routes));
  check("имя можно поменять", /router\.post\("\/api\/me\/name"/.test(routes));
  check("сервер отдаёт запрос маршрутизатору", /studioRouter\.dispatch\(request, response\)/.test(server));
  check("сбой меток не роняет студию", /catch \(actorError\)/.test(server));

  const badge = read("public", "actor-badge.js");
  check("бейдж сам монтируется", /getElementById\("actorBadge"\)/.test(badge));
  check("бейдж даёт переименоваться", /\/api\/me\/name/.test(badge));

  for (const page of ["constructor.html", "workbench.html"]) {
    const html = read("public", page);
    check(`бейдж есть в ${page}`, html.includes('id="actorBadge"'));
    check(`скрипт бейджа подключён в ${page}`, html.includes('src="/actor-badge.js"'));
    check(`стили бейджа подключены в ${page}`, html.includes('href="/actor-badge.css"'));
  }

  const css = read("public", "actor-badge.css");
  for (const cls of ["actor-badge", "actor-name", "actor-others", "actor-readonly"]) {
    check(`есть стиль .${cls}`, css.includes(`.${cls}`));
  }

  check("личные метки не уезжают в репозиторий", read(".gitignore").includes(".retkit/"));
}

/* ─── 9. Бейдж действительно рисуется ────────────────────────────────────── */
{
  // Headless-браузера в этой среде нет, поэтому вместо скриншота исполняем
  // сам файл бейджа в DOM из linkedom с подставным /api/me. Проверяем то же,
  // что увидел бы глаз: имя на месте, соседи посчитаны, режим чтения подписан.
  const { parseHTML } = await import("linkedom");
  const badgeSource = read("public", "actor-badge.js");

  const runBadge = async (payload) => {
    const { document, window } = parseHTML(
      `<html><body><div class="actor-badge" id="actorBadge"></div></body></html>`
    );
    const calls = [];
    window.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input) === "/api/me/name") {
        const name = JSON.parse(init.body).name.trim();
        return { ok: true, json: async () => ({ ok: true, me: { ...payload.me, name, displayName: name, named: true } }) };
      }
      return { ok: true, json: async () => payload };
    };
    window.setInterval = () => 0;
    window.prompt = () => "Коля";
    const scope = {
      window, document,
      fetch: window.fetch,
      setInterval: window.setInterval,
      console,
    };
    const run = new Function(...Object.keys(scope), badgeSource);
    run(...Object.values(scope));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { document, window, calls };
  };

  const alone = await runBadge({
    ok: true,
    me: { id: "human:ab12", kind: "human", name: "Коля", displayName: "Коля", named: true },
    readOnly: false,
    others: [],
  });
  const badgeHtml = alone.document.getElementById("actorBadge").innerHTML;
  check("имя человека видно в шапке", badgeHtml.includes("Коля"), badgeHtml.slice(0, 120));
  check("одному счётчик соседей не показываем", !badgeHtml.includes("actor-others"));
  check("в рабочем режиме пометки «только чтение» нет", !badgeHtml.includes("actor-readonly"));

  const crowded = await runBadge({
    ok: true,
    me: { id: "human:ab12", kind: "human", name: "", displayName: "Без имени ab12", named: false },
    readOnly: true,
    others: [
      { id: "human:cd34", kind: "human", name: "Саша", displayName: "Саша", named: true },
      { id: "agent:ef56", kind: "agent", name: "", displayName: "Агент-ef56", named: false },
    ],
  });
  const crowdedHtml = crowded.document.getElementById("actorBadge").innerHTML;
  check("безымянного зовём назваться", crowdedHtml.includes("✎"), crowdedHtml.slice(0, 140));
  check("соседи посчитаны", crowdedHtml.includes(">+2<"), crowdedHtml.slice(0, 200));
  check("имена соседей в подсказке", crowdedHtml.includes("Саша") && crowdedHtml.includes("Агент-ef56"));
  check("витрина подписана", crowdedHtml.includes("только чтение"));

  // Чужое имя приходит с сервера и попадает в разметку — значит его надо
  // экранировать, иначе второй человек сможет что-нибудь подсунуть первому.
  const nasty = await runBadge({
    ok: true,
    me: { id: "human:ab12", kind: "human", name: "x", displayName: "<img src=x onerror=alert(1)>", named: true },
    readOnly: false,
    others: [],
  });
  const nastyHtml = nasty.document.getElementById("actorBadge").innerHTML;
  check("чужое имя экранируется", !nastyHtml.includes("<img"), nastyHtml.slice(0, 160));

  const clickable = alone.document.querySelector(".actor-name");
  clickable.dispatchEvent(new alone.window.Event("click"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("клик по имени отправляет переименование",
    alone.calls.some((call) => call.url === "/api/me/name"), JSON.stringify(alone.calls.map((c) => c.url)));
}

console.log(`\nactor: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
