"use strict";

String.prototype.s2n = function() {
  try {
    // sanity check
    if(typeof(this) == "number") return this;

    let m = this.match(/\d+/);
    return Number(m[0]);
  } catch(e) {
    console.log(e);
    return null;
  }
}
String.prototype.n2s = Number.prototype.n2s = function() {
  try {
    return this.toString().replace("px", "") + "px";
  } catch(e) {
    console.log(e);
  }
}

window.onload = function() {
	const CONST = {
    ALERT:"alert",
    KEY_UPDATE:"key_update",
    KEY_STATE:"key_state",
    SFX:"sfx",
    NAME_UPDATE:"name_update",
    USER_NAME:"user_name",
    VIRTUAL_UPDATE:"virtual_update",
    USER_CHARACTER_SELECT:"USER_CHARACTER_SELECT",
    USER_READY:"user_ready",
    USER_DISCONNECT:"user_disconnect",
    USER_QUIT:"user_quit",
    TEAM_BLUE:"teamBlue",
    TEAM_GOLD:"teamGold",
    TOON_QUEEN:"queen",
    TOON_WORKER:"worker",
    GAME_OVER:"game_over",
    GAME_COUNTDOWN:"game_countdown",
    GAME_START:"game_start",
    GAME_WIN:"game_win",
    WIN_ECONOMIC:"win_economic",
    WIN_MILITARY:"win_military",
    WIN_SNAIL:"win_snail",
    DIRECTION_RIGHT:"direction-right",
    DIRECTION_LEFT:"direction-left",
    DIRECTION_DOWN:"direction-down",
    MENU_UPDATE:"menu_update",
    MAP_UPDATE:"map_update",
    USER_MAP_SELECT:"user_map_select",
    KEY_UP:"ArrowUp",
    KEY_DOWN:"ArrowDown",
    KEY_LEFT:"ArrowLeft",
    KEY_RIGHT:"ArrowRight",
    GAME_RESET: "game_reset",

    // front end only
    GAME_DISPLAY_WIN_DELAY: 1.5 * 1000,
	}

	var game = {
		characterSelected:null
	};

  var socket = io();

  socket.on(CONST.GAME_WIN, data => {
  	// alert("GAME OVER: " + data.type + " " + data.team)

    let d = CONST.GAME_DISPLAY_WIN_DELAY;

    // The match music stops on the win itself rather than on the screen a
    // second and a half later, so the win jingle the server just fired plays
    // into a gap instead of over a level loop.
    if(window.kqxAudio) window.kqxAudio.scene(null);

    // delay before showing the game over screen
    window.setTimeout(() => {
      let div = document.getElementById("game-over");
      div.classList.remove("hide");

      // Up with the screen, which is what the ending theme is scored for.
      if(window.kqxAudio) window.kqxAudio.scene("victory");

      document.getElementById("win-text").innerHTML = window.kqxWinText(data);

      div = document.getElementById("win-mask");

      // position circle mask effect

      // getting :before info isn't working ??? -jkr
      let pe = window.getComputedStyle(div, ":before");
      // let top = data.focus.top - pe.height.s2n() / 2;
      // let left = data.focus.left - pe.width.s2n() / 2;

      let top = data.focus.top - 50;
      let left = data.focus.left - 50;

      div.style.top = top + "px";
      div.style.left = left + "px";
    }, d);
  });

  socket.on(CONST.GAME_COUNTDOWN, data => {
  	var ele = document.getElementById("countdown");
  	ele.classList.remove("hide");

  	ele.innerHTML = data.time;
  });

  socket.on(CONST.GAME_RESET, data => {
  	console.log("!! GAME RESET")

  	if(window.kqxAudio) window.kqxAudio.scene("lobby");

  	document.getElementById('menu').classList.remove("hide");
    document.getElementById('game-over').classList.add("hide");
  });

  socket.on(CONST.GAME_START, data => {
  	if(window.kqxAudio) window.kqxAudio.scene("match");

  	document.getElementById('game-over').classList.add("hide");
  	var list = document.getElementsByTagName("li");
  	for(var i in list) {
  		var li = list[+i];
  		if(li) li.classList.remove('selected');
  	}
  	document.getElementById('player-ready').classList.remove('selected');
  	document.getElementById('countdown').classList.add('hide');
  	document.getElementById('menu').classList.add('hide');
  });

  socket.on(CONST.VIRTUAL_UPDATE, data => {
  	// try {
  		data.forEach(o => {
		  	var ele = document.getElementById(o.id);
		  	if(ele) {
					ele.style.left = o.left;
					ele.style.top = o.top;

					ele.classList.remove('direction-left');
					ele.classList.remove('direction-right');
					ele.classList.remove('direction-down');
					ele.classList.add(o.direction);

					if(o.warrior == true) ele.classList.add("warrior");
					else ele.classList.remove("warrior");

					if(o.Invulnerable == true) ele.classList.add("invulnerable");
					else ele.classList.remove("invulnerable");

					if(o.attacking > 0) ele.classList.add("attacking");
					else ele.classList.remove("attacking");

					if(o.speedUpgrade > 0) ele.classList.add("speed-upgrade");
					else ele.classList.remove("speed-upgrade");

					if(window.kqxMotion) window.kqxMotion.observe(o, ele);

					if(o.id.indexOf("shrine") > -1) {
						if(o.affiliation == CONST.TEAM_BLUE) ele.classList.add("blue");
						else ele.classList.remove("blue");

						if(o.affiliation == CONST.TEAM_GOLD) ele.classList.add("gold");
						else ele.classList.remove("gold");

						console.log(o.affiliation);
					}
				}
  		});
		// } catch(e) {
		// 	// it's time to shut it down (potential hack?)
		// 	console.warn(e);
		// }
  });

  socket.on(CONST.MENU_UPDATE, data => {
  	var list = document.getElementById("menu").getElementsByTagName("li");
  	for(var i in list) {
  		var li = list[+i];
  		if(li) li.classList.remove("taken");
  	}

  	data.users.forEach(user => {
  		var li = document.getElementById("menu-" + user.toonId);
  		if(li) li.classList.add("taken");
  	});

  	// if(!data.gameInProgress) {
  		document.getElementById('menu').classList.remove("hide");
  	// }
  });

  /**
   * The board is markup, so switching maps is a fetch and an innerHTML: the
   * server has already parsed the same file to build the objects it will send
   * updates for. Anything the client hung inside #level (name tags) goes with
   * it and is rebuilt on the next frame.
   */
  socket.on(CONST.MAP_UPDATE, data => {
  	buildMapPicker(data.maps, data.map);

  	if(game.mapLoaded == data.map) return;

  	fetch("maps/" + encodeURIComponent(data.map) + ".html").then(r => {
  		if(!r.ok) throw new Error(r.status);
  		return r.text();
  	}).then(html => {
  		var level = document.getElementById("level");
  		level.innerHTML = html;
  		// The day board has a painted backdrop drawn for its exact platforms;
  		// the others get their own in style.css.
  		level.className = "level-" + data.map;
  		game.mapLoaded = data.map;
  		kqxFit();
  	}).catch(e => console.warn("map load failed", e));
  });

  function buildMapPicker(maps, current) {
  	var sel = document.getElementById("kqx-map");
  	if(!sel || !maps) return;

  	// Rebuilt rather than patched: another player may have changed it, and the
  	// list is four options.
  	sel.innerHTML = "";
  	Object.keys(maps).forEach(name => {
  		var o = document.createElement("option");
  		o.value = name;
  		o.textContent = maps[name].label;
  		o.selected = (name == current);
  		sel.appendChild(o);
  	});

  	var blurb = document.getElementById("kqx-map-blurb");
  	if(blurb) blurb.textContent = maps[current] ? maps[current].blurb : "";
  }

  window.kqxMapChanged = () => {
  	var sel = document.getElementById("kqx-map");
  	if(sel) socket.emit(CONST.USER_MAP_SELECT, {map: sel.value});
  };

  socket.on(CONST.ALERT, (data) => {
  	window.alert(data.text);
  })

  socket.on(CONST.NAME_UPDATE, data => {
  	if(window.kqxHud) window.kqxHud.setNames(data.names);
  });

  socket.on(CONST.KEY_STATE, data => {
  	if(window.kqxHud) window.kqxHud.setKeys(data.toonId, data.keys);
  });

  /**
   * Sound cues. These have to come over the wire because VIRTUAL_UPDATE is
   * only positions and flags -- from here a berry landing in a slot and a
   * berry carried past one look identical.
   */
  socket.on(CONST.SFX, data => {
  	if(window.kqxAudio && data) window.kqxAudio.cue(data.cue);
  });

  var keys = [];

  // The HUD is told locally as well as through the server so your own row
  // reacts on the keypress rather than after a round trip.
  var pushKeys = () => {
  	socket.emit(CONST.KEY_UPDATE, keys);
  	if(window.kqxHud) window.kqxHud.setKeys(game.characterSelected, keys.slice(0));
  }
  var keyDown = key => {
  	if(keys.indexOf(key) < 0) {
	  	keys.push(key);
	  	pushKeys();
	  }
  }
  var keyUp = key => {
  	var xo = keys.indexOf(key);
  	if(xo > -1) {
  		keys.splice(xo, 1);
  		pushKeys();
  	}
  }
  window.kqxClearKeys = () => {
  	keys.length = 0;
  	pushKeys();
  }
  window.addEventListener("keydown", function(event) {
  	if(window.kqxHelpOpen || window.kqxSettingsOpen) return;
  	keyDown(event.key);
  });
  window.addEventListener("keyup", function(event) {
  	keyUp(event.key);
  });

  window.addEventListener("touchstart", function(event) {
  	keyDown(CONST.KEY_UP);
  });
  window.addEventListener("touchend", function(event) {
  	keyUp(CONST.KEY_UP);
  });

  window.addEventListener("deviceorientation", function(event) {
  	if(!event.beta) return;

  	if(event.beta < 5) {
  		keyUp(CONST.KEY_RIGHT);
  		keyDown(CONST.KEY_LEFT);
  	}
  	if(event.beta > 5) {
  		keyUp(CONST.KEY_LEFT);
  		keyDown(CONST.KEY_RIGHT);
  	}
  });

  // mobile disable scrolling
  document.ontouchmove = function(event){
    event.preventDefault();
	}
	// "force" landscape
	document.addEventListener("orientationchange", function(event) {
    switch(window.orientation) 
    {  
        case -90: case 90:
            /* Device is in landscape mode */
            break; 
        default:
            /* Device is in portrait mode */
    }
	});

	window.characterSelected = (ele, id) => {
		game.characterSelected = id;

		var list = document.getElementById("menu").getElementsByTagName('li');
		for(var i in list) {
			var li = list[+i];
			if(li) li.classList.remove("selected");
		}
		ele.classList.add("selected");

		document.getElementById("player-ready").disabled = false;
		document.getElementById("player-ready").classList.remove("selected");

		var leave = document.getElementById("player-leave");
		if(leave) leave.disabled = false;

		var input = document.getElementById("kqx-name");
		socket.emit(CONST.USER_CHARACTER_SELECT, {
			toonId: id,
			name: input ? input.value : ""
		});
		if(window.kqxHud) window.kqxHud.setMyToon(id);
	}

	// Its own event rather than re-sending the selection: the server's
	// already-taken check compares against every user including you, so
	// re-picking your own character would be refused.
	window.kqxNameChanged = () => {
		if(!game.characterSelected) return;
		var input = document.getElementById("kqx-name");
		socket.emit(CONST.USER_NAME, {name: input ? input.value : ""});
	}

	window.playerReady = () => {
		var ele = document.getElementById("player-ready");
		ele.classList.add("selected");

		socket.emit(CONST.USER_READY, {
			ready:ele.classList.contains("selected")
		});


	}

	// The in-match Quit tab is painted before this runs, so the global stub
	// below forwards here once the socket exists.
	window.kqxQuitImpl = () => {
		if(!game.characterSelected) return;

		socket.emit(CONST.USER_QUIT, {});
		game.characterSelected = null;

		var list = document.getElementById("menu").getElementsByTagName("li");
		for(var i in list) {
			var li = list[+i];
			if(li) li.classList.remove("selected");
		}

		var ready = document.getElementById("player-ready");
		ready.classList.remove("selected");
		ready.disabled = true;

		var leave = document.getElementById("player-leave");
		if(leave) leave.disabled = true;

		if(window.kqxHud) window.kqxHud.setMyToon(null);
		window.kqxClearKeys();

		// Back to the menu from the lobby or mid-match alike. A re-pick and
		// Ready quick-joins a round that is still running.
		document.getElementById("menu").classList.remove("hide");
	}
}
/**
 * The play field is a fixed 800x600 box (game.js hard-codes those bounds), so
 * fitting the window is a pure presentation scale: pick the largest whole-box
 * scale the viewport allows and centre it. No game coordinate changes.
 */
