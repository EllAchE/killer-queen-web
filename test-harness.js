/**
 * Ten laptops on a bad WiFi network, without the ten laptops.
 *
 * The lobby deadlock this repo just fixed was invisible to every test here
 * because none of them ever had two sockets open at once. This one drives the
 * real server over the real wire protocol: it spawns `node app.js` on its own
 * port, connects N clients, plays a match, and watches what the server does
 * about it.
 *
 * The server is deliberately not modified or required in-process. app.js
 * installs `process.on('uncaughtException')`, so a throw inside the game tick
 * never kills the process -- it prints a stack and the interval carries on
 * with that tick's broadcast skipped. That is invisible from inside; from out
 * here it is a line on stderr, and collecting those lines is most of the point
 * of this file.
 *
 *   node test-harness.js                 every scenario, about a minute
 *   node test-harness.js --list          what there is to run
 *   node test-harness.js --only=snail    one scenario, by name substring
 *   node test-harness.js --soak=300      hold a match open for 300s
 *   node test-harness.js --verbose       per-client event traces
 *
 * Exit status is 0 only if every scenario passed and the server logged no
 * uncaught exception. It does not currently exit 0: this lands red on purpose,
 * because the four things it fails on are all real and none of them are fixed
 * yet. In rough order of what it costs a player:
 *
 *   jump-mashing        both queens leave the top of the board inside twenty
 *                       seconds of ordinary play and never come back, which
 *                       ends the match without ending it
 *   id-uniqueness       two sockets handed the same Date.now(), after which
 *                       one disconnect unseats a different, still-connected
 *                       player and their controls stop answering
 *   rapid-ready-toggle  the countdown is re-armed per ready, so one lobby can
 *                       start the match twenty-five times over
 *   hostile-payloads    three socket handlers deref a null payload
 *
 * Each has a fix coming as its own change; this file is the thing that proves
 * them, so it goes in first and the reds turn green one at a time.
 *
 * What it does NOT find is worth recording too. Eight minutes of ten-player
 * soak held RSS flat at ~90MB, the broadcast gap at 16ms and the update rate
 * at 62/s, with no uncaught exceptions -- so a slow leak, which was the
 * leading theory for a session that degraded, is not what is happening here.
 */
"use strict";

