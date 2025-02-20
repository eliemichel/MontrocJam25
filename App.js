import { wait, lerp, randomInRange, randomIntInRange, fetchImage, fetchShape, fetchSound, scaleVec2, dotVec2 } from './utils.js'
import { createBeteSprite, drawSprite } from './sprites.js'
import * as Physics from './physics.js'
import { drawScaledImage } from './drawing.js'
import { drawShape, samplePath } from './shapes.js'
import assetInfo from './assetInfo.js'
import { fadeInMixer, fadeOutMixer } from './audio.js'

import GUI from './js/lil-gui.esm.js'

// ----------------------------------------------------
// CONFIG

const config = {
	// Resolution of gameplay logic, which is different from the final rendering resolution
	width: 1440,
	height: 840,//920,//760,

	scenes: [ "MENU", "BLOW_WIND", "TEMPEST", "PULL", "RAIN", "SUN", "BLOW_FLOWERS", "CREDITS" ],
	defaultScene: "MENU",

	blendModes: [
		"lighter",
		"lighten",
		"soft-light",
		"screen"
	],

	physics: {
		layers: {
			default: 0x0001,
			ground: 0x0002,
			freeBetes: 0x0004,
			pulledBetes: 0x0008,
			pappi: 0x00016,
		}
	}
}
// Use this any time you set the size/position of a DOM element
config.domPixelMultiplier = config.pixelPerfect ? 1.0 / window.devicePixelRatio : 1.0;

const $DOMContentLoaded = new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve));

function createMaskParticle(x, y, radius) {
	return {
		x, y,
		radius,
		velocity: {
			x: randomInRange({ min: 0.2, max: 0.5 }),
			y: 0,
		},
		birthTime: performance.now(),
		age: 0.0,
		lifeDuration: randomInRange({ min: 2000, max: 4000 }), // in ms
	};
}

function createRainDrop(x, y, period, size) {
	return {
		x,
		y,
		imageIndex: 0,
		birthTime: performance.now() - Math.random() * period,
		size: {
			x: size,
			y: size / 1.5,
		},
		anim: {
			period, // ms
			length: 500, // pixels
		}
	}
}

function createRainDropArray(area, opts) {
	opts = {
		timePeriodRange: { min: 1000, max: 2000 },
		sizeRange: { min: 0.3, max: 0.6 },
		imageIndexRange: { min: 0, max: 2 },
		xPeriod: 10,
		...opts,
	}
	const [ xmin, ymin, width, height ] = area;
	const xmax = xmin + width;
	const ymax = ymin + height;
	const allDrops = [];
	for (let x = xmin - 200 ; x < xmax + 200 ; x += opts.xPeriod) {
		const y = ymin + height / 2;
		const offset = (Math.random() - 0.5) * opts.xPeriod;
		const period = randomInRange(opts.timePeriodRange);
		const size = randomInRange(opts.sizeRange);
		const drop = createRainDrop(x, y, period, size);
		drop.anim.length = height;
		drop.imageIndex = randomIntInRange(opts.imageIndexRange)
		allDrops.push(drop);
	}
	return allDrops;
}

function createPlant(x, y, scale, skinIndex) {
	return {
		growth: 1.0,
		position: { x, y },
		scale,
		skinIndex,

		// computed once assets are loaded
		anchor: null,
		flowerAnchor: null,
		skinSize: null,
	}
}

function computePlantAnchors(plant, assets) {
	const { images, shapes } = assets;
	const key = `plant${plant.skinIndex}`;
	const shp = shapes[key];
	const img = images[key].data[0];
	const { width, height } = img;
	plant.skinSize = { width, height };
	plant.anchor = {
		x: shp.anchor.cx / width,
		y: shp.anchor.cy / height,
	};
	plant.flowerAnchor = {
		x: shp.flower.cx / width,
		y: shp.flower.cy / height,
	};
}

function createPulledBete(x, y, engine, soundName) {
	const { Bodies, Constraint, Composite } = Matter;
	const scale = 0.6;
	const position = { x, y };

	// Physics
	// 1. Body
	const radius = 35 * scale;
	const body = Bodies.circle(position.x, position.y, radius, {
		collisionFilter: {
			category: config.physics.layers.pulledBetes,
			mask: config.physics.layers.default,
		},
	});
	
	// 2. Spring
	const constraint = Constraint.create({
		pointA: position,
		bodyB: body,
		pointB: { x: 0, y: 0 },
		stiffness: 0.02,
		damping: 0.05
	});

	Composite.add(engine.world, [ body, constraint ]);
	
	return {
		position,
		scale,
		rigidbody: body,
		soundName,
	}
}

function createPappus(plant, shape, engine, angle, skinCount) {
	const { Bodies, Constraint, Composite } = Matter;
	const { scale, anchor, flowerAnchor, skinSize } = plant;

	const dx = (flowerAnchor.x - anchor.x) * skinSize.width;
	const dy = (flowerAnchor.y - anchor.y) * skinSize.height;;
	const position = {
		x: plant.position.x + dx * scale,
		y: plant.position.y + dy * scale,
	};

	// Physics
	const { layers } = config.physics;
	const radius = 35 * scale;
	const body = Bodies.circle(position.x, position.y, radius, {
		isSleeping: true,
		collisionFilter: {
			category: layers.pappi,
			mask: layers.default | layers.ground,
		},
	});
	Composite.add(engine.world, [ body ]);

	return {
		position,
		anchor: {
			x: shape.anchor.cx / 128,
			y: shape.anchor.cy / 128,
		},
		angle,
		plant,
		rigidbody: body,
		skinIndex: randomIntInRange({ min: 0, max: skinCount - 1 })
	}
}

export default class App {
	// ----------------------------------------------------
	// INITIALIZATION
	constructor() {
		this.initState();
		this.initAudio(); // must be before loadAssets
		const $dom = this.initDom();
		const [ $assets, $delayedAssets ] = this.loadAssets();
		const $canvas = $dom.then(() => this.initCanvas());
		const $hud = $dom.then(() => this.initHud());
		if (new URL(window.location).searchParams.get("gui") === "true") {
			this.initGui();
		}
		const $physics = $assets.then(() => this.initPhysics());
		Promise.all([
			$assets,
			$canvas,
			$hud,
			$physics,
		]).then(() => this.start());
	}

	initState() {
		this.state = {
			loading: true,
			loadingProgress: {
				ready: 0.0,
				total: 1.0,
			},
			inTransition: false,
			scene: config.defaultScene,
			frame: 0,
			audioContextAllowed: false,
			previousFrameTime: 0,
			needRedraw: true,
			camera: {
				x: 0,
				y: 45,
				zoom: 0,
			},
			drag: {
				active: false,
				previousMouse: null,
				startMouse: null,
				velocity: { x: 0, y: 0 },
				frames: 0, // count the number of frames ellapsed since the beginning of the drag operation
			},
			sprites: [],
			// Moving particles used to blend multiple backgrounds 
			maskParticles: [],
			wind: {
				// Minimal magnitude of the mouse drag before triggering wind
				minDragMagnitude: 0.05,
				// Maximum velocity of a wind particle and its force
				maxVelocity: 0.3,
				// Opacity of the white highlight
				lightOpacity: 0.04,
				// How much wind carries stuff
				drag: 2.0,
				// Wind particles triggered by mouse movements
				particles: {
					size: {
						min: 70,
						max: 230,
					},
					lifeDuration: {
						min: 0,
						max: 2000,
					},
				},
				// Test: add a constant flow of particles in the bottom part of the scene
				hasParticleFlow: false,

				// counter that keeps track of overall wind level, for sound effects
				level: 0.0,
				// speed at which level decays when there is no user input
				levelDecaySpeed: 0.000575,
				// sound node that is currently playing, if any
				currentSound: null,
				// how the sound decays when level decays follow a gamma curve
				soundDecayGamma: 1.608,

				// number of blow drag actions since the beginning of the scene
				blowCount: 0,
			},
			background: {
				anim: {
					fps: 2,
					useCrossFade: true,
					frame: 0,
					frameStartTime: 0,
					// subset of images
					start: 2,
					end: 4,
				},
			},
			tempest: {
				anim: {
					fps: 4,
					useCrossFade: false,
					frame: 0,
					frameStartTime: 0,
					// subset of images
					start: 3,
					end: 7,
				},
			},
			rain: {
				cloudPosition: 0.0,
				cloudOpacity: 1.0,
				interpolation: {
					useCorners: false,
				},
				swipe: {
					directionAngle: 215,
					sensitivity: 1.0,
				},
				drops: [],
				dropArrayOpts: {
					// see createRainDropArray()
				},
				angle: -5.0,
				speedMultiplier: 1.1,
				lengthMultiplier: 1.3,
			},
			rendering: {
				drawPhysicsOverlay: false,
				blackOverlay: 0.0,
			},
			music: {
				fadeSpeed: 0.02,
			},
			plants: {
				items: [
					createPlant(338, 735, 0.39, 0),
					createPlant(420, 755, 0.39, 1),
					createPlant(725, 710, 0.32, 1),
					createPlant(900, 690, 0.34, 0),
				],
				growth: 1.0,
			},
			pappi: {
				items: [],
				size: 0.62,
				countPerPlant: 5,
				maxAngle: 45,
				offset: -3.8,
				angleMultiplier: 0.72,
			},
			sun: {
				position: 0.0,
				opacity: 0.0,
				size: 300,
				lightOpacity: 0.0,
				maxLightOpacity: 0.18,
				lightBlendMode: "lighter",
				swipe: {
					directionAngle: 340,
					sensitivity: 1.0,
				},
			},
			grassMask: {
				show: true,
				imageIndex: 0,
			},
			pulledBetes: {
				items: [],
				mouseRadius: 100,
				mouseStrength: 1.0,
				pullCount: 0,
			},
			transitions: {
				growthAfterDeflate: 0.32,
				growthAfterRain: 0.39,
				growthAfterSun: 0.9,
				toBlowWind: {
					fadeSpeed: 0.02, 
					fadeGamma: 1.0,
				},
				fromBlowWind: {
					blowCount: 12,
				},
				toTempest: {
					fadeSpeed: 0.02,
					fadeGamma: 1.0,
				},
				fromPull: {
					pullCount: 5,
				},
				toRain: {
					fadeSpeed: 0.1,
					fadeGamma: 1.0,
				},
				fromRain: {
					cloudSpeed: 0.01,
					fadeSpeed: 0.02,
					fadeGamma: 1.0,
					plantSpeed: 0.004,
					rainSoundSpeed: 0.02,
				},
				toSun: {
					sunSpeed: 0.05,
				},
				fromSun: {
					sunSpeed: 0.002,
					plantSpeed: 0.008,
				},
				toBlowFlowers: {
					sunOpacitySpeed: 0.04,
					fadeSpeed: 0.1,
					fadeGamma: 1.0,
				},
				fromBlowFlowers: {
					blowCount: 9,
				},
			}
		}
	}

