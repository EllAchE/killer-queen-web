#!/bin/bash
#
# Rebuilds audio/ from the upstream CC0 packs.
#
# The encoded files are committed, so nobody needs to run this to play the
# game -- it exists so the provenance of every sound is checkable, and so a
# swap ("that berry blip is annoying") is a one-line edit plus a re-run
# rather than an archaeology exercise. See audio/CREDITS.md for the sources.
#
# Needs ffmpeg (already present on the dev machine) and the four upstream
# archives in $SRC, downloaded from the URLs listed in CREDITS.md.
#
# Usage:  SRC=/tmp/kqaudio tools/build-audio.sh

set -euo pipefail

SRC="${SRC:-/tmp/kqaudio}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/audio"

KENNEY_DIGITAL="$SRC/digital-audio/Audio"
KENNEY_IFACE="$SRC/interface-sounds/Audio"
KENNEY_IMPACT="$SRC/impact-sounds/Audio"
KENNEY_RPG="$SRC/rpg-audio/Audio"
KENNEY_JINGLE="$SRC/music-jingles/Audio/8-Bit jingles"
JUNKALA="$SRC/junkala"

mkdir -p "$OUT/music" "$OUT/sfx"

# Two formats, because no single one is safe.
#
# Ogg Opus is the good path: it stores the encoder delay as a pre-skip that
# decoders honour, so a looped track comes back around silently. MP3 cannot
# do that -- its padding is baked into the samples, so a looped MP3 ticks
# once per lap -- but it is the one format that plays everywhere, and people
# join this game from whatever laptop they walked in with. So both get built
# and the client picks with canPlayType.
say() { printf '  %-16s %s\n' "$1" "$2"; }

music() { # <src> <name>
	# Mono would halve the bytes, but chiptune leans hard on stereo panning.
	# Opus at 64k stereo is transparent enough for square waves.
	ffmpeg -v error -y -i "$1" -c:a libopus -b:a 64k "$OUT/music/$2.ogg"
	ffmpeg -v error -y -i "$1" -c:a libmp3lame -b:a 96k -ar 44100 "$OUT/music/$2.mp3"
	say "$2" "$(du -k "$OUT/music/$2.ogg" | cut -f1)K ogg + $(du -k "$OUT/music/$2.mp3" | cut -f1)K mp3"
}

sfx() { # <src> <name>
	# Mono, and low bitrate: these are sub-second one-shots fired over a noisy
	# game. Opus resamples to 48k internally whatever we ask, so no -ar here.
	ffmpeg -v error -y -i "$1" -ac 1 -c:a libopus -b:a 32k "$OUT/sfx/$2.ogg"
	ffmpeg -v error -y -i "$1" -ac 1 -ar 22050 -c:a libmp3lame -b:a 64k "$OUT/sfx/$2.mp3"
	say "$2" "$(du -k "$OUT/sfx/$2.ogg" | cut -f1)K ogg + $(du -k "$OUT/sfx/$2.mp3" | cut -f1)K mp3"
}

echo "music (Juhani Junkala, CC0)"
music "$JUNKALA/Juhani Junkala [Retro Game Music Pack] Title Screen.wav" lobby
music "$JUNKALA/Juhani Junkala [Retro Game Music Pack] Level 1.wav"      match-1
music "$JUNKALA/Juhani Junkala [Retro Game Music Pack] Level 2.wav"      match-2
music "$JUNKALA/Juhani Junkala [Retro Game Music Pack] Level 3.wav"      match-3
music "$JUNKALA/Juhani Junkala [Retro Game Music Pack] Ending.wav"       victory

echo
echo "effects (Kenney, CC0)"
sfx "$KENNEY_DIGITAL/pepSound1.ogg"              berry-pickup
sfx "$KENNEY_IFACE/confirmation_002.ogg"         berry-deposit
sfx "$KENNEY_DIGITAL/phaserUp3.ogg"              egg-hatch
sfx "$KENNEY_DIGITAL/zapThreeToneDown.ogg"       queen-death
sfx "$KENNEY_DIGITAL/powerUp5.ogg"               warrior-gate
sfx "$KENNEY_DIGITAL/powerUp2.ogg"               speed-gate
sfx "$KENNEY_RPG/creak1.ogg"                     snail-ride
sfx "$KENNEY_IMPACT/impactSoft_heavy_000.ogg"    snail-eat
sfx "$KENNEY_IMPACT/impactPunch_medium_000.ogg"  toon-death

# One per win type, so the room knows how the round ended before the text
# renders. Game.win already carries the type through to the client.
sfx "$KENNEY_JINGLE/jingles_NES00.ogg"           win-military
sfx "$KENNEY_JINGLE/jingles_NES13.ogg"           win-economic
sfx "$KENNEY_JINGLE/jingles_NES05.ogg"           win-snail

echo
echo "total: $(du -sk "$OUT" | cut -f1)K in $(find "$OUT" -type f \( -name '*.ogg' -o -name '*.mp3' \) | wc -l | tr -d ' ') files"
