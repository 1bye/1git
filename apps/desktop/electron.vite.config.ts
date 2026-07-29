import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..", "..");

export default defineConfig({
	main: {
		build: {
			outDir: "dist/main",
		},
	},
	preload: {
		build: {
			outDir: "dist/preload",
			rollupOptions: {
				output: {
					entryFileNames: "[name].js",
					format: "cjs",
				},
			},
		},
	},
	renderer: {
		build: {
			outDir: "dist/renderer",
		},
		plugins: [tailwindcss(), react()],
		server: {
			fs: {
				allow: [repositoryRoot],
			},
		},
	},
});
