/**
 * The sound cues. Run with `node test-audio.js`.
 *
 * There are two failures worth catching here and they are different in kind.
 *
 * The first is a cue that never fires -- a berry banks and the room hears
 * nothing -- so the triggers are driven through the real objects rather than
 * asserted about the source.
 *
 * The second is quieter and more likely: a cue that fires under a name no file
 * answers to. Nothing throws, nothing logs, the sound is simply missing, and
 * you would only find it by playing a full match and noticing an absence. So
 * every cue name in game.js is checked against the files on disk, in both
 * formats, whether or not this test managed to trigger it.
 */
"use strict";

// Captured rather than discarded: these emissions are the thing under test.
var emitted = [];
global.io = {
	emit: () => {},
	sockets: {emit: (name, data) => emitted.push({name: name, data: data})}
};
global.fs = require("fs");

const fs = require("fs");
const path = require("path");
const KQ = require("./game.js");
const {CONST, Game, Egg, Berry, Goal, Queen, Worker, ShrineWarrior, ShrineSpeed, Event} = KQ;

new Game(); // singleton

var failed = 0;
function check(label, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if(!ok) failed++;
	console.log("  " + (ok ? "ok  " : "FAIL") + " " + label +
		(ok ? "" : "   got " + JSON.stringify(got) + ", want " + JSON.stringify(want)));
}

/** Runs fn and returns the cue names it caused, in order. */
function cues(fn) {
	emitted = [];
	try { fn(); } catch(e) { console.log("       (threw: " + e.message + ")"); }
	return emitted.filter(e => e.name === CONST.SFX).map(e => e.data.cue);
}

function first(list, Type) {
	for(const o of list) if(o instanceof Type) return o;
	return null;
}

