# Your own match music

Drop an audio file in this directory and it appears in **Settings → Match
music** the next time somebody opens that panel. No restart, no rebuild, no
edit to any file.

```
audio/music/custom/Never Gonna Give You Up.mp3
```

The filename, minus the extension, is what the list shows — so name it what you
want to read. Spaces are fine. `.mp3`, `.ogg`, `.m4a` and `.wav` are all
recognised; `.mp3` is the safe choice if you only want to drop one file, since
every browser plays it.

## Nothing here is committed

The `.gitignore` in this directory ignores everything except itself and this
file. Your music stays on your machine, and `git status` stays clean.

## Why the rickroll is not already here

Because we cannot put it there for you, only make it easy for you to.

"Never Gonna Give You Up" carries two live copyrights — the 1987 composition
(Stock/Aitken/Waterman) and Rick Astley's recording of it. A Creative Commons
licence only covers what the uploader actually owns, so the CC0 chiptune covers
floating around clear the arranger's recording and do nothing about the
composition underneath. There is no version of this file we can commit to a
public repo honestly.

What you do with a copy on the laptop in your own living room is a different
question, and this directory does not ask it.

## The other half of the trick

The picker is built from whatever is on disk, not from a list in the code —
`app.js` scans this directory on every request to `/audio/tracks.json`. That is
the entire mechanism. Add a file, it is an option; delete it, it is not.