const {spawn} = require("child_process");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ARGS = process.argv.slice(2);
const argOf = (name, dflt) => {
	const hit = ARGS.find(a => a.startsWith("--" + name + "="));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const hasFlag = name => ARGS.indexOf("--" + name) >= 0;

const VERBOSE = hasFlag("verbose");
const SOAK_SECONDS = Number(argOf("soak", 0));
const ONLY = argOf("only", null);
const BASE_PORT = Number(argOf("port", 3400));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const trace = (...a) => { if(VERBOSE) console.log("      .", ...a); };

// The toon ids the maps actually declare. A ten player cabinet is one queen
// and four drones a side; these are the ids loadLevel builds from maps/*.html.
const BLUE = ["teamBlue-queen", "teamBlue-worker0", "teamBlue-worker1", "teamBlue-worker2", "teamBlue-worker3"];
const GOLD = ["teamGold-queen", "teamGold-worker0", "teamGold-worker1", "teamGold-worker2", "teamGold-worker3"];
const ALL_TOONS = BLUE.concat(GOLD);

const FIELD = {width: 800, height: 600};

// ------------------------------------------------------------------ server --

/**
 * The server under test, as a child process.
 *
 * Out of process on purpose. In-process the game is a singleton that no test
 * can reset, `global.io` has to be faked, and the uncaughtException handler
 * that hides tick crashes in production would be replaced by mocha's. Paying
 * a spawn per scenario buys a server that behaves exactly like the one Logan
 * ran on his Mac.
 */
class Server {
	constructor(port) {
		this.port = port;
		this.proc = null;
		this.stdout = "";
		this.stderr = "";
		this.crashes = [];   // uncaught exceptions, parsed out of stderr
	}

	async start() {
		this.proc = spawn(process.execPath, ["app.js"], {
			cwd: __dirname,
			env: Object.assign({}, process.env, {PORT: String(this.port)}),
			stdio: ["ignore", "pipe", "pipe"]
		});

		this.proc.stdout.on("data", d => { this.stdout += d; if(VERBOSE) process.stdout.write("      | " + d); });
		this.proc.stderr.on("data", d => { this.stderr += d; this._scan(String(d)); });

		// Wait for the listener rather than sleeping a fixed amount: loadLevel
		// parses the stylesheet on boot and that is not instant on a cold cache.
		const deadline = Date.now() + 15000;
		while(Date.now() < deadline) {
			if(this.stdout.indexOf("server started") >= 0) { await sleep(150); return; }
			if(this.proc.exitCode !== null) throw new Error("server exited on boot: " + this.stderr);
			await sleep(50);
		}
		throw new Error("server never came up on port " + this.port);
	}

	/**
	 * app.js prints uncaught exceptions with console.warn(e.stack), so a crash
	 * arrives as a stack trace on stderr and nothing else marks it. Anything
	 * that looks like `SomeError: message` followed by `    at ...` is one.
	 */
	_scan(chunk) {
		chunk.split("\n").forEach(line => {
			const m = line.match(/^([A-Za-z]*Error): (.*)$/);
			if(m) {
				this.crashes.push({type: m[1], message: m[2], at: null, raw: line});
				return;
			}
			// The first frame under a stack we already recorded names the site.
			const f = line.match(/^\s+at (.+)$/);
			if(f && this.crashes.length && !this.crashes[this.crashes.length - 1].at)
				this.crashes[this.crashes.length - 1].at = f[1].trim();
		});
	}

	/** Resident set size in MB, straight off /proc. Linux only; 0 elsewhere. */
	rssMB() {
		try {
			const s = fs.readFileSync("/proc/" + this.proc.pid + "/status", "utf8");
			const m = s.match(/VmRSS:\s+(\d+) kB/);
			return m ? Math.round(Number(m[1]) / 1024) : 0;
		} catch(e) { return 0; }
	}

	async stop() {
		if(!this.proc || this.proc.exitCode !== null) return;
		this.proc.kill("SIGKILL");
		await sleep(120);
	}

	/** Distinct crash sites, so a throw that fires every tick reads as one bug. */
	distinctCrashes() {
		const seen = new Map();
		this.crashes.forEach(c => {
			const key = c.type + "|" + c.message + "|" + (c.at || "");
			if(!seen.has(key)) seen.set(key, Object.assign({count: 0}, c));
			seen.get(key).count++;
		});
		return [...seen.values()];
	}
}

// ----------------------------------------------------------------- clients --

/**
 * How the packets get there.
 *
 * Applied on send only, and per client, because that is where the asymmetry
 * lives: one player on the far side of the house is late and lossy while
 * everyone else is fine, and a profile applied to the whole run cannot express
 * that. `reorder` is the reason sends go through a scheduler at all -- with a
 * flat delay every message still arrives in order, which is the one thing a
 * real WiFi link will not promise.
 */
const NET = {
	lan:      {delay: 1,   jitter: 1,   loss: 0,    reorder: 0},
	wifi:     {delay: 25,  jitter: 15,  loss: 0.01, reorder: 0.02},
	badwifi:  {delay: 120, jitter: 90,  loss: 0.08, reorder: 0.10}
};

const CONST = {
	USER_CHARACTER_SELECT: "USER_CHARACTER_SELECT",
	USER_READY: "user_ready",
	KEY_UPDATE: "key_update"
};

let seq = 0;

/**
 * One synthetic player, speaking engine.io v4 by hand.
 *
 * socket.io-client would do this too, but it also reconnects on its own,
 * buffers through a disconnect and answers pings from a timer this file cannot
 * reach into. Half of the scenarios below are about a client that stops
 * behaving, so the client has to be the thing under control.
 */
class Client {
	constructor(port, opts) {
		opts = opts || {};
		this.port = port;
		this.name = opts.name || ("p" + (++seq));
		this.net = NET[opts.net || "lan"];
		this.toonId = null;

		this.connected = false;
		this.closed = false;
		this.blackholed = false;
		this.autoPong = opts.autoPong !== false;

		this.counts = {};          // event name -> how many
		this.bytesIn = 0;
		this.updateTimes = [];     // arrival ms of each virtual_update
		this.world = new Map();    // id -> last known {left, top, ...}
		this.alerts = [];
		this.menu = null;
		this.started = false;
		this.reset = false;
		this.win = null;
	}

	connect() {
		return new Promise((resolve, reject) => {
			const url = "ws://127.0.0.1:" + this.port + "/socket.io/?EIO=4&transport=websocket";
			this.ws = new WebSocket(url);
			this.ws.on("message", buf => this._onMessage(String(buf), buf.length));
			this.ws.on("error", () => {});
			this.ws.on("close", () => { this.connected = false; this.closed = true; });

			const t = setTimeout(() => reject(new Error(this.name + " never finished the socket.io handshake")), 8000);
			this._onConnect = () => { clearTimeout(t); resolve(this); };
		});
	}

	_onMessage(data, len) {
		if(this.blackholed) return;
		this.bytesIn += len;

		if(data[0] === "0" && data[1] === "{") {           // engine.io open
			this._raw("40");
			return;
		}
		if(data === "2") {                                  // ping
			if(this.autoPong) this._raw("3");
			return;
		}
		if(data.startsWith("40")) {                         // namespace connected
			this.connected = true;
			if(this._onConnect) this._onConnect();
			return;
		}
		if(!data.startsWith("42")) return;

		let name, payload;
		try { [name, payload] = JSON.parse(data.slice(2)); }
		catch(e) { return; }

		this.counts[name] = (this.counts[name] || 0) + 1;
		trace(this.name, "<-", name);

		switch(name) {
			case "virtual_update":
				this.updateTimes.push(Date.now());
				if(Array.isArray(payload))
					payload.forEach(o => this.world.set(o.id, Object.assign(this.world.get(o.id) || {}, o)));
				break;
			case "game_start":  this.started = true; this.reset = false; break;
			case "game_reset":  this.reset = true; this.started = false; break;
			case "game_win":    this.win = payload; break;
			case "menu_update": this.menu = payload; break;
			case "alert":       this.alerts.push(payload && payload.text); break;
		}
	}

	/** Straight onto the wire, no network profile. Used for protocol frames. */
	_raw(s) {
		if(this.closed || this.blackholed) return;
		if(!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		try { this.ws.send(s); } catch(e) {}
	}

	/**
	 * A game event, through the network profile: dropped, delayed, and
	 * occasionally overtaken by whatever was sent after it.
	 */
	emit(name, payload) {
		const frame = "42" + JSON.stringify([name, payload]);
		const n = this.net;

		if(Math.random() < n.loss) { trace(this.name, "-x", name, "(dropped)"); return; }

		let wait = n.delay + (Math.random() * 2 - 1) * n.jitter;
		if(Math.random() < n.reorder) wait += n.delay + n.jitter;   // let the next one pass
		if(wait < 0) wait = 0;

		setTimeout(() => this._raw(frame), wait);
		trace(this.name, "->", name);
	}

	select(toonId, playerName) {
		this.toonId = toonId;
		this.emit(CONST.USER_CHARACTER_SELECT, {toonId, name: playerName || this.name});
	}
	ready(v) { this.emit(CONST.USER_READY, {ready: v !== false}); }
	keys(arr) { this.emit(CONST.KEY_UPDATE, arr); }

	/** Close the tab. A clean websocket close frame. */
	quit() { this.closed = true; try { this.ws.close(); } catch(e) {} }

	/**
	 * Yank the network cable: the TCP connection dies without a close frame.
	 * The server finds out from the socket, promptly.
	 */
	abort() { this.closed = true; try { this.ws._socket.destroy(); } catch(e) {} }

	/**
	 * Shut the laptop lid. The socket stays open as far as either kernel is
	 * concerned and simply stops carrying anything, so the server keeps this
	 * player in the lobby until engine.io's ping timeout notices -- which is
	 * the slowest and least tested way for a player to leave.
	 */
	blackhole() {
		this.blackholed = true;
		this.autoPong = false;
		try { this.ws._socket.pause(); } catch(e) {}
	}

	/** Median gap between server broadcasts, as this client saw them. */
	updateGapMs() {
		if(this.updateTimes.length < 3) return null;
		const gaps = [];
		for(let i = 1; i < this.updateTimes.length; i++) gaps.push(this.updateTimes[i] - this.updateTimes[i-1]);
		gaps.sort((a, b) => a - b);
		return gaps[Math.floor(gaps.length / 2)];
	}
}

/** Connect n clients at once, which is also how toon ids get raced. */
async function connectAll(port, n, opts) {
	const cs = [];
	for(let i = 0; i < n; i++) cs.push(new Client(port, Object.assign({name: "p" + (i+1)}, opts)));
	await Promise.all(cs.map(c => c.connect()));
	return cs;
}

// -------------------------------------------------------------- invariants --

/**
 * Things that have to hold however the round went.
 *
 * Written against what a client can actually observe, not against the server's
 * internals, so they stay true of the thing the players are looking at. Each
 * returns a list of violations; empty is a pass.
 */
const INVARIANTS = {
	/**
	 * The graveyard at (-100,-100) is where hatched eggs and spent berries are
	 * parked on purpose, so it is allowed.
	 *
	 * The margin is 150px rather than nothing because leaving the board is
	 * normal in two places. The top ledge on every map sits at y=0, so a toon
	 * standing on it is already at -25, and a jump from there arcs another
	 * 62px up before gravity wins: about -87, briefly, every time anyone
	 * jumps up top. And a map only wraps on the axis its config names, so on
	 * `day` there is nothing above the ceiling to come back from except
	 * gravity. What this is looking for is an escape -- geometry that puts an
	 * entity somewhere it can never return from.
	 */
	"entities stay on the board"(ctx) {
		const M = 150;
		const bad = [];
		ctx.clients.forEach(c => c.world.forEach((o, id) => {
			if(o.left === undefined || o.top === undefined) return;
			const parked = o.left <= -90 && o.top <= -90;
			if(parked) return;
			if(o.left < -M || o.left > FIELD.width + M || o.top < -M || o.top > FIELD.height + M)
				bad.push(id + " at " + o.left + "," + o.top);
		}));
		return [...new Set(bad)];
	},

	/**
	 * The reported symptom, as an assertion.
	 *
	 * "The game just crashed" with the server still listening is what a frozen
	 * tick looks like from a player's seat: the process is up, the port is
	 * open, and nothing on screen ever moves again. A synchronous hang inside
	 * the loop -- groundCheck's unbounded while, say -- produces exactly this
	 * and produces no stack for the crash scanner to find, so it has to be
	 * caught by its silence instead.
	 */
	"the world never stopped moving"(ctx) {
		const bad = [];
		ctx.clients.forEach(c => {
			if(!c.started || c.closed || c.blackholed) return;
			// Only while somebody was actually pressing something. sendUpdates
			// broadcasts nothing when nothing moved, so a settled lobby is
			// legitimately silent and says nothing about the tick.
			if(!c.drivingSince) return;
			const times = c.updateTimes.filter(t => t >= c.drivingSince);
			if(times.length < 5) { bad.push(c.name + " received almost nothing while being driven"); return; }
			let worst = 0;
			for(let i = 1; i < times.length; i++)
				worst = Math.max(worst, times[i] - times[i - 1]);
			// Two full seconds of nothing, in a loop that runs at 60Hz.
			if(worst > 2000) bad.push(c.name + " saw a " + worst + "ms gap in the broadcast");
		});
		return bad;
	},

	/**
	 * Two players holding one id.
	 *
	 * app.js stamps `user.id = Date.now()`, so two tabs that finish their
	 * handshake in the same millisecond -- ten people opening a link at once,
	 * which is how a LAN game starts -- are given the same id. Nothing
	 * downstream expects that, and the disconnect handler in particular
	 * removes the *first* user carrying the id rather than the one that left.
	 */
	"no two users share an id"(ctx) {
		const menu = ctx.clients.map(c => c.menu).filter(Boolean).pop();
		if(!menu || !menu.users) return [];
		const byId = {};
		menu.users.forEach(u => { (byId[u.id] = byId[u.id] || []).push(u.toonId || "(no pick)"); });
		return Object.keys(byId).filter(k => byId[k].length > 1)
			.map(k => "id " + k + " is held by " + byId[k].length + ": " + byId[k].join(", "));
	},

	"no position is NaN"(ctx) {
		const bad = [];
		ctx.clients.forEach(c => c.world.forEach((o, id) => {
			if(Number.isNaN(Number(o.left)) || Number.isNaN(Number(o.top))) bad.push(id);
		}));
		return [...new Set(bad)];
	},

	/** Two players driving one bee is the character-select race, landed. */
	"no toon is claimed twice"(ctx) {
		const held = {};
		const bad = [];
		ctx.clients.filter(c => !c.closed && c.acceptedToon).forEach(c => {
			if(held[c.acceptedToon]) bad.push(c.acceptedToon + " held by " + held[c.acceptedToon] + " and " + c.name);
			held[c.acceptedToon] = c.name;
		});
		return bad;
	},

	/**
	 * A tick that takes longer than its 16ms budget is the whole performance
	 * question, and the broadcast interval is the only place it shows. Judged
	 * on the median so one stall does not fail the run -- a persistent overrun
	 * is what matters.
	 */
	"the server keeps its tick budget"(ctx) {
		const bad = [];
		ctx.clients.forEach(c => {
			const g = c.updateGapMs();
			if(g !== null && g > 40) bad.push(c.name + " saw a median " + g + "ms between updates");
		});
		return bad;
	},

	"the server logged no uncaught exception"(ctx) {
		return ctx.server.distinctCrashes().map(c =>
			c.type + ": " + c.message + (c.at ? "  at " + c.at : "") + "  (x" + c.count + ")");
	}
};

function runInvariants(ctx, skip) {
	const out = [];
	Object.keys(INVARIANTS).forEach(name => {
		if(skip && skip.indexOf(name) >= 0) return;
		let v;
		try { v = INVARIANTS[name](ctx); }
		catch(e) { v = ["invariant itself threw: " + e.message]; }
		if(v.length) out.push({name, violations: v});
	});
	return out;
}

// --------------------------------------------------------------- scenarios --

const SCENARIOS = [];
const scenario = (name, blurb, fn, opts) => SCENARIOS.push({name, blurb, fn, opts: opts || {}});

/** Pick characters and ready up, the way ten people at a table would. */
async function seatEveryone(clients, toons) {
	toons = toons || ALL_TOONS;
	clients.forEach((c, i) => c.select(toons[i % toons.length]));
	await sleep(400);
	// menu_update carries the authoritative assignment back; believe it, not
	// what we asked for, because the server can refuse a taken character.
	clients.forEach(c => {
		const mine = c.menu && c.menu.users && c.menu.users.find(u => u.toonId === c.toonId);
		c.acceptedToon = mine ? mine.toonId : c.toonId;
	});
	clients.forEach(c => c.ready(true));
	await sleep(1800);
}

/** Hold plausible inputs. Biased toward the middle of the board, where the snail is. */
function fuzzInputs(clients) {
	const KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
	clients.forEach(c => { if(!c.drivingSince) c.drivingSince = Date.now(); });
	const timers = clients.map(c => setInterval(() => {
		const held = [];
		const toCentre = c.toonId && c.toonId.indexOf("Blue") > 0 ? "ArrowRight" : "ArrowLeft";
		if(Math.random() < 0.6) held.push(toCentre);
		if(Math.random() < 0.3) held.push(KEYS[Math.floor(Math.random() * KEYS.length)]);
		if(Math.random() < 0.25) held.push("ArrowUp");
		c.keys(held);
	}, 60 + Math.random() * 60));
	return () => timers.forEach(clearInterval);
}

scenario("full-lobby", "ten players pick, ready, and the match starts", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 10);
	await seatEveryone(cs);

	ctx.expect("every client was told the game started", cs.every(c => c.started), true);
	ctx.expect("every character was accepted", cs.filter(c => c.acceptedToon).length, 10);
	ctx.expect("nobody was told their pick was taken", cs.flatMap(c => c.alerts).length, 0);

	const stop = fuzzInputs(cs);
	await sleep(4000);
	stop();

	ctx.expect("everyone is receiving world updates", cs.every(c => c.counts.virtual_update > 30), true);
});

