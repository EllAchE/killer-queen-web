# Killer Queen (web)

A browser remake of the 10-player Killer Queen arcade cabinet, in HTML, CSS,
ES5 JavaScript and Node/socket.io.

## Credit where it is due

**This project was created by [Jackson Rollins](https://github.com/jacksonkr)**
at [jacksonkr/Killer-Queen](https://github.com/jacksonkr/Killer-Queen) (started
June 2017). The engine, the game loop, the socket protocol, the sprites and the
original ES5 codebase are his work.

This repository is a fork. It was imported from upstream's `dev` branch at
commit [`15fc028`](https://github.com/jacksonkr/Killer-Queen/commit/15fc028)
(22 November 2018) and has been developed independently since. Everything here
that is not Jackson's is a change layered on top of that import — see the git
log for what moved.

Maintained in this fork by Logan Harless.

> **Note on the git history:** the upstream history was flattened into a single
> import commit when this fork was created, so `git blame` and `git log` credit
> every line to this fork's committer rather than to Jackson. That is an
> artefact of how the import was done, not a claim of authorship. For the real
> provenance of anything predating the import, read
> [upstream's history](https://github.com/jacksonkr/Killer-Queen/commits/dev).

## License

`package.json` declares **ISC**, author *Jackson Rollins*. Upstream ships no
`LICENSE` file, so there is no canonical copyright text to reproduce here; the
declaration in `package.json` is the whole of it. That declaration is carried
forward unchanged in this fork.

## Running it

```
$ git clone https://github.com/EllAchE/killer-queen-web
$ cd killer-queen-web
$ npm install
$ node app.js
```

Then open <http://localhost:3000>.

To serve on another port — useful when something already holds 3000 — set
`PORT`:

```
$ PORT=3002 node app.js
```

The game is server-based: one machine runs `app.js` and everyone else joins it
over the network in a browser. The menu prints the address other players on the
same WiFi should open, so you should not have to look up your own IP.

## How to play

[Watch this video](https://www.youtube.com/watch?v=ii69y58Ks5g) for the arcade
game's rules. Controls and objectives are also listed in-game on the menu.

## Package contents

- **node / socket.io** — the game is server-based and multiplayer
- **cheerio** — parses `index.html` for game data
- **css** — parses the stylesheet for game item dimensions (width/height)

## Jackson's original notes

Kept from the upstream README:

> This is just for fun. Repurposing the 10 player Killer Queen arcade with HTML,
> CSS, JS(es5) and Node/SocketIO
>
> **Feel free to pitch in!**
>
> - I played this game at a bar and thought it would would be a fun
>   node/socketio project. I am doing this FOR FUN!
> - I personally develop with Sublime text 2 and OSX Chrome 58+ (64bit)
> - cheerio is used to parse the HTML
> - css is used to parse the CSS (although not so good)