	initGui() {
		const { state, audio } = this;
		const {
			wind,
			background,
			rendering,
			tempest,
			rain,
			plants,
			sun,
			grassMask,
			pulledBetes,
			pappi,
			transitions,
		} = state;
		const { mixers: mixerInfo } = assetInfo;

		const gui = new GUI();
		gui.add(state, 'scene', config.scenes);

		const cameraFolder = gui.addFolder("Camera").close();
		cameraFolder.add(state.camera, 'x', -300, 300);
		cameraFolder.add(state.camera, 'y', -300, 300);
		cameraFolder.add(state.camera, 'zoom', -8, 8);
		
		const windFolder = gui.addFolder("Wind").close();
		windFolder.add(wind, 'minDragMagnitude', 0.0, 0.3);
		windFolder.add(wind, 'maxVelocity', 0.0, 1.0);
		windFolder.add(background.anim, 'fps', 0, 20, 1).name("Background FPS");
		windFolder.add(background.anim, 'start', 1, 8, 1).name("Background Start");
		windFolder.add(background.anim, 'end', 1, 8, 1).name("Background End");
		windFolder.add(wind, 'lightOpacity', 0.0, 1.0);
		windFolder.add(wind, 'drag');
		windFolder.add(wind, 'hasParticleFlow');
		windFolder.add(wind, 'levelDecaySpeed', 0.0, 0.005);
		windFolder.add(wind, 'soundDecayGamma', 0.0, 8.0);

		const tempestFolder = gui.addFolder("Tempest").close();
		tempestFolder.add(tempest.anim, 'fps', 0, 20, 1).name("Background FPS");
		tempestFolder.add(tempest.anim, 'useCrossFade');

		const rainFolder = gui.addFolder("Rain").close();
		rainFolder.add(rain, 'cloudPosition', 0.0, 1.0);
		rainFolder.add(rain.interpolation, 'useCorners').name("Use corners for interpolation");
		rainFolder.add(rain.swipe, 'directionAngle', 0, 360).name("Swipe direction angle");
		rainFolder.add(rain.swipe, 'sensitivity', 0.0, 5.0).name("Swipe sensitivity");
		rainFolder.add(rain, 'angle', -180, 180).name("Drop angle");
		rainFolder.add(rain, 'speedMultiplier', 0.0, 5.0).name("Drop speed");
		rainFolder.add(rain, 'lengthMultiplier', 0.0, 5.0).name("Drop length");

		const plantFolder = gui.addFolder("Plants").close();
		plantFolder.add(plants, 'growth', 0.0, 1.0);
		let plantIndex = 0;
		for (const plant of plants.items) {
			const plantSubFolder = plantFolder.addFolder(`Plant #${plantIndex}`).close();
			plantSubFolder.add(plant, 'growth', 0.0, 1.0);
			plantSubFolder.add(plant.position, 'x', 0, config.width);
			plantSubFolder.add(plant.position, 'y', 0, config.height);
			plantSubFolder.add(plant, 'scale', 0.0, 1.0);
			plantSubFolder.add(plant, 'skinIndex', 0, 1, 1);
			++plantIndex;
		}

		const sunFolder = gui.addFolder("Sun").close();
		sunFolder.add(sun, 'position', 0.0, 1.0);
		sunFolder.add(sun, 'opacity', 0.0, 1.0);
		sunFolder.add(sun, 'size', 0, 500);
		sunFolder.add(sun, 'lightOpacity', 0.0, 1.0);
		sunFolder.add(sun, 'maxLightOpacity', 0.0, 1.0);
		sunFolder.add(sun, 'lightBlendMode', config.blendModes);
		sunFolder.add(sun.swipe, 'directionAngle', 0, 360).name("Swipe direction angle");
		sunFolder.add(sun.swipe, 'sensitivity', 0.0, 5.0).name("Swipe sensitivity");

		const grassMaskFolder = gui.addFolder("Grass Mask").close();
		grassMaskFolder.add(grassMask, 'show');
		grassMaskFolder.add(grassMask, 'imageIndex', 0, 7, 1);

		const pulledBetesFolder = gui.addFolder("Pulled Betes").close();
		pulledBetesFolder.add(pulledBetes, 'mouseRadius', 0, 500);
		pulledBetesFolder.add(pulledBetes, 'mouseStrength', 0, 5.0);

		const pappiFolder = gui.addFolder("Pappi").close();
		pappiFolder.add(pappi, 'size', 0.0, 1.0);
		pappiFolder.add(pappi, 'offset', -50, 50);
		pappiFolder.add(pappi, 'angleMultiplier', 0.0, 2.0);

		const windParticlesFolder = windFolder.addFolder("Particles");
		const { particles } = wind;
		windParticlesFolder.add(particles.size, 'min', 0, 300).name("Min size");
		windParticlesFolder.add(particles.size, 'max', 0, 300).name("Max size");
		windParticlesFolder.add(particles.lifeDuration, 'min', 0, 10000).name("Min life");
		windParticlesFolder.add(particles.lifeDuration, 'max', 0, 10000).name("Max life");

		const renderingFolder = gui.addFolder("Rendering");
		renderingFolder.add(rendering, 'drawPhysicsOverlay');
		renderingFolder.add(rendering, 'blackOverlay', 0.0, 1.0);

		const transitionFolder = gui.addFolder("Transitions");
		const actions = {
			Menu: () => this.transitionToScene('MENU'),
			BlowWind: () => this.transitionToScene('BLOW_WIND'),
			Tempest: () => this.transitionToScene('TEMPEST'),
			Pull: () => this.transitionToScene('PULL'),
			Rain: () => this.transitionToScene('RAIN'),
			Sun: () => this.transitionToScene('SUN'),
			BlowFlowers: () => this.transitionToScene('BLOW_FLOWERS'),
			Credits: () => this.transitionToScene('CREDITS'),
		}
		transitionFolder.add(actions, 'Menu');
		{
			const tr = transitions.toBlowWind;
			const subfolder = transitionFolder.addFolder("To BlowWind").close();
			subfolder.add(tr, 'fadeSpeed', 0.0, 0.1);
			subfolder.add(tr, 'fadeGamma', 0.0, 8.0);
		}
		transitionFolder.add(actions, 'BlowWind');
		{
			const tr = transitions.fromBlowWind;
			const subfolder = transitionFolder.addFolder("From BlowWind").close();
			subfolder.add(tr, 'blowCount', 0, 64, 1);
		}
		{
			const tr = transitions.toTempest;
			const subfolder = transitionFolder.addFolder("To Tempest").close();
			subfolder.add(tr, 'fadeSpeed', 0.0, 0.1);
			subfolder.add(tr, 'fadeGamma', 0.0, 8.0);
		}
		transitionFolder.add(actions, 'Tempest');
		transitionFolder.add(actions, 'Pull');
		{
			const tr = transitions.fromPull;
			const subfolder = transitionFolder.addFolder("From Pull").close();
			subfolder.add(tr, 'pullCount', 0, 15, 1);
		}
		{
			const tr = transitions.toRain;
			const subfolder = transitionFolder.addFolder("To Rain").close();
			subfolder.add(tr, 'fadeSpeed', 0.0, 0.1);
			subfolder.add(tr, 'fadeGamma', 0.0, 8.0);
		}
		transitionFolder.add(actions, 'Rain');
		{
			const tr = transitions.fromRain;
			const subfolder = transitionFolder.addFolder("From Rain").close();
			subfolder.add(tr, 'cloudSpeed', 0.0, 0.05);
			subfolder.add(tr, 'fadeSpeed', 0.0, 0.1);
			subfolder.add(tr, 'fadeGamma', 0.0, 8.0);
			subfolder.add(tr, 'plantSpeed', 0.0, 0.05);
			subfolder.add(tr, 'rainSoundSpeed', 0.0, 0.1);
		}
		{
			const tr = transitions.toSun;
			const subfolder = transitionFolder.addFolder("To Sun").close();
			subfolder.add(tr, 'sunSpeed', 0.0, 0.1);
		}
		transitionFolder.add(actions, 'Sun');
		{
			const tr = transitions.fromSun;
			const subfolder = transitionFolder.addFolder("From Sun").close();
			subfolder.add(tr, 'sunSpeed', 0.0, 0.05);
			subfolder.add(tr, 'plantSpeed', 0.0, 0.05);
		}
		{
			const tr = transitions.toBlowFlowers;
			const subfolder = transitionFolder.addFolder("To BlowFlowers").close();
			subfolder.add(tr, 'fadeSpeed', 0.0, 0.1);
			subfolder.add(tr, 'fadeGamma', 0.0, 8.0);
			subfolder.add(tr, 'sunOpacitySpeed', 0.0, 0.05);
		}
		transitionFolder.add(actions, 'BlowFlowers');
		{
			const tr = transitions.fromBlowFlowers;
			const subfolder = transitionFolder.addFolder("From BlowFlowers").close();
			subfolder.add(tr, 'blowCount', 0, 64, 1);
		}
		transitionFolder.add(actions, 'Credits');

		const mixersFolder = gui.addFolder("Sound Mixers").close();
		for (const [ name, mixer ] of Object.entries(audio.mixers)) {
			if (!mixerInfo[name].hidden) {
				mixersFolder.add(mixer.gain, 'value', 0.0, 1.0).name(name);
			}
		}
		
		this.gui = gui;
	}

