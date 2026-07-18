export function constructorBuildMailArgs({ brand, mailName, preview = false }) {
  const args = ["tools/build-mail.js", "--category", brand, "--mail", mailName];
  const isTemporaryWorkingCopy = preview || brand === "X_preview";
  // Iframe previews and the hidden Constructor -> Code working copy only need
  // one initial locale. Workbench builds newly selected/created locales on
  // demand, so compiling the whole vendor locale catalog here only makes the
  // handoff look frozen. Permanent constructor saves still rebuild every
  // locale present in vendor/data; otherwise the builder would prune locale
  // directories omitted from --locales.
  if (isTemporaryWorkingCopy) {
    // Iframe previews read compact index.html. --pretty asks build-mail to run
    // a second complete Pug + CSS-inline pass for index.pretty.html, doubling
    // the expensive part without changing either temporary consumer.
    args.push("--locales", "en");
  } else {
    args.push("--pretty");
  }
  return args;
}
