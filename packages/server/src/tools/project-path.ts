import { isAbsolute, relative, resolve, sep } from "path";

// Resolves a tool's path argument against the project folder, or returns null
// when it lands outside it. Compares with path.relative rather than a string
// prefix, so a sibling such as "project-secrets" doesn't pass for "project",
// and a folder stored with forward slashes still matches the backslash paths
// resolve() produces on Windows.
export function resolveProjectPath(cwd: string, path: string): string | null {
  const root = resolve(cwd);
  const target = resolve(root, path);
  const relativePath = relative(root, target);

  const escapes =
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    // A different drive on Windows
    isAbsolute(relativePath);

  return escapes ? null : target;
};
