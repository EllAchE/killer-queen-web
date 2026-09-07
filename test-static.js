/**
 * The static file handler in app.js. Worth a test of its own because it grew
 * two jobs at once: labelling audio correctly, and refusing to read files
 * outside the repo -- the second being a hole that had been open the whole
 * time, and the kind that reads as fine until someone points a URL at it.
 *
 * Spawns a real server rather than importing, because requiring app.js also
 * constructs the game singleton and binds a port.
 */
"use strict";

const http = require("http");
const { spawn } = require("child_process");

const PORT = 3987;

var failed = 0;
function check(label, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if(!ok) failed++;
	console.log("  " + (ok ? "ok  " : "FAIL") + " " + label +
		(ok ? "" : "   got " + JSON.stringify(got) + ", want " + JSON.stringify(want)));
}

/**
 * path is sent verbatim -- no normalising -- or the traversal cases below
 * would be collapsed to harmless ones before the server ever saw them.
 */
function get(path) {
	return new Promise((resolve, reject) => {
		const req = http.request({host: "127.0.0.1", port: PORT, path: path, method: "GET"}, res => {
			let body = "";
			res.on("data", c => { body += c; });
			res.on("end", () => resolve({
				code: res.statusCode,
				type: (res.headers["content-type"] || "").split(";")[0],
				body: body
			}));
		});
		req.on("error", reject);
		req.end();
	});
}

function waitForServer(tries) {
	return get("/index.html").catch(e => {
		if(tries <= 0) throw e;
		return new Promise(r => setTimeout(r, 100)).then(() => waitForServer(tries - 1));
	});
}

const server = spawn(process.execPath, [__dirname + "/app.js"], {
	env: Object.assign({}, process.env, {PORT: String(PORT)}),
	stdio: "ignore"
});

waitForServer(40).then(async () => {

	console.log("-- content types --");
	check("index.html", (await get("/index.html")).type, "text/html");
	check("/ serves index.html", (await get("/")).type, "text/html");
	check("a script", (await get("/site.js")).type, "text/javascript");
	check("the stylesheet", (await get("/style.css")).type, "text/css");
	check("an image", (await get("/assets/berry.png")).type, "image/png");
	check("a map", (await get("/maps/day.html")).type, "text/html");

	console.log("\n-- audio, which is why this exists --");
	{
		// Written and removed here rather than asserted against a shipped
		// track, so the check still means something if the audio set changes.
		const fs = require("fs");
		const tmp = __dirname + "/kqx-mime-probe.mp3";
		fs.writeFileSync(tmp, "not really an mp3");
		try {
			const r = await get("/kqx-mime-probe.mp3");
			check("an mp3 is labelled audio/mpeg", r.type, "audio/mpeg");
			check("and its body is served intact", r.body, "not really an mp3");
		} finally {
			fs.unlinkSync(tmp);
		}
		check("a missing track 404s rather than throwing",
			(await get("/audio/music/nothing-here.mp3")).code, 404);
	}

	console.log("\n-- the track listing --");
	{
		const fs = require("fs");
		const list = () => get("/audio/tracks.json").then(r => JSON.parse(r.body).tracks);

		let tracks = await list();
		const ids = tracks.map(t => t.id);

		check("the shipped match music is offered", ids.filter(i => /^match-/.test(i)).length > 0, true);

		// These two play on their own cue -- the lobby loop and the ending
		// theme -- so putting them in the picker would just be confusing.
		check("the lobby loop is not in the picker", ids.indexOf("lobby"), -1);
		check("nor is the ending theme", ids.indexOf("victory"), -1);

		const one = tracks.find(t => t.id === "match-1");
		check("a track carries every format it was built in",
			one ? one.srcs.slice().sort() : null,
			["audio/music/match-1.mp3", "audio/music/match-1.ogg"]);
		check("and a label a person would recognise", !!(one && one.label && one.label !== one.id), true);

		// The drop-in slot, which is the whole answer to "can we have Never
		// Gonna Give You Up". A space in the name because that is what a real
		// one looks like, and it has to survive all the way to the client.
		const dir = __dirname + "/audio/music/custom";
		const drop = dir + "/Test Drop In.mp3";
		fs.mkdirSync(dir, {recursive: true});
		fs.writeFileSync(drop, "not really an mp3");
		try {
			tracks = await list();
			const mine = tracks.find(t => t.id === "custom/Test Drop In");
			check("a file dropped into custom/ shows up with no restart", !!mine, true);
			check("labelled with its filename", mine && mine.label, "Test Drop In");
			check("and served from where it was dropped",
				mine && mine.srcs, ["audio/music/custom/Test Drop In.mp3"]);

			// The src has a space in it, so the client has to encode it. This
			// is the check that the server answers the encoded form.
			const r = await get("/audio/music/custom/Test%20Drop%20In.mp3");
			check("the encoded path fetches the file", r.code, 200);
			check("as audio", r.type, "audio/mpeg");
		} finally {
			fs.unlinkSync(drop);
		}

		tracks = await list();
		check("and it is gone again when the file is",
			tracks.filter(t => t.id === "custom/Test Drop In").length, 0);

		check("README.md in custom/ is not offered as music",
			tracks.filter(t => /README/i.test(t.id)).length, 0);
	}

	console.log("\n-- reads stay inside the repo --");
	for(const p of [
		"/../../../etc/passwd",
		"/../package.json",
		"/..%2fpackage.json",
		"/%2e%2e/%2e%2e/etc/passwd",
		"/assets/../../package.json"
	]) {
		check("refuses " + p, (await get(p)).code, 403);
	}
	check("a bad escape is a bad request", (await get("/%zz")).code, 400);

	console.log("\n-- ordinary misses --");
	check("missing file", (await get("/nope.html")).code, 404);
	check("a directory is not a file", (await get("/assets")).code, 404);

	console.log("\n-- the query string is not part of the filename --");
	check("index.html?v=2 still resolves", (await get("/index.html?v=2")).code, 200);

}).catch(e => {
	failed++;
	console.log("  FAIL harness   " + e.message);
}).then(() => {
	server.kill();
	console.log(failed ? "\n" + failed + " failed" : "\nall passed");
	process.exit(failed ? 1 : 0);
});
