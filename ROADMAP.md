# Killer Queen clone — feature roadmap

Two parts: the features Logan asked for, specced against this codebase, and a
survey of what the real arcade game has that this clone doesn't.

Codebase facts that shape most of the specs below:

- `app.js:130` calls `loadLevel("index.html", "style.css")`. The server parses
  the level out of the page itself with cheerio, reading each element's inline
  `style` and its CSS rule. **The map is the HTML.**
- `app.js` holds exactly one `Game.instance` and one flat `users` array, and
  `game.js` reaches for `Game.instance` as a global singleton throughout.
- `index.html` has **no doctype** — quirks mode is the only reason unitless
  `style.left = 51` positions anything. Never add one.
- Roster is 1 queen + 4 workers per team, 3 eggs, 12 goal cells. That matches
  the arcade game's 5v5 and its 12-berry economic win.

---

## Part 1 — Requested features

### 1. Map select — medium

The map is the page, so this is mostly a file-layout change:

- Move the contents of `#level` out of `index.html` into `maps/day.html`,
  `maps/night.html`, etc. Keep the `#level` wrapper in the page.
- `loadLevel(mapFile, "style.css")` takes the map name; the client fetches the
  same fragment and injects it before `playerReady()`.
- The server is authoritative and single-instance, so map choice is a lobby
  setting, not a per-player one: pick it (or vote) at the menu, then re-parse
  and reset. `GAME_RESET` already exists to hang this on.

Maps worth building, from the arcade roster:

| Map | What makes it different |
|---|---|
| **Day** | What the clone already is: hives on top, snail along the bottom, horizontal wrap on the lower three levels. |
| **Night** (Waterfall) | Hives at the *bottom*, blue left / gold right, with a gap in the hive wall so berries can be kicked between hives through the wrap. Snail starts mid-map with a much shorter lane, so snail runs are fast. Adds **vertical** wrap — dive out the bottom, come back in the top. |
| **Twilight** | Third standard map; gaps in the bottom platform that wrap to the top. |
| **Bonus: military-only** | No snail, no bases. Only the military win exists. |
| **Bonus: giant berry** | One oversized berry, everyone spawns as a warrior, kick it into your hive. |

The two bonus maps are nearly free once map select exists, and they're the most
fun-per-line on this list.

### 2. Character names + name bar — small

- Menu already has `characterSelected(ele, toonId)` and `playerReady()`. Add a
  text input and widen the `USER_CHARACTER_SELECT` payload from `{toonId}` to
  `{toonId, name}`. Server stores it on the user record and includes it in the
  menu update.
- Render names in a **separate absolutely-positioned layer**, not as children of
  `.toon`. `motion.js` writes a composed `transform` (lean, squash, and the
  facing mirror) onto every toon; a child label would inherit it and render
  upside-down and mirrored whenever the player faces left.
- Drive the layer off the same `VIRTUAL_UPDATE` that moves the sprites.
- Sanitize and cap length — names are the one place player input reaches other
  players' screens.

### 3. Keystroke overlay + settings — small

`site.js` already handles keydown/keyup and emits `KEY_UPDATE`, so:

- **Own keys only** needs no protocol change at all — read local key state,
  draw a translucent D-pad-ish widget. Do this first.
- **Everyone's keys** needs key state added to the update payload; the server
  currently fans out positions only. Worth it for spectating and for debugging
  desync, but it's a protocol change, so it's the second step.
- Settings: a gear button and a `localStorage`-backed prefs object — show/hide,
  opacity, corner, own-only vs. everyone. Same pattern would later cover
  volume, name display, and map preference.

### 4. Remote rooms — deferred (hard here)

Not because networking is hard — there's already a socket.io server — but
because `Game.instance` is a global singleton and `users` is a flat array. Rooms
means making the game non-singleton and keying socket.io rooms by lobby, which
touches nearly every file. Real work, worth its own project.

### 5. AI / bots — deferred, but **much closer than it looks**

There is already a half-built bot in the tree:

- `Worker.aiLoop()` (`game.js:1107`) targets the nearest berry, then the nearest
  goal, and steers the snail toward its own side.
- `MoveTask` and `PathPoint` (`game.js:825-928`) are a pathfinding scaffold, with
  `Ground.rayTraceGroundToFrom` for gap detection.