scenario("character-race", "ten clients grab the same bee in the same breath", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 10);

	// No stagger at all: the point is to land ten selects inside one tick.
	cs.forEach(c => c.select("teamBlue-queen"));
	await sleep(800);

	// The server's own view, as told to any client that has not picked.
	const menu = cs.map(c => c.menu).filter(Boolean).pop();
	const holders = menu ? menu.users.filter(u => u.toonId === "teamBlue-queen") : [];
	const refused = cs.filter(c => c.alerts.some(a => /already taken/.test(a || "")));

	ctx.expect("exactly one client holds the queen", holders.length, 1);
	ctx.expect("the other nine were told it was taken", refused.length, 9);
});

scenario("last-unready-leaves", "the tab the lobby was waiting on closes (PR #1)", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 4);
	cs.forEach((c, i) => c.select(ALL_TOONS[i]));
	await sleep(400);

	// Three ready, the fourth never does, then closes its tab.
	cs.slice(0, 3).forEach(c => c.ready(true));
	await sleep(700);
	ctx.expect("the round has not started yet", cs[0].started, false);

	cs[3].quit();
	await sleep(2200);

	ctx.expect("the round starts once the holdout is gone", cs[0].started, true);
});

scenario("quit-mid-countdown", "a player closes the tab inside the countdown window", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 6);
	cs.forEach((c, i) => c.select(ALL_TOONS[i]));
	await sleep(400);
	cs.forEach(c => c.ready(true));

	// GAME_COUNTDOWN schedules a one second timer; leave inside it.
	await sleep(300);
	cs[2].abort();
	await sleep(2500);

	ctx.expect("the survivors are in a match", cs.filter(c => c.started && !c.closed).length, 5);

	const stop = fuzzInputs(cs.filter(c => !c.closed));
	await sleep(2500);
	stop();
});

