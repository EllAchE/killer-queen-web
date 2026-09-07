"use strict";

process.on('uncaughtException', e => console.warn(e.stack));
process.on('warning', e => console.warn(e.stack));

const http = require('http');
const fs = require('fs');
global.fs = fs;
const port = process.env.PORT || 3000;
const app = http.createServer(function(req, res) {
	if(!req.url) req.url = "index.html";
	if(req.url == "/") req.url = "/index.html";

	var headers = {'Content-Type': 'text/html'};

	if(req.url.indexOf("css") >= 0)
		headers = {'Content-Type': 'text/css'};
    res.writeHead(200, headers);
    res.end(fs.readFileSync(__dirname + req.url));
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

io.sockets.on("connection", socket => {
	var user = {};
	user.id = Date.now();
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

	KQ.Game.instance.addEventListener(KQ.CONST.GAME_RESET, event => {
		user.toonId = null;
	})

	socket.on(KQ.CONST.USER_CHARACTER_SELECT, data => {
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
		if(!KQ.MAPS[data.map]) return;
		if(data.map == KQ.Game.instance.map) return;

		// Swapping the board out from under a running match would strand
		// everyone mid-air, so this is a lobby-only change.
		if(KQ.Game.instance.gameInProgress) {
			socket.emit(KQ.CONST.ALERT, {text:"Finish the round before changing the map"});
			return;
		}

		clearTimeout(KQ.Game.instance.countdownTimer);
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
		if(!user.toonId) return;
		user.name = cleanName(data.name);
		broadcastNames();
	});

	socket.on(KQ.CONST.KEY_UPDATE, data => {
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

	// todo: check game ready on disconnect (in case users are in lobby and one leaves);
	socket.on('disconnect', data => {
		// socket.broadcast.emit(COMMAND.GOODBYE, user);
		var e = new KQ.Event(KQ.CONST.USER_DISCONNECT);
		e.extra = {user:user};
		KQ.Game.instance.dispatchEvent(e);


		user.toonId = undefined;
		for(var i in KQ.Game.instance.users) {
			var o = KQ.Game.instance.users[i];
			if(o.id == user.id) KQ.Game.instance.users.splice(i, 1);
		};

		console.log("DISCONNECT", KQ.Game.instance.users.length);

		broadcastNames();

		if(KQ.Game.instance.users.length)
			KQ.Game.instance.dispatchEvent(new KQ.Event(KQ.CONST.MENU_UPDATE));
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