	async initDom() {
		await $DOMContentLoaded;
		const elementIds = [
			"main",
			"canvas",
			"hud",
			"msgCenter",
			"menuTitle",
			"creditsTitle",
			"loading",
			"loadingBar",
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

		// Event handlers
		const eventTarget = dom.canvas;//document;
		const eventHandlers = [
			[ 'keydown', this.onKeyDown ],
			[ 'keyup', this.onKeyUp ],
			[ 'touchstart', this.onTouchStart ],
			[ 'touchend', this.onTouchEnd ],
			[ 'touchmove', this.onTouchMove ],
			[ 'touchcancel', this.onTouchCancel ],
			[ 'mousedown', this.onMouseDown ],
			[ 'mouseup', this.onMouseUp ],
			[ 'mousemove', this.onMouseMove ],
			[ 'mouseenter', this.onMouseEnter ],
		];
		for (const [eventName, handler] of eventHandlers) {
			document.addEventListener(eventName, () => {
				this.tryAllowingAudioContext();
			});
			eventTarget.addEventListener(eventName, handler.bind(this));
		}
		window.addEventListener("resize", () => this.onResize());
		this.onResize();

	}

	initCanvas() {
		const { dom } = this;
		//dom.canvas.width = config.width;
		//dom.canvas.height = config.height;
		const ctx = dom.canvas.getContext("2d");
		//ctx.imageSmoothingEnabled = false;
		this.context2d = ctx;
	}

	initHud() {
		const { dom } = this;

		this.placeHudElement(dom.loading, {
			anchor: {
				x: 0.5,
				y: 0.5,
			},
			position: {
				x: 0.5,
				y: 0.5,
			},
			width: "100%",
			height: "4em",
		});

		this.placeHudElement(dom.menuTitle, {
			anchor: {
				x: 0.5,
				y: 0.5,
			},
			position: {
				x: 0.5,
				y: 0.35,
			},
			width: "100%",
			height: "6em",
		});

		this.placeHudElement(dom.creditsTitle, {
			anchor: {
				x: 0.5,
				y: 0.0,
			},
			position: {
				x: 0.5,
				y: 0.15,
			},
			width: "100%",
			height: "20em",
		});

		const defaultButtonStyle = {
			anchor: {
				x: 0.5,
				y: 0.5,
			},
			width: "10em",
			height: "2.5em",
		}
		this.createButton({
			id: "btnPlay",
			title: "Souffler",
			...defaultButtonStyle,
			position: {
				x: 0.5,
				y: 0.55,
			},
			onClick: () => this.transitionToScene('BLOW_WIND'),
		});

		this.createButton({
			id: "btnCredits",
			title: "Crédits",
			...defaultButtonStyle,
			position: {
				x: 0.5,
				y: 0.70,
			},
			onClick: () => this.transitionToScene('CREDITS'),
		});

		this.createButton({
			id: "btnMenu",
			title: "Retour au menu",
			...defaultButtonStyle,
			anchor: {
				x: 0.5,
				y: 1.0,
			},
			position: {
				x: 0.5,
				y: 0.85,
			},
			onClick: () => this.transitionToScene('MENU'),
		});

		this.renderHud();
	}

	createButton(opts) {
		const { dom } = this;
		const { title, onClick } = opts;

		const button = document.createElement("button");
		button.innerText = title;
		if (onClick) {
			button.addEventListener('click', onClick);
		}
		this.placeHudElement(button, opts);
	}

	placeHudElement(element, opts) {
		const { dom } = this;
		const { id, position, width, height, anchor } = opts;

		element.style.position = "absolute";
		element.style.left = `${position.x * 100}%`;
		element.style.top = `${position.y * 100}%`;
		element.style.width = width;
		element.style.height = height;
		element.style['margin-left'] = `calc(calc(0px - ${width}) * ${anchor.x})`;
		element.style['margin-top'] = `calc(calc(0px - ${height}) * ${anchor.y})`;
		
		if (id !== undefined) {
			element.id = id;
			dom[id] = element;
		}
		if (!element.parentElement) {
			dom.hud.append(element);
		}
	}

	initPhysics() {
		const { shapes } = this.assets;
		const { Engine, Bodies, Body, Composite, Runner, Common, Bounds } = Matter;
		// provide concave decomposition support library
		Common.setDecomp(decomp);

		const engine = Engine.create({
			enableSleeping: true,
		});

		// Create ground from a path
		const path = shapes.terrain.base;
		const verts = path.points.map(pt => ({ x: pt[0], y: pt[1] }));
		const originalBounds = Bounds.create(verts);
		const ground = Bodies.fromVertices(0, 0, verts, {
			isStatic: true,
			collisionFilter: {
				category: config.physics.layers.ground,
			},
		});
		const offset = {
			x: originalBounds.min.x - ground.bounds.min.x,
			y: originalBounds.min.y - ground.bounds.min.y,
		};
		Body.setPosition(ground, offset);

		Composite.add(engine.world, [ ground ]);

		// create runner
		const runner = Runner.create();

		// run the engine
		Runner.run(runner, engine);

		this.physics = {
			engine,
			runner,
			bodies: {
				ground,
			}
		};
	}

	initAudio() {
		const { mixers: mixerInfo, musics: musicInfo } = assetInfo;
		const audioCtx = new AudioContext();

		// Create mixers
		const mixers = {};
		// 1. Create nodes
		for (const [ name, info ] of Object.entries(mixerInfo)) {
			const mixer = new GainNode(audioCtx);
			mixer.gain.value = info.defaultGain;
			mixers[name] = mixer;
		}
		// 2. Connect nodes
		for (const [ name, info ] of Object.entries(mixerInfo)) {
			const mixer = mixers[name];
			const target = (
				info.target !== undefined
				? mixers[info.target]
				: audioCtx.destination
			);
			mixer.connect(target);
		}

		// Start loading musics
		const musics = {};
		for (const [ name, info ] of Object.entries(musicInfo)) {
			const audioElement = document.createElement('audio');
			audioElement.src = info.url;
			audioElement.loop = info.loop;
			const track = new MediaElementAudioSourceNode(audioCtx, {
				mediaElement: audioElement,
			});
			document.body.append(audioElement);
			track.connect(mixers[info.mixer]);
			musics[name] = audioElement;
		}

		this.audio = {
			context: audioCtx,
			mixers,
			musics,
		};
	}

	loadAssets() {
		this.assets = {
			images: {},
			shapes: {},
			sounds: {},
		}
		const { loadingProgress } = this.state;
		loadingProgress.ready = 0.0;
		loadingProgress.total = 0.0;

		const $prioritaryAssets = Promise.all([
			this.loadImages().then(() => this.afterLoadingImages()),
			this.loadShapes(),
		]);

		// We don't wait for these to fully load before starting the game
		const $delayedAssets = Promise.all([
			this.loadSounds(),
		]);

		return [ $prioritaryAssets, $delayedAssets ];
	}

	loadImages() {
		const { loadingProgress } = this.state;
		const { images } = this.assets;
		const { images: imageInfo } = assetInfo;

		return Promise.all(Object.entries(imageInfo).map(async pair => {
			const [name, info] = pair;

			const size = info.size !== undefined ? info.size : 1.0;
			loadingProgress.total += size;
			if (info.type === 'sequence') {
				const allUrls = [];
				for (let i = info.start ; i <= info.end ; ++i) {
					allUrls.push(info.url.replace('#', i));
				}
				const data = await Promise.all(allUrls.map(fetchImage));
				for (const img of data) {
					if (!img) {
						console.error(`Could not load image '${name}' from '${info.url}'!`);
					}
				}
				images[name] = { type: 'sequence', data };
			} else {
				const data = await fetchImage(info.url);
				if (!data) {
					console.error(`Could not load image '${name}' from '${info.url}'!`);
				}
				images[name] = { type: 'still', data };
			}
			loadingProgress.ready += size;
			this.onProgressUpdate();
		}));
	}

	afterLoadingImages() {
		const { images } = this.assets;

		// Generate a maskedBackgroundWind image from each background frame + grassMask
		const data = [];
		for (const layer of images.backgroundWind.data) {
			const canvas = document.createElement("canvas");
			canvas.width = layer.width;
			canvas.height = layer.height;
			const ctx = canvas.getContext("2d");

			ctx.drawImage(images.grassMask.data, 0, 0);
			ctx.globalCompositeOperation = "source-in";
			ctx.drawImage(layer, 0, 0);

			data.push(canvas);
		}
		images.maskedBackgroundWind = { data };
	}

	loadShapes() {
		const { loadingProgress } = this.state;
		const { shapes } = this.assets;
		const { shapes: shapeInfo } = assetInfo;

		return Promise.all(Object.entries(shapeInfo).map(async pair => {
			const [name, info] = pair;

			const size = info.size !== undefined ? info.size : 1.0;
			loadingProgress.total += size;
			const shapeData = await fetchShape(info.url);
			if (!shapeData) {
				console.error(`Could not load shape '${name}' from '${info.url}'!`);
			}
			shapes[name] = shapeData;
			loadingProgress.ready += size;
			this.onProgressUpdate();
		}));
	}

	loadSounds() {
		const { loadingProgress } = this.state;
		const { assets, audio } = this;
		const { sounds } = assets;
		const { sounds: soundInfo } = assetInfo;

		return Promise.all(Object.entries(soundInfo).map(async pair => {
			const [name, info] = pair;
			const soundData = await fetchSound(audio.context, info.url);
			if (!soundData) {
				console.error(`Could not load sound '${name}' from '${info.url}'!`);
			}
			sounds[name] = soundData;
		}));
	}

	start() {
		const { state } = this;
		console.log("start");
		state.loading = false;
		state.previousFrameTime = performance.now();
		this.startBackgroundAnimation();
		this.startPlants();
		this.startScene(state.scene);
		this.renderHud();
		requestAnimationFrame(() => this.onFrame());
	}

	startScene(scene) {
		switch (scene) {
		case 'MENU':
			return this.startMenu();
		case 'BLOW_WIND':
			return this.startBlowWind();
		case 'TEMPEST':
			return this.startTempest();
		case 'PULL':
			return this.startPull();
		case 'RAIN':
			return this.startRain();
		case 'SUN':
			return this.startSun();
		case 'BLOW_FLOWERS':
			return this.startBlowFlowers();
		case 'CREDITS':
			return this.startCredits();
		default:
			break;
		}
	}

	endScene(scene) {
		switch (scene) {
		case 'MENU':
			return this.endMenu();
		case 'BLOW_WIND':
			return this.endBlowWind();
		case 'TEMPEST':
			return this.endTempest();
		case 'PULL':
			return this.endPull();
		case 'RAIN':
			return this.endRain();
		case 'SUN':
			return this.endSun();
		case 'BLOW_FLOWERS':
			return this.endBlowFlowers();
		case 'CREDITS':
			return this.endCredits();
		default:
			break;
		}
	}

	async transitionToScene(scene) {
		const { state } = this;
		if (state.inTransition) {
			console.warn(`Transition already in progress! scene = ${state.scene}`);
			return;
		}
		state.inTransition = true;
		await this.endScene(state.scene);
		state.scene = scene
		this.renderGui();
		this.renderHud();
		await this.startScene(state.scene);
		state.inTransition = false;
	}

	async startMenu() {
		const { state } = this;
		state.rendering.blackOverlay = 0.7;
	}

	async endMenu() {
	}

	async startCredits() {
		const { state } = this;
		state.rendering.blackOverlay = 0.7;
	}

	async endCredits() {}

	async startBlowWind() {
		const { state } = this;
		const opts = state.transitions.toBlowWind

		state.plants.growth = 0.0;
		state.wind.blowCount = 0;
		this.spawnJumpingBetes();
		this.startSpriteAnimations();

		for (let t = 0.0 ; t <= 1.0 ; t += opts.fadeSpeed) {
			state.rendering.blackOverlay = Math.pow(1.0 - t, opts.fadeGamma);
			await wait(20);
		}
	}

	endBlowWind() {
		this.clearRigidBodies(this.state.sprites);
	}

	async startTempest() {
		const { state, audio } = this;
		const { musics, mixers } = audio;
		const opts = state.transitions.toTempest;

		state.plants.growth = 0.0;

		await fadeInMixer(
			mixers.tempestTrack,
			[ musics.tempest ],
			opts.fadeSpeed,
		);

		setTimeout(() => this.transitionToScene('PULL'), 2000);
	}

	endTempest() {
		const { state, audio } = this;
		const { musics, mixers } = audio;
		const opts = state.transitions.toTempest;

		return fadeOutMixer(
			mixers.tempestTrack,
			[ musics.tempest ],
			opts.fadeSpeed,
		)
	}

	async startPull() {
		const { state } = this;
		state.plants.growth = 0.0;
		state.pulledBetes.pullCount = 0;
		this.startPulledBetes();
	}

	async endPull() {
		//this.clearRigidBodies(this.state.pulledBetes.items);
	}

	async startRain() {
		const { state } = this;
		const { plants, rain, transitions } = state;
		plants.growth = 0.0;
		const opts = transitions.toRain;

		for (let t = 0.0 ; t <= 1.0 ; t += opts.fadeSpeed) {
			rain.cloudOpacity = Math.pow(Math.min(t, 1.0), opts.fadeGamma);
			await wait(20);
		}
	}

	async endRain() {
		const { state, audio } = this;
		const { mixers, musics } = audio;
		const { rain, plants, transitions } = state;
		const opts = transitions.fromRain;

		const $cloudAnim = (async () => {
			while (rain.cloudPosition < 1.0) {
				rain.cloudPosition += opts.cloudSpeed;
				await wait(20);
			}
			for (let t = 0.0 ; t <= 1.0 ; t += opts.fadeSpeed) {
				rain.cloudOpacity = 1.0 - Math.pow(Math.min(t, 1.0), opts.fadeGamma);
				await wait(20);
			}
		})();

		const $plantAnim = (async () => {
			plants.growth = 0.0;
			await wait(2000);
			const target = transitions.growthAfterRain;
			while (plants.growth < target) {
				plants.growth = Math.min(plants.growth + opts.plantSpeed, target);
				await wait(20);
			}
		})();

		this.startRainDrops();
		await wait(3000);
		await $cloudAnim;
		await $plantAnim;
		this.stopRainDrops();

		await fadeOutMixer(
			mixers.rainTrack,
			[ musics.rain ],
			opts.rainSoundSpeed
		);

		rain.cloudPosition = 0.0
	}

	async startSun() {
		const { state } = this;
		const { sun, transitions } = state;
		const opts = transitions.toSun;

		state.plants.growth = transitions.growthAfterRain;

		while (sun.opacity < 1.0) {
			sun.opacity += opts.sunSpeed;
			await wait(20);
		}
	}

	async endSun() {
		const { state, audio } = this;
		const { mixers, musics } = audio;
		const { sun, plants, transitions } = state;
		const opts = transitions.fromSun;

		const $sunAnim = (async () => {
			while (sun.position < 1.0) {
				sun.position += opts.sunSpeed;
				await wait(20);
			}
		})();

		const $plantAnim = (async () => {
			plants.growth = transitions.growthAfterRain;
			const target = transitions.growthAfterSun;
			while (plants.growth < target) {
				plants.growth = Math.min(plants.growth + opts.plantSpeed, target);
				await wait(20);
			}
		})();

		await $sunAnim;
		await $plantAnim;
	}

	async startBlowFlowers() {
		const { state } = this;
		const { transitions, sun } = state;
		const opts = transitions.toBlowFlowers;

		state.wind.blowCount = 0;

		const $sunAnim = (async () => {
			while (sun.opacity > 0.0) {
				sun.opacity -= opts.sunOpacitySpeed;
				await wait(20);
			}
			sun.position = 0;
		})();

		const $plantAnim = (async () => {
			const start = transitions.growthAfterSun;
			for (let t = 0.0 ; t <= 1.0 ; t += opts.fadeSpeed) {
				state.plants.growth = lerp(start, 1.0, Math.pow(t, opts.fadeGamma));
				await wait(20);
			}
			this.startPappi();
		})();

		await $sunAnim;
		await $plantAnim;
	}

	endBlowFlowers() {
		this.clearRigidBodies(this.state.pappi.items);
	}

	spawnJumpingBetes() {
		if (this.state.sprites.length > 0) return;
		this.spawnBete(300, 300, 1.0 * 0.5);
		this.spawnBete(400, 300, 0.5 * 0.5);
		this.spawnBete(500, 300, 0.7 * 0.5);
		this.spawnBete(600, 300, 0.6 * 0.5);
		this.spawnBete(700, 300, 0.9 * 0.5);
	}

	spawnBete(x, ymax, scale) {
		const { Bodies, Composite } = Matter;
		const { state, physics } = this;

		// Cast ray from (x,ymax) to locate the bete onto the ground
		const y = this.queryGroundPositionBelow(x, ymax);

		// Sprite
		const sprite = createBeteSprite(x, y, scale);
		state.sprites.push(sprite);
		
		// Physics
		const boxSize = 70 * scale;
		const anchor = { x: 0, y: boxSize * 0.45 };
		const { layers } = config.physics;
		const box = Bodies.rectangle(x - anchor.x, y - anchor.y, boxSize, boxSize, {
			isSleeping: true,
			collisionFilter: {
				category: layers.freeBetes,
				mask: layers.default | layers.ground | layers.freeBetes,
			},
		});
		Composite.add(physics.engine.world, [ box ]);
		sprite.rigidbody = box;
		sprite.rigidbodyAnchor = anchor;
	}

	clearRigidBodies(objectArray) {
		const { Composite } = Matter;
		const { state, physics } = this;
		Composite.remove(physics.engine.world, objectArray.map(obj => obj.rigidbody));
		objectArray.length = 0;
	}

	startSpriteAnimations() {
		const { state, assets } = this;
		const { images } = assets;
		
		for (const sprite of state.sprites) {
			const callbackB = async () => {
				const { Body } = Matter;
				let state = 'IDLE';
				let frame = 0;
				const jumpStartFrame = 2;
				const jumpDuration = 7;
				const jumpGamma = 0.5; // <1 = move at the beginning of jump, >1 = move and the end of jump
				const jumpDistanceRange = { min: 50, max: 200 };
				const jumpHeightRange = { min: 40, max: 300, gamma: 4.0 };
				const jumpPauseRange = { min: 200, max: 800 };
				let jumpDistanceSign = 1;

				// Index of the frame used when physics takes over
				const physicsFrame = 0;

				const { rigidbodyAnchor, rigidbody: body } = sprite;
				const { data } = images[sprite.imageName];
				for (;;) {
					const pause = randomInRange(jumpPauseRange);
					await wait(pause);

					if (!body.isSleeping) {
						// No animation while physics is playing
						sprite.frame = physicsFrame;
						continue;
					}

					const startPosition = { ...sprite.position };
					jumpDistanceSign = -jumpDistanceSign;
					if (startPosition.x < 10) jumpDistanceSign = 1;
					if (startPosition.x > config.width - 10) jumpDistanceSign = -1;
					const jumpDistance = jumpDistanceSign * randomInRange(jumpDistanceRange);
					const jumpHeight = randomInRange(jumpHeightRange);
					const endX = startPosition.x + jumpDistance;
					const endPosition = {
						x: endX,
						y: this.queryGroundPositionBelow(endX, /*startPosition.y - jumpHeight*/100),
					};
					sprite.flipX = jumpDistanceSign > 0;
					for (let i = 0; i < data.length; ++i) {
						sprite.frame = i;
						const t = Math.min(Math.max(0, (i - jumpStartFrame) / jumpDuration), 1);

						sprite.position.x = startPosition.x + jumpDistance * Math.pow(t, jumpGamma);
						sprite.position.y = lerp(startPosition.y, endPosition.y, t) - jumpHeight * 4 * t * (1 - t);

						if (body.isSleeping) {
							Body.setPosition(body, {
								x: sprite.position.x - rigidbodyAnchor.x,
								y: sprite.position.y - rigidbodyAnchor.y,
							});
						}

						await wait(1000 / sprite.anim.fps);
						if (!body.isSleeping) {
							// Break animation when physics takes over
							sprite.frame = physicsFrame;
							break;
						}
					}
				}
			}
			callbackB();
		}
	}

	startBackgroundAnimation() {
		const { state, assets } = this;
		const { images } = assets;
		const { data } = images.backgroundWind;

		const callbackA = async () => {
			const { anim } = state.background;
			for (;;) {
				//anim.frame = (anim.frame + 1) % data.length;
				anim.frame += 1;
				anim.frameStartTime = performance.now();
				await wait(1000 / anim.fps);
			}
		}
		callbackA();

		const callbackB = async () => {
			const { anim } = state.tempest;
			for (;;) {
				//anim.frame = (anim.frame + 1) % data.length;
				anim.frame += 1;
				anim.frameStartTime = performance.now();
				await wait(1000 / anim.fps);
			}
		}
		callbackB();
	}

	startPlants() {
		const { state, assets } = this;
		const { items } = state.plants;
		for (const plant of state.plants.items) {
			computePlantAnchors(plant, assets);
		}
	}

	startRainDrops() {
		const { state } = this;
		const { drops, dropArrayOpts } = state.rain;
		const tr = this.getBackgroundTransform();
		drops.push(...createRainDropArray(tr, dropArrayOpts));
	}

	stopRainDrops() {
		const { state } = this;
		const { drops } = state.rain;
		drops.length = 0;
	}

	startPulledBetes() {
		const { state, physics } = this;
		const { items } = state.pulledBetes;
		if (items.length > 0) return;

		items.push(
			createPulledBete(
				340,
				725,
				physics.engine,
				"squeak0",
			),
			createPulledBete(
				420,
				740,
				physics.engine,
				"squeak1",
			),
			createPulledBete(
				725,
				707,
				physics.engine,
				"squeak2",
			),
			createPulledBete(
				900,
				685,
				physics.engine,
				"squeak3",
			),
		);
	}

	startPappi() {
		const { state, physics, assets } = this;
		const { items, countPerPlant, maxAngle } = state.pappi;
		const { images, shapes } = assets;
		const skinCount = images.pappus.data.length;

		for (const plant of state.plants.items) {
			const shape = shapes.pappus;
			for (let i = 0 ; i < countPerPlant ; ++i) {
				const angle = lerp(-maxAngle, maxAngle, i / (countPerPlant - 1));
				items.push(
					createPappus(
						plant,
						shape,
						physics.engine,
						angle,
						skinCount
					)
				);
			}
		}
	}

	// ----------------------------------------------------
	// UTILS

	transformMouseToLocal(clientPosition) {
		const { canvas } = this.dom;
		const { camera } = this.state;
		const { x, y } = clientPosition;
		const rect = canvas.getBoundingClientRect();
		const canvasPosition = {
			x: (x - rect.x) * (config.width / rect.width),
			y: (y - rect.y) * (config.height / rect.height),
		};

		const zoomScale = Math.exp(0.1 * camera.zoom);
		const w2 = config.width / 2;
		const h2 = config.height / 2;

		return {
			x: (canvasPosition.x - w2) / zoomScale + w2 + camera.x,
			y: (canvasPosition.y - h2) / zoomScale + h2 + camera.y,
		}
	}

	queryGroundPositionBelow(x, y) {
		const { physics } = this;
		if (!physics) return y;
		const startPoint = { x, y };
		const endPoint = { x, y: 10 * config.height };
		const hits = raycast([ physics.bodies.ground ], startPoint, endPoint);
		if (hits.length > 0) {
			const h = hits[0];
			return h.point.y;
		}
		return y;
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
		let isButton0Presset = false;
		if (ev.buttons.includes) {
			isButton0Presset = ev.buttons.includes(0);
		} else {
			const MAIN_BUTTON_BIT = 1;
			isButton0Presset = ev.buttons & MAIN_BUTTON_BIT != 0;
		}
		if (!isButton0Presset) {
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
		ev.preventDefault();
	}

	onTouchCancel(ev) {
	}


	startDragging(position) {
		const { drag, wind, rain, sun, scene, loading } = this.state;
		if (drag.active || loading) return;
		const mouse = this.transformMouseToLocal(position);
		drag.active = true;
		drag.previousMouse = mouse;
		drag.frames = 0;

		// Blow wind
		drag.velocity = { x: 0, y: 0 };
		wind.currentSound = null;

		// Rain
		drag.startMouse = mouse;
		drag.startCloudPosition = rain.cloudPosition;

		drag.startSunPosition = sun.position;

		if (scene === "PULL" || (scene === "RAIN" && drag.startMouse.y > config.height / 2)) {
			this.startDraggingPull(mouse);
		}

		this.updateDragging(position);
	}

	startDraggingPull(mouse) {
		const { Constraint, Composite, Query, Bodies, Vector } = Matter;
		const { state, physics } = this;
		const { drag, pulledBetes } = state;

		pulledBetes.pullCount += 1;

		const beteBodies = pulledBetes.items.map(bete => bete.rigidbody);

		// TODO: cache this body?
		const mouseBody = Bodies.circle(mouse.x, mouse.y, pulledBetes.mouseRadius);
		const collisions = Query.collides(mouseBody, beteBodies);
		const bodyToBete = {};
		for (const bete of pulledBetes.items) {
			bodyToBete[bete.rigidbody.id] = bete;
		}

		const mouseLinks = [];
		for (const col of collisions) {
			const targetBody = col.bodyA === mouseBody ? col.bodyB : col.bodyA;

			// Create spring
			const constraint = Constraint.create({
				pointA: targetBody.position,
				bodyB: targetBody,
				pointB: { x: 0, y: 0 },
				stiffness: 0.005 * pulledBetes.mouseStrength,
			});

			const delta = Vector.sub(targetBody.position, mouse);

			mouseLinks.push({
				constraint,
				delta,
				sound: null,
				soundName: bodyToBete[targetBody.id].soundName,
			});
		}
		Composite.add(physics.engine.world, mouseLinks.map(l => l.constraint));
		drag.pulledBetes = { mouseLinks };
	}

	updateDraggingPull(mouse) {
		const { Vector } = Matter;
		const { drag } = this.state;
		for (const link of drag.pulledBetes.mouseLinks) {
			const point = Vector.add(mouse, link.delta);
			link.constraint.pointA = point;

			if (!link.sound) {
				const dx = mouse.x - drag.startMouse.x;
				const dy = mouse.y - drag.startMouse.y;
				const magnitudeSq = dx * dx + dy * dy;
				const th = 50;
				const thSq = th * th;
				if (magnitudeSq > thSq) {
					link.sound = this.playSound(link.soundName);
				}
			}
		}
	}

	stopDraggingPull() {
		const { Composite } = Matter;
		const { state, physics } = this;
		const { drag } = state;
		Composite.remove(physics.engine.world, drag.pulledBetes.mouseLinks.map(l => l.constraint));
		drag.pulledBetes = { mouseLinks: [] };

		if (state.pulledBetes.pullCount > state.transitions.fromPull.pullCount && state.scene != 'RAIN') {
			this.transitionToScene('RAIN');
		}
	}

	updateDragging(position) {
		const { state } = this;
		const { drag, scene } = state;
		if (!drag.active) return;
		drag.frames += 1;

		const mouse = this.transformMouseToLocal(position);
		window.mouse = mouse;

		switch (scene) {
		case 'BLOW_WIND':
		case 'BLOW_FLOWERS':
		case 'TEMPEST':
			this.updateDraggingWind(mouse);
			break;
		case 'PULL':
			this.updateDraggingPull(mouse);
			break;
		case 'RAIN':
			if (drag.startMouse.y > config.height / 2) {
				this.updateDraggingPull(mouse);
			} else {
				this.updateDraggingRain(mouse);
			}
			break;
		case 'SUN':
			this.updateDraggingSun(mouse);
			break;
		}

		state.needRedraw = true;

		drag.previousMouse = mouse;
	}

	updateDraggingRain(mouse) {
		const { state } = this;
		const { drag, rain } = state;
		const { directionAngle, sensitivity } = rain.swipe;

		const delta = {
			x: mouse.x - drag.startMouse.x,
			y: mouse.y - drag.startMouse.y,
		};
		const theta = directionAngle * Math.PI / 180;
		const direction = {
			x: Math.cos(theta),
			y: Math.sin(theta),
		}
		rain.cloudPosition = drag.startCloudPosition + 0.001 * sensitivity * dotVec2(delta, direction);
		rain.cloudPosition = Math.min(Math.max(0.0, rain.cloudPosition), 1.0);
	}

	updateDraggingSun(mouse) {
		const { state } = this;
		const { drag, sun } = state;
		const { directionAngle, sensitivity } = sun.swipe;

		const delta = {
			x: mouse.x - drag.startMouse.x,
			y: mouse.y - drag.startMouse.y,
		};
		const theta = directionAngle * Math.PI / 180;
		const direction = {
			x: Math.cos(theta),
			y: Math.sin(theta),
		}
		const dot = dotVec2(delta, direction);
		sun.position = drag.startSunPosition + 0.001 * sensitivity * dot;
		sun.position = Math.min(Math.max(0.0, sun.position), 1.0);
	}

	updateDraggingWind(mouse) {
		const { state, physics } = this;
		const { drag, wind } = state;

		const instantVelocity = {
			x: (mouse.x - drag.previousMouse.x) * 0.005,
			y: (mouse.y - drag.previousMouse.y) * 0.005,
		};
		const fac = drag.frames / (drag.frames + 1); // online average
		const velocity = {
			x: lerp(drag.velocity.x, instantVelocity.x, fac),
			y: lerp(drag.velocity.y, instantVelocity.y, fac),
		};
		drag.velocity = velocity;

		const magnitudeSq = velocity.x * velocity.x + velocity.y * velocity.y;

		if (magnitudeSq > wind.minDragMagnitude * wind.minDragMagnitude) {
			const magnitude = Math.sqrt(magnitudeSq);
			const clampedMagnitude = Math.min(magnitude, wind.maxVelocity);
			const scale = clampedMagnitude / magnitude;
			const clampedVelocity = scaleVec2(velocity, scale);
			// Emit wind particle
			const radius = randomInRange(wind.particles.size);
			state.maskParticles.push({
				...createMaskParticle(mouse.x, mouse.y, radius),
				velocity: clampedVelocity,
				lifeDuration: randomInRange(wind.particles.lifeDuration),
			});

			const offsetY = state.scene === "BLOW_FLOWERS" ? 0 : 0;

			Physics.applyLocalForce(
				physics.engine,
				mouse,
				radius,
				scaleVec2(clampedVelocity, wind.drag),
				{ x: 0, y: offsetY },
			);

			wind.level = Math.max(wind.level, lerp(0.5, 1.0, clampedMagnitude / wind.maxVelocity));
			if (wind.currentSound === null) {
				wind.currentSound = this.playSound("wind01", "wind");
				state.wind.blowCount += 1;
			}
		}
	}

	stopDragging() {
		const { drag, character, scene, loading, wind, transitions } = this.state;
		if (!drag.active || loading) return;
		drag.active = false;

		if (scene === "PULL" || (scene === "RAIN" && drag.startMouse.y > config.height / 2)) {
			this.stopDraggingPull();
		}

		if (scene === 'BLOW_WIND' && wind.blowCount >= transitions.fromBlowWind.blowCount) {
			this.transitionToScene('TEMPEST');
		}

		if (scene === 'BLOW_FLOWERS' && wind.blowCount >= transitions.fromBlowFlowers.blowCount) {
			this.transitionToScene('CREDITS');
		}
	}

	onProgressUpdate() {
		const { loadingProgress } = this.state;
		const progress = loadingProgress.ready / loadingProgress.total;
		const { dom } = this;
		if (!dom) return;
		dom.loadingBar.style.width = `${progress*100}%`;
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

		dom.canvas.width = width * window.devicePixelRatio;
		dom.canvas.height = height * window.devicePixelRatio;

		dom.canvas.style.width = `${width}px`;
		dom.canvas.style.height = `${height}px`;
		dom.main.style.width = `${width}px`;
		dom.main.style.height = `${height}px`;
		dom.main.style.top = `${(window.innerHeight - height) / 2}px`;
		dom.main.style['font-size'] = `${16 * width / (config.width * config.domPixelMultiplier)}px`; // scale definition of '1em'
	}

	// If only there was a browser event we could listen for when navigator.userActivation.hasBeenActive changes...
	tryAllowingAudioContext() {
		const { state, audio } = this;
		if (audio.context && !state.audioContextAllowed) {
			audio.context.resume().then(() => {
				if (!state.audioContextAllowed) {
					state.audioContextAllowed = true;
					this.onAudioContextAllowed();
				}
			});
		}
	}

	onAudioContextAllowed() {
		//this.dom["soundOn-btn"].style.display = 'block';
		//this.dom["soundOff-btn"].style.display = 'none';
		//if (this.state.scene == 'MENU') {
			this.fadeInSound();
		//}
	}

	onFrame() {
		const { state } = this;
		const frameTime = performance.now();
		const deltaTime = frameTime - state.previousFrameTime;

		this.updateGame(deltaTime);

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
		const { state } = this;
		const { scene } = state;
		state.frame += 1;
		this.updateMaskParticles(dt);
		if (scene === 'BLOW_WIND') {
			this.updateSprites();
		}
		if (scene === 'BLOW_FLOWERS') {
			this.updatePappi();
		}
		if (scene === 'BLOW_WIND' || scene === 'BLOW_FLOWERS') {
			this.updateWind(dt);
		}
		if (scene === 'RAIN') {
			this.updateRain();
		}
		this.updateSun();
		if (scene === 'SUN') {
			if (state.sun.position > 0.95) {
				this.transitionToScene('BLOW_FLOWERS');
			}
		}
		// TODO: test if something changed in the physics engine
		state.needRedraw = true;
	}

	updateMaskParticles(dt) {
		const { state } = this;
		for (const part of state.maskParticles) {
			part.x += dt * part.velocity.x;
			part.y += dt * part.velocity.y;
			part.age = (performance.now() - part.birthTime) /  part.lifeDuration;
		}

		const isParticleInSight = part => (
			part.x - part.radius < config.width &&
			part.x + part.radius > 0 &&
			part.y - part.radius < config.height &&
			part.y + part.radius > 0
		);

		// Remove particles once out of sight
		state.maskParticles = state.maskParticles.filter(part => isParticleInSight(part) && part.age < 1);

		// Create new particles
		if (state.wind.hasParticleFlow && Math.random() < 0.5) {
			const y = config.height * randomInRange({
				min: 0.1,
				max: 0.9
			});
			const radius = randomInRange({
				min: 20,
				max: 100
			});
			state.maskParticles.push(createMaskParticle(
				-radius,
				y,
				radius
			));
		}
	}

	updateSprites() {
		const { state, assets } = this;
		const { images } = assets;
		for (const sprite of state.sprites) {
			const { imageName, frame, anchor, scale, rigidbody: body, rigidbodyAnchor } = sprite;
			if (body === null) continue;
			if (!body.isSleeping) {
				const { x, y } = body.position;
				const imageData = images[imageName].data[frame];
				sprite.position = {
					x: x + rigidbodyAnchor.x,
					y: y + rigidbodyAnchor.y,
				};
			}
		}
	}

	updateWind(dt) {
		const { state } = this;
		const { wind } = state;
		wind.level = Math.max(0.0, wind.level - wind.levelDecaySpeed * dt);
		if (wind.currentSound !== null) {
			wind.currentSound.gain.value = Math.pow(wind.level, wind.soundDecayGamma);
		}
	}

	updateRain() {
		const { state, audio } = this;
		const { rain } = state;

		if (state.audioContextAllowed) {
			const { mixers, musics } = audio;
			mixers.rainTrack.gain.value = rain.cloudPosition;
			musics.rain.play();
		}

		if (rain.cloudPosition > 0.8) {
			this.transitionToScene('SUN');
		}
	}

	updateSun() {
		const { sun } = this.state;
		sun.lightOpacity = sun.opacity * sun.position * sun.maxLightOpacity;
	}

	updatePappi() {
		const { state, assets } = this;
		const { images } = assets;
		for (const pappus of state.pappi.items) {
			const { rigidbody: body } = pappus;
			if (body === null) continue;
			if (!body.isSleeping) {
				const { x, y } = body.position;
				//const imageData = images[imageName].data[frame];
				pappus.position = {
					x: x,// + rigidbodyAnchor.x,
					y: y,// + rigidbodyAnchor.y,
				};
			}
		}
	}

	// ----------------------------------------------------
	// SOUND

	fadeInSound() {
		const { state, audio } = this;
		if (!state.audioContextAllowed) return;
		const { mixers, musics } = audio;

		return fadeInMixer(
			mixers.master,
			[ musics.intro ],
			state.music.fadeSpeed,
		);
	}

	playSound(soundName, mixerName, loop) {
		mixerName = mixerName !== undefined ? mixerName : "sounds";
		loop = loop !== undefined ? loop : false;

		const { audio, assets } = this;
		const { mixers, context: audioCtx } = audio;

		if (audioCtx.state != 'running') return null;

		const soundData = assets.sounds[soundName];
		if (!soundData) return; // lazily loaded sound is not ready yet

		const mixer = new GainNode(audioCtx);
		mixer.gain.value = 1.0;

		const source = audioCtx.createBufferSource();
		source.buffer = soundData;
		source.connect(mixer).connect(mixers[mixerName]);
		source.loop = loop;
		source.start();
		return mixer;
		// TODO: destroy nodes when sound ends
	}

	// ----------------------------------------------------
	// RENDERING

	renderHud() {
		const { state, dom } = this;
		const { scene, loading } = state;
		dom.msgCenter.innerText = loading ? "Chargement..." : "";

		dom.msgCenter.style.display = "none";
		dom.loading.style.display = loading ? "block" : "none";

		dom.menuTitle.style.display = !loading && scene === "MENU" ? "block" : "none";
		dom.btnPlay.style.display = !loading && scene === "MENU" ? "block" : "none";
		dom.btnCredits.style.display = !loading && scene === "MENU" ? "block" : "none";

		dom.creditsTitle.style.display = !loading && scene === "CREDITS" ? "block" : "none";
		dom.btnMenu.style.display = !loading && scene === "CREDITS" ? "block" : "none";
	}

	renderGui() {
		if (!this.gui) return;
		for (const cont of this.gui.controllersRecursive()) {
			cont.updateDisplay();
		}
	}

	applyViewportTransform(ctx) {
		const { camera } = this.state;
		const zoomScale = Math.exp(0.1 * camera.zoom);
		ctx.scale(ctx.canvas.width / config.width, ctx.canvas.height / config.height);

		ctx.translate(config.width / 2, config.height / 2);
		ctx.scale(zoomScale, zoomScale);
		ctx.translate(-config.width / 2, -config.height / 2);
		
		ctx.translate(-camera.x, -camera.y);
	}

	renderCanvas() {
		const { state, dom, physics, assets, context2d: ctx } = this;
		const { rendering, scene } = state;
		const { images } = assets;
		const { canvas } = dom;

		if (rendering.blackOverlay > 0) {
			ctx.save();
			ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.width);
			this.applyViewportTransform(ctx);

			const isBlowing = scene === 'BLOW_WIND' || scene === 'BLOW_FLOWERS' || scene === 'TEMPEST'

			if (isBlowing) {
				this.drawBackgroundWind();
			} else if (scene === 'RAIN') {
				this.drawBackgroundRain();
				this.drawRainDrops();
			} else {
				this.drawBackgroundDefault();
			}

			this.drawAllPappi();
			this.drawAllPlants();

			if (scene === 'PULL' || scene === 'RAIN') {
				this.drawPulledBetes();
			}

			this.drawGrassMask();

			if (scene === 'BLOW_WIND' || scene === 'TEMPEST') {
				// Draw betes
				for (const sprite of state.sprites) {
					drawSprite(ctx, images, sprite);
				}
			}

			this.drawSunAndLight();

			if (rendering.drawPhysicsOverlay) {
				Physics.drawOverlay(ctx, physics.engine);
			}

			ctx.restore();
		}

		ctx.globalAlpha = rendering.blackOverlay;
		ctx.fillStyle = "black";
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.width);
		ctx.globalAlpha = 1.0;
	}

