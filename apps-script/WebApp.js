function doGet(e) {
  try {
    // 1. Route per la conferma 1-click del cliente (?token=<token> o ?confirm=<token> o ?t=<token>)
    const token = (e && e.parameter) ? (e.parameter.token || e.parameter.confirm || e.parameter.t || e.parameter.c) : null;
    if (token) {
      const tokenData = getConfirmationData_(token);
      return renderConfirmationHtml_(token, tokenData);
    }

    // 2. Protezione di sicurezza Dashboard: autorizza solo l'account Google della titolare o parametro admin
    const activeUser = Session.getActiveUser().getEmail();
    const effectiveUser = Session.getEffectiveUser().getEmail();
    const isOwner = Boolean(activeUser) && Boolean(effectiveUser) && activeUser.toLowerCase() === effectiveUser.toLowerCase();
    const adminKey = getConfig(CONFIG_KEYS.ADMIN_SECRET, null);
    const isAuthorized = isOwner || (adminKey && e && e.parameter && e.parameter.admin === adminKey);

    if (!isAuthorized) {
      return HtmlService.createHtmlOutput(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#3c4043;}' +
        '.box{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.08);text-align:center;max-width:360px;}' +
        'h2{margin-top:0;font-size:20px;}p{font-size:14px;color:#5f6368;}</style></head>' +
        '<body><div class="box"><h2>Accesso Riservato</h2><p>Questa pagina è riservata all\'amministrazione.</p></div></body></html>'
      ).setTitle("Accesso Riservato");
    }

    // 3. Renderizza la dashboard di gestione per l'amministratore autorizzato
    const template = HtmlService.createTemplateFromFile("Page");
    template.lastUpdated = new Date().toLocaleString();
    template.data = getReminderDataForDay("tomorrow");

    return template
      .evaluate()
      .setTitle("WhatsApp Reminder Dashboard")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  } catch (err) {
    Logger.log("❌ Errore in doGet: " + err + (err.stack ? "\n" + err.stack : ""));
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Errore</title>' +
      '<style>body{font-family:sans-serif;padding:30px;line-height:1.6;color:#333;}' +
      '.err{background:#fee;border:1px solid #fcc;padding:20px;border-radius:8px;max-width:600px;margin:20px auto;}' +
      'pre{background:#fff;padding:10px;border-radius:4px;overflow-x:auto;font-size:13px;}</style></head>' +
      '<body><div class="err"><h2>⚠️ Errore caricamento pagina</h2>' +
      '<p>Si è verificato il seguente errore durante l\'apertura della pagina:</p>' +
      '<pre>' + String(err) + (err.stack ? '\n\nStack:\n' + err.stack : '') + '</pre>' +
      '<p style="font-size:12px;color:#666;">Verifica i log in Google Apps Script > Esecuzioni.</p></div></body></html>'
    ).setTitle("Errore");
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
    .getContent();
}

function getReminderDataForDay(dayType) {
  Logger.log("--- Inizio getReminderDataForDay per " + dayType + " (leggendo telefono da Cache) ---");

  const appointmentsSheet = getClientSheet(CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME);
  const appointmentsData = appointmentsSheet.getDataRange().getDisplayValues();
  Logger.log(`Letto foglio appuntamenti "${CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME}". Righe totali (inclusa intestazione): ` + appointmentsData.length);

  if (appointmentsData.length <= 1) {
    Logger.log(`Nessun appuntamento trovato nel foglio "${CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME}" (solo intestazione o vuoto).`);
    Logger.log("--- Fine getReminderDataForDay (nessun dato) ---");
    return [];
  }

  const { startDate, endDate } = calculateDateRange(dayType);
  Logger.log("Intervallo date calcolato per '" + dayType + "': dal " + startDate + " al " + endDate + ".");

  const filteredAppointmentsData = appointmentsData
    .slice(1)
    .filter((row, index) => {
      const appointmentDateStr = row[CACHE_COL_DATE];
      if (!appointmentDateStr) return false;

      let appointmentDate;
      try {
        appointmentDate = new Date(appointmentDateStr);
        if (isNaN(appointmentDate.getTime())) {
          Logger.log(`Riga ${index + 2}: Data non valida '${appointmentDateStr}', scartata.`);
          return false;
        }
      } catch (e) {
        Logger.log(`Riga ${index + 2}: Errore convertendo data '${appointmentDateStr}': ${e}. Scartata.`);
        return false;
      }

      return appointmentDate.getTime() >= startDate.getTime() && appointmentDate.getTime() < endDate.getTime();
    });

  Logger.log("Filtraggio completato. Trovati " + filteredAppointmentsData.length + " appuntamenti per '" + dayType + "'.");

  const messageTemplate = getConfig(
    CONFIG_KEYS.MESSAGE_TEMPLATE,
    "Promemoria Appuntamento: Ciao [Nome Cliente], ti ricordo il tuo appuntamento il [Data] alle [Ora]."
  );

  const sentIds = getSentIds_();
  const confirmationLinksEnabled = getConfirmationLinksEnabled();
  const finalReminderEnabled = (getConfig(CONFIG_KEYS.FINAL_REMINDER_ENABLED, 'true') || 'true') === 'true';

  const finalData = filteredAppointmentsData.map((row, index) => {

    const eventId = row[CACHE_COL_EVENT_ID];
    const contactName = row[CACHE_COL_NAME];
    const rawDate = row[CACHE_COL_DATE];
    const rawTime = row[CACHE_COL_TIME];

    const clientPhoneRaw = row[CACHE_COL_PHONE]?.trim();

    const clientPhone = clientPhoneRaw || "N/A";

    let formattedDate = "Data Sconosciuta";
    let formattedTime = rawTime?.trim() || "Ora Sconosciuta";

    try {
      if (rawDate) {
        formattedDate = formatDate(new Date(rawDate), "dd/MM/yyyy");
      }
    } catch (e) {

    }

    let firstName = "Cliente";
    try {
      const extracted = extractFirstName(contactName);
      if (extracted) firstName = extracted;
    } catch (e) {

    }

    const sentStatus = Boolean(eventId && sentIds.has(eventId));

    const appointmentObject = {
      id: eventId,
      name: contactName,
      contactName: contactName,
      firstName: firstName,
      date: formattedDate,
      time: formattedTime,
      number: clientPhone,
      link: "",
      sent: sentStatus,
      confirmationLinksEnabled: confirmationLinksEnabled,
      finalReminderEnabled: finalReminderEnabled,
    };

    if (clientPhone !== "N/A" && formattedDate !== "Data Sconosciuta") {
      try {
        const confirmUrl = getConfirmationUrl_(appointmentObject);
        const personalizedMessage = personalizeMessage(
          messageTemplate,
          appointmentObject.firstName,
          appointmentObject.date,
          appointmentObject.time,
          confirmUrl
        );
        const whatsappLink = createWhatsAppLink(clientPhone, personalizedMessage);
        appointmentObject.link = whatsappLink;
      } catch (e) {
        Logger.log(`Errore creazione messaggio/link per '${contactName}' (ID ${eventId}, Numero: ${clientPhone}): ${e}`);

      }
    } else {

    }

    return appointmentObject;
  });

  Logger.log("Mapping appuntamenti completato. Preparati " + finalData.length + " oggetti.");
  Logger.log("--- Fine getReminderDataForDay ---");

  return finalData;
}

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

