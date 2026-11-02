/**
 * src/routes/workspace-routes.js — ручки про то, кто работает и в чьём черновике.
 *
 * Первый домен, переехавший из лестницы `if` в server.js. Выбран не случайно:
 * это самые молодые ручки студии, их поведение целиком описано тестами
 * (test-actor, test-mail-locks, test-mail-drafts), и переезд можно сверить.
 *
 * Зависимости передаются снаружи одним объектом, а не импортируются здесь:
 * так модуль не тянет за собой половину server.js и его можно проверять
 * подставными функциями.
 */
import {
  publicActor,
  listActiveActors,
  renameActor,
} from "../actor.js";
import {
  openDraft,
  listDrafts,
  draftChanges,
  publishDraft,
  discardDraft,
  listSnapshots,
  restoreSnapshot,
} from "../mail-drafts.js";
import {
  takeLease,
  refreshLease,
  releaseLease,
  readLease,
  listLeases,
  publicLease,
  LEASE_TTL_MS,
} from "../mail-locks.js";
import { MailStoreError, mailStoreStatus } from "../mail-store.js";

/**
 * @param {object} deps
 * @param {string} deps.repoRoot
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {() => boolean} deps.isReadOnly — режим витрины спрашиваем каждый раз,
 *   а не запоминаем: флаги читаются при старте, но проверка должна оставаться
 *   честной, если их когда-нибудь сделают переключаемыми.
 */
export function registerWorkspaceRoutes(router, deps) {
  const { repoRoot, sendJson, readRequestBody, isReadOnly } = deps;

  const fail = (response, error) => sendJson(response, mailStoreStatus(error), {
    ok: false,
    error: error.message,
    code: error.code,
    ...(error.holder ? { holder: error.holder } : {}),
    ...(error.changes ? { changes: error.changes } : {}),
  });

  const actorOf = (request) => {
    const actor = request.retkitActor;
    if (!actor) throw new MailStoreError("BAD_NAME", "Метка актёра не определена");
    return actor;
  };

  /* ─── Кто я ────────────────────────────────────────────────────────────── */

  router.get("/api/me", (request, response) => {
    const actor = request.retkitActor || null;
    sendJson(response, 200, {
      ok: true,
      me: publicActor(actor),
      readOnly: Boolean(isReadOnly()),
      others: listActiveActors(repoRoot)
        .filter((other) => other.token !== actor?.token)
        .map(publicActor),
    });
  });

  router.post("/api/me/name", async (request, response) => {
    try {
      const actor = actorOf(request);
      const body = await readRequestBody(request);
      sendJson(response, 200, { ok: true, me: publicActor(renameActor(repoRoot, actor.token, body?.name)) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });

  /* ─── Личные черновики ─────────────────────────────────────────────────── */
  // Правки идут в копию письма рядом, общая база меняется один раз — по
  // кнопке «опубликовать», с показом разницы. Ради этого агенту не нужно
  // спрашивать разрешение на каждую запись: он пишет в свой черновик.

  router.prefix("POST", "/api/drafts/", async (request, response, { tail }) => {
    try {
      const actor = actorOf(request);
      const body = await readRequestBody(request);
      const { brand = "", mail = "", force = false, at = 0 } = body || {};
      const readOnly = Boolean(isReadOnly());

      if (tail === "open") {
        const opened = await openDraft(repoRoot, { brand, mail, actor, readOnly });
        sendJson(response, 200, {
          ok: true, created: opened.created, draft: opened.draft.mail, brand: opened.draft.brand,
        });
        return;
      }
      if (tail === "publish") {
        sendJson(response, 200, {
          ok: true,
          ...await publishDraft(repoRoot, { brand, mail, actor, readOnly, force: Boolean(force) }),
        });
        return;
      }
      if (tail === "discard") {
        sendJson(response, 200, { ok: true, ...await discardDraft(repoRoot, { brand, mail, actor }) });
        return;
      }
      if (tail === "restore") {
        sendJson(response, 200, {
          ok: true,
          ...await restoreSnapshot(repoRoot, { brand, mail, at: Number(at), actor, readOnly }),
        });
        return;
      }
      sendJson(response, 404, { ok: false, error: "Неизвестное действие с черновиком" });
    } catch (error) {
      fail(response, error);
    }
  });

  router.prefix("GET", "/api/drafts", (request, response, { query }) => {
    const brand = query.get("brand") || "";
    const mail = query.get("mail") || "";
    try {
      const actor = actorOf(request);
      if (brand && mail) {
        sendJson(response, 200, {
          ok: true,
          changes: draftChanges(repoRoot, { brand, mail, actor }),
          history: listSnapshots(repoRoot, { brand, mail }),
        });
        return;
      }
      sendJson(response, 200, { ok: true, drafts: listDrafts(repoRoot, actor) });
    } catch (error) {
      fail(response, error);
    }
  });

  /* ─── Замки на письма ──────────────────────────────────────────────────── */
  // Интерфейс занимает письмо при открытии и подтверждает, что вкладка жива.
  // Закрыли вкладку — лиза протухнет сама, письмо освободится.

  router.prefix("POST", "/api/mail-lease/", async (request, response, { tail }) => {
    try {
      const actor = actorOf(request);
      const body = await readRequestBody(request);
      const { brand = "", mail = "", force = false } = body || {};

      if (tail === "take" || tail === "beat") {
        const lease = tail === "take"
          ? takeLease(repoRoot, { brand, mail, actor, force: Boolean(force) })
          : refreshLease(repoRoot, { brand, mail, actor });
        sendJson(response, 200, { ok: true, lease: publicLease({ ...lease, ageMs: 0 }), ttlMs: LEASE_TTL_MS });
        return;
      }
      if (tail === "release") {
        sendJson(response, 200, { ok: true, ...releaseLease(repoRoot, { brand, mail, actor }) });
        return;
      }
      sendJson(response, 404, { ok: false, error: "Неизвестное действие с замком" });
    } catch (error) {
      fail(response, error);
    }
  });

  router.prefix("GET", "/api/mail-lease", (request, response, { query }) => {
    const brand = query.get("brand") || "";
    const mail = query.get("mail") || "";
    try {
      if (!brand || !mail) {
        sendJson(response, 200, { ok: true, leases: listLeases(repoRoot) });
        return;
      }
      const lease = readLease(repoRoot, { brand, mail });
      sendJson(response, 200, {
        ok: true,
        lease: publicLease(lease),
        mine: Boolean(lease && lease.token === request.retkitActor?.token),
        ttlMs: LEASE_TTL_MS,
      });
    } catch (error) {
      fail(response, error);
    }
  });

  return router;
}
