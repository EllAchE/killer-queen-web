/**
 * The engine's core playability: that every object parses with a body, that a
 * stylesheet edit cannot take that body away, and that a toon falls, lands,
 * bumps its head, stops at a wall, and jumps. Run with `node test-physics.js`.
 *
 * The geometry half exists because these are the checks that would have caught
 * the fall-through: every character parsed 0x0 wide, so nothing ever collided
 * and toons sank to the ceiling strip. Nothing in the game loop was wrong.
 */
"use strict";

global.io = {emit: () => {}, sockets: {emit: () => {}}};
global.fs = require('fs');

const KQ = require('./game.js');
const {CONST, MAPS, Game, Ground, Worker, Queen} = KQ;

new Game(); // singleton, sets Game.instance

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

// ---------------------------------------------------------------- geometry --

/**
 * Sizes are asserted, not merely required to be non-zero: a body that is
 * present but the wrong size still walks through walls it should not.
 */
const SIZES = {queen: [31, 37], worker: [20, 25]};

function everyObject(level) {
	return []
		.concat(Object.keys(level.toons).map(k => level.toons[k]))
		.concat(level.ground, level.berries, level.goals, level.eggs, level.shrines, level.snailCages)
		.concat(level.snail ? [level.snail] : [])
		.filter(Boolean);
}

async function geometry() {
	for(const map of Object.keys(MAPS)) {
		console.log("\n-- " + map + ": every object has a body --");
		Game.instance.releaseLevel();
		await Game.instance.loadLevel(map);
		const level = Game.instance.virtual.level;
		const all = everyObject(level);

		check("the map parsed some objects at all", all.length > 20, true);

		const flat = all.filter(o => !(o.width > 0) || !(o.height > 0))
			.map(o => o.id + " " + o.width + "x" + o.height);
		check("nothing parsed with a zero side", flat, []);

		const placed = all.filter(o => typeof o.left != "number" || typeof o.top != "number" || isNaN(o.left) || isNaN(o.top))
			.map(o => o.id);
		check("everything parsed at a real position", placed, []);

		const wrong = [];
		Object.keys(level.toons).forEach(id => {
			const t = level.toons[id];
			const want = SIZES[id.indexOf("queen") > -1 ? "queen" : "worker"];
			if(t.width != want[0] || t.height != want[1])
				wrong.push(id + " " + t.width + "x" + t.height + " want " + want.join("x"));
		});
		check("queens are 31x37 and workers 20x25", wrong, []);
	}

	console.log("\n-- a warrior kills the drone riding the snail --");
	{
		// Snail.loop tests every toon against the snail and runs the two
		// halves of the collision in order: this.collission(toon), then
		// toon.collission(this). When the first half is an enemy warrior
		// reaching the rider, it kills them and nulls the snail's toon on the
		// way past -- so the second half used to arrive at a snail with nobody
		// on it and read o.toon.id off null.
		//
		// It threw out of Snail.loop, through the LOOP dispatch, and into
		// Game.loop, where nothing catches it, so the tick died before its
		// broadcast. A warrior killing a drone off the snail is ordinary play.
		Game.instance.releaseLevel();
		await Game.instance.loadLevel("day");
		const level = Game.instance.virtual.level;
		const snail = level.snail;
		const rider = level.toons["teamBlue-worker0"];
		const killer = level.toons["teamGold-worker0"];

		[rider, killer].forEach(t => { t.mReset(); t.Invulnerable = false; t.active = true; });

		rider.left = snail.left; rider.top = snail.top;
		snail.collission(rider);
		rider.collission(snail);
		check("the drone is riding", snail.toon && snail.toon.id, rider.id);

		killer.gainWarrior();
		killer.left = snail.left + 2;
		killer.top = snail.top + 2;

		let threw = null;
		try { snail.loop(); } catch(e) { threw = e.constructor.name + ": " + e.message; }
		check("the warrior does not take the tick down with the rider", threw, null);
		check("and the snail has nobody on it", snail.toon, null);
	}

	console.log("\n-- a berry whose carrier the snail ate --");
	{
		Game.instance.releaseLevel();
		await Game.instance.loadLevel("day");
		Game.instance.dispatchEvent(new KQ.Event(CONST.GAME_START));
		clearInterval(Game.instance.loopIntervalId);
		Game.instance.loopIntervalId = null;

		const level = Game.instance.virtual.level;
		const berry = level.berries[0];
		const drone = level.toons["teamBlue-worker0"];
		drone.mReset();
		drone.Invulnerable = false;

		berry.collission(drone);
		drone.berry = berry;
		check("the drone is carrying it", berry.toon && berry.toon.id, drone.id);

		const swallow = new KQ.Event(CONST.SNAIL_ATTACK);
		swallow.extra = {toon: drone};
		Game.instance.dispatchEvent(swallow);

		// It used to be set to false here, and berryCheck skips any berry whose
		// toon `!= null` -- which false is. So the berry sat where it was
		// dropped and could never be picked up again: gone from the round, and
		// with it one of the slots an economic win has to fill.
		check("the berry is free again", berry.toon, null);
		check("and berryCheck will offer it", berry.toon != null, false);
	}

	console.log("\n-- picking berries up does not accumulate listeners --");
	{
		// The snail handler used to be registered inside collission, so every
		// pickup added another and nothing removed any. The removeEventListener
		// meant to clean up is broken, and even working it matched on type and
		// dispatcher -- which every listener on Game.instance shares -- so it
		// would have unhooked some other berry.
		Game.instance.releaseLevel();
		await Game.instance.loadLevel("day");
		const level = Game.instance.virtual.level;
		const drone = level.toons["teamBlue-worker0"];

		const before = Game.instance._listeners.length;
		for(let i = 0; i < 200; i++) {
			const b = level.berries[i % level.berries.length];
			b.toon = null;
			drone.berry = null;
			b.collission(drone);
		}
		check("200 pickups add no listeners", Game.instance._listeners.length - before, 0);
	}
}