- `Queen.aiLoop()` (`game.js:1596`) is a stub: `return; // no ai for queen (yet)`.

It is **switched off by one commented line**, `game.js:1070`:

    // if(this.isAIPlayer === true) this.aiLoop();

and the `path-point` case is commented out of the level parser. So "add bots" is
closer to "finish and re-enable the existing one" than to a from-scratch build.
Killer Queen Black's bots set the bar: they play every objective, never throw
berries, and drop-outs are replaced by a bot mid-match so play never stops.

---

## Part 2 — Survey: what the real game has that this doesn't

### Fidelity gaps that are outright bugs

1. **Queen gate conversion does nothing.** `Shrine.collission` sets
   `this.affiliation = o.team` when a queen touches a gate, but the worker
   branch never reads `affiliation` — so an enemy worker still uses a gate the
   queen just converted. Gate control is one of the core positional battles in
   the real game. Small fix, big strategic payoff.
2. **Warriors can ride the snail.** A warrior is a `Worker` with
   `warrior === true`, and `Snail.collission` only tests `o instanceof Worker`.
   The arcade game forbids it. One condition.
3. **Warriors don't kill the snail rider.** Right now an opposing player who
   touches an occupied snail gets swallowed. A warrior should kill the rider
   outright and free whoever is being eaten.
4. **Speed upgrade doesn't help you ride.** In the real game a speed drone rides
   the snail faster, which is most of the reason to take speed at all.
5. **`Snail.collission` with a `SnailCage` reads `this.toon.team`** without a
   null check — an unridden snail touching the cage throws.

### Missing mechanics

6. **The queen has no dive.** `Queen` adds nothing to `Toon` but lives and
   speed; combat is Joust-style vertical ranking only. The dive — a fast
   downward attack that kills anything in its path — is the queen's signature
   move and the main skill expression in the role.
7. **No berry kicking.** `BERRY_MASS` and `ELE_BUMP` already exist as hooks.
   Kicking loose berries matters everywhere and is the whole point of Night
   map's hive gap.
8. **No match structure.** No timer, no score, no best-of series, no
   intermission. The arcade plays a *set*, not a game. `game.js`'s own header
   comment already plans for it: "VOICEOVER: teams during game, all during
   intermission."

### Missing presentation

9. **There is no audio at all** — zero `Audio`, `.mp3`, or `.wav` anywhere in
   the tree. The arcade game's sound is a big part of why it reads as chaotic
   fun: berry deposit chimes, the queen-death sting, the snail, the announcer.
   Highest atmosphere-per-hour item on this list.
10. **No spectator mode.** Nearly free — a client that connects, never picks a
    toon, and just renders. Currently *impossible*, because `app.js:87`
    (`if(!u.toonId || !u.ready) gameReady = false;`) requires every connected
    socket to be ready before a round starts, so one spectator deadlocks the
    lobby. Worth fixing regardless: that same line is what silently blocks a
    round when any stale socket is hanging around.
11. **No HUD.** Berry count per team, queen lives remaining, and snail progress
    are all in server state and none of them are on screen.

---

## Suggested order

1. Audio, and the four small fidelity fixes (gate affiliation, warrior/snail,
   warrior kills rider, speed-rides-faster) — cheapest, most felt.
2. Names + keystroke overlay + a settings panel — the settings panel is the
   hook everything later hangs on.
3. HUD and spectator mode (fixes the stale-socket lobby deadlock too).
4. Map select, then Night and the two bonus maps.
5. Queen dive, berry kicking, best-of series.
6. Re-enable and finish the bots.
7. Remote rooms, as its own project.

## Sources

- [How to Play — Killer Queen Arcade](https://killerqueenarcade.com/howtoplay)
- [Killer Queen (video game) — Wikipedia](https://en.wikipedia.org/wiki/Killer_Queen_(video_game))
- [Snail — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Snail)
- [Day map — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Day_map)
- [Night Map — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Night_Map)
- [Category:Maps — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Category:Maps)
- [Bots — Killer Queen Black Wiki](https://killerqueenblack.wiki/gameplay/bots/)
- [Killer Queen Black review — Nintendo World Report](http://www.nintendoworldreport.com/review/51923/killer-queen-black-switch-review)
