
function parseSvgPath(d) {
	let command = '';
	const points = [];
	for (const token of d.split(' ')) {
		if (token.length == 1) {
			command = token;
			continue;
		}
		const prevPoint = points.length > 0 ? points[points.length - 1] : [0,0];
		switch (command) {
		case 'M': {
			const subtokens = token.split(',');
			if (subtokens.length != 2) {
				throw Error(`Invalid token after 'M' in SVG path: '${token}'`);
			}
			const [ x, y ] = subtokens.map(parseFloat);
			points.push([ x, y ]);
			break;
		}
		case 'm': {
			const subtokens = token.split(',');
			if (subtokens.length != 2) {
				throw Error(`Invalid token after 'm' in SVG path: '${token}'`);
			}
			const [ x, y ] = subtokens.map(parseFloat);
			const [ px, py ] = prevPoint;
			points.push([ px + x, py + y ]);
			break;
		}
		case 'L': {
			const subtokens = token.split(',');
			if (subtokens.length != 2) {
				throw Error(`Invalid token after 'M' in SVG path: '${token}'`);
			}
			const [ x, y ] = subtokens.map(parseFloat);
			points.push([ x, y ]);
			break;
		}
		case 'l': {
			const subtokens = token.split(',');
			if (subtokens.length != 2) {
				throw Error(`Invalid token after 'm' in SVG path: '${token}'`);
			}
			const [ x, y ] = subtokens.map(parseFloat);
			const [ px, py ] = prevPoint;
			points.push([ px + x, py + y ]);
			break;
		}
		case 'V': {
			const x = prevPoint[0];
			const y = parseFloat(token);
			points.push([ x, y ]);
			break;
		}
		case 'v': {
			const x = prevPoint[0];
			const y = parseFloat(token);
			points.push([ x, prevPoint[1] + y ]);
			break;
		}
		case 'H': {
			const x = parseFloat(token);
			const y = prevPoint[1];
			points.push([ x, y ]);
			break;
		}
		case 'h': {
			const x = parseFloat(token);
			const y = prevPoint[1];
			points.push([ prevPoint[0] + x, y ]);
			break;
		}
		default:
			throw Error(`Unknown SVG path command: '${command}'`);
		}
	}
	const isClosed = command === 'Z' || command === 'z';
	return {
		points,
		isClosed,
	};
}

function applyCTM(matrix, pt) {
	const [ x, y ] = pt;
	if (matrix instanceof SVGMatrix) {
		const { a, b, c, d, e, f } = matrix;
		return [
			a * x + c * y + e,
			b * x + d * y + f,
		];
	} else {	
		const transformed = matrix.transformPoint({ x, y, z: 0, w: 1 })
		return [ transformed.x, transformed.y ];
	}
}

// Extract shapes from an SVG file
export function parseAllSvgShapes(svgSrc) {
	// Create a mock element to parse XML
	const el = document.createElement('div');
	el.innerHTML = svgSrc;
	// Bug in Firefox: getCTM returns null unless the SVG has been rendered once
	// See https://bugzilla.mozilla.org/show_bug.cgi?id=756985
	el.style.visibility = "hidden";
	el.style.overflow = "hidden";
	el.style.width = "1px";
	document.body.appendChild(el);

	const allPaths = {};
	for (const tag of el.querySelectorAll("path")) {
		const d = tag.getAttribute("d");
		const id = tag.getAttribute("id");
		const path = parseSvgPath(d);

		// Apply transform matrix
		const matrix = tag.getCTM();
		const points = path.points.map(pt => applyCTM(matrix, pt));

		allPaths[id] = { ...path, points };
	}

	const allCircles = {};
	for (const tag of el.querySelectorAll("circle,ellipse")) {
		const id = tag.getAttribute("id");
		const matrix = tag.getCTM();
		const [ cx, cy ] = applyCTM(matrix, [
			tag.getAttribute("cx"),
			tag.getAttribute("cy"),
		]);
		// TODO: Transform radii
		allCircles[id] = {
			cx,
			cy,
			rx: tag.getAttribute("rx"),
			ry: tag.getAttribute("ry"),
			r: tag.getAttribute("r"),
		}
	}

	return {
		...allPaths,
		...allCircles,
	}
}