// ------------------------------------------------------------- the matcher --

/**
 * Unit tests for the class matcher. These are the ones that fail today: the
 * old matcher looked at selectors[0] only, matched on substring, and replaced
 * the whole rule rather than merging declarations -- so the last stylesheet
 * rule that merely mentioned one of an element's classes deleted every
 * property the earlier ones had set.
 */
function matcher() {
	console.log("\n-- the stylesheet cannot delete a body --");

	const styleForClasses = KQ.styleForClasses;
	if(typeof styleForClasses != "function") {
		failures++;
		console.log("  FAIL game.js does not export styleForClasses");
		return;
	}

	// A stand-in stylesheet in the shape the css package produces.
	const rules = arr => arr.map(([selectors, json]) => ({selectors, json, declarations: []}));

	{
		// The real regression: .toon appears twice in style.css and the second
		// block has no width, so .worker's width vanished.
		const sheet = rules([
			[[".toon"], {"z-index": "5"}],
			[[".worker"], {width: "20px", height: "25px"}],
			[[".toon"], {"will-change": "transform"}]
		]);
		const got = styleForClasses(sheet, ["toon", "worker"]);
		check("a later .toon rule does not erase .worker's width", got.width, "20px");
		check("a later .toon rule does not erase .worker's height", got.height, "25px");
		check("declarations from both rules survive", got["will-change"], "transform");
	}

	{
		// Later wins property by property, which is what a cascade means.
		const sheet = rules([
			[[".worker"], {width: "20px", height: "25px"}],
			[[".worker"], {height: "40px"}]
		]);
		const got = styleForClasses(sheet, ["worker"]);
		check("a later rule overrides the property it sets", got.height, "40px");
		check("and leaves the ones it does not", got.width, "20px");
	}

	{
		// There is no document here, so a descendant selector cannot be
		// resolved -- and a rule that cannot be evaluated must not be guessed.
		const sheet = rules([
			[[".ground"], {height: "10px"}],
			[[".level-night .ground"], {background: "brown"}]
		]);
		const got = styleForClasses(sheet, ["ground"]);
		check("a descendant selector does not apply", got.background, undefined);
		check("and does not take the height with it", got.height, "10px");
	}

	{
		// Substring matching is what made ".toon" answer for ".toon-shadow"
		// and ".ground" for ".level-night .ground".
		const sheet = rules([
			[[".groundwork"], {width: "1px"}],
			[[".toon-shadow"], {width: "2px"}]
		]);
		const got = styleForClasses(sheet, ["ground", "toon"]);
		check("a class that merely contains ours does not match", got.width, undefined);
	}

	{
		// A compound needs every one of its classes present.
		const sheet = rules([[[".worker.warrior"], {width: "26px"}]]);
		check("a compound needs all its classes", styleForClasses(sheet, ["worker"]).width, undefined);
		check("and applies when they are all there", styleForClasses(sheet, ["worker", "warrior"]).width, "26px");
	}

	{
		// Any selector in the list counts, not just the first: style.css groups
		// its team colours that way.
		const sheet = rules([[[".teamBlue", ".teamGold"], {color: "x"}]]);
		check("a later selector in the list still matches", styleForClasses(sheet, ["teamGold"]).color, "x");
	}

	{
		// The result must be the element's own object. The old code merged into
		// rule.json, so one element's inline styles leaked into the next.
		const sheet = rules([[[".worker"], {width: "20px"}]]);
		const a = styleForClasses(sheet, ["worker"]);
		a.width = "999px";
		check("the caller cannot corrupt the stylesheet", styleForClasses(sheet, ["worker"]).width, "20px");
	}
}

