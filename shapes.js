import { lerp } from './utils.js'

export function samplePath(path, t) {
	const m = path.points.length;
	const continuousPointIndex = t * (m - 1);
	const pointIndex = Math.min(Math.max(0, Math.floor(continuousPointIndex)), m - 2);
	const pointFract = continuousPointIndex - pointIndex;
	const [ x0, y0 ] = path.points[pointIndex]
	const [ x1, y1 ] = path.points[pointIndex+1]
	const x = lerp(x0, x1, pointFract);
	const y = lerp(y0, y1, pointFract);
	return [ x, y ];
}

export function drawShapePath(ctx, path) {
	ctx.beginPath();
	let isFirst = true;
	for (const [ x, y ] of path.points) {
		const lineOrMoveTo = isFirst ? 'moveTo' : 'lineTo';
		ctx[lineOrMoveTo](x, y);
		isFirst = false;
	}
	if (path.isClosed && path.points.length > 0) {
		const [ x, y ] = path.points[0];
		ctx.lineTo(x, y);
	}
	ctx.stroke();
}

export function drawShape(ctx, shape) {
	for (const [ id, path ] of Object.entries(shape)) {
		drawShapePath(ctx, path);
	}
}
