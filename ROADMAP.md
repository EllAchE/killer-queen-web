# Killer Queen clone — feature roadmap

Two parts: the features Logan asked for, specced against this codebase, and a
survey of what the real arcade game has that this clone doesn't.

**Shipped so far:** the fidelity fixes below (gaps 1-5, plus one more the tests
turned up), player names, the keystroke overlay and settings panel, map select
with four boards, and music and sound effects. Each shipped section says what actually landed,
including where the spec turned out to be wrong. The rest is still open.

Codebase facts that shape most of the specs below:

- `app.js` calls `loadLevel(name)`, which parses `maps/<name>.html` with cheerio,
  reading each element's inline `style` and its CSS rule. **The map is the
  HTML** — which is why a new board is a file, not code.
- `app.js` holds exactly one `Game.instance` and one flat `users` array, and
  `game.js` reaches for `Game.instance` as a global singleton throughout.
- `index.html` has **no doctype** — quirks mode is the only reason unitless
  `style.left = 51` positions anything. Never add one.
- Roster is 1 queen + 4 workers per team, 3 eggs, 12 goal cells. That matches
  the arcade game's 5v5 and its 12-berry economic win.

---

## Part 1 — Requested features

### 1. Map select — **shipped**

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

**What landed:** Day, Night and both bonus boards, picked from a `Map` dropdown
in the lobby. Two things came out different from the spec above.

- **Giant berry became an empty arena.** `berryCheck` requires `!this.warrior`,
  so a board where everyone spawns armed is a board where nobody can carry the
  berry. `bonus-warriors` drops the berry instead: no goals, no gates, no snail,
  military win only.
- **Tearing a level down had to be built first.** Level objects register on
  `Game.instance`, `removeEventListener` is broken, and nothing recorded which
  level a listener came from, so the old board would have kept running under the
  new one. Listeners now carry an `owner` and `releaseLevel()` drops the level's.

**Twilight is still unbuilt** — it is the one standard arcade map missing, and
now costs one file.

### 2. Character names + name bar — **shipped**

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

**What landed:** names ride a `NAME_UPDATE` broadcast of their own rather than
`MENU_UPDATE`, which only reaches users who have not picked a character yet, so
in-round players never saw it. Tags live in a runtime-built layer inside
`#level` — a div written into `index.html` would have been parsed as a level
object. Server-side, names are stripped to printable ASCII and capped at 12.

### 3. Keystroke overlay + settings — **shipped**

`site.js` already handles keydown/keyup and emits `KEY_UPDATE`, so:

- **Own keys only** needs no protocol change at all — read local key state,
  draw a translucent D-pad-ish widget. Do this first.
- **Everyone's keys** needs key state added to the update payload; the server
  currently fans out positions only. Worth it for spectating and for debugging
  desync, but it's a protocol change, so it's the second step.
- Settings: a gear button and a `localStorage`-backed prefs object — show/hide,
  opacity, corner, own-only vs. everyone. Same pattern would later cover
  volume, name display, and map preference.

**What landed:** both scopes, plus corner and opacity, saved in `localStorage`.
The relay is emitted from the `KEY_UPDATE` receive handler rather than the game
loop, because the loop splices `ArrowUp` back out every tick to stop players
holding jump — by the time the loop runs, `user.keys` no longer says what is
being pressed.

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

### Fidelity gaps that are outright bugs — **1-5 shipped**

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

Two more turned up while building the maps. The first is now fixed:

6. ~~**Either cage wins the snail.**~~ Fixed. `Snail.collission` handed
   `WIN_SNAIL` to `this.toon.team` whichever cage it touched, so riding the
   snail backwards into the *enemy* basket won the game for you. `SnailCage`
   already inherited a `team` off its id — `cage-blue`, `cage-gold` — and never
   read it. It now returns unless the rider's team matches, and a cage with no
   team in its id stays neutral so a future shared basket still works.
7. **Horizontal wrap applies to the whole board.** `visibilityCheck` wraps any
   toon that leaves the side of the level, at any height. On the arcade's Day
   map only the lower section wraps; the upper platforms are walled. Now that
   `mapConfig.wrap` exists, this wants a band rather than a flag — something
   like `wrap: {x: [380, 600]}` — so Night's vertical wrap and Twilight's
   bottom-gap wrap can be expressed too.

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

