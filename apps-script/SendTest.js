/**
 * Quick manual check of the Apps Script -> WAHA connection.
 *
 * Reads WEBHOOK_URL and WEBHOOK_SECRET (the WAHA base URL and API key) and TEST_NUMBER (the
 * recipient, with country code) from Project settings > Script properties. Nothing is hard-coded.
 * Run `testWahaSend` from the editor; the result is written to the log (HTTP status code only,
 * never the key or the number).
 */
function testWahaSend() {
  const wahaBaseUrl = getConfig(CONFIG_KEYS.WEBHOOK_URL, null);
  const apiKey = getConfig(CONFIG_KEYS.WEBHOOK_SECRET, null);
  const testNumber = getConfig('TEST_NUMBER', null);

  const missing = [];
  if (!wahaBaseUrl) missing.push(CONFIG_KEYS.WEBHOOK_URL);
  if (!apiKey) missing.push(CONFIG_KEYS.WEBHOOK_SECRET);
  if (!testNumber) missing.push('TEST_NUMBER');
  if (missing.length > 0) {
    Logger.log("testWahaSend: Proprietà script mancanti: " + missing.join(", "));
    return;
  }

  const cleanNumber = testNumber.toString().replace(/[^\d]/g, "");
    const wahaSession = getConfig(CONFIG_KEYS.WAHA_SESSION, 'default');
    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": {
        "X-Api-Key": apiKey
      },
      "payload": JSON.stringify({
        "chatId": cleanNumber + "@c.us",
        "text": "prova WAHA",
        "session": wahaSession
      }),
      "muteHttpExceptions": true
    };

    const apiUrl = `${wahaBaseUrl.replace(/\/$/, "")}/api/sendText`;
    const response = UrlFetchApp.fetch(apiUrl, options);
    Logger.log("testWahaSend: HTTP " + response.getResponseCode());
  }

  /**
   * Interroga WAHA e stampa nel log l'elenco delle sessioni attive, i relativi nomi
   * e i numeri di telefono collegati. Utile quando si hanno più sessioni/numeri su WAHA.
   */
  function checkWahaSessions() {
    const wahaBaseUrl = getConfig(CONFIG_KEYS.WEBHOOK_URL, null);
    const apiKey = getConfig(CONFIG_KEYS.WEBHOOK_SECRET, null);

    if (!wahaBaseUrl) {
      Logger.log("checkWahaSessions: Proprietà WEBHOOK_URL mancante.");
      return;
    }

    const options = {
      method: "get",
      headers: apiKey ? { "X-Api-Key": apiKey } : {},
      muteHttpExceptions: true
    };

    const apiUrl = `${wahaBaseUrl.replace(/\/$/, "")}/api/sessions?all=true`;
    const response = UrlFetchApp.fetch(apiUrl, options);
    const code = response.getResponseCode();

    if (code !== 200) {
      Logger.log(`checkWahaSessions: Errore HTTP ${code}: ${response.getContentText()}`);
      return;
    }

    try {
      const sessions = JSON.parse(response.getContentText());
      Logger.log("========================================");
      Logger.log("=== SESSIONI WAHA ATTIVE RILEVATE ===");
      Logger.log("========================================");
      if (!Array.isArray(sessions) || sessions.length === 0) {
        Logger.log("Nessuna sessione trovata su WAHA.");
        return;
      }
      sessions.forEach((s, idx) => {
        const name = s.name || s.id || "n/d";
        const status = s.status || "n/d";
        const phone = s.me?.id ? s.me.id.replace(/@.*$/, "") : (s.phone || "Non autenticato / QR da scansionare");
        Logger.log(`[${idx + 1}] Nome: "${name}" | Stato: ${status} | Numero: ${phone}`);
      });
      Logger.log("========================================");
      Logger.log("Usa il nome della sessione desiderata nella configurazione WAHA_SESSION.");
    } catch (err) {
      Logger.log("checkWahaSessions: Errore parsing risposta: " + err.message);
    }
  }