scenario("join-in-progress", "somebody opens the page after the round started", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 4);
	cs.forEach((c, i) => c.select(ALL_TOONS[i]));
	await sleep(400);
	cs.forEach(c => c.ready(true));
	await sleep(1800);
	ctx.expect("the round is running", cs[0].started, true);

	const late = new Client(ctx.port, {name: "late"});
	await late.connect();
	cs.push(late);
	late.select(ALL_TOONS[4]);
	await sleep(300);
	late.ready(true);
	await sleep(600);

	ctx.expect("the latecomer is dropped straight into the match", late.started, true);

	// Somebody has to be moving before there is a world to receive: the tick
	// broadcasts only what changed, so a settled board sends nothing at all.
	const stop = fuzzInputs(cs);
	await sleep(2000);
	stop();

	ctx.expect("and starts receiving the world", late.counts.virtual_update > 5, true);
});

scenario("two-tabs-one-player", "the same person, two browser tabs, one bee", async ctx => {
	// A third socket that never picks anything. MENU_UPDATE is only sent to
	// users without a toonId, so once a client is seated it stops hearing who
	// else is in the lobby -- an observer is the only way to read the roster.
	const cs = ctx.clients = await connectAll(ctx.port, 3);
	const [tabA, tabB, watcher] = cs;

	tabA.select("teamGold-worker0");
	await sleep(350);
	tabB.select("teamGold-worker0");
	await sleep(450);

	ctx.expect("the second tab is refused", tabB.alerts.some(a => /already taken/.test(a || "")), true);
	ctx.expect("only one of them is seated",
		watcher.menu.users.filter(u => u.toonId === "teamGold-worker0").length, 1);

	// And the first tab closing has to hand the character back.
	tabA.quit();
	await sleep(700);
	tabB.select("teamGold-worker0");
	await sleep(600);

	const holders = watcher.menu.users.filter(u => u.toonId === "teamGold-worker0");
	ctx.expect("the freed character can be picked up", holders.length, 1);
});