	getBackgroundTransform() {
		const { assets, state, dom, context2d: ctx } = this;
		const { images } = assets;
		const img = images.backgroundWind.data[0];
		const backgroundRatio = img.width / img.height;
		const w = config.width;
		const h = config.width / backgroundRatio;
		const x = (config.width - w) / 2;
		const y = (config.height - h) / 2;
		return [ x, y, w, h ];
	}

	drawCanvasBackgroundMask(opacityMultiplier) {
		const { assets, state, dom, context2d: ctx } = this;
		const { images } = assets;

		// Draw mask
		ctx.fillStyle = `rgb(255, 0, 0)`;
		for (const part of state.maskParticles) {
			const { x, y, radius, age, velocity } = part;
			const opacity = 1.0 - age;
			ctx.save();
			ctx.globalAlpha = opacity * opacityMultiplier;
			ctx.translate(x, y);
			const velocityAngle = Math.atan2(velocity.y, velocity.x);
			ctx.rotate(50 * Math.PI / 180 + velocityAngle);
			ctx.translate(-x, -y);
			drawScaledImage(ctx, images.brush01.data, x - radius, y - radius, 2 * radius, 2 * radius);
			ctx.restore();
		}

	}

	drawBackgroundWind() {
		const { assets, state, dom, context2d: ctx } = this;
		const { images } = assets;
		const { camera, background, wind, tempest } = state;

		ctx.save();

		const tr = this.getBackgroundTransform();

		// Draw base background
		if (state.scene === 'TEMPEST') {
			const { anim } = tempest;
			const { start, end } = anim;
			const frameIndex = start + anim.frame % (end - start + 1);
			const nextFrameIndex = start + (anim.frame + 1) % (end - start + 1);
			const img = images.backgroundWind.data[frameIndex];
			drawScaledImage(ctx, img, ...tr);

			if (anim.useCrossFade) {
				const nextImg = images.backgroundWind.data[nextFrameIndex];
				const frameDuration = 1000 / anim.fps;
				const alpha = (performance.now() - anim.frameStartTime) / frameDuration;
				ctx.globalAlpha = alpha;
				drawScaledImage(ctx, nextImg, ...tr);
				ctx.globalAlpha = 1.0;
			}

		} else {
			const img = images.backgroundWind.data[0];
			drawScaledImage(ctx, img, ...tr);
		}

		// Carve into the background
		ctx.globalCompositeOperation = "destination-out"
		this.drawCanvasBackgroundMask(1.0);

		ctx.globalCompositeOperation = "destination-over";

		// Compose multiple backgrounds
		{
			const { anim } = background;
			const { start, end } = anim;
			const frameIndex = start + anim.frame % (end - start + 1);
			const nextFrameIndex = start + (anim.frame + 1) % (end - start + 1);
			const backgroundWindImg = images.backgroundWind.data[frameIndex];
			const nextBackgroundWindImg = images.backgroundWind.data[nextFrameIndex];
			const frameDuration = 1000 / anim.fps;
			const alpha = (performance.now() - anim.frameStartTime) / frameDuration;
			
			// Cross-fade, in destination-over mode: draw overlay first
			ctx.globalAlpha = alpha;
			drawScaledImage(ctx, nextBackgroundWindImg, ...tr);
			ctx.globalAlpha = 1.0;
			drawScaledImage(ctx, backgroundWindImg, ...tr);
		}

		ctx.globalCompositeOperation = "lighter";
		this.drawCanvasBackgroundMask(wind.lightOpacity);
		
		ctx.restore();
	}