// -------------------------------------------------------------- the engine --

// A bare board: one platform, nothing else, so a failure is about the physics
// and not about whatever else happened to be on a real map.
function board(ground) {
	Game.instance.virtual.level = Game.emptyLevel();
	Game.instance.virtual.level.ground = ground.map(g => {
		const gr = new Ground(g.id);
		gr.left = g.left; gr.top = g.top; gr.width = g.width; gr.height = g.height;
		return gr;
	});
}

function plat(id, left, top, width, height) { return {id, left, top, width, height}; }

// loop() is gated on active, which GAME_START sets; a toon built by hand is
// inert until it is told the round has begun.
function toon(left, top) {
	const t = new Worker("teamBlue-worker0");
	t.active = true;
	t.left = left; t.top = top;
	t.width = 20; t.height = 25;
	t.accel = 0;
	return t;
}

function run(t, ticks) { for(let i = 0; i < ticks; i++) t.loop(); return t; }

function engine() {
	console.log("\n-- gravity pulls down --");
	{
		board([]);
		const t = toon(100, 0);
		// roundNumbers() rounds top every tick, so the first few sub-pixel
		// steps are thrown away and free fall only starts once accel passes
		// half a pixel. Measure the direction over a span, not on one frame.
		const seen = [];
		for(let i = 0; i < 40; i++) { t.loop(); seen.push(t.top); }
		check("it ends up below where it started", t.top > 0, true);
		check("and never moved up on the way", seen.every((y, i) => i === 0 || y >= seen[i - 1]), true);
		check("acceleration clamps at gravity_max", t.accel, CONST.GRAVITY_MAX);
		check("terminal velocity is one gravity_max per tick", t.top - seen[seen.length - 2], CONST.GRAVITY_MAX);
	}

	console.log("\n-- a toon lands on a platform --");
	{
		// The exact reproduction from the bug report: a worker dropped 80px
		// above a platform on the day map's ground-1-1.
		board([plat("ground-1-1", 581, 50, 51, 10)]);
		const t = toon(590, 50 - 25 - 80);
		let lowest = t.top;
		for(let i = 0; i < 300; i++) { t.loop(); lowest = Math.max(lowest, t.top); }
		check("it comes to rest with its feet on the platform", Math.round(t.top + t.height), 50);
		check("it never passed through", Math.round(lowest + t.height) <= 51, true);
		check("and it knows it is grounded", t.grounded, true);
	}

	console.log("\n-- and does not tunnel at terminal velocity --");
	{
		// A platform only as thick as one frame of travel is the case a
		// position-only collision check gets wrong.
		board([plat("thin", 0, 400, 200, 4)]);
		const t = toon(50, 0);
		t.accel = CONST.GRAVITY_MAX;
		run(t, 400);
		check("a 4px platform still stops it", Math.round(t.top + t.height), 400);
	}

	console.log("\n-- a ceiling stops a rise --");
	{
		board([plat("floor", 0, 300, 400, 10), plat("roof", 0, 200, 400, 10)]);
		const t = toon(50, 300 - 25);
		run(t, 5);
		t.jump();
		t.accel = -20;           // hard enough to reach the roof in one frame
		run(t, 40);
		check("it is under the roof, not through it", t.top >= 210, true);
		check("and it falls back to the floor", Math.round(t.top + t.height), 300);
	}

	console.log("\n-- a wall stops a walk --");
	{
		board([plat("floor", 0, 300, 400, 10), plat("wall", 200, 200, 10, 110)]);
		const t = toon(100, 300 - 25);
		for(let i = 0; i < 200; i++) { t.left += 2; t.loop(); }
		check("it stops beside the wall", Math.round(t.left + t.width) <= 201, true);
		check("and did not climb it", Math.round(t.top + t.height), 300);
	}
	{
		board([plat("floor", 0, 300, 400, 10), plat("wall", 100, 200, 10, 110)]);
		const t = toon(200, 300 - 25);
		for(let i = 0; i < 200; i++) { t.left -= 2; t.loop(); }
		check("a wall on the left stops it too", Math.round(t.left) >= 109, true);
	}

	console.log("\n-- jumping --");
	{
		board([plat("floor", 0, 300, 400, 10)]);
		const t = toon(50, 300 - 25);
		run(t, 5);
		check("it starts grounded", t.grounded, true);
		const resting = t.top;
		t.jump();
		t.loop();
		check("the jump lifts it", t.top < resting, true);
		let peak = t.top;
		for(let i = 0; i < 60; i++) { t.loop(); peak = Math.min(peak, t.top); }
		check("it rose meaningfully", resting - peak > 10, true);
		check("and came back down to the floor", Math.round(t.top + t.height), 300);
		check("grounded again", t.grounded, true);
	}

	console.log("\n-- a queen has the same physics --");
	{
		board([plat("floor", 0, 300, 400, 10)]);
		const q = new Queen("teamBlue-queen");
		q.active = true;
		q.left = 50; q.top = 100; q.width = 31; q.height = 37;
		q.accel = 0;
		run(q, 200);
		check("she lands on the floor", Math.round(q.top + q.height), 300);
	}
}

