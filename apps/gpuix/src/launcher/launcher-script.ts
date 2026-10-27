/** POSIX launcher shipped in the app bundle and linked by the Settings action. */
export const launcherScript = `#!/bin/sh
set -eu

self="$0"
while [ -L "$self" ]; do
\tlink=$(readlink "$self")
\tcase "$link" in
\t\t/*) self="$link" ;;
\t\t*) self="$(dirname "$self")/$link" ;;
\tesac
done

contents="$(CDPATH= cd -- "$(dirname "$self")/.." && pwd)"
exec env ONEGIT_LAUNCHER_MODE=1 "$contents/MacOS/1git" "$@"
`;
