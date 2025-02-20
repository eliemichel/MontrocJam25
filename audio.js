import { wait } from './utils.js'

export async function fadeInMixer(mixer, musics, fadeSpeed) {
	for (const m of musics) {
		m.play();
	}
	for (let gain = mixer.gain.value ; gain <= 1.0 ; gain += fadeSpeed) {
		mixer.gain.value = Math.min(gain, 1.0);
		await wait(20);
	}
}

export async function fadeOutMixer(mixer, musics, fadeSpeed) {
	for (let gain = mixer.gain.value ; gain >= 0.0 ; gain -= fadeSpeed) {
		mixer.gain.value = Math.max(gain, 0.0);
		await wait(20);
	}
	for (const m of musics) {
		m.pause();
	}
}