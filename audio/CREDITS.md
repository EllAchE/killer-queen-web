# Where the sound came from

Everything committed under `audio/` is **CC0** — public domain dedication, no
attribution required, no commercial restriction. The credits below are given
because the authors deserve them and because the next person to touch this
should be able to check the provenance without taking my word for it.

`tools/build-audio.sh` is the exact recipe: it takes the upstream archives and
produces the files in this directory. It does not need to be run to play the
game — the encoded output is committed.

## Music

**Juhani Junkala — "5 Chiptunes (Action)"**
https://opengameart.org/content/5-chiptunes-action
CC0. From the pack's own `INFO.txt`: *"These music tracks have been released
under CC0 creative commons license. You can do anything you want with these
tunes."*

| File | Upstream track |
|---|---|
| `music/lobby.*`   | Title Screen |
| `music/match-1.*` | Level 1 |
| `music/match-2.*` | Level 2 |
| `music/match-3.*` | Level 3 |
| `music/victory.*` | Ending |

## Effects

**Kenney (kenney.nl)** — five CC0 packs. Every one carries the same
`License.txt`: *"License: (Creative Commons Zero, CC0) … free to use in
personal, educational and commercial projects. Support us by crediting Kenney
or www.kenney.nl (this is not mandatory)."*

- Digital Audio — https://kenney.nl/assets/digital-audio
- Interface Sounds — https://kenney.nl/assets/interface-sounds
- Impact Sounds — https://kenney.nl/assets/impact-sounds
- RPG Audio — https://kenney.nl/assets/rpg-audio
- Music Jingles — https://kenney.nl/assets/music-jingles

| Cue | Upstream file | Pack |
|---|---|---|
| `berry-pickup`  | `pepSound1.ogg`               | Digital Audio |
| `berry-deposit` | `confirmation_002.ogg`        | Interface Sounds |
| `egg-hatch`     | `phaserUp3.ogg`               | Digital Audio |
| `queen-death`   | `zapThreeToneDown.ogg`        | Digital Audio |
| `warrior-gate`  | `powerUp5.ogg`                | Digital Audio |
| `speed-gate`    | `powerUp2.ogg`                | Digital Audio |
| `snail-ride`    | `creak1.ogg`                  | RPG Audio |
| `snail-eat`     | `impactSoft_heavy_000.ogg`    | Impact Sounds |
| `toon-death`    | `impactPunch_medium_000.ogg`  | Impact Sounds |
| `win-military`  | `jingles_NES00.ogg`           | Music Jingles |
| `win-economic`  | `jingles_NES13.ogg`           | Music Jingles |
| `win-snail`     | `jingles_NES05.ogg`           | Music Jingles |

## Two formats, on purpose

Every sound ships as both `.ogg` (Opus) and `.mp3`, and `audio.js` asks the
browser which it wants.

Opus is the one worth having: it records the encoder's start-up delay as a
*pre-skip* that the decoder throws away, so a looping track comes back around
in silence. MP3 has no such field — its padding is part of the samples — so a
looped MP3 ticks audibly once per lap. MP3 is carried anyway because it is the
one format that plays in every browser somebody might walk in with.

## "Never Gonna Give You Up"

Not in this repository, and it cannot be.

Two separate copyrights attach to a song: the **composition** (Stock/Aitken/
Waterman, 1987) and the **sound recording** (Rick Astley's). Both are in force.
A Creative Commons licence only ever covers what the person applying it owns,
so even a CC0 chiptune cover on OpenGameArt clears the *arranger's* recording
and leaves the underlying composition untouched. Shipping one here would put an
infringing file in the repo with a licence file next to it saying otherwise,
which is worse than not shipping it.

So it is a **drop-in slot** instead. See `music/custom/README.md`.