scenario("simultaneous-join", "ten people open the link at the same moment", async ctx => {
	// No stagger: every handshake finishes inside the same few milliseconds,
	// which is what happens when a host reads the join URL out to a room.
	const cs = ctx.clients = await connectAll(ctx.port, 10);
	const watcher = new Client(ctx.port, {name: "watch"});
	await watcher.connect();
	cs.push(watcher);

	cs.slice(0, 10).forEach((c, i) => c.select(ALL_TOONS[i]));
	await sleep(700);
	ctx.expect("all ten are seated", watcher.menu.users.filter(u => u.toonId).length, 10);

	cs.slice(0, 10).forEach(c => c.ready(true));
	await sleep(2200);
	ctx.expect("the match started", cs[0].started, true);

	// One person closes their tab. Exactly one seat should empty, and every
	// other player's controls have to keep working.
	const quitter = cs[9];
	quitter.quit();
	await sleep(800);

	ctx.expect("exactly one seat emptied", watcher.menu.users.filter(u => u.toonId).length, 9);

	const survivors = cs.slice(0, 9);
	const before = survivors.map(c => {
		const t = c.world.get(c.toonId);
		return t ? t.left : null;
	});
	survivors.forEach(c => c.keys(["ArrowRight"]));
	const iv = setInterval(() => survivors.forEach(c => c.keys(["ArrowRight"])), 100);
	survivors.forEach(c => { if(!c.drivingSince) c.drivingSince = Date.now(); });
	await sleep(1500);
	clearInterval(iv);

	const dead = survivors.filter((c, i) => {
		const t = c.world.get(c.toonId);
		return before[i] !== null && t && t.left === before[i];
	}).map(c => c.toonId);

	ctx.expect("every remaining player can still drive their bee", dead, []);
});