9. ~~**There is no audio at all**~~ — **shipped.** Music and effects, all of it
   CC0, sourced and credited in `audio/CREDITS.md`.

   **What landed:** five music tracks (a lobby loop, three selectable match
   tracks, an ending theme) and twelve effects, each built to both Ogg Opus and
   MP3 by `tools/build-audio.sh` and picked between at runtime with
   `canPlayType`. Opus loops seamlessly because it stores encoder delay as a
   pre-skip; MP3 does not, and is carried only because it plays everywhere.

   **The thing that shaped the design:** the client receives nothing but
   `VIRTUAL_UPDATE` — positions and flags — so from the browser's side a berry
   banking in a slot and a berry carried past one are the same two numbers
   moving. There was no event to listen for. Effects therefore needed a new
   wire channel, `CONST.SFX`, emitted from `Game.sfx()` at the handful of
   places in `game.js` where the distinction is still known. `test-audio.js`
   drives each of those places and also checks every cue name in the source
   against the files on disk, because a cue that fires under a name no file
   answers to fails silently.

   **"Never Gonna Give You Up" is a drop-in slot, not a file.** Two live
   copyrights attach to it — the 1987 composition and Astley's recording — and
   a CC licence only covers what the uploader owns, so even a CC0 chiptune
   cover clears the arranger and leaves the composition untouched. Instead,
   `app.js` scans `audio/music/custom/` on every request to
   `/audio/tracks.json`, so anything dropped in there is in the Settings
   picker on the next open. The directory ignores its own contents.

   Serving it needed `app.js` fixed first: everything had been sent as
   `text/html`, reads were `readFileSync` on the game's own event loop, and
   `__dirname + req.url` was an unchecked path traversal.
10. **No spectator mode.** Nearly free — a client that connects, never picks a
    toon, and just renders. It used to be *impossible*: the readiness gate
    required every connected socket to have a toon and be ready, so one
    spectator deadlocked the lobby.

    That gate is now `Game.readyToStart`, which waits only on users who picked
    a character, and `test-lobby.js` covers it. What is left is the client
    side — a spectator has no way to say "just show me the game", and no view
    that renders the match without a toon of its own.

    The old failure was **delayed, which is what made it confusing**, and is
    worth recording because the same shape will recur. Mid-round the
    `USER_READY` handler short-circuits on `if(gameInProgress) { ...; return; }`
    before it ever reached the gate, so a spectator tab opened during a live
    match was harmless and looked fine. But `GAME_RESET` nulls `toonId` on
    *every* user, so from the next reset onward that same tab — and any stale
    socket nobody remembered leaving open — blocked every round with no message
    saying why. It was hit while verifying this work: a forgotten browser tab
    held the lobby shut.
11. **No HUD.** Berry count per team, queen lives remaining, and snail progress
    are all in server state and none of them are on screen.

---

## Suggested order

Done: fidelity gaps 1-5, names, the keystroke overlay and settings panel, map
select with Day, Night and both bonus boards, and audio.

What's left, cheapest and most felt first:

1. Wrapping a band of the board rather than all of it (item 7 above). The
   other gap the map work turned up, the own-cage snail win, is fixed.
2. HUD and spectator mode — berry count, queen lives and snail progress are all
   already in server state. The lobby deadlock that used to make spectating
   impossible is fixed, so what remains is the client view.
3. Twilight, now that a map is a file.
4. Queen dive, berry kicking, best-of series.
5. Re-enable and finish the bots.
6. Remote rooms, as its own project.

## Sources

- [How to Play — Killer Queen Arcade](https://killerqueenarcade.com/howtoplay)
- [Killer Queen (video game) — Wikipedia](https://en.wikipedia.org/wiki/Killer_Queen_(video_game))
- [Snail — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Snail)
- [Day map — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Day_map)
- [Night Map — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Night_Map)
- [Category:Maps — KillerQueenArcade Wiki](https://killerqueenarcade.fandom.com/wiki/Category:Maps)
- [Bots — Killer Queen Black Wiki](https://killerqueenblack.wiki/gameplay/bots/)
- [Killer Queen Black review — Nintendo World Report](http://www.nintendoworldreport.com/review/51923/killer-queen-black-switch-review)
