import { fetchImage } from './utils.js'
import assetInfo from './assetInfo.js'

// ----------------------------------------------------
// CONFIG

const config = {
	width: 720,
	height: 380,
	pixelPerfect: false, // display in the exact 380x720 resolution, whichever the window size and pixel density
}
// Use this any time you set the size/position of a DOM element
config.domPixelMultiplier = config.pixelPerfect ? 1.0 / window.devicePixelRatio : 1.0;

const $DOMContentLoaded = new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve));

export default class App {
	// ----------------------------------------------------
	// INITIALIZATION
	constructor() {
		this.initState();
		const $assets = this.loadAssets();
		const $dom = this.initDom();
		const $canvas = $dom.then(() => this.initCanvas());
		Promise.all([$assets, $canvas]).then(() => this.start());
	}

	initState() {
		this.state = {
			loaded: false,
			needRedraw: true,
			camera: {
				x: 0,
			},
			drag: {
				active: false,
				previousMouse: null,
			},
		}
	}

	async initDom() {
		await $DOMContentLoaded;
		const elementIds = [
			"main",
			"msgCenter",
			"canvas",
			"hud",
		]
		const dom = {};
		for (const id of elementIds) {
			dom[id] = document.getElementById(id);
			if (!dom[id]) {
				console.error(`Could not find element with ID '${id}'!`);
			}
		}
		dom.container = dom.main.parentElement;
		this.dom = dom;

		document.addEventListener("keydown", this.onKeyDown.bind(this));
		document.addEventListener("keyup", this.onKeyUp.bind(this));
		document.addEventListener("touchstart", this.onTouchStart.bind(this));
		document.addEventListener("touchend", this.onTouchEnd.bind(this));
		document.addEventListener("touchmove", this.onTouchMove.bind(this));
		document.addEventListener("touchcancel", this.onTouchCancel.bind(this));
		document.addEventListener("mousedown", this.onMouseDown.bind(this));
		document.addEventListener("mouseup", this.onMouseUp.bind(this));
		document.addEventListener("mousemove", this.onMouseMove.bind(this));
		document.addEventListener("mouseenter", this.onMouseEnter.bind(this));
		window.addEventListener("resize", () => this.onResize());
		this.onResize();

	}

	initCanvas() {
		const { dom } = this;
		dom.canvas.width = config.width;
		dom.canvas.height = config.height;
		const ctx = dom.canvas.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		this.context2d = ctx;
	}

	async loadAssets() {
		this.assets = {
			images: {},
		}
		await this.loadImages();
	}

	async loadImages() {
		const { images } = this.assets;
		const { images: imageInfo } = assetInfo;

		for (const [name, info] of Object.entries(imageInfo)) {
			const imageData = await fetchImage(info.url);
			if (!imageData) {
				console.error(`Could not load image '${name}' from '${info.url}'!`);
			}
			images[name] = imageData;
		}
	}

	start() {
		const { state } = this;
		state.loading = false;
		this.renderHud();
		requestAnimationFrame(() => this.onFrame());
	}

	// ----------------------------------------------------
	// UTILS

	transformMouseToLocal(clientPosition) {
		const { canvas } = this.dom;
		const { x, y } = clientPosition;
		const rect = canvas.getBoundingClientRect();
		return {
			x: (x - rect.x) * (config.width / rect.width),
			y: (y - rect.y) * (config.height / rect.height),
		};
	}

	// ----------------------------------------------------
	// EVENT CALLBACKS

	onKeyDown(ev) {
		const { state } = this;

		switch (ev.key) {
		case "ArrowRight":
			state.camera.x += 10.0;
			state.needRedraw = true;
			break;

		case "ArrowLeft":
			state.camera.x -= 10.0;
			state.needRedraw = true;
			break;
		}
	}

	onKeyUp(ev) {}

	onMouseDown(ev) {
		if (ev.button == 0) {
			this.startDragging({ x: ev.clientX, y: ev.clientY });
		}
	}

	onMouseMove(ev) {
		this.updateDragging({ x: ev.clientX, y: ev.clientY });
	}

	onMouseUp(ev) {
		if (ev.button == 0) {
			this.stopDragging();
		}
	}

