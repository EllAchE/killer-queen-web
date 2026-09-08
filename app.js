"use strict";

process.on('uncaughtException', e => console.warn(e.stack));
process.on('warning', e => console.warn(e.stack));

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
global.fs = fs;
const port = process.env.PORT || 3000;

/**
 * Everything used to be served as text/html, which browsers forgave for
 * scripts and images. Audio is where that stops working: a music loop
 * labelled text/html is not something <audio> will agree to play.
 */
const MIME = {
	".html": "text/html",
	".js":   "text/javascript",
	".css":  "text/css",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".ico":  "image/x-icon",
	".mp3":  "audio/mpeg",
	".ogg":  "audio/ogg",
	".wav":  "audio/wav",
	".json": "application/json"
};

// Resolved once so the traversal check below compares against a real path
// even if the repo is reached through a symlink.
const ROOT = fs.realpathSync(__dirname);

const PLAYABLE = [".ogg", ".mp3", ".m4a", ".wav"];

// The three that ship. Anything else found is somebody's own file and is
// labelled with its filename.
const TRACK_LABELS = {
	"match-1": "Chiptune — Level 1",
	"match-2": "Chiptune — Level 2",
	"match-3": "Chiptune — Level 3"
};

/**
 * The `http://<lan-ip>:<port>` URLs other laptops join at, one per external
 * IPv4 interface. Loopback is left out: it only reaches this machine, so it
 * answers nothing on anyone else's screen. IPv6 is left out too, for the
 * duller reason that it needs brackets in a URL and nobody's LAN here does.
 */
function joinUrls() {
	var seen = {};
	try {
		Object.keys(os.networkInterfaces()).forEach(function(name) {
			os.networkInterfaces()[name].forEach(function(nic) {
				if(nic.family !== "IPv4" || nic.internal || !nic.address) return;
				seen[nic.address] = true;
			});
		});
	} catch(e) {
		// No interfaces readable: the menu simply shows nothing.
	}
	return Object.keys(seen).sort().map(function(addr) {
		return "http://" + addr + ":" + port;
	});
}

/**
 * The match music the picker offers.
 *
 * Read off the disk rather than hardcoded, which is the whole mechanism
 * behind audio/music/custom/: drop an mp3 in there and it is in the list next
 * time somebody opens Settings. Nothing to edit, nothing to rebuild, and
 * nothing of yours ends up committed.
 *
 * One entry per track, carrying every format found for it, because which one
 * to fetch is the browser's call and not ours.
 */
function musicTracks() {
	var found = {};   // id -> {id, label, srcs:[]}

	function scan(dir, prefix, isCustom) {
		var names;
		try { names = fs.readdirSync(path.join(ROOT, dir)); }
		catch(e) { return; }   // custom/ is allowed not to exist

		names.sort().forEach(function(name) {
			var ext = path.extname(name).toLowerCase();
			if(PLAYABLE.indexOf(ext) < 0) return;

			var id = path.basename(name, ext);
			// Shipped music that is not selectable: the lobby loop and the
			// game-over theme both play on their own cue.
			if(!isCustom && !/^match-/.test(id)) return;

			var key = isCustom ? "custom/" + id : id;
			if(!found[key]) found[key] = {
				id: key,
				label: isCustom ? id : (TRACK_LABELS[id] || id),
				srcs: []
			};
			found[key].srcs.push(prefix + name);
		});
	}

	scan("audio/music", "audio/music/", false);
	scan("audio/music/custom", "audio/music/custom/", true);

	return Object.keys(found).map(function(k) { return found[k]; });
}

const app = http.createServer(function(req, res) {
	var url = (req.url || "/").split("?")[0].split("#")[0];
	if(url == "/") url = "/index.html";

	// Decoded before the traversal check, or %2e%2e would walk straight past it.
	try { url = decodeURIComponent(url); }
	catch(e) { res.writeHead(400); return res.end(); }

	// Listed rather than served, so it has to be answered ahead of the file
	// handler. No-store because the point of it is picking up a file that was
	// dropped in after the page was first loaded.
	if(url == "/audio/tracks.json") {
		var body = JSON.stringify({tracks: musicTracks()});
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(body),
			"Cache-Control": "no-store"
		});
		return res.end(body);
	}

	// The address other laptops join at. The host's own page knows it only as
	// localhost, so the menu asks here and prints it: without this everyone
	// types `ipconfig getifaddr en0` into a terminal instead. No-store because
	// a laptop can change networks mid-session.
	if(url == "/kqx-join.json") {
		var joinBody = JSON.stringify({port: Number(port), urls: joinUrls()});
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(joinBody),
			"Cache-Control": "no-store"
		});
		return res.end(joinBody);
	}

	// This used to be fs.readFileSync(__dirname + req.url), so a request for
	// /../../../etc/passwd read it out to anyone on the network. resolve()
	// collapses the "..", and the prefix test is what actually refuses a climb.
	var file = path.resolve(ROOT, "." + url);
	if(file != ROOT && !file.startsWith(ROOT + path.sep)) {
		res.writeHead(403);
		return res.end();
	}

	var type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";

	// Streamed rather than read whole, and async rather than Sync: this is the
	// same process and the same event loop as the game, so a multi-megabyte
	// track read the old way stalled every player's match to serve one page.
	fs.stat(file, function(err, st) {
		if(err || !st.isFile()) {
			res.writeHead(404, {"Content-Type": "text/plain"});
			return res.end("not found");
		}

		res.writeHead(200, {"Content-Type": type, "Content-Length": st.size});
		fs.createReadStream(file)
			.on("error", function() { res.end(); })
			.pipe(res);
	});
});
const io = require('socket.io')(app);
global.io = io;
// module.exports = io;

