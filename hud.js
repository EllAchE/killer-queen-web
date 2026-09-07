/**
 * Player name tags, a keystroke overlay, and the settings that turn them on
 * and off. All of it is presentation: nothing here talks back to the server,
 * so a setting can never change what happens in the match.
 *
 * Two coordinate spaces are in play. Name tags belong to the play field, so
 * they live inside #level and are positioned in level pixels. The keystroke
 * panel is a screen-space overlay outside #game, so it stays legible whatever
 * scale kqxFit() picked for the window.
 */
"use strict";

(function() {
	var STORE_KEY = "kqx.hud";
	var NAME_MAX = 12;

	var DEFAULTS = {
		names: true,
		keys: true,
		keysCorner: "bl",     // tl | tr | bl | br
		opacity: 0.55
	};

	var settings = load();
	var names = {};           // toonId -> name
	var keys = {};            // toonId -> array of key names
	var tags = {};            // toonId -> the tag element
	var layer = null;         // name tag layer, inside #level
	var panel = null;         // keystroke overlay, outside #game
	var myToonId = null;

	function load() {
		var s = {};
		for(var k in DEFAULTS) s[k] = DEFAULTS[k];
		try {
			var raw = window.localStorage.getItem(STORE_KEY);
			if(raw) {
				var got = JSON.parse(raw);
				for(var k2 in DEFAULTS) if(got[k2] !== undefined) s[k2] = got[k2];
			}
		} catch(e) {
			// private windows and blocked site data both throw on read
		}
		return s;
	}

	function save() {
		try {
			window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
		} catch(e) {}
	}

	/**
	 * The level markup is parsed on the server to build the map, so the tag
	 * layer is created here at runtime instead: a div added to index.html
	 * would be handed to loadLevel as another level object.
	 */
	function ensureLayer() {
		if(layer && layer.parentNode) return layer;

		var level = document.getElementById("level");
		if(!level) return null;

		layer = document.createElement("div");
		layer.id = "kqx-nametags";
		level.appendChild(layer);
		return layer;
	}

	function ensurePanel() {
		if(panel && panel.parentNode) return panel;
		// This script is in <head>, so the body does not exist on first call.
		if(!document.body) return null;

		panel = document.createElement("div");
		panel.id = "kqx-keys";
		document.body.appendChild(panel);
		return panel;
	}

	function teamOf(toonId) {
		return (toonId.indexOf("teamGold") === 0) ? "gold" : "blue";
	}

	// The arrow keys are the whole control scheme; anything else a player leans
	// on (r to respawn) is shown as its own bare character.
	var GLYPH = {
		ArrowUp: "↑",
		ArrowDown: "↓",
		ArrowLeft: "←",
		ArrowRight: "→"
	};
	var ORDER = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];

	function glyphsFor(held) {
		var out = [];
		ORDER.forEach(function(k) {
			out.push({g: GLYPH[k], on: held.indexOf(k) > -1});
		});
		held.forEach(function(k) {
			if(!GLYPH[k] && k.length === 1) out.push({g: k.toUpperCase(), on: true});
		});
		return out;
	}

	function renderPanel() {
		var p = ensurePanel();
		if(!p) return;

		p.className = "kqx-corner-" + settings.keysCorner;
		p.style.opacity = settings.opacity;

		if(!settings.keys) {
			p.classList.add("kqx-off");
			return;
		}
		p.classList.remove("kqx-off");

		// Only ever your own row. What the other hive is pressing is theirs,
		// and reading it off the screen would be cheating, not a HUD.
		var ids = myToonId ? [myToonId] : [];

		var html = "";
		ids.forEach(function(id) {
			var held = keys[id] || [];
			var label = names[id] || shortId(id);
			html += '<div class="kqx-keyrow kqx-' + teamOf(id) + '">';
			html += '<span class="kqx-keyname">' + escapeHtml(label) + "</span>";
			glyphsFor(held).forEach(function(k) {
				html += '<span class="kqx-key' + (k.on ? " kqx-down" : "") + '">' + escapeHtml(k.g) + "</span>";
			});
			html += "</div>";
		});

		if(!html) html = '<div class="kqx-keyrow kqx-empty">no keys yet</div>';
		p.innerHTML = html;
	}

	function shortId(toonId) {
		// teamBlue-worker0 -> W1, teamGold-queen -> Q
		if(toonId.indexOf("queen") > -1) return "Q";
		var m = toonId.match(/worker(\d+)/);
		return m ? "W" + (Number(m[1]) + 1) : toonId;
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function renderTags() {
		var l = ensureLayer();
		if(!l) return;

		l.classList.toggle("kqx-off", !settings.names);
		if(!settings.names) return;

		Object.keys(names).forEach(function(toonId) {
			var toon = document.getElementById(toonId);
			if(!toon) return;

			var tag = tags[toonId];
			if(!tag || !tag.parentNode) {
				tag = document.createElement("div");
				tag.className = "kqx-tag kqx-" + teamOf(toonId);
				tags[toonId] = tag;
				l.appendChild(tag);
			}
			if(tag.textContent !== names[toonId]) tag.textContent = names[toonId];

			// The tag is a sibling of the toon, not a child: .toon carries the
			// composed transform from motion.js, so a child would lean, squash
			// and mirror along with the bee.
			var left = parseFloat(toon.style.left) || 0;
			var top = parseFloat(toon.style.top) || 0;
			tag.style.left = (left + toon.offsetWidth / 2) + "px";
			tag.style.top = (top - 10) + "px";
			tag.classList.toggle("kqx-hidden", toon.classList.contains("hide"));
		});

		Object.keys(tags).forEach(function(toonId) {
			if(names[toonId] === undefined && tags[toonId].parentNode) {
				tags[toonId].parentNode.removeChild(tags[toonId]);
				delete tags[toonId];
			}
		});
	}

	function frame() {
		renderTags();
		window.requestAnimationFrame(frame);
	}

	// ---- settings panel ----

	function buildSettings() {
		var d = document.createElement("div");
		d.id = "kqx-settings";
		d.className = "kqx-off";
		d.innerHTML =
			'<div class="kqx-panel">' +
				'<button class="kqx-close" type="button" data-kqx="close">Close &middot; Esc</button>' +
				"<h1>Settings</h1>" +
				'<label class="kqx-row"><input type="checkbox" data-kqx="names"> Show player names over characters</label>' +
				'<label class="kqx-row"><input type="checkbox" data-kqx="keys"> Show a keystroke overlay</label>' +
				'<label class="kqx-row">Overlay corner ' +
					'<select data-kqx="keysCorner">' +
						'<option value="bl">bottom left</option>' +
						'<option value="br">bottom right</option>' +
						'<option value="tl">top left</option>' +
						'<option value="tr">top right</option>' +
					"</select></label>" +
				'<label class="kqx-row">Overlay opacity ' +
					'<input type="range" min="0.15" max="1" step="0.05" data-kqx="opacity"></label>' +
				'<p class="kqx-foot">Saved in this browser only. None of it changes the match.</p>' +
			"</div>";
		document.body.appendChild(d);

		d.addEventListener("change", function(e) {
			var key = e.target.getAttribute("data-kqx");
			if(!key) return;
			if(e.target.type === "checkbox") settings[key] = e.target.checked;
			else if(e.target.type === "range") settings[key] = Number(e.target.value);
			else settings[key] = e.target.value;
			save();
			renderPanel();
			renderTags();
		});
		d.addEventListener("click", function(e) {
			if(e.target.getAttribute("data-kqx") === "close") window.kqxSettings(false);
		});
		return d;
	}

	function syncSettingsInputs(d) {
		Object.keys(DEFAULTS).forEach(function(key) {
			var el = d.querySelector('[data-kqx="' + key + '"]');
			if(!el) return;
			if(el.type === "checkbox") el.checked = !!settings[key];
			else el.value = settings[key];
		});
	}

	var settingsEl = null;
	window.kqxSettingsOpen = false;
	window.kqxSettings = function(show) {
		if(!settingsEl) settingsEl = buildSettings();
		window.kqxSettingsOpen = !!show;
		if(show) {
			syncSettingsInputs(settingsEl);
			settingsEl.classList.remove("kqx-off");
			// A held arrow key would keep the toon walking behind the panel.
			if(window.kqxClearKeys) window.kqxClearKeys();
		} else {
			settingsEl.classList.add("kqx-off");
		}
	};

	document.addEventListener("keydown", function(e) {
		if(e.key === "Escape") window.kqxSettings(false);
	});

	// ---- what site.js feeds in ----

	window.kqxHud = {
		nameMax: NAME_MAX,
		setNames: function(map) {
			names = map || {};
			renderPanel();
			renderTags();
		},
		setKeys: function(toonId, held) {
			if(!toonId) return;
			keys[toonId] = held || [];
			renderPanel();
		},
		setMyToon: function(toonId) {
			myToonId = toonId;
			renderPanel();
		}
	};

	document.addEventListener("DOMContentLoaded", function() {
		renderPanel();
		window.requestAnimationFrame(frame);
	});
})();
