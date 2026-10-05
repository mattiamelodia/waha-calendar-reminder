/**
 * Gestione dei link di conferma 1-click sicuri e usa-e-getta.
 */

/**
 * Restituisce se l'aggiunta dei link di conferma 1-clic nei promemoria è attiva.
 */
function getConfirmationLinksEnabled() {
  const val = getConfig(CONFIG_KEYS.ENABLE_CONFIRMATION_LINKS, 'true');
  return val === 'true' || val === true;
}

/**
 * Attiva o disattiva i link di conferma 1-clic nei promemoria.
 */
function setConfirmationLinksEnabled(enabled) {
  const props = PropertiesService.getScriptProperties();
  const strVal = enabled ? 'true' : 'false';
  props.setProperty(CONFIG_KEYS.ENABLE_CONFIRMATION_LINKS, strVal);
  return enabled;
}

// Alias per compatibilità con il frontend esistente
function getPollRemindersEnabled() {
  return getConfirmationLinksEnabled();
}

function setPollRemindersEnabled(enabled) {
  return setConfirmationLinksEnabled(enabled);
}

/**
 * Aggiorna il titolo di un evento di Calendar anteponendo il tag di stato specificato,
 * dopo aver rimosso eventuali tag di stato preesistenti.
 */
function updateEventStatusTitle_(event, tag) {
  const currentTitle = event.getTitle() || '';
  const baseTitle = stripStatusPrefixes_(currentTitle);
  const newTitle = `${tag} ${baseTitle}`.trim();
  event.setTitle(newTitle);
  return newTitle;
}

/**
 * Genera un token crittografico univoco e registra i metadati dell'appuntamento.
 */
function generateConfirmationToken_(app) {
  if (!app || !app.id) return null;
  const props = PropertiesService.getScriptProperties();

  // Verifica se esiste già un token in stato 'pending' per questo evento
  const existingToken = props.getProperty('EVENT_CONFIRM_' + app.id);
  if (existingToken) {
    const existingRaw = props.getProperty('CONFIRM_' + existingToken);
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (parsed && parsed.status === 'pending') {
          return existingToken;
        }
      } catch (e) {}
    }
  }

  // Genera un token casuale sicuro di 16 caratteri alfanumerici
  const rawUuid = typeof Utilities.getUuid === 'function' ? Utilities.getUuid() : String(Math.random());
  const token = rawUuid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toLowerCase();

  const tokenData = {
    eventId: app.id,
    clientName: app.name,
    firstName: app.firstName || app.name,
    date: app.date,
    time: app.time,
    phone: app.number,
    status: 'pending',
    createdAt: Date.now()
  };

  props.setProperty('CONFIRM_' + token, JSON.stringify(tokenData));
  props.setProperty('EVENT_CONFIRM_' + app.id, token);
  return token;
}

/**
 * Accorcia un URL lungo utilizzando il servizio TinyURL con memorizzazione in cache.
 * Se il servizio fallisce o va in timeout, restituisce l'URL originale di fallback.
 */
function shortenUrl_(url) {
  if (!url) return '';
  const shouldShorten = getConfig(CONFIG_KEYS.SHORTEN_CONFIRMATION_URLS, 'true') === 'true';
  if (!shouldShorten) return url;

  let cache = null;
  try {
    cache = (typeof CacheService !== 'undefined' && CacheService.getScriptCache) ? CacheService.getScriptCache() : null;
  } catch (e) {}

  const cacheKey = 'SHORT_' + url.slice(-20);
  if (cache) {
    try {
      const cached = cache.get(cacheKey);
      if (cached) return cached;
    } catch (e) {}
  }

  try {
    const apiUrl = 'https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url);
    const resp = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
    if (resp && resp.getResponseCode() === 200) {
      const shortUrl = resp.getContentText().trim();
      if (shortUrl.startsWith('http://') || shortUrl.startsWith('https://')) {
        if (cache) {
          try {
            cache.put(cacheKey, shortUrl, 21600); // 6 ore di TTL
          } catch (e) {}
        }
        return shortUrl;
      }
    }
  } catch (e) {
    Logger.log('Errore shortening TinyURL: ' + e);
  }
  return url;
}

