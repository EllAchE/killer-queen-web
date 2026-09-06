import io, os, re, sys

KQ = "/private/tmp/kq-happyhour"

# ---------------------------------------------------------------- index.html
p = os.path.join(KQ, "index.html")
src = io.open(p, encoding="utf-8").read()

head = '''<html>
<head>
\t<meta charset="utf-8" />
\t<title>Killer Queen</title>
\t<script src="/socket.io/socket.io.js"></script>
\t<script src="site.js"></script>
\t<link rel="stylesheet" href="style.css" />

\t<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
</head>

<body>
\t<div id="game">
\t\t<div id="menu" class="hide">
\t\t\t<div class="kqx-veil"></div>
\t\t\t<div class="teams">
\t\t\t\t<h1 class="kqx-title">KILLER QUEEN</h1>
\t\t\t\t<p class="kqx-sub">Pick a character, then press Ready. The round starts once every connected tab is ready. Nobody is played by the computer, so both Queens should be taken by a person.</p>
\t\t\t\t<div class="team blue">
\t\t\t\t\t<h2 class="kqx-hive-a">Blue Hive</h2>
\t\t\t\t\t<ul>
{blue}
\t\t\t\t\t</ul>
\t\t\t\t</div>
\t\t\t\t<div class="team gold">
\t\t\t\t\t<h2 class="kqx-hive-b">Gold Hive</h2>
\t\t\t\t\t<ul>
{gold}
\t\t\t\t\t</ul>
\t\t\t\t</div>
\t\t\t\t<div class="kqx-actions">
\t\t\t\t\t<button id="player-ready" onclick="playerReady()" disabled>Ready</button>
\t\t\t\t\t<button id="kqx-menu-help" type="button" onclick="kqxHelp(true)">How to play</button>
\t\t\t\t</div>
\t\t\t</div>
\t\t</div>
\t\t<div id="countdown" class="hide">
\t\t\t#
\t\t</div>
\t\t<div id="game-over" class="hide">
\t\t\t<div id="win-mask"></div>
\t\t\t<p id="win-text">GAME OVER</p>
\t\t</div>
\t\t'''

def slots(team):
    rows = []
    rows.append('\t\t\t\t\t\t<li id="menu-%s-queen" onclick="characterSelected(this, \'%s-queen\')">'
                '<span class="kqx-role">Queen</span>'
                '<span class="kqx-hint">flies and fights from the start &middot; 3 eggs</span></li>' % (team, team))
    hints = ["carries berries, rides the snail",
             "carries berries, rides the snail",
             "upgrade at a shrine to fight",
             "upgrade at a shrine to fight"]
    for i in range(4):
        rows.append('\t\t\t\t\t\t<li id="menu-%s-worker%d" onclick="characterSelected(this, \'%s-worker%d\')">'
                    '<span class="kqx-role">Worker %d</span>'
                    '<span class="kqx-hint">%s</span></li>' % (team, i, team, i, i + 1, hints[i]))
    return "\n".join(rows)

head = head.replace("{blue}", slots("teamBlue")).replace("{gold}", slots("teamGold"))

