const vertex = `attribute vec2 position; varying vec2 uv;
void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0., 1.); }`;

const fragment = `precision highp float;
varying vec2 uv;
uniform float time;
uniform vec2 center;
uniform vec2 radius;
uniform vec3 innerColor;
uniform vec3 outerColor;
void main() {
  float d = length((vec2(uv.x, 1. - uv.y) - center) / radius);
  float t = smoothstep(0., 1., pow(clamp(d, 0., 1.), 1.15));
  vec3 col = mix(innerColor, outerColor, t);
  vec2 cell = floor(gl_FragCoord.xy / 2.);
  float frame = floor(time * 12.);
  float n = fract(sin(dot(cell + vec2(frame*7.13, frame*3.71), vec2(12.9898,78.233))) * 43758.5453) - .5;
  col += n * .11 * mix(1., .45, t);
  gl_FragColor = vec4(col, 1.);
}`;

const host = document.querySelector<HTMLElement>("[data-glow-background]");
const canvas = host?.querySelector<HTMLCanvasElement>("canvas");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

if (host && canvas) {
	let repaint = () => {};

	const zones = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting && entry.target instanceof HTMLElement) {
					host.dataset.variant = entry.target.dataset.glowZone ?? "section";
				}
			}

			repaint();
		},
		{ rootMargin: "-45% 0px -45% 0px" }
	);

	for (const zone of document.querySelectorAll("[data-glow-zone]"))
		zones.observe(zone);

	const gl = canvas.getContext("webgl", {
		alpha: false,
		antialias: false,
		powerPreference: "low-power",
	});

	if (gl) {
		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type);

			if (!shader) return null;

			gl.shaderSource(shader, source);
			gl.compileShader(shader);

			return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
		};

		const vs = compile(gl.VERTEX_SHADER, vertex);
		const fs = compile(gl.FRAGMENT_SHADER, fragment);
		const program = gl.createProgram();

		if (vs && fs && program) {
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);

			if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
				gl.useProgram(program);
				const buffer = gl.createBuffer();

				gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
				gl.bufferData(
					gl.ARRAY_BUFFER,
					new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
					gl.STATIC_DRAW
				);
				const position = gl.getAttribLocation(program, "position");

				gl.enableVertexAttribArray(position);
				gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
				const time = gl.getUniformLocation(program, "time");
				const center = gl.getUniformLocation(program, "center");
				const radius = gl.getUniformLocation(program, "radius");
				const inner = gl.getUniformLocation(program, "innerColor");
				const outer = gl.getUniformLocation(program, "outerColor");
				let frame = 0;
				let last = 0;
				let active = true;
				let heroVisible = true;
				const hero = document.querySelector(".hero");

				const colors = (name: string) => {
					const value = getComputedStyle(document.documentElement)
						.getPropertyValue(name)
						.trim();

					return [1, 3, 5].map(
						(offset) =>
							Number.parseInt(value.slice(offset, offset + 2), 16) / 255
					);
				};

				const draw = (now: number) => {
					if (now - last < 1000 / 30) return;

					last = now;
					const variant = host.dataset.variant;
					const dpr = Math.min(devicePixelRatio, 1.5);
					const width = Math.round(innerWidth * dpr);
					const height = Math.round(innerHeight * dpr);

					if (canvas.width !== width || canvas.height !== height) {
						canvas.width = width;
						canvas.height = height;
						gl.viewport(0, 0, width, height);
					}

					gl.uniform1f(time, now / 1000);
					gl.uniform2f(center, 0.5, variant === "hero" ? 0.44 : 0.5);
					gl.uniform2f(
						radius,
						variant === "hero" ? 0.46 : 0.52,
						variant === "hero" ? 0.5 : 0.55
					);
					gl.uniform3fv(
						inner,
						colors(
							variant === "deep"
								? "--glow-deep"
								: variant === "hero"
									? "--glow-mid"
									: "--glow-inner"
						)
					);
					gl.uniform3fv(
						outer,
						variant === "hero"
							? [233 / 255, 238 / 255, 246 / 255]
							: colors("--glow-outer")
					);
					gl.drawArrays(gl.TRIANGLES, 0, 6);
				};

				const tick = (now: number) => {
					draw(now);
					frame = requestAnimationFrame(tick);
				};

				const sync = () => {
					cancelAnimationFrame(frame);
					const enabled =
						!reduced.matches &&
						heroVisible &&
						!document.hidden &&
						!document.documentElement.hasAttribute("data-motion-paused");

					host.toggleAttribute("data-webgl", enabled);
					active = enabled;

					if (enabled) {
						draw(performance.now() + 40);

						if (heroVisible) frame = requestAnimationFrame(tick);
					}
				};

				repaint = () => {
					if (active) draw(performance.now() + 40);
				};

				if (hero)
					new IntersectionObserver(([entry]) => {
						heroVisible = entry?.isIntersecting ?? false;
						sync();
					}).observe(hero);
				else heroVisible = false;

				document.addEventListener("visibilitychange", sync);
				document.addEventListener("motionchange", sync);
				reduced.addEventListener("change", sync);
				window.addEventListener("resize", () => {
					if (active) draw(performance.now() + 40);
				});
				canvas.addEventListener("webglcontextlost", (event) => {
					event.preventDefault();
					cancelAnimationFrame(frame);
					host.removeAttribute("data-webgl");
				});
				sync();
			}
		}
	}
}

export {};
