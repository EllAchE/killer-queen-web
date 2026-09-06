const HOST = "http://127.0.0.1:9223";
const PAGE = "http://127.0.0.1:3000/";
const OUT  = "/private/tmp/kq-happyhour";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const tgt = await (await fetch(HOST + "/json/new?" + encodeURIComponent(PAGE), {method: "PUT"})).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 0; const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(r => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({id: n, method, params}));
});

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",
           {width: 1512, height: 900, deviceScaleFactor: 1, mobile: false});
await send("Page.navigate", {url: PAGE});
await sleep(3000);

const shot = async name => {
  const r = await send("Page.captureScreenshot", {format: "png"});
  await Bun.write(OUT + "/" + name, Buffer.from(r.data, "base64"));
  console.log("wrote", name);
};

const ev = async expr => (await send("Runtime.evaluate",
  {expression: expr, returnByValue: true})).result.value;

console.log("viewport      :", await ev("window.innerWidth + 'x' + window.innerHeight"));
console.log("#game transform:", await ev("getComputedStyle(document.getElementById('game')).transform"));
console.log("rendered box  :", await ev(
  "(r => Math.round(r.width) + 'x' + Math.round(r.height) + ' at ' + Math.round(r.left) + ',' + Math.round(r.top))(document.getElementById('game').getBoundingClientRect())"));
console.log("menu visible  :", await ev("!document.getElementById('menu').classList.contains('hide')"));
await shot("shot-menu.png");

await ev("kqxHelp(true)");
await sleep(400);
await shot("shot-help.png");

await ev("kqxHelp(false)");
await sleep(200);
await ev("document.getElementById('menu').classList.add('hide')");
await sleep(200);
await shot("shot-field.png");

await fetch(HOST + "/json/close/" + tgt.id);
process.exit(0);
