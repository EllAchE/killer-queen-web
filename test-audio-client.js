/**
 * The browser side: audio.js. Run with `node test-audio-client.js`.
 *
 * Sound is the one feature nobody notices is broken from a code review -- it
 * either happens in a room or it does not -- so the parts with actual state in
 * them are driven here against a stub DOM and a stub Web Audio context.
 *
 * Two of these checks exist because the bug was real. Clicking anywhere in the
 * lobby used to restart the loop from the top, because the autoplay-unlock
 * handler runs on every click and not just the first. And quick-joining a match
 * before /audio/tracks.json came back left the entire round silent, because the
 * picker had nothing in it at the moment the music was asked for.
 */
"use strict";

var failed = 0;
function check(label, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if(!ok) failed++;
	console.log("  " + (ok ? "ok  " : "FAIL") + " " + label +
		(ok ? "" : "   got " + JSON.stringify(got) + ", want " + JSON.stringify(want)));
}

// ---------------------------------------------------------------- the stubs --

var fetched = [];            // every URL audio.js asked for
var trackList = {tracks: []};  // what /audio/tracks.json answers with
var canPlay = {".ogg": true, ".mp3": true};
var nodes = [];              // every buffer source ever started
var gestures = [];           // handlers audio.js registered for the unlock

global.fetch = function(url) {
	fetched.push(url);
	if(url.indexOf("tracks.json") > -1)
		return Promise.resolve({ok: true, json: () => Promise.resolve(trackList)});

	return Promise.resolve({ok: true, arrayBuffer: () => Promise.resolve({url: url})});
};

var gainKinds = ["music", "sfx"];
var ctx = {
	state: "running",
	destination: {},
	resume: () => Promise.resolve(),
	createGain: function() {
		return {kind: gainKinds.shift(), gain: {value: 0}, connect: function() {}};
	},
	createBufferSource: function() {
		var node = {
			buffer: null, loop: false, onended: null, started: false, stopped: false,
			connect: function(dest) { node.dest = dest; },
			disconnect: function() {},
			start: function() { node.started = true; nodes.push(node); },
			stop: function() { node.stopped = true; }
		};
		return node;
	},
	decodeAudioData: function(bytes, ok) { ok({url: bytes.url}); }
};

var store = {};
global.window = {
	AudioContext: function() { return ctx; },   // one shared context
	localStorage: {
		getItem: k => (k in store ? store[k] : null),
		setItem: (k, v) => { store[k] = v; }
	}
};
global.document = {
	createElement: () => ({canPlayType: t => (canPlay[t.indexOf("ogg") > -1 ? ".ogg" : ".mp3"] ? "probably" : "")}),
	addEventListener: (ev, fn) => gestures.push(fn)
};

require("./audio.js");
const A = global.window.kqxAudio;

/** Lets every pending promise chain finish. */
function settle() {
	return new Promise(r => setImmediate(() => setImmediate(() => setImmediate(r))));
}
function click() { gestures.forEach(fn => fn()); }

/** The music node currently sounding, by the file it holds. */
function music() {
	const live = nodes.filter(n => n.dest && n.dest.kind === "music" && !n.stopped);
	return live.length ? live[live.length - 1].buffer.url : null;
}
function musicNodes() { return nodes.filter(n => n.dest && n.dest.kind === "music"); }
function sfxNodes() { return nodes.filter(n => n.dest && n.dest.kind === "sfx"); }

const FULL_LIST = {tracks: [
	{id: "match-1", label: "Chiptune — Level 1", srcs: ["audio/music/match-1.mp3", "audio/music/match-1.ogg"]},
	{id: "match-3", label: "Chiptune — Level 3", srcs: ["audio/music/match-3.mp3", "audio/music/match-3.ogg"]},
	{id: "custom/Never Gonna Give You Up", label: "Never Gonna Give You Up",
		srcs: ["audio/music/custom/Never Gonna Give You Up.mp3"]}
]};

