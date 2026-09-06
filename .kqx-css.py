import io

p = "/private/tmp/kq-happyhour/style.css"
s = io.open(p, encoding="utf-8").read()

FONT = '"Trebuchet MS", "Segoe UI", Avenir, Helvetica, sans-serif'

def swap(start, end, new):
    global s
    a = s.index(start); b = s.index(end)
    assert a < b, (start, end)
    s = s[:a] + new + s[b:]

# --- page chrome -----------------------------------------------------------
swap("body {\n\tmargin: 0;", ".direction-right {", '''html, body {
\tmargin: 0;
\tpadding: 0;
\twidth: 100%%;
\theight: 100%%;
\toverflow: hidden;
\tbackground: #14121c;
\tcolor: #e8e6f0;
\tfont-family: %s;
\tuser-select: none;
}

''' % FONT)

# --- the play field: a fixed 800x600 box, scaled to the window by site.js ---
swap("#game {", "#menu {", '''#game {
\tposition: absolute;
\ttop: 0;
\tleft: 0;
\toverflow: hidden;
\twidth: 800px;
\theight: 600px;
\ttransform-origin: 0 0;
\timage-rendering: pixelated;
}

''')

# --- menu ------------------------------------------------------------------
swap("#menu {", "#level {", '''#menu {
\tposition: absolute;
\twidth: 100%%;
\theight: 100%%;
\tz-index: 99;
\tfont-family: %s;
}
#menu .kqx-veil {
\tposition: absolute;
\twidth: 100%%;
\theight: 100%%;
\tbackground: #14121c;
\topacity: 0.95;
}
#menu .teams {
\tposition: absolute;
\twidth: 100%%;
\theight: 100%%;
\tbox-sizing: border-box;
\tpadding: 26px 24px;
\ttext-align: center;
\tcolor: #e8e6f0;
}
#menu .kqx-title {
\tmargin: 0;
\tfont-size: 40px;
\tletter-spacing: 11px;
\tfont-weight: 700;
\tcolor: #ffd76a;
\ttext-shadow: 0 3px 0 #7a4b12;
}
#menu .kqx-sub {
\tmargin: 8px auto 20px;
\tmax-width: 540px;
\tfont-size: 13px;
\tline-height: 1.55;
\tcolor: #a9a6bd;
}
#menu .team {
\tdisplay: inline-block;
\tvertical-align: top;
\twidth: 46%%;
}
#menu .kqx-hive-a, #menu .kqx-hive-b {
\tmargin: 0 0 10px;
\tfont-size: 13px;
\tletter-spacing: 4px;
\ttext-transform: uppercase;
\tfont-weight: 700;
}
#menu .kqx-hive-a { color: #7fa6ef; }
#menu .kqx-hive-b { color: #ffa15c; }
#menu ul {
\tmargin: 0 auto;
\tpadding: 0;
\twidth: 215px;
}
#menu li {
\ttransition: all 0.12s;
\tlist-style: none;
\tmargin: 0 0 6px;
\tpadding: 7px 11px;
\tborder-radius: 6px;
\tborder: 1px solid #3a3750;
\tbackground: #1d1a2a;
\tcolor: #cfcce0;
\twidth: auto;
\theight: auto;
\tfont-size: 15px;
\ttext-align: left;
\tcursor: pointer;
\toverflow: hidden;
}
#menu li .kqx-role {
\tdisplay: block;
\tfont-weight: 700;
\tletter-spacing: 1px;
}
#menu li .kqx-hint {
\tdisplay: block;
\tfont-size: 11px;
\tline-height: 1.4;
\tcolor: #8d8aa3;
}
#menu li:hover {
\tborder-color: #7d7899;
}
#menu .blue li:hover { color: #7fa6ef; }
#menu .gold li:hover { color: #ffa15c; }
#menu .blue li.selected { background-color: #2f4f91; }
#menu .gold li.selected { background-color: #a8541f; }
#menu li.selected {
\topacity: 1.0;
\tcursor: default;
\tcolor: #fff !important;
\tborder-color: #fff;
}
#menu li.selected .kqx-hint { color: #e2e0ee; }
#menu li.taken {
\topacity: 0.3;
\tcursor: not-allowed;
\tpointer-events: none;
}
#menu .kqx-actions {
\tmargin-top: 20px;
}

''' % FONT)

# --- buttons ---------------------------------------------------------------
swap("#player-ready {", "#countdown {", '''#player-ready, #kqx-menu-help {
\tposition: static;
\tdisplay: inline-block;
\tmargin: 0 6px;
\toutline: none;
\tcursor: pointer;
\ttransition: all 0.2s;
\tfont-family: inherit;
\tfont-size: 16px;
\tletter-spacing: 3px;
\ttext-transform: uppercase;
\tbackground: none;
\tcolor: #cfcce0;
\tborder: 2px solid #4a4763;
\tborder-radius: 6px;
\tpadding: 10px 24px;
}
#player-ready:disabled {
\topacity: 0.25;
\tpointer-events: none;
}
#player-ready:hover {
\tborder-color: #4ad07a;
\tcolor: #4ad07a;
}
#kqx-menu-help:hover {
\tborder-color: #ffd76a;
\tcolor: #ffd76a;
}
#player-ready.selected {
\tborder-color: #4ad07a;
\tbackground: #1d3a27;
\tcolor: #7ef2a8;
\tfont-weight: bold;
\tcursor: default;
}

''')