scenario("id-uniqueness", "everyone opens the join link at once", async ctx => {
	// A timestamp collides only when two handshakes land inside the same
	// millisecond, so this is a race and this scenario is a sampler, not a
	// proof. It reproduces the shape that actually collides: a cold server and
	// one tight opening batch, which is how a LAN game starts and is the only
	// arrangement measured here that collides at all -- spread the accepts out
	// with a bigger batch or a warmed server and they stop sharing a
	// millisecond. Expect it to catch the bug on roughly half of runs.
	//
	// The reliable detector is the `no two users share an id` invariant, which
	// runs after all fourteen scenarios: across that many the odds of missing
	// a collision every time are small, and against an id that is unique by
	// construction it is silent every time.
	const watcher = new Client(ctx.port, {name: "watch"});
	await watcher.connect();
	const cs = ctx.clients = [watcher].concat(await connectAll(ctx.port, 20));
	await sleep(800);

	const users = (watcher.menu && watcher.menu.users) || [];
	ctx.expect("the server saw every socket", users.length, cs.length);

	const byId = {};
	users.forEach(u => { byId[u.id] = (byId[u.id] || 0) + 1; });
	ctx.expect("no id was handed out twice",
		Object.keys(byId).filter(k => byId[k] > 1).map(k => "id " + k + " went to " + byId[k] + " sockets"), []);
});

scenario("jump-mashing", "everybody taps jump, the way everybody does", async ctx => {
	// The queen is supposed to fly -- that is what she does in the arcade --
	// and `Worker.jump` lets a warrior go again in mid-air too. Neither is the
	// bug. The bug is that on a map whose config wraps only `x`, nothing
	// bounds `y` at all: visibilityCheck wraps the named axis and leaves the
	// other one open, so anyone who can jump without being grounded climbs out
	// of the top of the board and gravity never gets them back.
	//
	// Jumping on the spot is not enough, which is worth knowing: the ceiling
	// strip holds anyone directly under it, so getting out means wandering
	// sideways until you are under one of the gaps in it. Hence the horizontal
	// key -- this is someone moving around and tapping jump, not a lab setup.
	// Twenty seconds; both queens are usually gone inside ten.
	const cs = ctx.clients = await connectAll(ctx.port, 10);
	await seatEveryone(cs);
	ctx.expect("the match is running", cs.every(c => c.started), true);

	const stop = fuzzInputs(cs);
	await sleep(20000);
	stop();
	cs.forEach(c => c.keys([]));
	await sleep(500);

	const escaped = ALL_TOONS.filter(id => {
		const o = cs[0].world.get(id);
		return o && o.top < -200;
	});
	ctx.expect("nobody jumped their way off the board", escaped, []);
});

scenario("hostile-payloads", "clients that send things the page never would", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 3);
	const c = cs[0];

	// Every one of these is reachable from a devtools console on the real page.
	c.emit("USER_CHARACTER_SELECT", null);
	c.emit("USER_CHARACTER_SELECT", {toonId: {}});
	c.emit("USER_CHARACTER_SELECT", {toonId: "no-such-toon", name: 12345});
	c.emit("USER_CHARACTER_SELECT", {toonId: "teamBlue-queen", name: new Array(500).join("x")});
	c.emit("user_ready", null);
	c.emit("user_ready", {ready: "yes"});
	c.emit("key_update", null);
	c.emit("key_update", "ArrowUp");
	c.emit("key_update", {0: "ArrowUp"});
	c.emit("key_update", new Array(5000).fill("ArrowUp"));
	c.emit("user_map_select", {map: "../../etc/passwd"});
	c.emit("user_map_select", null);
	c.emit("user_name", {name: null});
	await sleep(1000);

	cs[1].select("teamGold-queen");
	await sleep(350);
	cs[1].ready(true);
	await sleep(1600);

	ctx.expect("the server is still serving", cs[1].counts.menu_update > 0 || cs[1].started, true);
	ctx.expect("the process is still up", ctx.server.proc.exitCode, null);
});

scenario("rapid-ready-toggle", "somebody drumming the ready button", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 4);
	cs.forEach((c, i) => c.select(ALL_TOONS[i]));
	await sleep(400);
	cs.slice(0, 3).forEach(c => c.ready(true));

	for(let i = 0; i < 60; i++) { cs[3].ready(i % 2 === 0); await sleep(20); }
	cs[3].ready(true);
	await sleep(2500);

	ctx.expect("the match started exactly once", cs[0].counts.game_start, 1);
});

scenario("half-open-sockets", "two laptops have their lids shut mid-match", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 6);
	await seatEveryone(cs);
	ctx.expect("the match is running", cs[0].started, true);

	const stop = fuzzInputs(cs);
	await sleep(1500);

	// No close frame and no reset: the socket simply stops carrying anything
	// and stops answering pings, so engine.io only finds out at its timeout.
	cs[1].blackhole();
	cs[4].blackhole();
	await sleep(4500);
	stop();

	const live = cs.filter(c => !c.blackholed);
	ctx.expect("the players still there kept playing", live.every(c => c.counts.virtual_update > 40), true);
	ctx.expect("the server did not fall over", ctx.server.proc.exitCode, null);
});

