import "@gpuix/native";
import "@gpuix/native/host";

declare module "@gpuix/native" {
	interface WindowOptions {
		/** Local native patch: prevent AppKit from consuming tab gestures. */
		appOwnsTitlebarDrag?: boolean;
	}
}

declare module "@gpuix/native/host" {
	interface HostProps {
		/** Local native patch: synchronous native move/zoom on otherwise empty chrome. */
		windowDrag?: boolean;
	}
}
