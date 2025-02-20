if not exist lowres (
	mkdir lowres
)

for %%f in (*.png) do (
	magick convert %%f -resize 50%%  lowres/%%f
)