scenario("bad-wifi-match", "a full ten player round over a bad link", async ctx => {
	const cs = ctx.clients = [];
	for(let i = 0; i < 10; i++)
		cs.push(new Client(ctx.port, {name: "p" + (i + 1), net: i < 7 ? "wifi" : "badwifi"}));
	await Promise.all(cs.map(c => c.connect()));

	// A lossy link drops selects and readies outright, so say it again until
	// the menu comes back agreeing. This is what the real page does not do.
	for(let attempt = 0; attempt < 5; attempt++) {
		cs.forEach((c, i) => { if(!c.acceptedToon) c.select(ALL_TOONS[i]); });
		await sleep(600);
		cs.forEach(c => {
			const mine = c.menu && c.menu.users && c.menu.users.find(u => u.toonId === c.toonId);
			if(mine) c.acceptedToon = mine.toonId;
		});
		if(cs.every(c => c.acceptedToon)) break;
	}
	cs.forEach(c => c.ready(true));
	await sleep(1400);
	cs.filter(c => !c.started).forEach(c => c.ready(true));
	await sleep(2000);

	const stop = fuzzInputs(cs);
	await sleep(6000);
	stop();

	ctx.expect("everyone got into the match", cs.filter(c => c.started).length, 10);
	ctx.note("received per client", cs.map(c => Math.round(c.bytesIn / 1024) + "K").join(" "));
});

scenario("broadcast-cost", "what one tick costs, times ten clients", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 10);
	await seatEveryone(cs);
	ctx.expect("the match is running", cs.every(c => c.started), true);

	const stop = fuzzInputs(cs);
	const t0 = Date.now();
	const before = cs.map(c => c.bytesIn);
	await sleep(8000);
	stop();
	const secs = (Date.now() - t0) / 1000;

	const perClient = cs.map((c, i) => (c.bytesIn - before[i]) / secs);
	const each = perClient.reduce((a, b) => a + b, 0) / perClient.length;
	const total = perClient.reduce((a, b) => a + b, 0);

	ctx.note("per client", Math.round(each / 1024) + " KB/s");
	ctx.note("server egress at ten players", Math.round(total / 1024) + " KB/s");
	ctx.note("median gap between broadcasts", cs[0].updateGapMs() + " ms");
	ctx.note("updates received", cs[0].counts.virtual_update + " in " + secs.toFixed(1) + "s");
	ctx.note("server RSS", ctx.server.rssMB() + " MB");

	// Absolute throughput is a finding, not a contract. What has to hold is
	// that the tick is not being starved by the work of sending it.
	ctx.expect("the tick is still near its 16ms budget", cs[0].updateGapMs() < 40, true);
});

scenario("connect-churn", "a hundred tabs open and close across a running match", async ctx => {
	const cs = ctx.clients = await connectAll(ctx.port, 2);
	cs.forEach((c, i) => c.select(ALL_TOONS[i]));
	await sleep(400);
	cs.forEach(c => c.ready(true));
	await sleep(1800);
	ctx.expect("a match is running", cs[0].started, true);

	// Somebody has to be moving throughout, or the tick has nothing to
	// broadcast and the gap measurement below reads a quiet board as a stall.
	const stop = fuzzInputs(cs);

	const rssBefore = ctx.server.rssMB();
	const gapBefore = await measureGap(cs[0], 1500);

	// Nobody in the churn picks a character. This is people opening the page
	// and closing it again, the cheapest thing a visitor can do to the server.
	for(let round = 0; round < 10; round++) {
		const batch = await connectAll(ctx.port, 10, {name: "churn"});
		await sleep(140);
		batch.forEach(c => c.quit());
		await sleep(140);
	}
	await sleep(1000);

	const rssAfter = ctx.server.rssMB();
	const gapAfter = await measureGap(cs[0], 1500);
	stop();

	ctx.note("RSS", rssBefore + "MB -> " + rssAfter + "MB across 100 connect/disconnect cycles");
	ctx.note("median broadcast gap", gapBefore + "ms -> " + gapAfter + "ms");

	ctx.expect("the match survived the churn", cs[0].counts.virtual_update > 60, true);
	ctx.expect("the tick did not degrade past budget", gapAfter < 40, true);
});

