/**
 * Rules the arcade game has that this clone was missing. Run with `node test-fidelity.js`.
 *
 * game.js is pure logic, so each case builds the two or three objects the rule
 * involves and calls the collision directly rather than standing up a level.
 */
"use strict";

global.io = {emit: () => {}, sockets: {emit: () => {}}};
global.fs = require('fs');

const KQ = require('./game.js');
const {CONST, Event, Game, Snail, SnailCage, Worker, Queen, ShrineWarrior, ShrineSpeed} = KQ;

new Game(); // singleton, sets Game.instance

let failures = 0;
// Game objects hold listeners that point back at them, so a failing check must
// never serialize one: it would throw on the cycle instead of reporting.
function show(v) {
	if(v && v.id) return v.id;
	try { return JSON.stringify(v); } catch(e) { return String(v); }
}
function check(name, got, want) {
	const ok = show(got) === show(want);
	if(!ok) failures++;
	console.log((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : "   got " + show(got) + ", want " + show(want)));
}

// Every object overlaps the origin so a hit test is never the thing under test.
function place(o) { o.left = 0; o.top = 0; o.width = 20; o.height = 20; return o; }

// GAME_START normally runs mReset on every element; these are the fields it
// sets, and the gate checks warrior === false rather than just falsy.
function drone(id) {
	const w = place(new Worker(id));
	w.active = true;
	w.warrior = false;
	w.speedUpgrade = false;
	w.berry = null;
	w.snail = null;
	return w;
}
function warrior(id) { const w = drone(id); w.gainWarrior(); return w; }
// Workers reach for the level's snail by name when they hear SNAIL_ATTACK, so
// the one under test has to be the one the level is holding.
function snail() {
	const s = place(new Snail("snail"));
	s.active = true; s.toon = null; s.swallowing = false;
	Game.instance.virtual.level.snail = s;
	return s;
}

console.log("\n-- only drones ride --");
{
	const s = snail();
	s.collission(warrior("teamBlue-worker0"));
	check("a warrior cannot mount an empty snail", s.toon, null);

	const d = drone("teamBlue-worker1");
	s.collission(d);
	check("a drone can", s.toon === d, true);
}

console.log("\n-- a warrior kills the rider --");
{
	const s = snail();
	const rider = drone("teamBlue-worker0");
	s.collission(rider);

	let killed = false;
	Game.instance.addEventListener(CONST.ATTACKED, e => { if(e.extra.toon === rider) killed = true; });

	s.collission(warrior("teamGold-worker0"));
	check("rider is dead", killed, true);
	check("snail is riderless", s.toon, null);
}

console.log("\n-- an enemy drone is still eaten, and a warrior frees it --");
{
	const s = snail();
	s.collission(drone("teamBlue-worker0"));

	const victim = drone("teamGold-worker1");
	s.collission(victim);
	check("snail is swallowing", s.swallowing, true);
	check("victim is frozen", victim.active, false);
	check("snail tracks its victim", s.victim === victim, true);

	s.collission(warrior("teamGold-worker0"));
	check("swallowing stopped", s.swallowing, false);
	check("victim is free again", victim.active, true);
	check("victim is not held", s.victim, null);
}

console.log("\n-- a speed drone rides faster --");
{
	const s = snail();
	check("riderless snail is at base speed", s.speed, CONST.SNAIL_SPEED);

	const d = drone("teamBlue-worker0");
	s.collission(d);
	check("a plain drone is at base speed", s.speed, CONST.SNAIL_SPEED);

	d.gainSpeed();
	check("a speed drone is faster", s.speed, CONST.SNAIL_SPEED_UPGRADE);
	check("and faster is actually faster", s.speed > CONST.SNAIL_SPEED, true);
}

console.log("\n-- a riderless snail on the cage does not throw --");
{
	const s = snail();
	let won = null;
	Game.instance.win = (type, team) => { won = type; };
	let threw = false;
	try { s.collission(place(new SnailCage("cage-blue"))); } catch(e) { threw = true; }
	check("no throw", threw, false);
	check("no win awarded", won, null);

	s.collission(drone("teamBlue-worker0"));
	s.collission(place(new SnailCage("cage-blue")));
	check("a ridden snail still wins", won, CONST.WIN_SNAIL);
}

console.log("\n-- a converted gate only serves its own team --");
{
	const g = place(new ShrineWarrior("shrine-warrior-blue"));
	g.inUse = false;

	let powered = [];
	Game.instance.addEventListener(CONST.SHRINE_POWER_UP, e => powered.push(e.extra.toon.id));

	// the gate only powers someone standing in its middle
	const blue = drone("teamBlue-worker0"); blue.berry = {}; blue.left = 10;
	const gold = drone("teamGold-worker0"); gold.berry = {}; gold.left = 10;

	g.collission(blue);
	g.inUse = false;
	g.collission(gold);
	check("a neutral gate serves both teams", powered, ["teamBlue-worker0", "teamGold-worker0"]);

	// a gold queen walks through it
	powered = [];
	g.inUse = false;
	const q = place(new Queen("teamGold-queen")); q.left = 10;
	g.collission(q);
	check("the queen converts it", g.affiliation, CONST.TEAM_GOLD);

	// Also fresh: a spent drone would be turned away for having no berry, which
	// would pass this check whether the affiliation gate exists or not.
	const blue2 = drone("teamBlue-worker1"); blue2.berry = {}; blue2.left = 10;
	g.collission(blue2);
	check("the enemy is locked out", powered, []);
	// A fresh drone: the first gold one spent its berry at the gate and came out
	// a warrior, so it no longer qualifies on either count.
	const gold2 = drone("teamGold-worker1"); gold2.berry = {}; gold2.left = 10;
	g.inUse = false;
	g.collission(gold2);
	check("her own team still gets through", powered, ["teamGold-worker1"]);
}

console.log("\n-- mounting does not leak a listener per ride --");
{
	// Count the delta across rides on one snail: every snail and drone built
	// earlier in this file is still holding its own listeners.
	const countAttacked = () => Game.instance._listeners.filter(l => l.type === CONST.ATTACKED).length;

	const s = snail();
	const before = countAttacked();
	for(let i = 0; i < 10; i++) {
		s.collission(drone("teamBlue-rider" + i));
		s.toon = null;
	}
	check("ten rides add no ATTACKED listeners", countAttacked() - before, 0);
}

console.log("\n" + (failures ? failures + " FAILURE(S)" : "all passed"));
process.exit(failures ? 1 : 0);
