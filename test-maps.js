/**
 * The maps, and the level teardown that lets one replace another.
 * Run with `node test-maps.js`.
 *
 * Swapping maps is the first thing this codebase ever asked of it: a level
 * used to be parsed once and outlive the process. So most of what is checked
 * here is that the old board is really gone.
 */
"use strict";

global.io = {emit: () => {}, sockets: {emit: () => {}}};
global.fs = require('fs');

const KQ = require('./game.js');
const {CONST, MAPS, DEFAULT_MAP, Event, Game, Goal, Updateable} = KQ;

new Game(); // singleton

let failures = 0;
function show(v) {
	if(v && v.id) return v.id;
	try { return JSON.stringify(v); } catch(e) { return String(v); }
}
function check(name, got, want) {
	const ok = show(got) === show(want);
	if(!ok) failures++;
	console.log((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : "   got " + show(got) + ", want " + show(want)));
}

const level = () => Game.instance.virtual.level;
const census = () => ({
	toons: Object.keys(level().toons).length,
	ground: level().ground.length,
	berries: level().berries.length,
	goals: level().goals.length,
	eggs: level().eggs.length,
	shrines: level().shrines.length,
	cages: level().snailCages.length,
	snail: !!level().snail
});

(async () => {

console.log("\n-- every map in the menu loads --");
{
	for(const name of Object.keys(MAPS)) {
		Game.instance.releaseLevel();
		await Game.instance.loadLevel(name);
		const c = census();
		console.log("       " + name + ": " + JSON.stringify(c));
		// Ten toons and some ground is the floor for a playable board; the rest
		// is what makes each map different and is checked per map below.
		check(name + " has both hives", c.toons, 10);
		check(name + " has ground to stand on", c.ground > 0, true);
		check(name + " has eggs for both queens", c.eggs, 6);
	}
}

console.log("\n-- the maps differ in the ways MAPS says they do --");
{
	Game.instance.releaseLevel();
	await Game.instance.loadLevel("day");
	const day = census();
	check("day has a snail", day.snail, true);
	check("day has twelve slots a side", day.goals, 24);

	Game.instance.releaseLevel();
	await Game.instance.loadLevel("bonus-military");
	const mil = census();
	check("the military bonus has no snail", mil.snail, false);
	check("and no cage to ride into", mil.cages, 0);
	check("and no berry slots, so nobody can bank", mil.goals, 0);
	check("but berries are still there to spend", mil.berries > 0, true);
	check("at gates", mil.shrines, 4);

	Game.instance.releaseLevel();
	await Game.instance.loadLevel("bonus-warriors");
	const war = census();
	check("the warrior bonus is an empty room", [war.berries, war.goals, war.shrines, war.cages], [0, 0, 0, 0]);
	check("with no snail either", war.snail, false);
}

console.log("\n-- wrap follows the map, not the engine --");
{
	// A toon at the edge, walked one step past it. The map decides whether
	// that step puts it back on the other side.
	const walkOff = async (map, axis) => {
		Game.instance.releaseLevel();
		await Game.instance.loadLevel(map);

		// Sized here rather than taken from the level: no CSS rule gives a toon
		// a width, so the parsed one is 0 and every edge test would be a
		// coin flip on rounding.
		const t = level().toons["teamBlue-worker0"];
		t.width = t.height = 20;

		if(axis == "x") { t.left = -20; t.top = 100; }
		else { t.top = level().height + 20; t.left = 100; }

		t.visibilityCheck();
		return axis == "x" ? t.left : t.top;
	};

	check("day sends you off the side and back on", await walkOff("day", "x") > 700, true);
	check("night sends you off the bottom and back on", await walkOff("night", "y"), 0);

	// The axis a map does not wrap is not a free axis: it used to do nothing
	// at all, so anything that got past the board's edge kept going. Coming
	// back to the edge is the whole point -- coming back to the far side would
	// be a wrap, which is the thing these maps are declaring they do not do.
	check("day puts you back at the bottom instead", await walkOff("day", "y"), 600 - 20);
	check("and does not wrap you to the top", await walkOff("day", "y") == 0, false);
	check("night walls you in at the sides", await walkOff("night", "x"), -20);
}

console.log("\n-- and a toon cannot leave the board on the axis that does not wrap --");
{
	// The Day board is a full-width ceiling strip ten pixels deep, and a toon
	// that gets its middle into that strip is pushed up out of it by the same
	// loop that stands it on a floor. Above the board there was nothing: the
	// queen flies and a warrior jumps again in mid-air, so both of them simply
	// climbed, and twenty seconds of ordinary play put both queens ten
	// thousand pixels up where they could not be seen, reached, or killed.
	Game.instance.releaseLevel();
	await Game.instance.loadLevel("day");
	const t = level().toons["teamBlue-queen"];
	t.width = t.height = 20;

	t.top = -10000;
	t.left = 400;
	t.visibilityCheck();
	check("a toon far above the board is brought back", t.top, -20);

	// But not so far back that it is shoved into the ceiling it is resting on:
	// a body's worth of headroom is exactly what standing on that strip needs,
	// and clamping tighter would fight groundCheck every frame.
	t.top = -15;
	t.visibilityCheck();
	check("and one resting on the ceiling is left alone", t.top, -15);
}

console.log("\n-- the warrior bonus arms everyone --");
{
	Game.instance.releaseLevel();
	await Game.instance.loadLevel("day");
	Game.instance.virtual.level.toons["teamBlue-worker0"].mReset();
	check("a worker on the day map starts unarmed", level().toons["teamBlue-worker0"].warrior, false);

	Game.instance.releaseLevel();
	await Game.instance.loadLevel("bonus-warriors");
	const w = level().toons["teamBlue-worker0"];
	w.mReset();
	check("a worker on the warrior map starts armed", w.warrior, true);
	check("and moves at warrior speed", w.speed, CONST.WARRIOR_SPEED);
	w.attacked();
	check("and is armed again after dying", w.warrior, true);
}

console.log("\n-- a snail-less map survives a loop --");
{
	Game.instance.releaseLevel();
	await Game.instance.loadLevel("bonus-military");
	Game.instance.dispatchEvent(new Event(CONST.GAME_START));

	let threw = null;
	try { Game.instance.loop(); } catch(e) { threw = e.message; }
	check("no throw with no snail on the board", threw, null);
	clearInterval(Game.instance.loopIntervalId);
}

console.log("\n-- the old board is really gone --");
{
	Game.instance.releaseLevel();
	const bare = Game.instance._listeners.length;

	await Game.instance.loadLevel("day");
	const loaded = Game.instance._listeners.length;
	check("a level registers listeners", loaded > bare, true);

	Game.instance.releaseLevel();
	check("teardown takes every one of them back off", Game.instance._listeners.length, bare);
	check("and empties the goal registry", Goal.goals.length, 0);
	check("and the update copies", Object.keys(Updateable._copies).length, 0);
	check("and the board itself", census(), {toons:0, ground:0, berries:0, goals:0, eggs:0, shrines:0, cages:0, snail:false});

	// The point of all of the above: load the same map twice and the second
	// board must be the only one running.
	await Game.instance.loadLevel("day");
	check("so a reload lands on the same listener count", Game.instance._listeners.length, loaded);

	Game.instance.releaseLevel();
	await Game.instance.loadLevel("night");
	const nightCount = Game.instance._listeners.length;
	Game.instance.releaseLevel();
	await Game.instance.loadLevel("night");
	check("and switching maps twice does not stack them", Game.instance._listeners.length, nightCount);
}

console.log("\n-- the default map is a real one --");
check("MAPS has the default", !!MAPS[DEFAULT_MAP], true);

console.log("\n" + (failures ? failures + " FAILURE(S)" : "all passed"));
process.exit(failures ? 1 : 0);

})();
