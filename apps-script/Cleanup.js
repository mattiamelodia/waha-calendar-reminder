function cleanupSentStatusProperties() {
  const lockResult = withScriptLock_(20000, () => {
    removeClientsWithoutPhone();
    checkQuotaUsage_();

    const relevantEvents = [
      ...getReminderDataForDay("tomorrow"),
      ...getReminderDataForDay("dayAfterTomorrow"),
    ];

    const relevantEventIds = relevantEvents.map((e) => e.id);

    const props = PropertiesService.getScriptProperties();
    const allProperties = props.getProperties();
    const allPropertyKeys = Object.keys(allProperties);

    const calendarEventKeys = allPropertyKeys.filter((key) =>
      key.includes("@google.com")
    );
    Logger.log(`Trovate ${calendarEventKeys.length} proprietà candidate come Event ID di Google Calendar su un totale di ${allPropertyKeys.length} proprietà.`);

    const keysToDelete = calendarEventKeys.filter((key) => {
      const rawId = key.replace(/^(confirm_|reminder_)/, "");
      return !relevantEventIds.includes(rawId);
    });

    const keysAlreadyIn = calendarEventKeys.filter((key) => {
      const rawId = key.replace(/^(confirm_|reminder_)/, "");
      return relevantEventIds.includes(rawId);
    });

    if (keysToDelete.length > 0) {
      Logger.log(`Eliminazione di ${keysToDelete.length} proprietà obsolete (eventi non più rilevanti)...`);
      for (const key of keysToDelete) {
        props.deleteProperty(key);
      }
      Logger.log(
        `Pulizia completata: eliminate ${keysToDelete.length} proprietà obsolete di ${calendarEventKeys.length} proprietà totali di eventi del calendario identificate.`
      );
    } else {

      Logger.log(
        `Nessuna proprietà obsoleta da eliminare. Trovate ${calendarEventKeys.length} proprietà di eventi del calendario identificate.`
      );
    }

    if (keysAlreadyIn.length > 0) {
      Logger.log(`Reset di ${keysAlreadyIn.length} proprietà per eventi ancora rilevanti...`);
      for (const key of keysAlreadyIn) {
        props.deleteProperty(key);
      }
      Logger.log(
        `Reset completato: eliminate ${keysAlreadyIn.length} proprietà di ${calendarEventKeys.length} proprietà totali di eventi del calendario identificate (corrispondenti a eventi ancora rilevanti).`
      );
    } else {

      Logger.log(
        `Nessuna proprietà da resettare per eventi ancora rilevanti. Trovate ${calendarEventKeys.length} proprietà di eventi del calendario identificate.`
      );
    }

    // Pulizia periodica di tutte le proprietà temporanee (SHORT_*, RUNSTATS_* > 7gg, CONFIRM_* > 3gg)
    cleanupObsoleteProperties_();

    return {
      calendarEventProperties: calendarEventKeys.length,
      cleaned: keysToDelete.length,
      remaining: calendarEventKeys.length - keysToDelete.length,
    };
  });

  return lockResult.ran ? lockResult.value : null;
}

function getAllRelevantEvents() {

  const calendar = getCalendar();
  if (!calendar) {
    Logger.log("Impossibile ottenere l'oggetto Calendar. Ritorno array vuoto.");
    return [];
  }

  const tomorrowRange = calculateDateRange("tomorrow");

  const tomorrowEvents = calendar.getEvents(
    tomorrowRange.startDate,
    tomorrowRange.endDate
  );
  Logger.log(`Trovati ${tomorrowEvents.length} eventi per domani.`);

  const dayAfterTomorrowRange = calculateDateRange("dayAfterTomorrow");

  const dayAfterTomorrowEvents = calendar.getEvents(
    dayAfterTomorrowRange.startDate,
    dayAfterTomorrowRange.endDate
  );
  Logger.log(`Trovati ${dayAfterTomorrowEvents.length} eventi per dopodomani.`);

  return [...tomorrowEvents, ...dayAfterTomorrowEvents];
}

function setupDailyCleanupTrigger() {
  Logger.log("Configurazione trigger giornaliero per cleanupSentStatusProperties...");

  const triggers = ScriptApp.getProjectTriggers();

  for (const trigger of triggers) {

    if (trigger.getHandlerFunction() === "cleanupSentStatusProperties") {

      Logger.log(`Rimosso trigger esistente per ${trigger.getHandlerFunction()}.`);
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger("cleanupSentStatusProperties")
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  Logger.log("Trigger giornaliero per cleanupSentStatusProperties configurato per le 3:00 AM.");

  return "Trigger di pulizia giornaliero configurato con successo";
}


function removeUnregisteredAppointmentsYesterday() {
  return withScriptLock_(20000, () => {
    const sheetAppuntamenti = getClientSheet(CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME);
    const sheetClienti = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);

    if (!sheetAppuntamenti || !sheetClienti) {
      Logger.log("Errore: uno dei due fogli non esiste.");
      return;
    }

    const lastRowApp = sheetAppuntamenti.getLastRow();
    const lastRowClienti = sheetClienti.getLastRow();

    if (lastRowApp <= 1 || lastRowClienti <= 1) {
      Logger.log("Nessun appuntamento o cliente oltre l'intestazione. Uscita pulita.");
      return;
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const range = sheetAppuntamenti.getRange(2, 1, lastRowApp - 1, 4);
    const data = range.getValues();

    const nomiClienti = sheetClienti.getRange("A2:A" + lastRowClienti).getValues().flat()
      .map(n => n.toString().trim().toLowerCase());

    const righeDaEliminare = [];

    for (let i = 0; i < data.length; i++) {
      const nome = data[i][1];       // colonna B
      const dataAppuntamento = data[i][2]; // colonna C
      const normNome = nome.toString().trim().toLowerCase();

      if (
        dataAppuntamento instanceof Date &&
        isSameDay(dataAppuntamento, yesterday) &&
        normNome &&
        !nomiClienti.includes(normNome)
      ) {
        righeDaEliminare.push(i + 2);
      }
    }

    Logger.log(`Trovate ${righeDaEliminare.length} righe da eliminare (appuntamenti ieri con nomi non registrati).`);

    for (let i = righeDaEliminare.length - 1; i >= 0; i--) {
      sheetAppuntamenti.deleteRow(righeDaEliminare[i]);
    }

    Logger.log(`Eliminate ${righeDaEliminare.length} righe.`);
  });
}

function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate();
}

function setupDailyCleanupYesterdayTrigger() {
  Logger.log("Configurazione trigger giornaliero per removeUnregisteredAppointmentsYesterday...");

  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "removeUnregisteredAppointmentsYesterday") {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("Trigger esistente rimosso.");
    }
  }

  ScriptApp.newTrigger("removeUnregisteredAppointmentsYesterday")
    .timeBased()
    .atHour(3)
    .nearMinute(30)
    .everyDays(1)
    .create();

  Logger.log("Trigger giornaliero configurato con successo per removeUnregisteredAppointmentsYesterday.");
}
