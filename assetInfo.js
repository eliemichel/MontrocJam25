// ----------------------------------------------------
// ASSET DECLARATION

// This is sort of an equivalent of the .meta files that Unity creates to tell
// how to interpret the raw resource files.

export default {
	images: {
		backgroundWind: {
			type: 'sequence',
			start: 1,
			end: 8,
			url: "images/BG/BG-#.jpg",
		},

		sun: {
			url: "images/Soleil/Soleil.png",
		},

		sunLight: {
			url: "images/Soleil/Lumiere.png",
		},

		grassMask: {
			url: "images/Herbe_masque.png"
		},

		cloud: {
			type: 'sequence',
			start: 1,
			end: 4,
			url: "images/Pluie/Nuage_#_V2.png",
		},

		rainDrop: {
			type: 'sequence',
			start: 1,
			end: 3,
			url: "images/Pluie/Goutte-#-blanc.png",
		},

		plant0: {
			type: 'sequence',
			start: 1,
			end: 31,
			url: "images/Chardon1/Chardon1-#.png",
		},

		plant1: {
			type: 'sequence',
			start: 1,
			end: 33,
			url: "images/Chardon2/Chardon2-#.png",
		},

		pappus: {
			type: 'sequence',
			start: 1,
			end: 2,
			url: "images/Pappus_#.png"
		},

		brush01: {
			url: "images/brushes/brush01.png",
		},

		bete: {
			type: 'sequence',
			start: 1,
			end: 16,
			url: "images/ANIM_0008/ANIM_0008-#.png",
		},

		pulledBete: {
			url: "images/pulledBete.png"
		},

		pulledBeteLink: {
			url: "images/pulledBeteLink.png"
		},
	},

	shapes: {
		terrain: {
			url: "shapes/terrain-physics.svg"
		},
		cloud: {
			url: "shapes/cloud-path.svg"
		},
		plant0: {
			url: "shapes/Chardon1.svg",
		},
		plant1: {
			url: "shapes/Chardon2.svg",
		},
		pappus: {
			url: "shapes/Pappus.svg",
		},
	},

	// audio mixers
	mixers: {
		master: {
			defaultGain: 0.0,
		},
		sounds: {
			defaultGain: 0.5,
			target: "master",
		},
		wind: {
			defaultGain: 0.37,
			target: "master",
		},
		rain: {
			defaultGain: 0.5,
			target: "master",
		},
		music: {
			defaultGain: 0.1,
			target: "master",
		},
		tempest: {
			defaultGain: 0.3,
			target: "master",
		},
		introMusic: {
			defaultGain: 1.0,
			target: "music",
			hidden: true,
		},
		rainTrack: {
			defaultGain: 0.0,
			target: "rain",
			hidden: true,
		},
		tempestTrack: {
			defaultGain: 0.0,
			target: "tempest",
			hidden: true,
		},
	},

	sounds: {
		wind01: {
			url: "sound/Bourrasques/light gust-3.mp3",
		},

		squeak0: {
			url: "sound/Grincements/squeak-1.mp3",
		},
		squeak1: {
			url: "sound/Grincements/squeak-3.mp3",
		},
		squeak2: {
			url: "sound/Grincements/squeak-2.mp3",
		},
		squeak3: {
			url: "sound/Grincements/squeak-4.mp3",
		},
	},

	musics: {
		intro: {
			url: "sound/Wind-chimes-olympos.mp3",
			loop: true,
			mixer: "introMusic",
		},
		rain: {
			url: "sound/Pluie/rain.mp3",
			loop: true,
			mixer: "rainTrack",
		},
		tempest: {
			url: "sound/tornado-sound-better-quality.mp3",
			loop: true,
			mixer: "tempestTrack",
		},
	},
}