	drawBackgroundRain() {
		const { assets, state, context2d: ctx } = this;
		const { images, shapes } = assets;
		const { rain } = state;

		const img = images.backgroundWind.data[0];
		const tr = this.getBackgroundTransform();
		drawScaledImage(ctx, img, ...tr);
		const backgroundScale = tr[2] / img.width;

		// Cloud
		{
			const n = images.cloud.data.length;
			const continuousCloudIndex = rain.cloudPosition * (n - 1);
			const cloudIndex = Math.min(Math.max(0, Math.floor(continuousCloudIndex)), n - 2);
			const fract = continuousCloudIndex - cloudIndex;
			const cloudImg = images.cloud.data[cloudIndex];
			const nextCloudImg = images.cloud.data[cloudIndex + 1];

			let x, y, w, h;
			if (rain.interpolation.useCorners) {
				const [ left, top ] = samplePath(shapes.cloud.smoothTopLeft, rain.cloudPosition);
				const [ right, bottom ] = samplePath(shapes.cloud.smoothBottomRight, rain.cloudPosition);
				x = (left + right) / 2;
				y = (top + bottom) / 2;
				w = right - left;
				h = bottom - top;
			} else {
				[ x, y ] = samplePath(shapes.cloud.smoothCenter, rain.cloudPosition);
				const width = lerp(cloudImg.width, nextCloudImg.width, fract);
				const height = lerp(cloudImg.height, nextCloudImg.height, fract);
				w = backgroundScale * width;
				h = backgroundScale * height;
			}

			ctx.globalAlpha = (1.0 - fract) * rain.cloudOpacity;
			drawScaledImage(ctx, cloudImg, x - w / 2, y - h / 2, w, h);
			ctx.globalAlpha = fract * rain.cloudOpacity;
			drawScaledImage(ctx, nextCloudImg, x - w / 2, y - h / 2, w, h);
			ctx.globalAlpha = 1.0;
		}
	}

