import "@gpuix/native";
import "@gpuix/native/host";

declare module "@gpuix/native" {
	interface WindowOptions {
		/** Local native patch: prevent AppKit from consuming tab gestures. */
		appOwnsTitlebarDrag?: boolean;
	}
}

declare module "@gpuix/native/host" {
	interface InputProps {
		/** Local native patch: masked editor; callers keep secrets out of controlled props. */
		type?: "text" | "password";
	}
	interface HostProps {
		/** Local native patch: synchronous native move/zoom on otherwise empty chrome. */
		windowDrag?: boolean;
	}
}
