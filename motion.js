"use strict";

/**
 * Motion animation for the toons.
 *
 * The server sends nothing but a position and a facing, so everything here is
 * derived from that stream and stays on the client: none of it can change what
 * the authoritative loop decides, and a client that never loads this file
 * plays exactly the same match.
 *
 * Server units are pixels per 60Hz tick, which is where the speeds below come
 * from: a worker walks at 2, a warrior at 3, a super warrior at 4, terminal
 * fall is 4, and a queen's flap starts at -5.
 */
(function() {

var WALK_SPEED = 120;			// px/s, CONST.WORKER_SPEED at 60Hz
var TRAIL_MIN_SPEED = 170;		// a plain walk leaves nothing behind
var TRAIL_FULL_SPEED = 320;		// a flap or a dive is a full-strength streak
var RISING_SPEED = 70;			// upward px/s that counts as a wingbeat
var LANDING_SPEED = 150;		// downward px/s that earns a squash on arrival

var FLAP_DURATION = 280;		// ms, one wingbeat
var FLAP_UPSTROKE = 0.45;		// the surge is the front of the beat
var SQUASH_DURATION = 170;		// ms, the landing compress-and-recover

var TRAIL_INTERVAL = 32;		// ms between afterimages
var TRAIL_LIFETIME = 260;		// ms, matches the fade in style.css
var TRAIL_MAX_ALPHA = 0.5;
var TRAIL_MAX_GHOSTS = 60;

// A respawn parks a toon offscreen and a run off the edge wraps it to the far
// side. Both look like enormous speed, so anything past this in one update is
// a teleport: no trail, no lean, just pick the state back up where it landed.
var TELEPORT_JUMP = 60;

// Updates are only sent for objects that actually moved, so a toon that stops
// goes quiet instead of reporting a stop. Speed has to expire on its own.
var STALE_AFTER = 60;			// ms of silence that means "standing still"

var state = {};
var ghosts = 0;
var lastFrame = 0;

function clamp(v, lo, hi) {
	return v < lo ? lo : (v > hi ? hi : v);
}

function toonState(id) {
	if(!state[id]) {
		state[id] = {
			left: null, top: null, at: 0,
			vx: 0, vy: 0,
			flapUntil: 0, squashUntil: 0,
			wasRising: false, wasFalling: false,
			runPhase: 0, lastGhost: 0,
			ele: null, direction: null
		};
	}

	return state[id];
}

/**
 * Called for every toon in every server update. Differencing consecutive
 * positions is the only source of velocity available to a client.
 */
function observe(o, ele) {
	if(!ele || !ele.classList.contains("toon")) return;

	var s = toonState(o.id);
	var now = performance.now();

	s.ele = ele;
	s.direction = o.direction;

	if(s.left !== null) {
		var dx = o.left - s.left;
		var dy = o.top - s.top;
		var dt = now - s.at;

		if(Math.abs(dx) > TELEPORT_JUMP || Math.abs(dy) > TELEPORT_JUMP) {
			s.vx = s.vy = 0;
			s.wasRising = s.wasFalling = false;
		} else if(dt > 0) {
			// Smoothed so a single 1px tick doesn't read as a speed change.
			s.vx += ((dx / dt) * 1000 - s.vx) * 0.35;
			s.vy += ((dy / dt) * 1000 - s.vy) * 0.35;
		}
	}

	s.left = o.left;
	s.top = o.top;
	s.at = now;
}

/**
 * An afterimage of the toon exactly as it looks right now: same pose, same
 * facing, same team tint, left behind and faded out by style.css.
 */
function dropGhost(s, now, strength) {
	var level = document.getElementById("level");
	if(!level || ghosts >= TRAIL_MAX_GHOSTS) return;

	var cs = getComputedStyle(s.ele);
	var g = document.createElement("div");

	g.className = "kqx-ghost";
	g.style.left = s.left + "px";
	g.style.top = s.top + "px";
	g.style.width = cs.width;
	g.style.height = cs.height;
	g.style.backgroundImage = cs.backgroundImage;
	g.style.backgroundSize = cs.backgroundSize;
	// The team tint is a filter on the live element, so copy it rather than
	// re-deriving which hive this toon belongs to.
	g.style.filter = cs.filter;
	g.style.transform = s.ele.style.transform || cs.transform;
	g.style.opacity = TRAIL_MAX_ALPHA * strength;

	level.appendChild(g);
	ghosts++;

	setTimeout(function() {
		if(g.parentNode) g.parentNode.removeChild(g);
		ghosts--;
	}, TRAIL_LIFETIME + 50);
}

function animate(s, now, dt) {
	if(!s.ele) return;

	if(now - s.at > STALE_AFTER) {
		s.vx *= 0.82;
		s.vy *= 0.82;
	}

	var speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
	var rising = s.vy < -RISING_SPEED;
	var diving = s.direction === "direction-down";
	var airborne = Math.abs(s.vy) > 30;

	// A wingbeat starts on the edge into rising, so holding altitude beats
	// steadily instead of locking the body into one stretched pose.
	if(rising && !s.wasRising) s.flapUntil = now + FLAP_DURATION;
	// Landing is the edge out of a real fall, which is what earns the squash.
	if(s.wasFalling && s.vy < 40) s.squashUntil = now + SQUASH_DURATION;

	s.wasRising = rising;
	s.wasFalling = s.vy > LANDING_SPEED;

	var sx = 1, sy = 1, ty = 0;
	// Lean into the direction of travel; a dive is already a nose-down pose.
	var rot = diving ? 0 : clamp(s.vx / 300, -1, 1) * 9;

	if(!airborne && Math.abs(s.vx) > 20) {
		// No walk frames exist in the art, so the run reads as a bob whose
		// rate follows the speed the toon is actually managing.
		var cyclesPerSecond = clamp(2.2 * (Math.abs(s.vx) / WALK_SPEED), 1.5, 6);
		s.runPhase = (s.runPhase + cyclesPerSecond * dt / 1000) % 1;

		var bob = Math.sin(s.runPhase * Math.PI * 2);
		ty += bob * 1.6;
		sy += bob * 0.04;
		sx -= bob * 0.04;
	} else {
		s.runPhase = 0;
	}

	if(now < s.flapUntil) {
		var beat = 1 - (s.flapUntil - now) / FLAP_DURATION;

		if(beat < FLAP_UPSTROKE) {
			// The downstroke: the body surges up and narrows.
			var push = beat / FLAP_UPSTROKE;
			sy += 0.16 * push;
			sx -= 0.09 * push;
			ty -= 2.0 * push;
		} else {
			// The glide back out of it.
			var ease = 1 - (beat - FLAP_UPSTROKE) / (1 - FLAP_UPSTROKE);
			sy += 0.16 * ease;
			sx -= 0.09 * ease;
			ty -= 2.0 * ease;
		}
	} else if(diving) {
		sy += 0.18;
		sx -= 0.12;
	} else if(airborne && s.vy > 0) {
		// Sinking between beats: tipped forward, slightly flattened.
		var sink = clamp(s.vy / 240, 0, 1);
		sy -= 0.04 * sink;
		sx += 0.04 * sink;
		rot += (s.vx < 0 ? -1 : 1) * 6 * sink;
	}

	if(now < s.squashUntil) {
		var recover = (s.squashUntil - now) / SQUASH_DURATION;
		sy -= 0.22 * recover;
		sx += 0.18 * recover;
	}

	if(speed > TRAIL_MIN_SPEED && now - s.lastGhost > TRAIL_INTERVAL) {
		var strength = clamp((speed - TRAIL_MIN_SPEED) /
			(TRAIL_FULL_SPEED - TRAIL_MIN_SPEED), 0, 1);

		dropGhost(s, now, strength);
		s.lastGhost = now;
	}

	// The facing flip normally comes from the .direction-left rule, but this
	// needs one composed transform, so it is folded in here and the inline
	// style wins over the class. The scale is innermost, so the mirror happens
	// before the rotation and the lean is already in screen space: leaning it
	// by the facing as well would tip a left-running toon backwards.
	var flip = (s.direction === "direction-left") ? -1 : 1;

	s.ele.style.transform = "translate(0px," + ty.toFixed(2) + "px) " +
		"rotate(" + rot.toFixed(2) + "deg) " +
		"scale(" + (sx * flip).toFixed(3) + "," + sy.toFixed(3) + ")";
}

function frame(now) {
	var dt = lastFrame ? Math.min(now - lastFrame, 100) : 16;
	lastFrame = now;

	for(var id in state) animate(state[id], now, dt);

	requestAnimationFrame(frame);
}

window.kqxMotion = {observe: observe};
requestAnimationFrame(frame);

})();
