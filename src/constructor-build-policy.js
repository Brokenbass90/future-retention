export function constructorBuildMailArgs({ brand, mailName, preview = false }) {
  const args = ["tools/build-mail.js", "--category", brand, "--mail", mailName];
  // Temporary iframe previews only need one locale. Persistent constructor
  // saves must rebuild every locale present in vendor/data; otherwise the
  // builder prunes locale directories that were omitted from --locales.
  if (preview) args.push("--locales", "en");
  args.push("--pretty");
  return args;
}
