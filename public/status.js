'use strict';

// Fetches live channel status from /status and renders the channel list.
// Progressive enhancement: the page ships a <noscript> fallback, and any
// failure here leaves a readable message rather than an empty section.
(function () {
  var grid = document.getElementById('channel-grid');
  var statusMsg = document.getElementById('channel-status');
  var summary = document.getElementById('section-summary');
  var statTotal = document.getElementById('stat-total');
  var statLive = document.getElementById('stat-live');

  if (!grid) return;

  var GROUP_CLASS = {
    'Toonami Aftermath': 'group-toonami',
    'Adult Swim / CN': 'group-cn',
    'Pluto TV': 'group-pluto',
  };

  function render(data) {
    // Preserve first-seen order so groups render Toonami, Adult Swim / CN, Pluto.
    var order = [];
    var byGroup = {};
    data.channels.forEach(function (ch) {
      if (!byGroup[ch.group]) {
        byGroup[ch.group] = [];
        order.push(ch.group);
      }
      byGroup[ch.group].push(ch);
    });

    grid.textContent = '';

    order.forEach(function (groupName) {
      var groupEl = document.createElement('div');
      groupEl.className = 'channel-group ' + (GROUP_CLASS[groupName] || '');

      var label = document.createElement('div');
      label.className = 'group-label';

      var dot = document.createElement('span');
      dot.className = 'group-dot';
      dot.setAttribute('aria-hidden', 'true');

      var gname = document.createElement('span');
      gname.className = 'group-name';
      gname.textContent = groupName;

      label.appendChild(dot);
      label.appendChild(gname);
      groupEl.appendChild(label);

      var ul = document.createElement('ul');
      ul.className = 'channel-list';

      byGroup[groupName].forEach(function (ch) {
        var li = document.createElement('li');
        li.className = ch.live ? 'is-live' : 'is-offline';

        var liveDot = document.createElement('span');
        liveDot.className = 'live-dot';
        liveDot.setAttribute('aria-hidden', 'true');

        var name = document.createElement('span');
        name.className = 'ch-name';
        name.textContent = ch.name;

        var state = document.createElement('span');
        // Status is conveyed as text, not colour alone. Live channels carry an
        // off-screen label; offline channels show a visible "offline" tag.
        state.className = ch.live ? 'ch-state sr-only' : 'ch-state ch-off';
        state.textContent = ch.live ? 'live' : 'offline';

        li.appendChild(liveDot);
        li.appendChild(name);
        li.appendChild(state);
        ul.appendChild(li);
      });

      groupEl.appendChild(ul);
      grid.appendChild(groupEl);
    });

    grid.setAttribute('aria-busy', 'false');
    if (statTotal) statTotal.textContent = String(data.total);
    if (statLive) statLive.textContent = String(data.live);
    if (summary) summary.textContent = data.live + ' of ' + data.total + ' channels live right now';
    if (statusMsg) statusMsg.textContent = 'Channel list loaded: ' + data.total + ' channels, ' + data.live + ' live now.';
  }

  function fail() {
    grid.setAttribute('aria-busy', 'false');
    grid.textContent = '';
    var p = document.createElement('p');
    p.className = 'load-error';
    p.appendChild(document.createTextNode('Could not load live channel status. The addon may be restarting — try refreshing, or '));
    var a = document.createElement('a');
    a.href = '/manifest.json';
    a.textContent = 'open the manifest';
    p.appendChild(a);
    p.appendChild(document.createTextNode(' directly.'));
    grid.appendChild(p);
    if (statusMsg) statusMsg.textContent = 'Could not load live channel status. Try refreshing the page.';
  }

  fetch('/status', { headers: { Accept: 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(fail);
})();
