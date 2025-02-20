import { parseAllSvgShapes } from './svg.js'

export function wait(ms) {
	return new Promise(resolve => { setTimeout(resolve, ms); });
}

export function lerp(a, b, t) {
	return a * (1 - t) + b * t;
}

export function scaleVec2(v, scale) {
	return {
		x: v.x * scale,
		y: v.y * scale,
	}
}

export function dotVec2(a, b) {
	return a.x * b.x + a.y * b.y;
}

export function randomInRange(range) {
	const { min, max, gamma } = range;
	const g = gamma !== undefined ? x => Math.pow(x, gamma) : x => x
	return min + g(Math.random()) * (max - min);
}

export function randomIntInRange(range) {
	const { max } = range;
	const value = randomInRange({ ...range, max: max + 1 });
	return Math.min(Math.floor(value), max);
}

export function fetchImage(url) {
	return new Promise(resolve => {
		const img = new Image();
		img.addEventListener("load", e => resolve(img));
		img.src = url;
	});
}

export async function fetchShape(url) {
	const res = await fetch(url);
	if (!res.ok) return null;
	const svg = await res.text();
	return parseAllSvgShapes(svg);
}

export async function fetchSound(audioCtx, url) {
	const response = await fetch(url);
	const bytes = await response.arrayBuffer();
	return await audioCtx.decodeAudioData(bytes);
}
