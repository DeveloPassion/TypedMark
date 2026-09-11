export function exclusionPatterns(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [".git/**"];
}

// Only an unrestricted trailing globstar proves that every descendant is out
// of scope. A glob matching a directory alone says nothing about its children.
export function isSubtreeExcluded(path: string, globs: string[]): boolean {
  return globs.some((glob) => glob.endsWith("**") && isExcluded(path, [glob]));
}

export function isExcluded(path: string, globs: string[]) {
  return globs.some((input) => {
    const glob = input.normalize("NFC").split("/").filter((segment, index, all) => segment !== "**" || all[index - 1] !== "**").join("/");
    let regex = "";
    for (let index = 0; index < glob.length;) {
      if (glob.slice(index) === "/**") { regex += "(?:/[\\s\\S]*)?"; break; }
      if (glob.slice(index, index + 3) === "**/" && (index === 0 || glob[index - 1] === "/")) { regex += "(?:[^/]+/)*"; index += 3; }
      else if (glob.slice(index, index + 2) === "**") { regex += "[\\s\\S]*"; index += 2; }
      else if (glob[index] === "*") { regex += "[^/]*"; index++; }
      else if (glob[index] === "?") { regex += "[^/]"; index++; }
      else { regex += glob[index]!.replace(/[.+^${}()|[\]\\]/g, "\\$&"); index++; }
    }
    return new RegExp(`^(?:${regex})(?![\\s\\S])`, "u").test(path.normalize("NFC"));
  });
}
