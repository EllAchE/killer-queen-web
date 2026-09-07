/**
 * The lobby readiness gate. No server and no sockets: readyToStart is a pure
 * function of the user list precisely so the deadlock it replaced can be
 * reproduced in a test instead of by leaving a tab open for ten minutes.
 */
"use strict";

const KQ = require("./game.js");
const Game = KQ.Game;

var failed = 0;
function check(label, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if(!ok) failed++;
	console.log("  " + (ok ? "ok  " : "FAIL") + " " + label +
		(ok ? "" : "   got " + JSON.stringify(got) + ", want " + JSON.stringify(want)));
}

// A user as app.js builds one: a socket that has not picked has no toonId.
function player(toonId, ready) { return {id: Math.random(), toonId: toonId, ready: ready}; }
function watcher() { return {id: Math.random(), keys: []}; }

console.log("-- who the lobby waits on --");
check("one ready player starts", Game.readyToStart([player("teamBlue-queen", true)]), true);
check("one unready player does not", Game.readyToStart([player("teamBlue-queen", false)]), false);
check("both ready starts", Game.readyToStart([
	player("teamBlue-queen", true), player("teamGold-queen", true)
]), true);
check("one of two unready blocks", Game.readyToStart([
	player("teamBlue-queen", true), player("teamGold-queen", false)
]), false);

console.log("\n-- an empty lobby is not ready --");
check("nobody at all", Game.readyToStart([]), false);
check("nobody who picked", Game.readyToStart([watcher(), watcher()]), false);

console.log("\n-- a spectator does not block the round --");
{
	// The reported deadlock: a tab open with the menu up, no character picked.
	const users = [player("teamBlue-queen", true), watcher()];
	check("ready players start around them", Game.readyToStart(users), true);

	// And however many of them there are.
	check("three of them, still starts", Game.readyToStart(
		[player("teamBlue-queen", true), watcher(), watcher(), watcher()]
	), true);
}

console.log("\n-- and after a reset, which nulls every toonId --");
{
	// GAME_RESET runs `user.toonId = null` on every connected socket, which is
	// what turned the old gate from a one-round annoyance into a permanent one.
	const users = [player("teamBlue-queen", true), player("teamGold-queen", true)];
	users.forEach(u => { u.toonId = null; });
	check("nobody has re-picked yet", Game.readyToStart(users), false);

	users[0].toonId = "teamBlue-queen";
	users[0].ready = true;
	check("the one who re-picked can start", Game.readyToStart(users), true);
}

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
