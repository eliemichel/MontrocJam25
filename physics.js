const {
	Composite,
	Common,
	Body,
	Vector,
} = Matter;

export function shakeScene(engine) {
	const timeScale = (1000 / 60) / engine.timing.lastDelta;
	const allBodies = Composite.allBodies(engine.world);

	for (const body of allBodies) {
		if (body.isStatic) continue;
		
		// scale force for mass and time applied
		const forceMagnitude = (0.03 * body.mass) * timeScale;

		// apply the force over a single update
		Body.applyForce(body, body.position, { 
			x: (forceMagnitude + Common.random() * forceMagnitude) * Common.choose([1, -1]), 
			y: -forceMagnitude + Common.random() * -forceMagnitude
		});
	}
};

// Apply force at a given position, with a linear falloff of a given radius
export function applyLocalForce(engine, center, radius, force, offset) {
	offset = offset !== undefined ? offset : { x: 0, y: 0 };
	const timeScale = (1000 / 60) / engine.timing.lastDelta;
	const allBodies = Composite.allBodies(engine.world);
	const radiusSq = radius * radius;

	for (const body of allBodies) {
		if (body.isStatic) continue;

		// scale force for mass and time applied
		const forceMultiplier = (0.03 * body.mass) * timeScale;
		const dx = body.position.x - center.x;
		const dy = body.position.y - center.y;
		const distanceSq = dx * dx + dy * dy;

		if (distanceSq > radiusSq) continue;

		const position = Vector.add(body.position, offset);

		// apply the force over a single update
		Body.applyForce(body, position, { 
			x: force.x * forceMultiplier, 
			y: force.y * forceMultiplier
		});
	}
};

export function drawOverlay(ctx, engine) {
	const allBodies = Composite.allBodies(engine.world);

	// 1. Parts

	ctx.beginPath();

	for (const body of allBodies) {
		for (const part of body.parts) {
			const { vertices } = part;

			ctx.moveTo(vertices[0].x, vertices[0].y);

			for (var j = 1; j < vertices.length; j += 1) {
				ctx.lineTo(vertices[j].x, vertices[j].y);
			}

			ctx.lineTo(vertices[0].x, vertices[0].y);
		}
	}

	ctx.lineWidth = 2;
	ctx.strokeStyle = '#9f2';
	ctx.stroke();

	// 2. Bounds

	for (const body of allBodies) {
		const { vertices, isSleeping } = body;

		ctx.beginPath();

		ctx.moveTo(vertices[0].x, vertices[0].y);

		for (let j = 1; j < vertices.length; j += 1) {
			ctx.lineTo(vertices[j].x, vertices[j].y);
		}

		ctx.lineTo(vertices[0].x, vertices[0].y);

		if (window.test === undefined) {
			window.test = true;
		}

		const epsilon = 0.0005;
		ctx.lineWidth = 2;
		//ctx.strokeStyle = Math.abs(body.angularVelocity) < epsilon && Math.abs(body.motion) < epsilon ? '#f02' : '#f92';
		ctx.strokeStyle = isSleeping ? '#f02' : '#f92';
		ctx.stroke();
	}

	// 3. Constraints
	const allConstraints = Composite.allConstraints(engine.world);

	for (const constraint of allConstraints) {
		const { bodyA, bodyB, pointA, pointB } = constraint;

		const start = bodyA ? Vector.add(bodyA.position, pointA) : pointA;
		const end = bodyB ? Vector.add(bodyB.position, pointB) : pointB;

		if (constraint.render.type === 'pin') {
			ctx.beginPath();
			ctx.arc(start.x, start.y, 3, 0, 2 * Math.PI);
			ctx.closePath();
		} else {
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);

			if (constraint.render.type === 'spring') {
				const delta = Vector.sub(end, start);
				const normal = Vector.perp(Vector.normalise(delta));
				const coils = Math.ceil(Common.clamp(constraint.length / 5, 12, 20));
				let offset = 0;

				for (let j = 1; j < coils; j += 1) {
					offset = j % 2 === 0 ? 1 : -1;

					ctx.lineTo(
						start.x + delta.x * (j / coils) + normal.x * offset * 4,
						start.y + delta.y * (j / coils) + normal.y * offset * 4
					);
				}
			}

			ctx.lineTo(end.x, end.y);

			// Line
			ctx.lineWidth = 2;
			ctx.strokeStyle = "#fff";
			ctx.stroke();

			// Anchors
			ctx.fillStyle = "#fff";
			ctx.beginPath();
			ctx.arc(start.x, start.y, 3, 0, 2 * Math.PI);
			ctx.arc(end.x, end.y, 3, 0, 2 * Math.PI);
			ctx.closePath();
			ctx.fill();
		}
	}
}