helppanel = '''
\t<div id="kqx-help" class="kqx-off">
\t\t<div class="kqx-panel">
\t\t\t<button class="kqx-close" type="button" onclick="kqxHelp(false)">Close &middot; Esc</button>
\t\t\t<h1>KILLER QUEEN</h1>
\t\t\t<p class="kqx-lead">Two hives, five bees each: one Queen and four Workers. The first hive to pull off any one of the three victories takes the round.</p>

\t\t\t<h2>Getting into a match</h2>
\t\t\t<ul>
\t\t\t\t<li>Everyone opens the same address in a browser on their own laptop.</li>
\t\t\t\t<li>Click a character on the menu, then press <b>Ready</b>.</li>
\t\t\t\t<li>The round starts only once <b>every connected tab</b> has picked and readied &mdash; one person idling on the menu holds up everyone.</li>
\t\t\t\t<li>Slots nobody picks just stand still. There are no computer players in this build, so make sure a person is on each Queen.</li>
\t\t\t</ul>

\t\t\t<h2>Three ways to win</h2>
\t\t\t<ul>
\t\t\t\t<li><span class="kqx-win">Economic</span> &mdash; fill all twelve berry slots in your hive. Workers carry one berry at a time and bank it by touching the slot.</li>
\t\t\t\t<li><span class="kqx-win">Military</span> &mdash; kill the enemy Queen after her eggs run out. She has three; each death hatches one and respawns her, and the kill that finds no egg left ends the game.</li>
\t\t\t\t<li><span class="kqx-win">Snail</span> &mdash; a Worker rides the snail along the bottom track into the cage at the end of it. Riding is slow and leaves you completely exposed.</li>
\t\t\t</ul>

\t\t\t<div class="kqx-cols">
\t\t\t\t<div class="kqx-col">
\t\t\t\t\t<h2>Controls &mdash; everyone</h2>
\t\t\t\t\t<ul>
\t\t\t\t\t\t<li><span class="kqx-k">&larr;</span><span class="kqx-k">&rarr;</span> move left and right</li>
\t\t\t\t\t\t<li><span class="kqx-k">&uarr;</span> jump / flap &mdash; <b>tap it repeatedly</b>; holding it down does nothing extra</li>
\t\t\t\t\t\t<li><span class="kqx-k">&darr;</span> dive downward</li>
\t\t\t\t\t\t<li><span class="kqx-k">R</span> respawn your character if you get stuck</li>
\t\t\t\t\t\t<li><span class="kqx-k">H</span> or <span class="kqx-k">?</span> opens this screen, <span class="kqx-k">Esc</span> closes it</li>
\t\t\t\t\t</ul>
\t\t\t\t</div>
\t\t\t\t<div class="kqx-col">
\t\t\t\t\t<h2>Fighting</h2>
\t\t\t\t\t<p>There is no attack button. You strike automatically whenever you are facing an enemy and are able to fight &mdash; Queens always, Workers only once they are Warriors.</p>
\t\t\t\t\t<p>One hit kills. When two Queens meet head on, the one who is higher up wins and the lower one is knocked back; hit anyone from behind and they die outright.</p>
\t\t\t\t</div>
\t\t\t</div>

\t\t\t<h2>Playing the Queen</h2>
\t\t\t<ul>
\t\t\t\t<li>Flies and fights from the start &mdash; the only character who can fly with no upgrade.</li>
\t\t\t\t<li>Her three eggs are her lives. Lose all three and the other hive wins outright.</li>
\t\t\t\t<li>She cannot carry berries or ride the snail. Her job is escorting workers and hunting the other Queen.</li>
\t\t\t</ul>

\t\t\t<h2>Playing a Worker</h2>
\t\t\t<ul>
\t\t\t\t<li>Starts unarmed: runs and jumps, but cannot fly or fight.</li>
\t\t\t\t<li>Walk over a berry to pick it up, one at a time, then either bank it in your hive or spend it at a shrine.</li>
\t\t\t\t<li><b>Speed shrine</b> &mdash; spend a berry to move faster.</li>
\t\t\t\t<li><b>Warrior shrine</b> &mdash; spend a berry to become a Warrior, who can fly and kill but can no longer carry berries.</li>
\t\t\t\t<li>Take the speed shrine <em>before</em> the warrior shrine if you want both: once you are a Warrior the speed shrine stops working on you.</li>
\t\t\t\t<li>Only Workers ride the snail. Dying knocks you all the way back to an unarmed Worker with no berry.</li>
\t\t\t</ul>

\t\t\t<p class="kqx-foot">Killer Queen clone by jacksonkr, ISC licensed. Running on a laptop on this network &mdash; nothing leaves the room.</p>
\t\t</div>
\t</div>
\t<button id="kqx-tab" type="button" onclick="kqxHelp(true)">? How to play</button>
'''

keep = src[src.index('<div id="level"'):src.index('</body>')]
io.open(p, "w", encoding="utf-8").write(head + keep + helppanel + "</body>\n\n</html>\n")
print("index.html rewritten")
