/**
 * Sound. Music loops under the match, and the server's SFX cues fire one-shots.
 *
 * Web Audio rather than <audio> elements for two reasons. One-shots need to
 * overlap -- four berries banked at once is four sounds, not one restarted
 * four times -- and an element can only be playing once. And the music has to
 * loop without a seam, which a decoded buffer does and an element does not.
 *
 * Nothing here is allowed to break the game. Every entry point swallows its
 * own failures: a missing file, a browser that refuses to decode, a laptop
 * with no output device. Silence is an acceptable outcome, a thrown exception
 * during a match is not.
 */
(function() {
	"use strict";

	var STORE_KEY = "kqx-audio";

	var DEFAULTS = {
		musicVolume: 0.35,   // under the effects on purpose: it is background
		sfxVolume: 0.8,
		musicTrack: "match-1"
	};

	var settings = load();

	var ctx = null;
	var musicGain = null;
	var sfxGain = null;

	var buffers = {};     // url -> Promise<AudioBuffer>
	var tracks = [];      // from /audio/tracks.json
	var musicSource = null;
	var musicPending = false;

	// Set while Settings is previewing a match track outside a match. Any
	// real scene change clears it; closing Settings resumes the scene music.
	var previewing = false;

	// Bumped by every stop. A load that finishes against a stale epoch is a
	// track somebody has already navigated away from, and installing it would
	// leave two loops running over each other.
	var musicEpoch = 0;

	// Starts on the lobby because that is where a tab opens. Nothing is audible
	// until the first click anyway -- see unlock() -- so this only decides what
	// starts at that moment. Quick-joining a running match gets its own
	// GAME_START and moves straight to "match".
	var scene = "lobby";  // "lobby" | "match" | "victory" | null
	var lastCue = {};     // cue -> when it last played

	// Two identical cues inside this window are one event heard twice: the
	// same berry hitting the same slot on consecutive frames. Playing both
	// phases them against each other and sounds like a glitch.
	var CUE_DEBOUNCE_MS = 45;

	function load() {
		var s = {};
		for(var k in DEFAULTS) s[k] = DEFAULTS[k];
		try {
			var raw = window.localStorage.getItem(STORE_KEY);
			if(raw) {
				var got = JSON.parse(raw);
				for(var k2 in DEFAULTS) if(got[k2] !== undefined) s[k2] = got[k2];
			}
		} catch(e) {
			// private windows and blocked site data both throw on read
		}
		return s;
	}

	function save() {
		try {
			window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
		} catch(e) {}
	}

	// ---- which of the two encodings this browser wants ----

	var MIME = {
		// Opus is asked about first everywhere it is offered: it carries its
		// encoder delay as a pre-skip that the decoder removes, so a loop comes
		// back around silently. MP3 bakes that padding into the samples and
		// ticks once per lap -- but it is the format that plays everywhere.
		".ogg": 'audio/ogg; codecs="opus"',
		".mp3": "audio/mpeg",
		".m4a": "audio/mp4",
		".wav": "audio/wav"
	};
	var PREFERENCE = [".ogg", ".mp3", ".m4a", ".wav"];

	var probe = null;
	function canPlay(ext) {
		if(!probe) probe = document.createElement("audio");
		var type = MIME[ext];
		if(!type || !probe.canPlayType) return false;
		return probe.canPlayType(type) !== "";
	}

	/**
	 * @param srcs array of paths for the same track in different formats
	 * @return the one to fetch, or null if this browser can play none of them
	 */
	function pick(srcs) {
		if(!srcs || !srcs.length) return null;

		for(var i = 0; i < PREFERENCE.length; i++) {
			for(var j = 0; j < srcs.length; j++) {
				var s = srcs[j];
				if(s.slice(s.lastIndexOf(".")).toLowerCase() === PREFERENCE[i] && canPlay(PREFERENCE[i])) return s;
			}
		}

		// An unrecognised extension on somebody's own file. canPlayType is
		// advisory anyway, so it is worth a try rather than a refusal.
		return srcs[0];
	}

	// ---- context, created late ----

	/**
	 * Browsers hand back a suspended context until the page has been clicked,
	 * so this is called from the first gesture as well as from every play
	 * path. Returns null while there is still no way to make sound.
	 */
	function audio() {
		if(ctx) return ctx;

		var Ctor = window.AudioContext || window.webkitAudioContext;
		if(!Ctor) return null;

		try { ctx = new Ctor(); }
		catch(e) { return null; }

		musicGain = ctx.createGain();
		musicGain.gain.value = settings.musicVolume;
		musicGain.connect(ctx.destination);

		sfxGain = ctx.createGain();
		sfxGain.gain.value = settings.sfxVolume;
		sfxGain.connect(ctx.destination);

		return ctx;
	}

	function unlock() {
		var c = audio();
		if(!c) return;
		if(c.state === "suspended") c.resume().catch(function() {});

		// Whatever the game asked for before anyone had clicked -- but only if
		// nothing is already playing or on its way. This runs on every click, not
		// just the first, because a tab can be suspended again later; without the
		// guard, clicking anywhere in the lobby would restart the loop from zero.
		if(scene && !musicSource && !musicPending) applyScene();
	}

	// ---- loading ----

	function buffer(url) {
		if(buffers[url]) return buffers[url];

		var c = audio();
		if(!c) return Promise.reject(new Error("no audio context"));

		// Spaces and the like are legal in a drop-in filename and illegal in a
		// request line.
		buffers[url] = fetch(encodeURI(url))
			.then(function(r) {
				if(!r.ok) throw new Error(url + " " + r.status);
				return r.arrayBuffer();
			})
			.then(function(bytes) {
				// Safari's decodeAudioData only had the callback form for a
				// long time, and still resolves it, so this covers both.
				return new Promise(function(resolve, reject) {
					var p = c.decodeAudioData(bytes, resolve, reject);
					if(p && p.then) p.then(resolve, reject);
				});
			});

		// A failed fetch must not be cached as a permanently broken track:
		// dropping the file in and reopening Settings should work.
		buffers[url].catch(function() { delete buffers[url]; });

		return buffers[url];
	}

	// ---- effects ----

	function cue(name) {
		if(!name) return;

		var now = Date.now();
		if(lastCue[name] && now - lastCue[name] < CUE_DEBOUNCE_MS) return;
		lastCue[name] = now;

		var c = audio();
		if(!c || settings.sfxVolume <= 0) return;

		var url = pick(["audio/sfx/" + name + ".ogg", "audio/sfx/" + name + ".mp3"]);
		if(!url) return;

		buffer(url).then(function(buf) {
			var src = c.createBufferSource();
			src.buffer = buf;
			src.connect(sfxGain);
			src.start(0);
		}).catch(function() {
			// An effect that will not load is not worth interrupting play for.
		});
	}

	// ---- music ----

	function stopMusic() {
		// Ahead of the early return: a load in flight has to be cancelled too, or
		// it arrives after this and starts the track we just stopped.
		musicEpoch++;

		if(!musicSource) return;
		try { musicSource.stop(); } catch(e) {}
		try { musicSource.disconnect(); } catch(e) {}
		musicSource = null;
	}

	function srcsForTrack(id) {
		for(var i = 0; i < tracks.length; i++)
			if(tracks[i].id === id) return tracks[i].srcs;

		// The chosen track is gone -- a drop-in that was deleted, most likely.
		return tracks.length ? tracks[0].srcs : null;
	}

	function srcsFor(name) {
		if(name === "lobby" || name === "victory")
			return ["audio/music/" + name + ".ogg", "audio/music/" + name + ".mp3"];

		return srcsForTrack(settings.musicTrack);
	}

	function applyScene() {
		var c = audio();
		if(!c) return;

		// A scene change always wins over a preview: the match starting, the
		// win cutting the music, the lobby returning -- none of them should
		// leave the preview loop running underneath.
		previewing = false;

		stopMusic();
		// Cleared here rather than only where a load settles: the early returns
		// below would otherwise leave it stuck true and unlock() would never
		// start anything again.
		musicPending = false;

		if(!scene || settings.musicVolume <= 0) return;
		if(scene === "match" && settings.musicTrack === "off") return;

		var url = pick(srcsFor(scene));
		if(!url) return;

		startMusic(url, scene !== "victory");
	}

	/**
	 * The epoch-guarded load-and-play behind both the scene music and the
	 * Settings preview. A load that finishes against a stale epoch is a track
	 * somebody has already navigated away from, and installing it would leave
	 * two loops running over each other.
	 */
	function startMusic(url, loop) {
		var c = audio();
		if(!c) return;

		var epoch = musicEpoch;
		musicPending = true;
		buffer(url).then(function(buf) {
			if(epoch !== musicEpoch) return;   // stopped, or superseded, while loading

			var src = c.createBufferSource();
			src.buffer = buf;
			src.loop = loop;
			src.connect(musicGain);
			src.start(0);
			musicSource = src;

			// The ending theme does not loop, so without this musicSource would
			// stay pointing at a finished node and unlock() would think music was
			// still playing.
			src.onended = function() { if(musicSource === src) musicSource = null; };
		}).catch(function() {}).then(function() {
			if(epoch === musicEpoch) musicPending = false;
		});
	}

	function setScene(name) {
		if(scene === name) return;
		scene = name;
		applyScene();
	}

	/**
	 * Hear the match track from inside Settings. The picker lives in the
	 * lobby, where the lobby loop is playing, so without this a new choice
	 * changes nothing audible until the next round starts.
	 */
	function previewMatch() {
		// Resolved before anything stops: no track (or no volume, or no
		// context yet) leaves the lobby loop alone rather than silencing it
		// for a preview that will never sound.
		var url = pick(srcsForTrack(settings.musicTrack));
		if(!url) return;

		var c = audio();
		if(!c || settings.musicVolume <= 0) return;

		stopMusic();
		musicPending = false;
		previewing = true;

		startMusic(url, true);
	}

	function stopPreview() {
		if(!previewing) return;
		previewing = false;
		applyScene();
	}

	// ---- what site.js and hud.js talk to ----

	window.kqxAudio = {
		/** A sound cue from the server. */
		cue: function(name) {
			try { cue(name); } catch(e) {}
		},

		/** "lobby" | "match" | "victory" | null */
		scene: function(name) {
			try { setScene(name); } catch(e) {}
		},

		/** The match tracks the picker should offer, drop-ins included. */
		tracks: function() { return tracks.slice(0); },

		/** Back to the scene music after a Settings preview. */
		stopPreview: function() {
			try { stopPreview(); } catch(e) {}
		},

		settings: function() {
			var out = {};
			for(var k in DEFAULTS) out[k] = settings[k];
			return out;
		},

		/** Called by the settings panel; only known keys are honoured. */
		set: function(key, value) {
			if(!(key in DEFAULTS)) return;
			settings[key] = value;
			save();

			try {
				if(key === "musicVolume" && musicGain) {
					musicGain.gain.value = value;
					// Crossing zero either kills the source or needs one started.
					if((value <= 0) !== !musicSource) applyScene();
				} else if(key === "sfxVolume" && sfxGain) {
					sfxGain.gain.value = value;
			} else if(key === "musicTrack") {
				if(scene === "match") applyScene();
				else if(scene === "lobby") {
					// "None" previews as the lobby loop itself: stopping the
					// music and starting nothing would read as broken.
					if(value === "off") stopPreview();
					else previewMatch();
				}
			}
			} catch(e) {}
		}
	};

	// The list is fetched once at load and again whenever Settings is opened,
	// which is what makes a file dropped in mid-session show up.
	function refresh() {
		return fetch("audio/tracks.json")
			.then(function(r) { return r.json(); })
			.then(function(d) {
				tracks = (d && d.tracks) || [];

				// Quick-joining a match in progress can put us in "match" before
				// this list has arrived, and applyScene had nothing to pick from at
				// the time. Without this the whole round is silent.
				if(scene === "match" && !musicSource && !musicPending) applyScene();
			})
			.catch(function() {});
	}
	window.kqxAudio.refresh = refresh;

	refresh();

	// Autoplay policy: nothing sounds until the page has been interacted with.
	// The lobby is full of clicks, so this costs nobody anything.
	["pointerdown", "keydown", "touchstart"].forEach(function(ev) {
		document.addEventListener(ev, unlock, {once: false, passive: true});
	});
})();
