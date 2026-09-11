// Zeigt den OAuth-Code an, den Abacus nach dem benutzerabhaengigen Login zurueckgibt.
// Der Code wird nur angezeigt, nirgends gespeichert oder weitergeschickt.
(function () {
  var q = new URLSearchParams(window.location.search);
  var out = document.getElementById('out');
  var code = q.get('code');
  var err = q.get('error');
  var desc = q.get('error_description');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (err) {
    out.innerHTML =
      '<p class="err"><strong>Abacus meldet einen Fehler:</strong> ' + esc(err) + '</p>' +
      (desc ? '<p class="err">' + esc(desc) + '</p>' : '') +
      '<p class="muted">Bei "no access to any scope requested" fehlen die API-Scopes beim Benutzer in Q981.</p>';
    return;
  }

  if (!code) {
    out.innerHTML =
      '<p>Diese Seite ist die Login-Redirect-URL fuer die Abacus-API-Anbindung.</p>' +
      '<p class="muted">Sie wird nur ueber den Abacus-Login aufgerufen. Direkt geoeffnet zeigt sie nichts an.</p>';
    return;
  }

  out.innerHTML =
    '<p>Login erfolgreich. Diesen Code bitte an Claude weitergeben:</p>' +
    '<textarea id="code" readonly></textarea>' +
    '<button id="copy">Code kopieren</button>' +
    '<p class="muted">Der Code ist nur kurz gueltig und kann nur einmal eingeloest werden.</p>';
  var ta = document.getElementById('code');
  ta.value = code;
  document.getElementById('copy').addEventListener('click', function () {
    ta.select();
    try { navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); }
    this.textContent = 'Kopiert';
  });
})();