# --- countdown -------------------------------------------------------------
swap("#countdown {", "/**\n * leave a trail", '''#countdown {
\tposition: absolute;
\twidth: 100%;
\theight: 100%;
\tz-index: 98;
\tbackground: rgba(20, 18, 28, 0.72);
\tcolor: #ffd76a;
\tfont-size: 210px;
\tline-height: 600px;
\tfont-weight: 700;
\ttext-align: center;
\tcursor: default;
}

''')

# --- game over: viewport units break once #game is scaled, so pin to px -----
for a, b in [("width: 20vmin;", "width: 90px;"),
             ("height: 20vmin;", "height: 90px;"),
             ("box-shadow: 0px 0px 0px 100vmax #f88;",
              "box-shadow: 0px 0px 0px 1200px rgba(20, 18, 28, 0.86);"),
             ("width: 200vmin;", "width: 1800px;"),
             ("height: 200vmin;", "height: 1800px;"),
             ("margin:-50vmax;", "margin: -900px;")]:
    assert s.count(a) == 1, a
    s = s.replace(a, b)

s = s[:s.index("#game-over #win-text {")] + '''#game-over #win-text {
\tposition: absolute;
\tmargin: 0;
\tfont-family: %s;
\ttext-align: center;
\twidth: 100%%;
\ttop: 210px;
\tfont-size: 44px;
\tletter-spacing: 4px;
\tfont-weight: 700;
\tcolor: #ffd76a;
\ttext-shadow: 0 3px 0 #7a4b12;
}
''' % FONT

# --- instructions overlay: lives outside #game, so it stays crisp ----------
s += '''
/**
 * Instructions overlay. Sits outside #game so it is never scaled, and every
 * selector here is free of the class names game.js substring-matches when it
 * parses this file for level geometry.
 */
#kqx-tab {
\tposition: fixed;
\ttop: 10px;
\tright: 12px;
\tz-index: 200;
\tfont-family: %(font)s;
\tfont-size: 11px;
\tletter-spacing: 2px;
\ttext-transform: uppercase;
\tcolor: #cfcce0;
\tbackground: rgba(29, 26, 42, 0.92);
\tborder: 1px solid #4a4763;
\tborder-radius: 6px;
\tpadding: 7px 12px;
\tcursor: pointer;
}
#kqx-tab:hover {
\tcolor: #ffd76a;
\tborder-color: #ffd76a;
}
#kqx-help {
\tposition: fixed;
\ttop: 0;
\tleft: 0;
\twidth: 100%%;
\theight: 100%%;
\tz-index: 300;
\tbackground: rgba(10, 9, 14, 0.88);
\toverflow-y: auto;
\tfont-family: %(font)s;
}
#kqx-help.kqx-off {
\tdisplay: none;
}
#kqx-help .kqx-panel {
\tbox-sizing: border-box;
\tmax-width: 880px;
\tmargin: 36px auto;
\tbackground: #1b1826;
\tborder: 1px solid #3a3750;
\tborder-radius: 10px;
\tpadding: 26px 32px 32px;
\tcolor: #d8d5e6;
\tfont-size: 14px;
\tline-height: 1.62;
}
#kqx-help h1 {
\tmargin: 0 0 6px;
\tfont-size: 26px;
\tletter-spacing: 7px;
\tcolor: #ffd76a;
}
#kqx-help h2 {
\tmargin: 24px 0 8px;
\tfont-size: 13px;
\tletter-spacing: 3px;
\ttext-transform: uppercase;
\tcolor: #8fb4f5;
\tborder-bottom: 1px solid #33304a;
\tpadding-bottom: 6px;
}
#kqx-help p {
\tmargin: 0 0 10px;
}
#kqx-help ul {
\tmargin: 0 0 10px;
\tpadding-left: 20px;
}
#kqx-help li {
\tmargin-bottom: 6px;
}
#kqx-help .kqx-lead {
\tcolor: #a9a6bd;
}
#kqx-help .kqx-cols {
\tdisplay: flex;
\tflex-wrap: wrap;
}
#kqx-help .kqx-col {
\tflex: 1 1 330px;
\tpadding-right: 26px;
\tbox-sizing: border-box;
}
#kqx-help .kqx-k {
\tdisplay: inline-block;
\tmin-width: 14px;
\tpadding: 1px 7px;
\tmargin-right: 4px;
\ttext-align: center;
\tborder: 1px solid #55516f;
\tborder-radius: 4px;
\tbackground: #26223a;
\tcolor: #fff;
\tfont-size: 12px;
\tfont-family: Menlo, Consolas, monospace;
}
#kqx-help .kqx-win {
\tcolor: #ffd76a;
\tfont-weight: 700;
}
#kqx-help .kqx-close {
\tfloat: right;
\tfont-family: inherit;
\tfont-size: 11px;
\tletter-spacing: 2px;
\ttext-transform: uppercase;
\tcolor: #cfcce0;
\tbackground: none;
\tborder: 1px solid #4a4763;
\tborder-radius: 6px;
\tpadding: 7px 12px;
\tcursor: pointer;
}
#kqx-help .kqx-close:hover {
\tcolor: #ffd76a;
\tborder-color: #ffd76a;
}
#kqx-help .kqx-foot {
\tmargin-top: 22px;
\tcolor: #8d8aa3;
\tfont-size: 12px;
}
''' % {"font": FONT}

io.open(p, "w", encoding="utf-8").write(s)
print("style.css rewritten,", len(s), "bytes")