	drawBackgroundDefault() {
		const { assets, context2d: ctx } = this;
		const { images } = assets;

		const img = images.backgroundWind.data[0];
		const tr = this.getBackgroundTransform();
		drawScaledImage(ctx, img, ...tr);
	}

	drawRainDrops() {
		const { state, assets, context2d: ctx } = this;
		const { rain } = state;
		const { images } = assets;

		for (const drop of rain.drops) {
			const { imageIndex, x, y, birthTime, size, anim } = drop;
			const img = images.rainDrop.data[imageIndex];
			const ntime = (performance.now() - birthTime) / anim.period * rain.speedMultiplier;
			const t = ntime - Math.floor(ntime);
			const offset = (t - 0.5) * anim.length * rain.lengthMultiplier;
			const w = img.width * size.x;
			const h = img.height * size.y;

			ctx.save();
			ctx.globalAlpha = 0.5 * 4 * t * (1 - t);
			ctx.translate(x, y);
			ctx.rotate(rain.angle * Math.PI / 180);
			ctx.translate(-x, -y);
			drawScaledImage(ctx, img, x - w/2, y - h/2 + offset, w, h);
			ctx.restore();
		}
	}

	drawGrassMask() {
		const { state, assets, context2d: ctx } = this;
		const { images } = assets;
		const { grassMask } = state;
		if (!grassMask.show) return;
		const tr = this.getBackgroundTransform();
		drawScaledImage(ctx, images.maskedBackgroundWind.data[grassMask.imageIndex], ...tr);
	}

