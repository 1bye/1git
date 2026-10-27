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
status=0
env ONEGIT_LAUNCHER_MODE=1 ONEGIT_LAUNCHER_VALIDATE=1 "$contents/MacOS/1git" "$@" </dev/null || status=$?

case "$status" in
	0) exit 0 ;;
	10) ;;
	*) exit "$status" ;;
esac

nohup env ONEGIT_LAUNCHER_MODE=1 "$contents/MacOS/1git" "$@" </dev/null >/dev/null 2>&1 &

attempt=0
while [ "$attempt" -lt 10 ]; do
	if env ONEGIT_LAUNCHER_MODE=1 ONEGIT_LAUNCHER_VALIDATE=1 \
		"$contents/MacOS/1git" </dev/null >/dev/null 2>&1
	then
		exit 0
	fi

	attempt=$((attempt + 1))
	sleep 0.1
done

echo "1git launcher: the app did not become ready." >&2
exit 1
`;
