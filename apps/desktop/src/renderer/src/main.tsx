import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import "./styles.css";

document.documentElement.classList.add("light");

const container = document.getElementById("root");

if (!container) {
	throw new Error("Desktop renderer root element was not found.");
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>
);
