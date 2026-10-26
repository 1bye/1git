const vertex = `attribute vec2 position;
void main() { gl_Position = vec4(position, 0., 1.); }`;

const fragment = `precision highp float;
uniform float time;
uniform vec2 center;
uniform vec2 radius;
uniform vec3 innerColor;
uniform vec3 outerColor;
void main() {
  // Light edges deepen into a soft blue pool centred on the active copy.
  float d = length((gl_FragCoord.xy - center) / radius);
  float t = smoothstep(.42, 1.32, d);
  vec3 col = mix(innerColor, outerColor, t);
  vec2 cell = floor(gl_FragCoord.xy / 2.);
  float frame = floor(time * 12.);
  // Avoid sine precision stripes on mobile WebGL implementations.
  vec2 seed = cell + vec2(frame * 7.13, frame * 3.71);
  vec3 hash = fract(vec3(seed.x, seed.y, seed.x) * .1031);
  hash += dot(hash, hash.yzx + 33.33);
  float n = fract((hash.x + hash.y) * hash.z) - .5;
  col += n * .085;
  gl_FragColor = vec4(col, 1.);
}`;

interface Glow {
	x: number;
	y: number;
	rx: number;
	ry: number;
}

const GLOW_EASE = 0.08;
const FRAME_MS = 1000 / 30;
const CENTRE_PULL = 0.5;
const STACKED_WIDTH = 768;

const host = document.querySelector<HTMLElement>("[data-glow-background]");
const canvas = host?.querySelector<HTMLCanvasElement>("canvas");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const scenes = [...document.querySelectorAll<HTMLElement>("[data-scene]")];

/** Centre the glow on the copy of whichever scene holds the viewport centre. */
const targetGlow = (): Glow => {
	const middle = innerHeight / 2;

	const scene = scenes.find((candidate) => {
		const { top, bottom } = candidate.getBoundingClientRect();

		return top <= middle && bottom > middle;
	});

	// Stacked mobile scenes light copy and window together.
	const copy = scene?.querySelector("[data-glow-anchor]");
	const content = scene?.querySelector(".scene-content");

	const anchor =
		innerWidth < STACKED_WIDTH ? (content ?? copy) : (copy ?? content);

	if (!anchor)
		return {
			x: innerWidth / 2,
			y: middle,
			rx: innerWidth * 0.62,
			ry: innerHeight * 0.66,
		};

	const rect = anchor.getBoundingClientRect();
	// Long mobile scenes only light the part that is on screen.
	const top = Math.max(rect.top, 0);
	const bottom = Math.min(rect.bottom, innerHeight);
	const width = rect.width;
	const height = Math.max(bottom - top, 0);

	// Lean towards the viewport centre so a side column still tints its window.
	const x = rect.left + width / 2;

	return {
		x: x + (innerWidth / 2 - x) * CENTRE_PULL,
		y: top + height / 2,
		rx: Math.min(Math.max(width * 0.7 + 520, 420), innerWidth * 0.9),
		ry: Math.min(Math.max(height * 0.7 + 260, 320), innerHeight * 0.95),
	};
};

if (host) {
	let glow = targetGlow();

	const step = (ease: number) => {
		const target = targetGlow();

		glow = {
			x: glow.x + (target.x - glow.x) * ease,
			y: glow.y + (target.y - glow.y) * ease,
			rx: glow.rx + (target.rx - glow.rx) * ease,
			ry: glow.ry + (target.ry - glow.ry) * ease,
		};
		host.style.setProperty("--glow-x", `${glow.x.toFixed(1)}px`);
		host.style.setProperty("--glow-y", `${glow.y.toFixed(1)}px`);
		host.style.setProperty("--glow-rx", `${glow.rx.toFixed(1)}px`);
		host.style.setProperty("--glow-ry", `${glow.ry.toFixed(1)}px`);
	};

	// Without animation the CSS gradient jumps straight to the current scene.
	const settle = () => step(1);

	const settleWhenStatic = () => {
		// The render loop already eases the moving glow; scroll must not bypass it.
		if (!host.hasAttribute("data-webgl")) settle();
	};

	addEventListener("scroll", settleWhenStatic, { passive: true });
	addEventListener("resize", settleWhenStatic);
	settle();

	const gl = canvas?.getContext("webgl", {
		alpha: false,
		antialias: false,
		powerPreference: "low-power",
	});

	if (canvas && gl) {
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
				let contextLost = false;

				const colors = (name: string) => {
					const value = getComputedStyle(document.documentElement)
						.getPropertyValue(name)
						.trim();

					return [1, 3, 5].map(
						(offset) =>
							Number.parseInt(value.slice(offset, offset + 2), 16) / 255
					);
				};

				let innerColor = colors("--atmosphere-inner");
				let outerColor = colors("--atmosphere-outer");
				let painted = 0;

				const draw = (now: number) => {
					if (now - last < FRAME_MS) return;

					last = now;
					step(GLOW_EASE);

					// Dev builds can attach the stylesheet after this module runs.
					if (innerColor.some(Number.isNaN))
						innerColor = colors("--atmosphere-inner");

					if (outerColor.some(Number.isNaN))
						outerColor = colors("--atmosphere-outer");

					const dpr = Math.min(devicePixelRatio, 1.5);
					// The fixed surface can exceed innerHeight while browser controls move.
					const width = Math.round(host.clientWidth * dpr);
					const height = Math.round(host.clientHeight * dpr);

					if (canvas.width !== width || canvas.height !== height) {
						canvas.width = width;
						canvas.height = height;
						gl.viewport(0, 0, width, height);
					}

					gl.uniform1f(time, now / 1000);
					// WebGL fragment coordinates start at the bottom edge.
					gl.uniform2f(center, glow.x * dpr, height - glow.y * dpr);
					gl.uniform2f(radius, glow.rx * dpr, glow.ry * dpr);
					gl.uniform3fv(inner, innerColor);
					gl.uniform3fv(outer, outerColor);
					gl.drawArrays(gl.TRIANGLES, 0, 6);
					painted += 1;

					// Reveal the opaque canvas only once it has presented a frame.
					if (painted === 2) host.setAttribute("data-webgl", "");
				};

				const tick = (now: number) => {
					draw(now);
					frame = requestAnimationFrame(tick);
				};

				const sync = () => {
					cancelAnimationFrame(frame);
					const enabled =
						!contextLost &&
						!reduced.matches &&
						!document.documentElement.hasAttribute("data-motion-paused");

					if (!enabled) {
						painted = 0;
						host.removeAttribute("data-webgl");
					}

					if (enabled && !document.hidden) frame = requestAnimationFrame(tick);
					else settle();
				};

				document.addEventListener("visibilitychange", sync);
				document.addEventListener("motionchange", sync);
				reduced.addEventListener("change", sync);
				canvas.addEventListener("webglcontextlost", (event) => {
					event.preventDefault();
					contextLost = true;
					cancelAnimationFrame(frame);
					host.removeAttribute("data-webgl");
				});
				sync();
			}
		}
	}
}