/**
 * Restituisce l'URL di conferma a 1-click per un determinato appuntamento.
 * Se la funzionalità è disattivata dall'amministratore e force=false, restituisce stringa vuota.
 * @param {Object} app - Oggetto appuntamento
 * @param {boolean} [force=false] - Se true, genera l'URL anche se i link automatici sono disabilitati
 */
function getConfirmationUrl_(app, force) {
  if (!app || !app.id) return '';
  if (!force && !getConfirmationLinksEnabled()) return '';

  const token = generateConfirmationToken_(app);
  if (!token) return '';

  let baseUrl = getConfig('WEBAPP_URL', null);
  if (!baseUrl) {
    try {
      baseUrl = ScriptApp.getService().getUrl();
    } catch (e) {
      baseUrl = '';
    }
  }

  const fullUrl = baseUrl ? `${baseUrl}?token=${token}` : '';
  if (!fullUrl) return '';

  return shortenUrl_(fullUrl);
}

/**
 * Recupera i dati associati a un token di conferma.
 */
function getConfirmationData_(token) {
  if (!token) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('CONFIRM_' + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Registra la scelta della cliente (Conferma o Sposta) in modo definitivo e univoco.
 * Una volta registrata, la scelta non può più essere modificata dal link.
 */
function submitClientConfirmation(token, choice) {
  const tokenData = getConfirmationData_(token);
  if (!tokenData) {
    return {
      success: false,
      reason: 'invalid_token',
      message: 'Link non valido o scaduto.'
    };
  }

  // Se ha già risposto, blocca qualsiasi ripensamento o cambio di scelta
  if (tokenData.status && tokenData.status !== 'pending') {
    return {
      success: false,
      alreadyAnswered: true,
      status: tokenData.status,
      message: 'La tua risposta è già stata registrata come definitiva. Per ulteriori modifiche ti invitiamo a contattarci direttamente.'
    };
  }

  const newStatus = (choice === 'confirm' ? 'confirmed' : 'rescheduled');
  tokenData.status = newStatus;
  tokenData.answeredAt = new Date().toISOString();

  const props = PropertiesService.getScriptProperties();
  props.setProperty('CONFIRM_' + token, JSON.stringify(tokenData));

  // Aggiorna Google Calendar in tempo reale
  try {
    const cal = getCalendar();
    if (cal && tokenData.eventId) {
      const event = cal.getEventById(tokenData.eventId);
      if (event) {
        if (newStatus === 'confirmed') {
          event.setColor(CalendarApp.EventColor.PALE_GREEN);
          updateEventStatusTitle_(event, '[OK]');
          Logger.log(`[1-CLICK] Appuntamento confermato per ${tokenData.clientName}`);
        } else {
          event.setColor(CalendarApp.EventColor.PALE_RED);
          updateEventStatusTitle_(event, '[SPOSTARE]');
          Logger.log(`[1-CLICK] Richiesta spostamento per ${tokenData.clientName}`);
        }
      }
    }
  } catch (calErr) {
    Logger.log(`[1-CLICK] Errore aggiornamento calendario: ${calErr.message}`);
  }

  return {
    success: true,
    status: newStatus,
    clientName: tokenData.firstName || tokenData.clientName
  };
}

/**
 * Genera l'interfaccia HTML autosufficiente per la conferma 1-click del cliente.
 * Non dipende da template esterni ed evita qualsiasi errore di file non trovato.
 */
function renderConfirmationHtml_(token, tokenData) {
  const safeToken = token ? String(token).replace(/[^a-zA-Z0-9]/g, '') : '';
  const tokenJson = JSON.stringify(tokenData || null);

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <base target="_top" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Conferma Appuntamento</title>
  <meta property="og:title" content="Conferma Appuntamento" />
  <meta property="og:description" content="Conferma la tua presenza o richiedi una modifica con un clic" />
  <meta property="og:type" content="website" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #1a73e8;
      --success: #1e8e3e;
      --danger: #d93025;
      --bg: #f8f9fa;
      --card-bg: #ffffff;
      --text: #202124;
      --text-muted: #5f6368;
      --border: #dadce0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Google Sans", Roboto, -apple-system, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px 16px;
    }
    .card {
      background: var(--card-bg);
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(60,64,67,0.1), 0 4px 12px rgba(60,64,67,0.15);
      border: 1px solid var(--border);
      max-width: 440px;
      width: 100%;
      padding: 32px 24px;
      text-align: center;
    }
    h1 { font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .lead { font-size: 15px; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5; }
    .appointment-box { background: #f1f3f4; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .appointment-box .date-time { font-size: 18px; font-weight: 700; color: var(--text); margin-top: 4px; }
    .btn-container { display: flex; flex-direction: column; gap: 12px; }
    .btn {
      width: 100%;
      padding: 14px 20px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-decoration: none;
    }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .btn-confirm { background-color: var(--success); color: #ffffff; box-shadow: 0 2px 6px rgba(30,142,62,0.3); }
    .btn-confirm:hover:not(:disabled) { background-color: #187733; }
    .btn-reschedule { background-color: #ffffff; color: var(--danger); border: 1px solid #f28b82; }
    .btn-reschedule:hover:not(:disabled) { background-color: #fce8e6; }
    .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 14px; font-weight: 500; margin-bottom: 16px; }
    .status-badge.confirmed { background: #e6f4ea; color: var(--success); border: 1px solid #ceead6; }
    .status-badge.rescheduled { background: #fce8e6; color: var(--danger); border: 1px solid #fad2cf; }
    .footer-note { font-size: 12px; color: var(--text-muted); margin-top: 24px; line-height: 1.4; }
    .spinner {
      border: 3px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top: 3px solid #ffffff;
      width: 20px;
      height: 20px;
      animation: spin 1s linear infinite;
      display: inline-block;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card" id="main-card">
    <div id="view-invalid" style="display: none;">
      <h1>Link non valido</h1>
      <p class="lead">Questo link di conferma non è valido oppure è già scaduto.</p>
      <p class="footer-note">Per qualsiasi informazione sul tuo appuntamento, ti invitiamo a contattarci direttamente.</p>
    </div>
    <div id="view-confirmed" style="display: none;">
      <div class="status-badge confirmed">Appuntamento Confermato</div>
      <h1>Ti aspettiamo!</h1>
      <p class="lead">Ciao <strong id="confirmed-name"></strong>, la tua conferma per <strong id="confirmed-date"></strong> alle ore <strong id="confirmed-time"></strong> è già stata registrata.</p>
      <p class="footer-note">Per qualsiasi successiva modifica o disdetta, ti invitiamo a contattarci telefonicamente.</p>
    </div>
    <div id="view-rescheduled" style="display: none;">
      <div class="status-badge rescheduled">Richiesta Ricevuta</div>
      <h1>Richiesta Registrata</h1>
      <p class="lead">Ciao <strong id="rescheduled-name"></strong>, abbiamo registrato la tua richiesta di spostamento/annullamento per il <strong id="rescheduled-date"></strong>.</p>
      <p class="footer-note">Ti contatteremo al più presto per concordare un nuovo orario o liberare lo slot. A presto!</p>
    </div>
    <div id="view-pending" style="display: none;">
      <h1>Promemoria Appuntamento</h1>
      <p class="lead">Ciao <strong id="pending-name"></strong>, confermi il tuo appuntamento?</p>
      <div class="appointment-box">
        <div style="font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Data e Ora</div>
        <div class="date-time" id="pending-datetime"></div>
      </div>
      <div class="btn-container">
        <button type="button" class="btn btn-confirm" id="btn-confirm" onclick="submitChoice('confirm')">
          <span id="txt-confirm">Confermo l'appuntamento</span>
        </button>
        <button type="button" class="btn btn-reschedule" id="btn-reschedule" onclick="submitChoice('reschedule')">
          <span id="txt-reschedule">Vorrei spostare o annullare</span>
        </button>
      </div>
      <p class="footer-note">La tua risposta verrà memorizzata istantaneamente.</p>
    </div>
    <div id="view-result" style="display: none;"></div>
  </div>
  <script>
    var TOKEN = "${safeToken}";
    var TOKEN_DATA = ${tokenJson};
    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    function initPage() {
      if (!TOKEN_DATA || !TOKEN_DATA.status) {
        document.getElementById("view-invalid").style.display = "block";
        return;
      }
      if (TOKEN_DATA.status === "confirmed") {
        document.getElementById("confirmed-name").textContent = TOKEN_DATA.firstName || TOKEN_DATA.clientName || "";
        document.getElementById("confirmed-date").textContent = TOKEN_DATA.date || "";
        document.getElementById("confirmed-time").textContent = TOKEN_DATA.time || "";
        document.getElementById("view-confirmed").style.display = "block";
      } else if (TOKEN_DATA.status === "rescheduled") {
        document.getElementById("rescheduled-name").textContent = TOKEN_DATA.firstName || TOKEN_DATA.clientName || "";
        document.getElementById("rescheduled-date").textContent = TOKEN_DATA.date || "";
        document.getElementById("view-rescheduled").style.display = "block";
      } else {
        document.getElementById("pending-name").textContent = TOKEN_DATA.firstName || TOKEN_DATA.clientName || "";
        document.getElementById("pending-datetime").textContent = (TOKEN_DATA.date || "") + " • ore " + (TOKEN_DATA.time || "");
        document.getElementById("view-pending").style.display = "block";
      }
    }
    function submitChoice(choice) {
      var btnConfirm = document.getElementById("btn-confirm");
      var btnReschedule = document.getElementById("btn-reschedule");
      if (!btnConfirm || !btnReschedule) return;
      btnConfirm.disabled = true;
      btnReschedule.disabled = true;
      var activeBtn = choice === "confirm" ? btnConfirm : btnReschedule;
      activeBtn.innerHTML = '<div class="spinner"></div> Registrazione in corso...';
      google.script.run
        .withSuccessHandler(onSuccess)
        .withFailureHandler(onError)
        .submitClientConfirmation(TOKEN, choice);
    }
    function onSuccess(res) {
      var pending = document.getElementById("view-pending");
      if (pending) pending.style.display = "none";
      var resultSection = document.getElementById("view-result");
      resultSection.style.display = "block";
      if (res && res.status === "confirmed") {
        resultSection.innerHTML = 
          '<div class="status-badge confirmed">Appuntamento Confermato</div>' +
          '<h1>Grazie ' + escapeHtml(res.clientName) + '!</h1>' +
          '<p class="lead">La tua conferma è stata registrata con successo sul calendario.</p>' +
          '<p class="footer-note">Per qualsiasi successiva modifica o imprevisto, ti chiediamo di avvisare direttamente al telefono.</p>';
      } else if (res && res.status === "rescheduled") {
        resultSection.innerHTML = 
          '<div class="status-badge rescheduled">Richiesta Ricevuta</div>' +
          '<h1>Richiesta Inviata</h1>' +
          '<p class="lead">Abbiamo registrato la tua richiesta di annullamento/spostamento.</p>' +
          '<p class="footer-note">Ti ricontatteremo al più presto. Grazie per averci avvisato!</p>';
      } else if (res && res.alreadyAnswered) {
        resultSection.innerHTML = 
          '<h1>Risposta già registrata</h1>' +
          '<p class="lead">' + escapeHtml(res.message) + '</p>';
      } else {
        resultSection.innerHTML = 
          '<h1>Attenzione</h1>' +
          '<p class="lead">' + escapeHtml(res ? res.message : "Si è verificato un errore.") + '</p>';
      }
    }
    function onError(err) {
      var viewPending = document.getElementById("view-pending");
      var resultSection = document.getElementById("result-section");
      if (viewPending && resultSection) {
        viewPending.style.display = "none";
        resultSection.style.display = "block";
        resultSection.innerHTML = 
          '<h1>Attenzione</h1>' +
          '<p class="lead">Si è verificato un errore di connessione. Riprova più tardi.</p>';
      }
      var btnConfirm = document.getElementById("btn-confirm");
      var btnReschedule = document.getElementById("btn-reschedule");
      if (btnConfirm) btnConfirm.disabled = false;
      if (btnReschedule) btnReschedule.disabled = false;
      var txtConfirm = document.getElementById("txt-confirm");
      if (txtConfirm) txtConfirm.textContent = "Confermo l'appuntamento";
      var txtReschedule = document.getElementById("txt-reschedule");
      if (txtReschedule) txtReschedule.textContent = "Vorrei spostare o annullare";
    }
    document.addEventListener("DOMContentLoaded", initPage);
  </script>
</body>
</html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle("Conferma Appuntamento")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1");
}
