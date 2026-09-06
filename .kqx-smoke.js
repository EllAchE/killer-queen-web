const URL = "ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket";

function player(toonId) {
  return new Promise(resolve => {
    const st = {toonId, started: false, frames: 0, first: null, last: null};
    const ws = new WebSocket(URL);
    ws.onmessage = e => {
      const d = e.data;
      if (d[0] === "0" && d[1] === "{") { ws.send("40"); return; }
      if (d === "2") { ws.send("3"); return; }
      if (d.startsWith("40")) {
        ws.send('42["USER_CHARACTER_SELECT",{"toonId":"' + toonId + '"}]');
        setTimeout(() => ws.send('42["user_ready",{"ready":true}]'), 250);
        return;
      }
      if (d.startsWith("42")) {
        const [name, payload] = JSON.parse(d.slice(2));
        if (name === "game_start") st.started = true;
        if (name === "virtual_update" && Array.isArray(payload)) {
          st.frames++;
          const me = payload.find(o => o.id === toonId);
          if (me) { if (!st.first) st.first = {...me}; st.last = {...me}; }
        }
      }
    };
    st.press = k => ws.send('42["key_update",["' + k + '"]]');
    st.release = () => ws.send('42["key_update",[]]');
    st.close = () => ws.close();
    setTimeout(() => resolve(st), 600);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const blue = await player("teamBlue-queen");
  const gold = await player("teamGold-queen");
  await sleep(2500);
  console.log("game_start  blue:", blue.started, " gold:", gold.started);

  blue.press("ArrowRight"); gold.press("ArrowLeft");
  await sleep(1500);
  blue.release(); gold.release();
  await sleep(400);

  const d = s => s.first && s.last ? (s.last.left - s.first.left) : "n/a";
  console.log("frames      blue:", blue.frames, " gold:", gold.frames);
  console.log("horizontal  blue:", d(blue), " gold:", d(gold));
  console.log("facing      blue:", blue.last && blue.last.direction, " gold:", gold.last && gold.last.direction);

  blue.close(); gold.close();
  process.exit(0);
})();