	drawSunAndLight() {
		const { assets, state, context2d: ctx } = this;
		const { sun } = state;
		const { images } = assets;

		ctx.save();

		if (sun.opacity > 0) {
			const x0 = config.width * 0.1;
			const y0 = config.height * 0.5;
			const x1 = config.width * 0.2;
			const y1 = config.height * 0.3;
			const x2 = config.width * 0.5;
			const y2 = config.height * 0.2;

			const t = sun.position;
			const x = lerp(
				lerp(x0, x2, t),
				x1,
				2.0 * t * (1 - t)
			);
			const y = lerp(
				lerp(y0, y2, t),
				y1,
				2.0 * t * (1 - t)
			);

			const img = images.sun.data;
			const w = sun.size * lerp(0.3, 1.0, t);
			const h = sun.size * lerp(0.3, 1.0, t);
			ctx.globalAlpha = sun.opacity;
			drawScaledImage(ctx, img, x - w / 2, y - h / 2, w, h);
		}

		if (sun.lightOpacity > 0) {
			const img = images.sunLight.data;
			ctx.globalCompositeOperation = sun.lightBlendMode;
			ctx.globalAlpha = sun.lightOpacity;
			const tr = this.getBackgroundTransform();
			drawScaledImage(ctx, img, ...tr);
		}

		ctx.restore();
	}

