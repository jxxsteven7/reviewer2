// The commit that a build's version names, which the footer links to, with the history up to it.
// vite.config.ts asks at build time. A version such as v0.1.43 is the title of a commit on main
// (docs/rules/versioning.md): the first one in `git log --first-parent --format='%H %s'`, which
// `log` reads only then. A commit hash, which a build has when no title gives a version
// (docs/development.md), is its own commit. Anything else, such as `dev`, names none.
export function versionCommit(version: string, log: () => string): string | null {
  if (/^[0-9a-f]{7,40}$/.test(version)) return version;
  if (!/^v\d+\.\d+\.\d+$/.test(version)) return null;
  for (const line of log().split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0 && line.startsWith(`${version} `, space + 1)) return line.slice(0, space);
  }
  return null;
}