(async function() {
	await settle();

	console.log("-- nothing sounds before somebody clicks --");
	check("no music yet", music(), null);
	check("and nothing was fetched but the track list",
		fetched.filter(u => u.indexOf("tracks.json") < 0), []);

	console.log("\n-- the first click starts the lobby --");
	click();
	await settle();
	check("the lobby loop is playing", music(), "audio/music/lobby.ogg");
	check("and it loops", musicNodes()[0].loop, true);

	console.log("\n-- clicking again does not start it over --");
	// The bug this replaces: unlock() runs on every gesture, so a second click
	// used to stop the loop and begin it again from zero.
	const before = musicNodes().length;
	click(); click();
	await settle();
	check("still the one music node", musicNodes().length, before);
	check("still playing", music(), "audio/music/lobby.ogg");

	console.log("\n-- a match that starts before the track list arrives --");
	// trackList is still empty here, which is the race: GAME_START can beat
	// the fetch, and there is nothing to pick.
	A.scene("match");
	await settle();
	check("the lobby music stopped", musicNodes()[0].stopped, true);
	check("and nothing replaced it yet", music(), null);

	trackList = FULL_LIST;
	await A.refresh();
	await settle();
	check("the list arriving starts the match music", music(), "audio/music/match-1.ogg");

	console.log("\n-- and it does not start twice once it has --");
	const n = musicNodes().length;
	await A.refresh();
	await settle();
	check("a second refresh changes nothing", musicNodes().length, n);

	console.log("\n-- picking a different track --");
	A.set("musicTrack", "custom/Never Gonna Give You Up");
	await settle();
	// The drop-in has a space in its name and exists only as an mp3. The space
	// has to be encoded on the way out or the request line is malformed, which
	// is why what plays is the encoded URL.
	check("the drop-in plays, with its space encoded",
		music(), "audio/music/custom/Never%20Gonna%20Give%20You%20Up.mp3");

	A.set("musicTrack", "off");
	await settle();
	check("None means silence during the match", music(), null);

	A.set("musicTrack", "match-3");
	await settle();
	check("and picking a track again brings it back", music(), "audio/music/match-3.ogg");

	console.log("\n-- volume --");
	A.set("musicVolume", 0);
	await settle();
	check("zero stops the music rather than playing it silently", music(), null);
	A.set("musicVolume", 0.5);
	await settle();
	check("and turning it back up restarts it", music(), "audio/music/match-3.ogg");
	check("the saved settings came back", A.settings().musicVolume, 0.5);
	check("and were written to localStorage", JSON.parse(store["kqx-audio"]).musicVolume, 0.5);

	console.log("\n-- the win, and the ending theme --");
	A.scene(null);
	A.cue("win-military");
	await settle();
	check("the match music is cut at the win", music(), null);
	check("and the jingle plays into the gap",
		sfxNodes().map(x => x.buffer.url), ["audio/sfx/win-military.ogg"]);

	A.scene("victory");
	await settle();
	check("the ending theme comes up", music(), "audio/music/victory.ogg");
	check("and does not loop", musicNodes()[musicNodes().length - 1].loop, false);

	console.log("\n-- effects --");
	{
		const was = sfxNodes().length;
		A.cue("berry-deposit");
		A.cue("berry-deposit");   // same frame -- one event heard twice
		await settle();
		check("a repeated cue only sounds once", sfxNodes().length - was, 1);

		A.cue("berry-pickup");
		await settle();
		check("but a different cue still sounds", sfxNodes().length - was, 2);

		A.set("sfxVolume", 0);
		A.cue("egg-hatch");
		await settle();
		check("and none of them at zero", sfxNodes().length - was, 2);
		A.set("sfxVolume", 0.8);
	}

	console.log("\n-- the codec choice --");
	{
		// Safari only learned Ogg Opus in 18.4; before that this has to fall
		// through to the mp3 or the whole feature is silent on those laptops.
		canPlay[".ogg"] = false;
		A.scene(null);
		A.scene("match");
		await settle();
		check("no Opus support falls back to the mp3", music(), "audio/music/match-3.mp3");

		canPlay[".ogg"] = true;
		A.scene(null);
		A.scene("match");
		await settle();
		check("and with it we take the Opus", music(), "audio/music/match-3.ogg");
	}
})().catch(e => {
	failed++;
	console.log("  FAIL harness   " + e.stack);
}).then(() => {
	console.log(failed ? "\n" + failed + " failed" : "\nall passed");
	process.exit(failed ? 1 : 0);
});