console.log("\n-- listeners can be taken back off --");
{
	// The old removeEventListener matched a dispatched Event's type and
	// currentTarget, which cannot single anything out: every listener is
	// registered with `currentTarget: this`, so that pair describes all of
	// them. And a missing pair of braces put its `return true` outside the
	// `if`, so it returned on the first iteration whether or not that entry
	// matched -- reporting success having removed nothing.
	const d = new KQ.EventDispatcher();
	const a = () => {}, b = () => {}, c = () => {};
	d.addEventListener("tick", a);
	d.addEventListener("tick", b);
	d.addEventListener("other", c);

	check("it removes the one it was given", d.removeEventListener("tick", b), true);
	check("and only that one", d._listeners.length, 2);
	check("the right one is gone", d._listeners.map(l => l.callback).indexOf(b), -1);
	check("its sibling of the same type stays", d._listeners.map(l => l.callback).indexOf(a) >= 0, true);

	check("removing it twice reports nothing to remove", d.removeEventListener("tick", b), false);
	check("a callback never registered", d.removeEventListener("tick", () => {}), false);
	check("the right callback under the wrong type", d.removeEventListener("other", a), false);
	check("nothing was removed by the misses", d._listeners.length, 2);

	// The leak this exists to close: one listener per socket, for the life of
	// the process, because nothing held a reference to take back off.
	const conn = [];
	for(let i = 0; i < 50; i++) { const f = () => {}; conn.push(f); d.addEventListener("game_reset", f); }
	check("50 connections add 50", d._listeners.length, 52);
	conn.forEach(f => d.removeEventListener("game_reset", f));
	check("and 50 disconnects take them away", d._listeners.length, 2);
}

(async () => {
	matcher();
	engine();
	await geometry();
	console.log("\n" + (failures ? failures + " FAILURE(S)" : "all passed"));
	process.exit(failures ? 1 : 0);
})();
