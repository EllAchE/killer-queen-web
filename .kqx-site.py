import io

p = "/private/tmp/kq-happyhour/site.js"
s = io.open(p, encoding="utf-8").read()

def sub(old, new):
    global s
    assert s.count(old) == 1, (old, s.count(old))
    s = s.replace(old, new)

# readable win banner instead of the raw event name
sub('      div = document.getElementById("win-text").innerHTML = data.type;',
    '      document.getElementById("win-text").innerHTML = window.kqxWinText(data);')

# these were assigned unitless, so the browser dropped them and the mask never moved
sub('      div.style.top = top;\n      div.style.left = left;',
    '      div.style.top = top + "px";\n      div.style.left = left + "px";')

# don't drive the game while the instructions are up
sub('''  window.addEventListener("keydown", function(event) {
  \tkeyDown(event.key);
  });''',
    '''  window.kqxClearKeys = () => {
  \tkeys.length = 0;
  \tsocket.emit(CONST.KEY_UPDATE, keys);
  }
  window.addEventListener("keydown", function(event) {
  \tif(window.kqxHelpOpen) return;
  \tkeyDown(event.key);
  });''')

s += '''
/**
 * The play field is a fixed 800x600 box (game.js hard-codes those bounds), so
 * fitting the window is a pure presentation scale: pick the largest whole-box
 * scale the viewport allows and centre it. No game coordinate changes.
 */
function kqxFit() {
\tvar g = document.getElementById("game");
\tif(!g) return;

\tvar s = Math.min(window.innerWidth / 800, window.innerHeight / 600);
\tvar x = Math.round((window.innerWidth - 800 * s) / 2);
\tvar y = Math.round((window.innerHeight - 600 * s) / 2);

\tg.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")";
}
window.addEventListener("resize", kqxFit);
window.addEventListener("orientationchange", kqxFit);
document.addEventListener("DOMContentLoaded", kqxFit);
window.addEventListener("load", kqxFit);

window.kqxHelpOpen = false;
window.kqxHelp = function(show) {
\tvar d = document.getElementById("kqx-help");
\tif(!d) return;

\twindow.kqxHelpOpen = !!show;
\tif(show) {
\t\td.classList.remove("kqx-off");
\t\tif(window.kqxClearKeys) window.kqxClearKeys();
\t} else {
\t\td.classList.add("kqx-off");
\t}
}
document.addEventListener("keydown", function(event) {
\tif(event.key == "Escape") window.kqxHelp(false);
\telse if(event.key == "?" || event.key == "h" || event.key == "H")
\t\twindow.kqxHelp(!window.kqxHelpOpen);
});

window.kqxWinText = function(data) {
\tvar hive = (data.team == "teamBlue") ? "BLUE HIVE" : "GOLD HIVE";
\tvar how = {
\t\twin_economic: "ECONOMIC VICTORY",
\t\twin_military: "MILITARY VICTORY",
\t\twin_snail: "SNAIL VICTORY"
\t}[data.type] || "VICTORY";

\treturn hive + " WINS &mdash; " + how;
}
'''

io.open(p, "w", encoding="utf-8").write(s)
print("site.js patched,", len(s), "bytes")