(async function() {

	// ------------------------------------------------------ names and files --

	console.log("-- every cue has a file to play --");

	// Read out of the source so a cue added later is covered without anyone
	// remembering to come back here. The win cues are built from the type
	// string at runtime, so they are derived the same way game.js derives them.
	const src = fs.readFileSync(__dirname + "/game.js", "utf8");
	// Every string inside an sfx(...) call, not just sfx("literal"): two of the
	// call sites choose between two names with a ternary, and those are exactly
	// the pairs most likely to drift apart from the files.
	const literals = [];
	(src.match(/\bsfx\([^)]*\)/g) || []).forEach(call => {
		(call.match(/"([a-z][a-z-]*)"/g) || []).forEach(q => literals.push(q.slice(1, -1)));
	});
	const wins = [CONST.WIN_MILITARY, CONST.WIN_ECONOMIC, CONST.WIN_SNAIL]
		.map(t => t.replace(/_/g, "-"));

	const names = Array.from(new Set(literals.concat(wins))).sort();
	check("found the cue names in game.js", names.length > 8, true);

	const missing = [];
	names.forEach(n => {
		[".ogg", ".mp3"].forEach(ext => {
			const f = path.join(__dirname, "audio", "sfx", n + ext);
			if(!fs.existsSync(f)) missing.push("audio/sfx/" + n + ext);
		});
	});
	check("no cue names a file that is not there", missing, []);

	// The music the client asks for by name rather than off the track list.
	const fixedMusic = [];
	["lobby", "victory"].forEach(n => {
		[".ogg", ".mp3"].forEach(ext => {
			const f = path.join(__dirname, "audio", "music", n + ext);
			if(!fs.existsSync(f)) fixedMusic.push("audio/music/" + n + ext);
		});
	});
	check("the lobby and ending themes are both there", fixedMusic, []);

	// ------------------------------------------------------------ triggers --

	await Game.instance.loadLevel(KQ.DEFAULT_MAP);
	const level = Game.instance.virtual.level;

	console.log("\n-- the three wins, which is what the brief asked for --");
	// A focus object is all win() reads off its third argument.
	const focus = {id: "test", top: 10, left: 10};
	check("military", cues(() => Game.instance.win(CONST.WIN_MILITARY, "teamBlue", focus)), ["win-military"]);
	check("economic", cues(() => Game.instance.win(CONST.WIN_ECONOMIC, "teamBlue", focus)), ["win-economic"]);
	check("snail",    cues(() => Game.instance.win(CONST.WIN_SNAIL,    "teamGold", focus)), ["win-snail"]);

	console.log("\n-- berries --");
	{
		const goal = level.goals.find(g => !g.berry);
		const berry = level.berries[0];
		check("banking one in an empty slot sounds",
			cues(() => goal.collission(berry)).indexOf("berry-deposit") > -1, true);

		// Through the event, not through berryCheck: the listener is where the
		// pickup actually takes effect, and where a second overlapping berry
		// gets rejected as a dupe instead of blipping twice.
		const worker = Object.keys(level.toons).map(k => level.toons[k]).find(t => t instanceof Worker);
		worker.berry = null;
		const pickup = () => {
			const e = new Event(CONST.BERRY_PICKUP);
			e.extra = {toon: worker, berry: level.berries[1]};
			worker.dispatchEvent(e);
		};
		check("picking one up sounds", cues(pickup), ["berry-pickup"]);
		check("and the second berry in the same frame does not", cues(pickup), []);
	}

	console.log("\n-- eggs and deaths --");
	{
		const egg = level.eggs.find(e => !e.hatched);
		check("an egg hatching sounds", cues(() => egg.hatch()), ["egg-hatch"]);

		const toons = Object.keys(level.toons).map(k => level.toons[k]);
		const queen = first(toons, Queen);
		const worker = toons.find(t => t instanceof Worker);

		// A toon is only made active and vulnerable by mReset, which runs when
		// a round starts. Both are set by hand here because this is testing the
		// sound, not the guard in front of it.
		worker.active = true; worker.Invulnerable = false; worker.berry = null;
		check("a worker dying sounds", cues(() => worker.attacked()), ["toon-death"]);

		queen.active = true; queen.Invulnerable = false;
		// Two sounds, and both belong: her death spends one of her three eggs,
		// and the egg hatching is the other hive's cue that she is not out yet.
		check("the queen has her own, and it costs her an egg",
			cues(() => queen.attacked()), ["queen-death", "egg-hatch"]);
	}

	console.log("\n-- gates tell you which one it was --");
	{
		const warriorGate = first(level.shrines, ShrineWarrior);
		const speedGate = level.shrines.find(s => s instanceof ShrineSpeed && !(s instanceof ShrineWarrior));
		const toons = Object.keys(level.toons).map(k => level.toons[k]);

		function useGate(gate) {
			const w = toons.find(t => t instanceof Worker);
			w.warrior = false;
			w.berry = level.berries[2];
			gate.inUse = false;
			gate.affiliation = null;
			// Standing in the middle is what the shrine checks for.
			w.left = gate.left + gate.width * 0.5;
			return cues(() => gate.collission(w));
		}

		if(warriorGate) check("warrior gate", useGate(warriorGate), ["warrior-gate"]);
		if(speedGate)   check("speed gate",   useGate(speedGate),   ["speed-gate"]);
		check("the board had both kinds of gate to test", !!(warriorGate && speedGate), true);
	}

	console.log("\n-- the snail --");
	if(level.snail) {
		const snail = level.snail;
		const toons = Object.keys(level.toons).map(k => level.toons[k]);
		const rider = toons.find(t => t instanceof Worker);
		rider.warrior = false;

		snail.active = true;
		snail.toon = null;
		check("mounting sounds", cues(() => snail.collission(rider)), ["snail-ride"]);
		// Still mounted, so this is a second frame of the same ride.
		check("and riding on does not repeat it", cues(() => snail.collission(rider)), []);
	} else {
		check("the default board has a snail", false, true);
	}

	console.log("\n-- nothing sounds without a socket --");
	{
		const real = global.io;
		global.io = null;   // the physics tests run this way
		// game.js captured io at require time, so this only proves the guard
		// reads a live value if it does; either way it must not throw.
		let threw = false;
		try { Game.instance.sfx("berry-pickup"); } catch(e) { threw = true; }
		global.io = real;
		check("a cue with no io does not throw", threw, false);
	}

})().catch(e => {
	failed++;
	console.log("  FAIL harness   " + e.stack);
}).then(() => {
	console.log(failed ? "\n" + failed + " failed" : "\nall passed");
	process.exit(failed ? 1 : 0);
});