io.on('connection', function(socket){
  console.log('a user connected');
});

app.listen(port);

const KQ = require("./game.js");

/**
 * Names are typed by whoever is on that laptop and land in everybody else's
 * DOM, so nothing but printable characters survives and the tag stays short
 * enough to sit over a 20px bee.
 */
const NAME_MAX = 12;
function cleanName(raw) {
	if(typeof raw != "string") return "";
	return raw.replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/**
 * Names go to everyone, unlike MENU_UPDATE, which only reaches users who have
 * not picked a character yet -- in-game players need these too.
 */
/**
 * The map is lobby-wide, not per-player, so everyone is told which one is
 * loaded: the browser fetches the same maps/<name>.html the server parsed and
 * drops it into #level.
 */
function broadcastMap() {
	io.sockets.emit(KQ.CONST.MAP_UPDATE, {
		map: KQ.Game.instance.map,
		maps: KQ.MAPS
	});
}

function broadcastNames() {
	var names = {};
	KQ.Game.instance.users.forEach(u => {
		if(u.toonId && u.name) names[u.toonId] = u.name;
	});
	io.sockets.emit(KQ.CONST.NAME_UPDATE, {names: names});
}

/**
 * A user id that is actually one user.
 *
 * This was Date.now(), which is only unique if no two people ever connect in
 * the same millisecond. Ten laptops opening the same join link do exactly
 * that, and the disconnect handler below identifies the leaver by this value,
 * so a collision there unseats somebody else: their bee stops answering while
 * their screen carries on showing a live match, which reads as the game
 * having crashed on them alone.
 *
 * The counter is what makes it unique; the timestamp stays only because these
 * show up in logs and a bare 7 says less than the time it happened.
 */
var userSeq = 0;
function nextUserId() {
	return Date.now() + "-" + (++userSeq);
}

io.sockets.on("connection", socket => {
	var user = {};
	user.id = nextUserId();
	user.keys = [];
	user.socket = socket;
	socket.user = user;
	KQ.Game.instance.users.push(user);
	user.toString = function() {
		var toonId = "";
		if(this.toonId) toonId = this.toonId;
		return this.id + ", " + toonId;
	}
	if(KQ.Game.instance.noUsersResetDelayTimeoutID) clearTimeout(KQ.Game.instance.noUsersResetDelayTimeoutID);

	KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.MENU_UPDATE));
	socket.emit(KQ.CONST.MAP_UPDATE, {map: KQ.Game.instance.map, maps: KQ.MAPS});

	/**
	 * Named and kept, because it has to come back off again on disconnect.
	 *
	 * This was an inline arrow with no reference held anywhere, so every
	 * socket that ever connected left one behind: the count only ever went up,
	 * for the life of the process, and every one of them ran on every reset
	 * writing to a user object nobody was using any more. addEventListener
	 * re-sorts the whole array on each add, so the cost of connecting grew
	 * with the number of people who had already left.
	 */
	function clearToonOnReset() {
		user.toonId = null;
	}
	KQ.Game.instance.addEventListener(KQ.CONST.GAME_RESET, clearToonOnReset);

	socket.on(KQ.CONST.USER_CHARACTER_SELECT, data => {
		if(!data) return;

		// The page only ever sends an id it read off the menu, but the page is
		// not the only thing that can send one, and a toonId with no toon
		// behind it is worse than it looks: the select succeeds, and then
		// Game.loop looks it up every tick, gets undefined, and throws on the
		// first key this player presses -- forever, into a caught-and-logged
		// warning nobody is reading.
		if(!KQ.Game.instance.virtual.level.toons[data.toonId]) return;

		// make sure character isn't already taken
		var taken = false;
		KQ.Game.instance.users.forEach(u => {
			if(u.toonId == data.toonId) {
				socket.emit(KQ.CONST.ALERT, {text:"This character is already taken"});
				taken = true;
			}
		});
		if(taken) return;

		user.ready = false;
		user.toonId = data.toonId;
		user.name = cleanName(data.name);

		KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.MENU_UPDATE));
		broadcastNames();
	});

	socket.on(KQ.CONST.USER_READY, data => {
		if(!data) return;
		user.ready = data.ready;

		if(user.ready) {
			var e = new KQ.Event(KQ.CONST.USER_READY);
			e.extra = {user:user};
			KQ.Game.instance.dispatchEvent(e);

			if(KQ.Game.instance.gameInProgress) {
				// quick join, send only to this user -jkr
				user.socket.emit(KQ.CONST.GAME_START);
				return;
			}

			// if we're here then no game is in progress -jkr
			var gameReady = KQ.Game.readyToStart(KQ.Game.instance.users);

			// once every player is ready, start the countdown -jkr
			if(gameReady) {
				KQ.Game.instance.countDownStartTime = Date.now();
				KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.GAME_COUNTDOWN));
			}
		}
	})

	socket.on(KQ.CONST.USER_MAP_SELECT, data => {
		if(!data) return;
		if(!KQ.MAPS[data.map]) return;
		if(data.map == KQ.Game.instance.map) return;

		// Swapping the board out from under a running match would strand
		// everyone mid-air, so this is a lobby-only change.
		if(KQ.Game.instance.gameInProgress) {
			socket.emit(KQ.CONST.ALERT, {text:"Finish the round before changing the map"});
			return;
		}

		// Nulled as well as cleared: the countdown gate reads this to decide
		// whether one is already running, and a stale id would refuse every
		// countdown from here on.
		clearTimeout(KQ.Game.instance.countdownTimer);
		KQ.Game.instance.countdownTimer = null;

		KQ.Game.instance.releaseLevel();
		KQ.Game.instance.loadLevel(data.map).then(() => {
			// Everyone un-readies: you agreed to play the old board.
			KQ.Game.instance.users.forEach(u => u.ready = false);

			broadcastMap();
			KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.MENU_UPDATE));
		}).catch(e => {
			console.warn(e);
			socket.emit(KQ.CONST.ALERT, {text:"That map failed to load"});
		});
	});

	socket.on(KQ.CONST.USER_NAME, data => {
		if(!data) return;
		if(!user.toonId) return;
		user.name = cleanName(data.name);
		broadcastNames();
	});

	socket.on(KQ.CONST.KEY_UPDATE, data => {
		// An array of key names is the only thing loop() can walk. Anything
		// else lands in user.keys and throws on every tick from then on, into
		// the try/catch that logs it and moves on -- so the player's inputs
		// are silently dead and the console fills up at 60Hz.
		if(!Array.isArray(data)) return;
		user.keys = data;

		// Relay for the keystroke HUD. Sent back to this socket only: the
		// overlay shows you your own inputs, and broadcasting everyone's would
		// put the other hive's timing on your screen.
		//
		// Sent from here rather than the game loop because loop() splices
		// ArrowUp back out to stop players holding jump, so by then user.keys
		// no longer says what is actually being pressed.
		if(user.toonId)
			socket.emit(KQ.CONST.KEY_STATE, {toonId: user.toonId, keys: data});
	});

	socket.on('disconnect', data => {
		// socket.broadcast.emit(COMMAND.GOODBYE, user);
		var e = new KQ.Event(KQ.CONST.USER_DISCONNECT);
		e.extra = {user:user};
		KQ.Game.instance.dispatchEvent(e);


		user.toonId = undefined;

		// By identity, not by id. Matching on the id searched from the front
		// and removed every hit without stopping, so the socket that left took
		// the first user carrying its id with it -- and mutating the array
		// under a for-in meant which ones went depended on where they sat.
		// indexOf finds this user and nobody else, whatever the id says.
		var at = KQ.Game.instance.users.indexOf(user);
		if(at >= 0) KQ.Game.instance.users.splice(at, 1);

		KQ.Game.instance.removeEventListener(KQ.CONST.GAME_RESET, clearToonOnReset);

		console.log("DISCONNECT", KQ.Game.instance.users.length);

		broadcastNames();

		if(KQ.Game.instance.users.length) {
			KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.MENU_UPDATE));

			/**
			 * The tab that just closed may have been the only one the lobby
			 * was still waiting on. Nobody is left to touch that ready flag,
			 * so the gate has to run again here -- otherwise everyone who is
			 * already readied sits on the menu until one of them toggles
			 * ready off and on to retrigger it.
			 */
			if(!KQ.Game.instance.gameInProgress &&
					KQ.Game.readyToStart(KQ.Game.instance.users)) {
				KQ.Game.instance.countDownStartTime = Date.now();
				KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.GAME_COUNTDOWN));
			}
		}
		else {
			KQ.Game.instance.noUsersResetDelayTimeoutID = setTimeout(() => {
				KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.GAME_RESET));
			}, KQ.CONST.GAME_NO_USERS_RESET_DELAY);
		}
			
	});
});

new KQ.Game(); // singleton
KQ.Game.instance.loadLevel(KQ.DEFAULT_MAP).catch(e => console.warn(e));

// Registered down here because Game.instance does not exist any earlier.
KQ.Game.instance.addEventListener(KQ.CONST.GAME_START, () => broadcastNames());

console.log('server started');

process.on('unhandledRejection', (reason, p) => {
    console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
    // application specific logging, throwing an error, or other logic here
});