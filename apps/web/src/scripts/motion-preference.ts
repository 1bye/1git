export const motionStorageKey = "1git-motion-paused";

/** Storage can be disabled by browser privacy settings; motion still works. */
export function readMotionPreference(): boolean {
	try {
		return localStorage.getItem(motionStorageKey) === "1";
	} catch {
		return false;
	}
}

/** Persist only the user's explicit pause choice, never an OS preference. */
export function writeMotionPreference(paused: boolean): void {
	try {
		localStorage.setItem(motionStorageKey, paused ? "1" : "0");
	} catch {
		// The current page still honours the choice when persistence is blocked.
	}
}