/** Median broadcast gap over a fresh window, so before and after compare. */
async function measureGap(client, ms) {
	const start = client.updateTimes.length;
	await sleep(ms);
	const times = client.updateTimes.slice(start);
	if(times.length < 3) return null;
	const gaps = [];
	for(let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
	gaps.sort((a, b) => a - b);
	return gaps[Math.floor(gaps.length / 2)];
}

/**
 * The long one. Not in the default set -- run it with --soak=<seconds>.
 *
 * A slow leak is the best available explanation for a session that was fine
 * for twenty minutes and then was not, so this holds a ten player match open
 * and samples the things that would show it: resident memory, the gap between
 * broadcasts, and whether the tick is still keeping its budget at the end.
 */
async function soak(ctx, seconds) {
	const cs = ctx.clients = await connectAll(ctx.port, 10);
	await seatEveryone(cs);
	ctx.expect("the match is running", cs.every(c => c.started), true);

	const stop = fuzzInputs(cs);
	const samples = [];
	const t0 = Date.now();
	let lastUpdates = 0;

	while((Date.now() - t0) / 1000 < seconds) {
		const gap = await measureGap(cs[0], 5000);
		const elapsed = Math.round((Date.now() - t0) / 1000);
		const updates = cs[0].counts.virtual_update;
		const s = {
			t: elapsed,
			rss: ctx.server.rssMB(),
			gap: gap,
			fps: Math.round((updates - lastUpdates) / 5),
			crashes: ctx.server.crashes.length
		};
		lastUpdates = updates;
		samples.push(s);
		console.log("      " + String(s.t).padStart(5) + "s  rss " + String(s.rss).padStart(4) + "MB" +
			"  gap " + String(s.gap).padStart(3) + "ms  " + String(s.fps).padStart(3) + " updates/s" +
			"  crashes " + s.crashes);
	}
	stop();

	const first = samples[0], last = samples[samples.length - 1];
	ctx.note("RSS", first.rss + "MB -> " + last.rss + "MB over " + last.t + "s");
	ctx.note("broadcast gap", first.gap + "ms -> " + last.gap + "ms");
	ctx.note("uncaught exceptions", String(ctx.server.crashes.length));

	ctx.expect("the tick still keeps its budget at the end", last.gap < 40, true);
	ctx.expect("the match never stopped broadcasting", last.fps > 30, true);
}

// ------------------------------------------------------------------ runner --

/**
 * One scenario, one server. Restarting between scenarios costs about a second
 * each and buys the thing the game cannot give a test any other way: a Game
 * singleton that has genuinely never been played.
 */
async function runScenario(s, port) {
	const server = new Server(port);
	const ctx = {
		port, server, clients: [],
		checks: [], notes: [],
		expect(label, got, want) {
			const ok = JSON.stringify(got) === JSON.stringify(want);
			this.checks.push({label, ok, got, want});
		},
		note(label, value) { this.notes.push(label + ": " + value); }
	};

	console.log("\n== " + s.name + " -- " + s.blurb);

	let error = null;
	try {
		await server.start();
		await s.fn(ctx);
	} catch(e) {
		error = e;
	}

	// Invariants run against whatever state the scenario left behind, so they
	// still say something useful about a scenario that threw halfway.
	let violations = [];
	try { violations = runInvariants(ctx, s.opts.skipInvariants); }
	catch(e) { violations = [{name: "invariants", violations: [e.message]}]; }

	ctx.clients.forEach(c => { try { c.quit(); } catch(e) {} });
	await sleep(150);
	await server.stop();

	ctx.checks.forEach(c => console.log("   " + (c.ok ? "ok   " : "FAIL ") + c.label +
		(c.ok ? "" : "   got " + JSON.stringify(c.got) + ", want " + JSON.stringify(c.want))));
	ctx.notes.forEach(n => console.log("   -    " + n));
	violations.forEach(v => {
		console.log("   FAIL " + v.name);
		v.violations.slice(0, 6).forEach(x => console.log("          " + x));
		if(v.violations.length > 6) console.log("          ... and " + (v.violations.length - 6) + " more");
	});
	if(error) console.log("   FAIL the scenario itself threw: " + error.message);

	const failed = ctx.checks.filter(c => !c.ok).length + violations.length + (error ? 1 : 0);
	return {name: s.name, failed, crashes: server.distinctCrashes()};
}

async function main() {
	if(hasFlag("list")) {
		SCENARIOS.forEach(s => console.log("  " + s.name.padEnd(22) + s.blurb));
		console.log("  " + "soak".padEnd(22) + "hold a ten player match open (--soak=<seconds>)");
		return 0;
	}

	// --only=none is how you ask for the soak on its own.
	const chosen = ONLY ? SCENARIOS.filter(s => s.name.indexOf(ONLY) >= 0) : SCENARIOS;
	if(ONLY && !chosen.length && !SOAK_SECONDS) {
		console.log("no scenario matching " + ONLY);
		return 1;
	}

	const results = [];
	let port = BASE_PORT;

	for(const s of chosen) results.push(await runScenario(s, port++));

	if(SOAK_SECONDS > 0)
		results.push(await runScenario(
			{name: "soak", blurb: SOAK_SECONDS + "s with ten players connected",
			 fn: ctx => soak(ctx, SOAK_SECONDS), opts: {}}, port++));

	// ---- summary

	const failed = results.filter(r => r.failed);
	const allCrashes = new Map();
	results.forEach(r => r.crashes.forEach(c => {
		const key = c.type + "|" + c.message + "|" + (c.at || "");
		if(!allCrashes.has(key)) allCrashes.set(key, {c, where: []});
		allCrashes.get(key).where.push(r.name);
	}));

	console.log("\n" + "-".repeat(72));
	if(allCrashes.size) {
		console.log("\nuncaught exceptions the server swallowed:\n");
		[...allCrashes.values()].forEach(({c, where}) => {
			console.log("  " + c.type + ": " + c.message);
			if(c.at) console.log("      at " + c.at);
			console.log("      seen in: " + [...new Set(where)].join(", "));
		});
		console.log("\n  app.js installs process.on('uncaughtException'), so none of these");
		console.log("  killed the process. Each one skipped the rest of that tick, which");
		console.log("  includes the broadcast at the end of Game.loop().");
	} else {
		console.log("\nno uncaught exceptions on the server");
	}

	console.log("\n" + results.length + " scenarios, " + failed.length + " with failures" +
		(failed.length ? ": " + failed.map(f => f.name).join(", ") : ""));

	return (failed.length || allCrashes.size) ? 1 : 0;
}

main().then(code => process.exit(code)).catch(e => {
	console.error(e);
	process.exit(1);
});
