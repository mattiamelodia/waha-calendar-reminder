function notifyGotify(title, message, priority) {
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('GOTIFY_URL');
    const token = props.getProperty('GOTIFY_TOKEN');
    if (!url || !token) return;
    UrlFetchApp.fetch(url.replace(/\/$/, "") + '/message', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Gotify-Key': token },
      payload: JSON.stringify({ title: title, message: message, priority: priority }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Gotify non raggiungibile: " + e.message);
  }
}

function testGotify() {
  notifyGotify("Test da Apps Script", "Se leggi questo, Google raggiunge Gotify.", 3);
}












/**
 * Funzione principale AGGIORNATA per WAHA.
 * Invia i promemoria automatici parlando direttamente con l'API di WAHA sul tuo VPS.
 * Viene eseguita da un trigger giornaliero.
 */
function sendAutomaticReminders() {
  Logger.log("--- [WAHA] Avvio processo di invio promemoria automatici ---");

  const wahaBaseUrl = getConfig(CONFIG_KEYS.WEBHOOK_URL, null);
  const apiKey = getConfig(CONFIG_KEYS.WEBHOOK_SECRET, null);

  if (!wahaBaseUrl || !apiKey || !wahaBaseUrl.startsWith('http')) {
    Logger.log("ERRORE: URL di WAHA o API Key non configurati correttamente nelle Proprietà dello Script.");
    return;
  }

  const confirmationDays = parseInt(getConfig(CONFIG_KEYS.CONFIRMATION_DAYS_IN_ADVANCE, '1'), 10);
  const confirmationLinksEnabled = getConfirmationLinksEnabled();
  const defaultConfirmationTemplate = "Ciao %NOME%, ti chiediamo gentilmente di confermare il tuo appuntamento per %DATA% alle ore %ORE%.\n\nPuoi confermare la tua presenza (o comunicarci una modifica con 1 clic) tramite questo link:\n%LINK%\n\nGrazie per la collaborazione!";
  const templateConfirmation = getConfig(CONFIG_KEYS.MESSAGE_TEMPLATE, defaultConfirmationTemplate) || defaultConfirmationTemplate;
  const finalReminderEnabled = getConfig(CONFIG_KEYS.FINAL_REMINDER_ENABLED, 'true') === 'true';
  const finalOnlyConfirmed = getConfig(CONFIG_KEYS.FINAL_REMINDER_ONLY_CONFIRMED, 'false') === 'true';
  const defaultFinalTemplate = "Ciao %NOME%, ti ricordiamo il tuo appuntamento fissato per domani alle ore %ORE%. Ti aspettiamo!";
  const templateFinal = getConfig(CONFIG_KEYS.MESSAGE_TEMPLATE_FINAL, defaultFinalTemplate) || defaultFinalTemplate;

  let totalSent = 0;
  let totalAttempted = 0;
  const errors = [];

  const wahaSession = getConfig(CONFIG_KEYS.WAHA_SESSION, "default");

  function sendWahaMsg(chatId, text) {
    const payload = {
      chatId: chatId,
      text: text,
      session: wahaSession,
      linkPreview: false
    };

    const options = {
      method: "post",
      contentType: "application/json",
      headers: { "X-Api-Key": apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    const apiUrl = `${wahaBaseUrl.replace(/\/$/, "")}/api/sendText`;
    return UrlFetchApp.fetch(apiUrl, options);
  }

  // ---- FASE 1: Richiesta di conferma N giorni prima ----
  if (confirmationDays > 0 && confirmationLinksEnabled) {
    const dayKey = confirmationDays === 1 ? 'tomorrow' : (confirmationDays === 2 ? 'dayAfterTomorrow' : (confirmationDays === 3 ? 'in3days' : confirmationDays));
    const confirmAppointments = getReminderDataForDay(dayKey) || [];
    Logger.log(`[Fase 1 - Conferma ${confirmationDays}gg prima] Trovati ${confirmAppointments.length} appuntamenti.`);

    const toSendConfirm = confirmAppointments.filter(app => {
      const hasValidNumber = app.number && app.number !== "N/A";
      const isAlreadySent = getSentStatus(app.id, 'confirm') || getSentStatus(app.id);
      const isCancelled = app.name && (app.name.includes('[SPOSTARE]') || app.name.includes('[ANNULLATO]'));
      return hasValidNumber && !isAlreadySent && !isCancelled;
    });

    for (const app of toSendConfirm) {
      totalAttempted++;
      try {
        const confirmUrl = confirmationLinksEnabled ? getConfirmationUrl_(app) : '';
        const personalMessage = personalizeMessage(templateConfirmation, app.firstName, app.date, app.time, confirmUrl);
        const cleanNumber = app.number.toString().replace(/[^\d]/g, "");
        const chatId = cleanNumber + "@c.us";

        const response = sendWahaMsg(chatId, personalMessage);
        const code = response.getResponseCode();
        if (code === 200 || code === 201) {
          updateSentStatus(app.id, true, 'confirm');
          updateSentStatus(app.id, true);
          totalSent++;
          Logger.log(`✅ [Conferma] Inviato a ${app.name} (${cleanNumber})`);
        } else {
          errors.push(`HTTP ${code}`);
          Logger.log(`❌ ERRORE invio conferma a ${app.name}: HTTP ${code}`);
        }
        if (toSendConfirm.length > 1) {
          Utilities.sleep(2000);
        }
      } catch (err) {
        errors.push(err.message);
        Logger.log(`⚠️ ERRORE critico conferma per ${app.name}: ${err.message}`);
      }
    }
  }

  // ---- FASE 2: Promemoria finale il giorno prima (se confirmationDays != 1 o conferma disattivata, e finalReminderEnabled) ----
  if ((confirmationDays !== 1 || !confirmationLinksEnabled) && finalReminderEnabled) {
    const tomorrowAppointments = getReminderDataForDay("tomorrow") || [];
    Logger.log(`[Fase 2 - Promemoria Finale 24h] Trovati ${tomorrowAppointments.length} appuntamenti per domani.`);

    const toSendFinal = tomorrowAppointments.filter(app => {
      const hasValidNumber = app.number && app.number !== "N/A";
      const isAlreadySentFinal = getSentStatus(app.id, 'final');
      const isCancelled = app.name && (app.name.includes('[SPOSTARE]') || app.name.includes('[ANNULLATO]'));
      const isConfirmed = app.name && (app.name.includes('[OK]') || app.name.includes('[CONFERMATO]'));

      if (finalOnlyConfirmed && !isConfirmed) {
        return false;
      }
      return hasValidNumber && !isAlreadySentFinal && !isCancelled;
    });

    for (const app of toSendFinal) {
      totalAttempted++;
      try {
        const personalMessage = personalizeMessage(templateFinal, app.firstName, app.date, app.time, null);
        const cleanNumber = app.number.toString().replace(/[^\d]/g, "");
        const chatId = cleanNumber + "@c.us";

        const response = sendWahaMsg(chatId, personalMessage);
        const code = response.getResponseCode();
        if (code === 200 || code === 201) {
          updateSentStatus(app.id, true, 'final');
          totalSent++;
          Logger.log(`✅ [Promemoria Finale] Inviato a ${app.name} (${cleanNumber})`);
        } else {
          errors.push(`HTTP ${code}`);
          Logger.log(`❌ ERRORE finale per ${app.name}: HTTP ${code}`);
        }
        if (toSendFinal.length > 1) {
          Utilities.sleep(2000);
        }
      } catch (err) {
        errors.push(err.message);
        Logger.log(`⚠️ ERRORE critico finale per ${app.name}: ${err.message}`);
      }
    }
  }

  Logger.log(`--- Fine processo: ${totalSent} inviati su ${totalAttempted} tentativi ---`);

  if (totalAttempted > 0) {
    if (errors.length === 0) {
      notifyGotify("✅ Promemoria WhatsApp", `${totalSent} promemoria inviati con successo.`, 3);
    } else {
      notifyGotify("❌ Promemoria WhatsApp", `${totalSent} inviati su ${totalAttempted}, ${errors.length} errori (${errors[0]}).`, 8);
    }
  }
}

/**
 * Crea o aggiorna il trigger giornaliero per l'invio automatico dei promemoria.
 */
function setupDailyReminderTrigger() {
  const functionName = "sendAutomaticReminders";
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .atHour(9) 
    .everyDays(1)
    .create();
  Logger.log(`Trigger giornaliero configurato per le 9:00 AM.`);
}

/**
 * Invia manualmente un singolo promemoria tramite WAHA per un determinato appuntamento dalla dashboard.
 */
/**
 * Invia manualmente un singolo promemoria tramite WAHA per un determinato appuntamento dalla dashboard.
 * @param {string} eventId - ID dell'evento
 * @param {string} [type='confirm'] - 'confirm' per richiesta di conferma 1-click, 'reminder' per promemoria di cortesia
 */
function sendSingleReminderViaWaha(eventId, type) {
  if (!eventId) {
    throw new Error("ID appuntamento mancante.");
  }

  const sendType = (type === 'reminder' || type === 'final') ? 'reminder' : 'confirm';

  const wahaBaseUrl = getConfig(CONFIG_KEYS.WEBHOOK_URL, null);
  const apiKey = getConfig(CONFIG_KEYS.WEBHOOK_SECRET, null);
  if (!wahaBaseUrl || !apiKey || !wahaBaseUrl.startsWith('http')) {
    throw new Error("URL di WAHA o API Key non configurati nelle Proprietà dello Script.");
  }

  let targetApp = null;
  const days = ["tomorrow", "today", "dayAfterTomorrow"];
  for (const d of days) {
    const list = getReminderDataForDay(d);
    if (list && list.length > 0) {
      targetApp = list.find(a => a.id === eventId);
      if (targetApp) break;
    }
  }

  if (!targetApp) {
    throw new Error("Appuntamento non trovato nei dati dei promemoria.");
  }

  if (!targetApp.number || targetApp.number === "N/A") {
    throw new Error(`Nessun numero di telefono valido per ${targetApp.name}.`);
  }

  const cleanNumber = targetApp.number.toString().replace(/[^\d]/g, "");
  const chatId = cleanNumber + "@c.us";

  let personalMessage = "";
  let confirmUrl = "";

  if (sendType === 'confirm') {
    const defaultConfirmationTemplate = "Ciao %NOME%, ti chiediamo gentilmente di confermare il tuo appuntamento per %DATA% alle ore %ORE%.\n\nPuoi confermare la tua presenza (o comunicarci una modifica con 1 clic) tramite questo link:\n%LINK%\n\nGrazie per la collaborazione!";
    const messageTemplate = getConfig(CONFIG_KEYS.MESSAGE_TEMPLATE, defaultConfirmationTemplate) || defaultConfirmationTemplate;
    confirmUrl = getConfirmationUrl_(targetApp, true);
    personalMessage = personalizeMessage(
      messageTemplate,
      targetApp.firstName,
      targetApp.date,
      targetApp.time,
      confirmUrl
    );
  } else {
    const defaultFinalTemplate = "Ciao %NOME%, ti ricordiamo il tuo appuntamento fissato per domani alle ore %ORE%. Ti aspettiamo!";
    const messageTemplate = getConfig(CONFIG_KEYS.MESSAGE_TEMPLATE_FINAL, defaultFinalTemplate) || defaultFinalTemplate;
    personalMessage = personalizeMessage(
      messageTemplate,
      targetApp.firstName,
      targetApp.date,
      targetApp.time,
      null
    );
  }

  const wahaSession = getConfig(CONFIG_KEYS.WAHA_SESSION, "default");

  const payload = {
    chatId: chatId,
    text: personalMessage,
    session: wahaSession,
    linkPreview: false
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "X-Api-Key": apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const apiUrl = `${wahaBaseUrl.replace(/\/$/, "")}/api/sendText`;
  const response = UrlFetchApp.fetch(apiUrl, options);
  const responseCode = response.getResponseCode();

  if (responseCode !== 200 && responseCode !== 201) {
    throw new Error(`Errore invio messaggio a ${targetApp.name}: HTTP ${responseCode}`);
  }

  if (sendType === 'confirm') {
    updateSentStatus(targetApp.id, true, 'confirm');
  } else {
    updateSentStatus(targetApp.id, true, 'final');
  }
  updateSentStatus(targetApp.id, true);

  Logger.log(`✅ [Manuale - ${sendType}] Messaggio inviato a ${targetApp.name} (${cleanNumber})`);

  return {
    success: true,
    clientName: targetApp.name,
    number: cleanNumber,
    type: sendType
  };
}
