
// Should be called "wanderingBete" or sth
export function createBeteSprite(x, y, scale) {
	return {
		position: { x, y },
		anchor: {
			x: 0.5,
			y: 0.85,
		},
		imageName: 'bete',
		frame: 0,
		anim: {
			fps: 12,
		},
		flipX: false,
		scale,
		rigidbody: null, // optional
		rigidbodyAnchor: {
			x: 0.0,
			y: 0.0,
		},
	}
}

export function drawSprite(ctx, images, sprite) {
	const { imageName, frame, position, anchor, scale } = sprite;
	const { x, y } = position;

	const imageData = images[imageName].data[frame];
	ctx.save();

	// flip
	ctx.translate(x, y);
	const scaleX = sprite.flipX ? -scale : scale;
	ctx.scale(scaleX, scale);
	ctx.translate(-x, -y);

	ctx.drawImage(
		imageData,
		x - imageData.width * anchor.x,
		y - imageData.height * anchor.y,
	);
	ctx.restore();

	const debugAnchors = false;
	if (debugAnchors) {
		ctx.fillStyle = "rgb(34, 177, 76)"; // dark green
		ctx.fillRect(x-5, y-5, 10, 10);
	}
}