function kqxFit() {
	var g = document.getElementById("game");
	if(!g) return;

	var s = Math.min(window.innerWidth / 800, window.innerHeight / 600);
	var x = Math.round((window.innerWidth - 800 * s) / 2);
	var y = Math.round((window.innerHeight - 600 * s) / 2);

	g.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")";
}
window.addEventListener("resize", kqxFit);
window.addEventListener("orientationchange", kqxFit);
document.addEventListener("DOMContentLoaded", kqxFit);
window.addEventListener("load", kqxFit);

window.kqxHelpOpen = false;
// The in-match Quit tab is painted before window.onload runs, so this stub
// exists from first paint and forwards once the socket is up. A click before
// then is a no-op rather than a ReferenceError.
window.playerQuit = function() { if(window.kqxQuitImpl) window.kqxQuitImpl(); };
window.kqxHelp = function(show) {
	var d = document.getElementById("kqx-help");
	if(!d) return;

	window.kqxHelpOpen = !!show;
	if(show) {
		d.classList.remove("kqx-off");
		if(window.kqxClearKeys) window.kqxClearKeys();
	} else {
		d.classList.add("kqx-off");
	}
}
document.addEventListener("keydown", function(event) {
	if(event.key == "Escape") window.kqxHelp(false);
	else if(event.key == "?" || event.key == "h" || event.key == "H")
		window.kqxHelp(!window.kqxHelpOpen);
});

window.kqxWinText = function(data) {
	var hive = (data.team == "teamBlue") ? "BLUE HIVE" : "GOLD HIVE";
	var how = {
		win_economic: "ECONOMIC VICTORY",
		win_military: "MILITARY VICTORY",
		win_snail: "SNAIL VICTORY"
	}[data.type] || "VICTORY";

	return hive + " WINS &mdash; " + how;
}
