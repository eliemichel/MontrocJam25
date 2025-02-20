
export function drawScaledImage(ctx, img, x, y, width, height) {
	ctx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height);
}
