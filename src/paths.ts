export function isExcluded(path: string, globs: string[]) {
  return globs.some((glob) => {
    const regex = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    return new RegExp(`^${regex}$`, "u").test(path);
  });
}
