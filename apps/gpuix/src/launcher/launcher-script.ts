import { launcherPathOutputMarker } from "./launcher-protocol";

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
bundle="$(dirname "$contents")"
socketPath="\${GPUIX_LAUNCHER_SOCKET:-$HOME/Library/Application Support/1git-gpuix/launcher.sock}"

# Validate once and, when no process owns the socket, print the canonical path
# that LaunchServices must receive. A validation failure is deliberately distinct
# from a malformed request so the cold-start path can continue to open the app.
status=0
validatedPath=$(env ONEGIT_LAUNCHER_MODE=1 ONEGIT_LAUNCHER_VALIDATE=1 \
	ONEGIT_LAUNCHER_PRINT_PATH=1 "$contents/MacOS/1git" "$@" </dev/null) || status=$?

# Command substitution trims trailing newlines. The validation process appends
# a sentinel so paths containing a trailing newline survive the hand-off.
validatedPath=\${validatedPath%${launcherPathOutputMarker}}

case "$status" in
	0) exit 0 ;;
	10) ;;
	*) exit "$status" ;;
esac

openCommand="/usr/bin/open"
if [ -n "$validatedPath" ]; then
	"$openCommand" -a "$bundle" --args "$validatedPath"
else
	"$openCommand" -a "$bundle"
fi

attempt=0
delay=0.1
while [ "$attempt" -lt 31 ]; do
	if [ -S "$socketPath" ]; then
		exit 0
	fi

	attempt=$((attempt + 1))
	sleep "$delay"
	case "$delay" in
		0.1) delay=0.2 ;;
		0.2) delay=0.3 ;;
		0.3) delay=0.4 ;;
		*) delay=0.5 ;;
	esac
done

echo "1git launcher: the app did not become ready." >&2
exit 1
`;
