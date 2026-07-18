import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertPortableBlockSource } from "../src/block-library-review.js";
import {
  auditMailSourceBeforeBuild,
  resolveWorkbenchMailRoot,
  resolveWorkbenchSourcePath,
  validateWorkbenchSourceContent,
} from "../src/mail-source-security.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "retkit-mail-source-security-"));
const emailBaseRoot = path.join(temporary, "email-base");
const brand = "X_Test";
const mail = "mail-safe";
const mailRoot = path.join(emailBaseRoot, brand, mail);
const appRoot = path.join(mailRoot, "app");

async function put(relative, content) {
  const target = path.join(emailBaseRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

function expectReject(fn, pattern, label) {
  assert.throws(fn, pattern, label);
}

try {
  await put("vendor/helpers/head.pug", "meta(charset='utf-8')\n");
  await put(`${brand}/${mail}/app/templates/index.pug`, [
    "doctype html",
    "html",
    "  head",
    "    include ../../../../vendor/helpers/head",
    "  body",
    "    include blocks/header",
    "",
  ].join("\n"));
  await put(`${brand}/${mail}/app/templates/blocks/header.pug`, "table(role='presentation')\n  tr\n    td Safe email\n");
  await put(`${brand}/${mail}/app/styles/common.styl`, "@import 'helpers/variables'\n@import 'blocks/**/*'\nbody\n  color textColor\n");
  await put(`${brand}/${mail}/app/styles/helpers/variables.styl`, "textColor = #222\n");
  await put(`${brand}/${mail}/app/styles/blocks/main.styl`, ".body\n  background #fff\n");
  await put(`${brand}/${mail}/app/assets/styles/common.css`, ".safe { color: #222; }\n");

  const audit = auditMailSourceBeforeBuild({ emailBaseRoot, brand, mail });
  assert.equal(audit.ok, true);
  assert.equal(audit.filesAudited, 6);

  const resolvedMail = resolveWorkbenchMailRoot({ emailBaseRoot, brand, mail });
  assert.equal(resolvedMail.appRoot, appRoot);
  const safeSource = resolveWorkbenchSourcePath({
    emailBaseRoot,
    brand,
    mail,
    file: "templates/blocks/header.pug",
  });
  assert.equal(safeSource.target, path.join(appRoot, "templates/blocks/header.pug"));

  for (const unsafePath of [
    "../styles/common.styl",
    "templates/../../styles/common.styl",
    "/etc/passwd.pug",
    "templates\\blocks\\header.pug",
  ]) {
    expectReject(
      () => resolveWorkbenchSourcePath({ emailBaseRoot, brand, mail, file: unsafePath }),
      /invalid|escapes/i,
      `source path must be contained: ${unsafePath}`,
    );
  }
  expectReject(
    () => resolveWorkbenchMailRoot({ emailBaseRoot, brand: "../X_Test", mail }),
    /invalid/i,
  );

  const outsidePug = path.join(temporary, "outside.pug");
  await writeFile(outsidePug, "p= process.env.OPENAI_API_KEY\n", "utf8");
  await symlink(outsidePug, path.join(appRoot, "templates/escape.pug"));
  expectReject(
    () => resolveWorkbenchSourcePath({ emailBaseRoot, brand, mail, file: "templates/escape.pug" }),
    /symlink escapes/i,
  );

  const pugContext = {
    target: safeSource.target,
    file: safeSource.file,
    mailRoot,
    emailBaseRoot,
  };
  const unsafePug = [
    "p= process.env.OPENAI_API_KEY",
    "p #{process.env.OPENAI_API_KEY}",
    "- 'apparently static but unbuffered code'",
    "a(href=process.env.HOME) unsafe",
    "script.\n  globalThis.compromised = true",
    "iframe(src='https://example.test')",
    "base(href='https://example.test')",
    "include ../../../../../../.env",
    "include:markdown blocks/header.pug",
  ];
  for (const content of unsafePug) {
    expectReject(
      () => validateWorkbenchSourceContent({ ...pugContext, content }),
      /not allowed|static|escapes|executable|raw\/filtered/i,
      `unsafe Pug must be rejected: ${content.split("\n")[0]}`,
    );
  }

  const stylSource = resolveWorkbenchSourcePath({
    emailBaseRoot,
    brand,
    mail,
    file: "styles/common.styl",
  });
  const stylContext = {
    target: stylSource.target,
    file: stylSource.file,
    mailRoot,
    emailBaseRoot,
  };
  const unsafeStylus = [
    "@js { process.mainModule.require('fs').readFileSync('/etc/passwd') }",
    "secret = '../../../../.env'\n@import secret",
    "@import '../../../../.env'",
    "payload = json('../../../../package.json')",
    "body\n  background embedurl('../../../../.env')",
  ];
  for (const content of unsafeStylus) {
    expectReject(
      () => validateWorkbenchSourceContent({ ...stylContext, content }),
      /not allowed|static quoted|escapes|file-reading/i,
      `unsafe Stylus must be rejected: ${content.split("\n")[0]}`,
    );
  }

  const cssSource = resolveWorkbenchSourcePath({
    emailBaseRoot,
    brand,
    mail,
    file: "assets/styles/common.css",
  });
  expectReject(
    () => validateWorkbenchSourceContent({
      content: ".bad { background: url(javascript:alert(1)); }",
      target: cssSource.target,
      file: cssSource.file,
      mailRoot,
      emailBaseRoot,
    }),
    /executable/i,
  );

  // Direct conversion runs in the server process, so it must use the same
  // declarative gate before invoking Pug or Stylus.
  expectReject(
    () => assertPortableBlockSource({ id: "convert", pug: "p= process.env.OPENAI_API_KEY", styl: "", slots: [] }),
    /portable source gate/i,
  );
  expectReject(
    () => assertPortableBlockSource({ id: "convert", pug: "", styl: "@js { global.pwned = true }", slots: [] }),
    /portable source gate/i,
  );

  const originalHeader = await readFile(safeSource.target, "utf8");
  expectReject(
    () => validateWorkbenchSourceContent({ ...pugContext, content: "p= process.env.OPENAI_API_KEY" }),
    /static|expressions/i,
  );
  assert.equal(await readFile(safeSource.target, "utf8"), originalHeader, "validation failure must occur before source write");

  await writeFile(safeSource.target, "p= process.env.OPENAI_API_KEY\n", "utf8");
  expectReject(
    () => auditMailSourceBeforeBuild({ emailBaseRoot, brand, mail }),
    /static|expressions/i,
    "pre-build audit must stop a malicious source already on disk",
  );

  const serverSource = await readFile(path.join(projectRoot, "server.js"), "utf8");
  assert.doesNotMatch(serverSource, /env\s*:\s*process\.env/, "compiler subprocesses must never inherit the full server environment");
  const envStart = serverSource.indexOf("const buildSubprocessEnv");
  const envEnd = serverSource.indexOf("const previewBuildCoordinator", envStart);
  const envSection = serverSource.slice(envStart, envEnd);
  assert.ok(envStart >= 0 && envEnd > envStart, "sanitized subprocess environment must be defined");
  assert.doesNotMatch(envSection, /OPENAI|DEEPL|FIGMA|AUTH|PASSWORD|SECRET|TOKEN|API_KEY/i);

  const saveStart = serverSource.indexOf('request.url === "/api/wb/email-file"');
  const buildStart = serverSource.indexOf('request.url === "/api/wb/build-email"');
  const convertStart = serverSource.indexOf('request.url === "/api/wb/convert"');
  const importStart = serverSource.indexOf('request.url === "/api/wb/email-import"');
  const saveSection = serverSource.slice(saveStart, buildStart);
  const buildSection = serverSource.slice(buildStart, convertStart);
  const convertSection = serverSource.slice(convertStart, importStart);
  assert.match(saveSection, /resolveWorkbenchSourcePath/);
  assert.match(saveSection, /validateWorkbenchSourceContent/);
  assert.match(saveSection, /acquireKeyedOperationLock/);
  assert.match(buildSection, /auditMailSourceBeforeBuild/);
  assert.match(buildSection, /env:\s*buildSubprocessEnv/);
  assert.match(convertSection, /assertPortableBlockSource[\s\S]*pug\.render/);
  assert.match(convertSection, /assertPortableBlockSource[\s\S]*stylus\(String/);

  console.log("mail source security tests: ok");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