	drawAllPlants() {
		for (const plant of this.state.plants.items) {
			this.drawPlant(plant);
		}
	}

	drawPlant(plant) {
		const { assets, state, context2d: ctx } = this;
		const { plants } = state;
		const { images } = assets;
		const { position, scale, growth, skinIndex, anchor } = plant;

		const sequence = images[`plant${skinIndex}`].data;
		const n = sequence.length;
		const continuousFrameIndex = growth * plants.growth * (n - 1);
		const frameIndex = Math.min(Math.max(0, Math.floor(continuousFrameIndex)), n - 2);
		//const fract = continuousFrameIndex - frameIndex;

		const img = sequence[frameIndex];
		const w = img.width * scale;
		const h = img.height * scale;
		drawScaledImage(ctx, img, position.x - w * anchor.x, position.y - h * anchor.y, w, h);
	}

	drawPulledBetes() {
		const { assets, state, context2d: ctx } = this;
		const { images } = assets;
		const { plants, transitions } = state;
		const growthScale = 1.0 - Math.min(plants.growth / transitions.growthAfterDeflate, 1.0);

		for (const bete of state.pulledBetes.items) {
			const { position, scale, rigidbody: body } = bete;
			//const { x, y } = position;
			const { x, y } = body.position;

			// Bete
			{
				const img = images.pulledBete.data;
				const w = img.width * scale * growthScale;
				const h = img.height * scale * growthScale;
				drawScaledImage(ctx, img, x - w/2, y - h/2, w, h);
			}

			// Link
			{
				const img = images.pulledBeteLink.data;
				const dx = x - position.x;
				const dy = y - position.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const angle = Math.atan2(dy, dx);
				const cx = position.x + dx / 2;
				const cy = position.y + dy / 2;
				ctx.save();
				ctx.translate(cx, cy);
				ctx.rotate(angle + Math.PI / 2);
				ctx.scale(
					scale * growthScale * 0.65,
					2.2 * scale * growthScale / img.height * dist
				);
				ctx.drawImage(img, -img.width / 2, -img.height / 2);
				ctx.restore();
			}
		}
	}

	drawAllPappi() {
		for (const pappus of this.state.pappi.items) {
			this.drawPappus(pappus);
		}
	}

	drawPappus(pappus) {
		const { state, assets, context2d: ctx } = this;
		const { pappi } = state;
		const { position, skinIndex, anchor, angle } = pappus;
		const { x, y } = position;

		const img = assets.images.pappus.data[skinIndex];

		ctx.save();
		ctx.translate(x, y + pappi.offset);
		ctx.scale(pappi.size, pappi.size);
		ctx.rotate(angle * Math.PI / 180 * pappi.angleMultiplier);
		ctx.drawImage(img, -img.width * anchor.x, -img.height * anchor.y);
		ctx.restore();
	}

}