/**
 * Restituisce le impostazioni generali del salone e del flusso promemoria.
 */
function getSalonSettings() {
  const props = PropertiesService.getScriptProperties();
  return {
    salonName: props.getProperty(CONFIG_KEYS.SALON_NAME) || 'Appuntamenti',
    salonLogoUrl: props.getProperty(CONFIG_KEYS.SALON_LOGO_URL) || '',
    wahaSession: props.getProperty(CONFIG_KEYS.WAHA_SESSION) || 'default',
    confirmationDays: parseInt(props.getProperty(CONFIG_KEYS.CONFIRMATION_DAYS_IN_ADVANCE) || '1', 10),
    confirmationLinksEnabled: getConfirmationLinksEnabled(),
    finalReminderEnabled: (props.getProperty(CONFIG_KEYS.FINAL_REMINDER_ENABLED) || 'true') === 'true',
    finalReminderOnlyConfirmed: (props.getProperty(CONFIG_KEYS.FINAL_REMINDER_ONLY_CONFIRMED) || 'false') === 'true',
    messageTemplateConfirmation: props.getProperty(CONFIG_KEYS.MESSAGE_TEMPLATE) || "Ciao %NOME%, ti chiediamo gentilmente di confermare il tuo appuntamento per %DATA% alle ore %ORE%.\n\nPuoi confermare la tua presenza (o comunicarci una modifica con 1 clic) tramite questo link:\n%LINK%\n\nGrazie per la collaborazione!",
    messageTemplateFinal: props.getProperty(CONFIG_KEYS.MESSAGE_TEMPLATE_FINAL) || "Ciao %NOME%, ti ricordiamo il tuo appuntamento fissato per domani alle ore %ORE%. Ti aspettiamo!"
  };
}

/**
 * Salva le impostazioni configurate dall'amministratore nella dashboard.
 */
function saveSalonSettings(settings) {
  if (!settings) return { success: false, message: 'Dati mancanti.' };
  const props = PropertiesService.getScriptProperties();

  if (settings.salonName !== undefined) {
    props.setProperty(CONFIG_KEYS.SALON_NAME, String(settings.salonName).trim());
  }
  if (settings.salonLogoUrl !== undefined) {
    props.setProperty(CONFIG_KEYS.SALON_LOGO_URL, String(settings.salonLogoUrl).trim());
  }
  if (settings.wahaSession !== undefined) {
    props.setProperty(CONFIG_KEYS.WAHA_SESSION, String(settings.wahaSession).trim() || 'default');
  }
  if (settings.confirmationDays !== undefined) {
    props.setProperty(CONFIG_KEYS.CONFIRMATION_DAYS_IN_ADVANCE, String(settings.confirmationDays));
  }
  if (settings.confirmationLinksEnabled !== undefined) {
    setConfirmationLinksEnabled(Boolean(settings.confirmationLinksEnabled));
  }
  if (settings.finalReminderEnabled !== undefined) {
    props.setProperty(CONFIG_KEYS.FINAL_REMINDER_ENABLED, settings.finalReminderEnabled ? 'true' : 'false');
  }
  if (settings.finalReminderOnlyConfirmed !== undefined) {
    props.setProperty(CONFIG_KEYS.FINAL_REMINDER_ONLY_CONFIRMED, settings.finalReminderOnlyConfirmed ? 'true' : 'false');
  }
  if (settings.messageTemplateConfirmation !== undefined) {
    props.setProperty(CONFIG_KEYS.MESSAGE_TEMPLATE, String(settings.messageTemplateConfirmation));
  }
  if (settings.messageTemplateFinal !== undefined) {
    props.setProperty(CONFIG_KEYS.MESSAGE_TEMPLATE_FINAL, String(settings.messageTemplateFinal));
  }

  // Pulisce eventuali vecchie proprietà SHORT_* rimaste orfane nelle Script Properties
  cleanupObsoleteProperties_();

  return { success: true };
}