	onMouseEnter(ev) {
		if (!ev.buttons.includes(0)) {
			this.stopDragging();
		}
	}

	onTouchStart(ev) {
		this.startDragging({ x: ev.touches[0].clientX, y: ev.touches[0].clientY });
	}

	onTouchEnd(ev) {
		this.stopDragging();
	}

	onTouchMove(ev) {
		this.updateDragging({ x: ev.touches[0].clientX, y: ev.touches[0].clientY });
	}

	onTouchCancel(ev) {
	}


	startDragging(position) {
		const { drag } = this.state;
		if (drag.active) return;
		drag.active = true;
		drag.previousMouse = this.transformMouseToLocal(position);

		this.updateDragging(position);
	}

	updateDragging(position) {
		const { state } = this;
		const { drag } = state;
		if (!drag.active) return;

		const mouse = this.transformMouseToLocal(position);

		state.camera.x += drag.previousMouse.x - mouse.x;
		state.needRedraw = true;

		drag.previousMouse = mouse;
	}

	stopDragging() {
		const { drag, character } = this.state;
		drag.active = false;
	}

	onResize() {
		const { dom } = this;
		let width, height;
		if (config.pixelPerfect) {
			width = config.width * config.domPixelMultiplier;
			height = config.height * config.domPixelMultiplier;
		} else {
			const ratio = config.width / config.height;
			const heightFromWidth = window.innerWidth / ratio;
			const widthFromHeight = window.innerHeight * ratio;
			if (heightFromWidth > window.innerHeight) {
				height = window.innerHeight;
				width = widthFromHeight;
			} else {
				height = heightFromWidth;
				width = window.innerWidth;
			}
		}

		dom.canvas.style.width = `${width}px`;
		dom.canvas.style.height = `${height}px`;
		dom.main.style.width = `${width}px`;
		dom.main.style.height = `${height}px`;
		dom.main.style.top = `${(window.innerHeight - height) / 2}px`;
		dom.main.style['font-size'] = `${16 * width / (config.width * config.domPixelMultiplier)}px`; // scale definition of '1em'
	}

	onFrame() {
		const { state } = this;
		const frameTime = performance.now();
		const deltaTime = frameTime - state.previousFrameTime;

		switch (state.scene) {
		case 'GAME':
			this.updateGame(deltaTime);
			break;
		case 'END':
			break;
		}

		if (state.needRedraw) {
			this.renderCanvas();
		}
		state.needRedraw = false;
		state.previousFrameTime = frameTime;
		requestAnimationFrame(() => this.onFrame());
	}

	// ----------------------------------------------------
	// GAME LOGIC

	updateGame(dt) {

	}

	// ----------------------------------------------------
	// RENDERING

	renderHud() {
		const { state, dom } = this;
		dom.msgCenter.innerText = state.loading ? "Chargement..." : "";
	}

	renderCanvas() {
		const { state, assets, context2d: ctx } = this;
		const { images } = assets;

		ctx.fillStyle = "rgb(34, 177, 76)"; // dark green
		ctx.fillRect(0, 0, config.width, config.height);

		ctx.drawImage(images.parallaxLayer03, -1 * state.camera.x + 50, 0);
		ctx.drawImage(images.parallaxLayer03b, -1 * state.camera.x + 50 + 640, 0);

		ctx.drawImage(images.parallaxLayer02, -2 * state.camera.x - 100, 0);
		ctx.drawImage(images.parallaxLayer02b, -2 * state.camera.x - 100 + 640, 0);

		ctx.drawImage(images.parallaxLayer01, -3 * state.camera.x, 0);
		ctx.drawImage(images.parallaxLayer01b, -3 * state.camera.x - 640, 0);
		ctx.drawImage(images.parallaxLayer01c, -3 * state.camera.x + 1000, 0);

		ctx.fillStyle = "rgb(0, 0, 0)";
		ctx.fillRect(-3 * state.camera.x + 1000 + 640, 0, 1000, config.height);
		ctx.fillRect(-3 * state.camera.x - 640 - 1000, 0, 1000, config.height);
	}

}
