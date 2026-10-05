function syncAppointmentsFromCalendar(e, timeoutMs) {
  const forceFullSync = (e === true);
  const timeout = typeof timeoutMs === 'number' ? timeoutMs : 0;

  return withScriptLock_(timeout, () => {
    const startTime = new Date();
    let ok = false;
    Logger.log(`--- Avvio Ciclo di Sincronizzazione (Forzato: ${forceFullSync}) ---`);

    try {
      let changesDetected = false;

      if (forceFullSync) {
        Logger.log("Full Sync forzata dal parametro.");
        changesDetected = true;
      } else {
        changesDetected = quickCheckSync();
      }

      if (changesDetected || forceFullSync) {
        fullSync(forceFullSync);
      }
      ok = true;
    } catch (e) {
      Logger.log(`--- Errore critico nel ciclo di Sincronizzazione: ${e} --- `);
    } finally {
      const totalScriptTime = new Date() - startTime;
      Logger.log(`--- Ciclo di Sincronizzazione completato. Tempo totale: ${totalScriptTime}ms ---`);
      recordRun_('sync', totalScriptTime, ok);

      const props = PropertiesService.getScriptProperties();
      const prevStreak = Number(props.getProperty('SYNC_FAIL_STREAK_COUNT') || '0');
      const newStreak = nextFailStreak_(prevStreak, ok);
      props.setProperty('SYNC_FAIL_STREAK_COUNT', String(newStreak));

      if (!ok) {
        if (newStreak >= 3) {
          notifyOnce_(
            'sync_fail',
            'Errore Sincronizzazione',
            `❌ Sincronizzazione calendario ferma (${newStreak} errori di fila)`,
            8,
            60
          );
        }
      } else {
        if (prevStreak >= 3) {
          notifyGotify('Sincronizzazione Ripristinata', '✅ Sincronizzazione ripristinata', 5);
          props.deleteProperty('LASTNOTIFY_sync_fail');
        }
      }
    }
  });
}

function needsPhoneRetry_(cacheData, nowMs, lastMs, intervalMin) {
  if (!cacheData || cacheData.length <= 1) return false;

  const intervalMs = (Number(intervalMin) || 10) * 60 * 1000;
  const elapsed = (Number(nowMs) || 0) - (Number(lastMs) || 0);
  if (elapsed < intervalMs) {
    return false;
  }

  for (let i = 1; i < cacheData.length; i++) {
    const row = cacheData[i];
    const phone = row[CACHE_COL_PHONE];
    if (!phone || String(phone).trim() === '') {
      return true;
    }
  }

  return false;
}

function markPhoneRetry_(nowMs) {
  const time = nowMs !== undefined ? nowMs : new Date().getTime();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_PHONE_RETRY_MS', String(time));
}

function quickCheckSync() {
  Logger.log("--- Avvio Quick Check di Sincronizzazione ---");

  try {
    const cacheSheet = getClientSheet(CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME);
    const cacheData = cacheSheet.getDataRange().getDisplayValues();

    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);

    const calendar = getCalendar();

    if (cacheData.length <= 1) {
      Logger.log("Quick check: Cache vuota o solo intestazione. RICHIESTA FULL SYNC.");
      return true;
    } else {
      const eventsInWindowQuickCheck = calendar.getEvents(windowStart, windowEnd)
        .filter(event => event.getTitle()?.trim() !== "Messaggi Appuntamenti");
      const eventMapInWindowQuickCheck = new Map(eventsInWindowQuickCheck.map(event => [event.getId(), event]));

      logDebug_(`Quick check: Letti ${cacheData.length - 1} appuntamenti dalla cache e ${eventsInWindowQuickCheck.length} eventi dal calendario (finestra ${formatDate(windowStart, "yyyy-MM-dd")} - ${formatDate(windowEnd, "yyyy-MM-dd")}).`);
      const quickCheckComparisonsStartTime = new Date();
      const scriptTimeZone = Session.getScriptTimeZone();

      for (let i = 1; i < cacheData.length; i++) {
        const cacheRow = cacheData[i];
        const eventId = cacheRow[CACHE_COL_EVENT_ID];
        const cachedContactName = cacheRow[CACHE_COL_NAME];
        const cachedDateStr = cacheRow[CACHE_COL_DATE];
        const cachedTimeStr = cacheRow[CACHE_COL_TIME];

        if (!eventId) continue;

        const event = eventMapInWindowQuickCheck.get(eventId);

        if (!event) {
          Logger.log(`Quick check: Riga cache ${i + 1} (ID: ${eventId}, ${cachedContactName}) - Evento non trovato in calendario nella finestra. RICHIESTA FULL SYNC.`);
          return true;
        }

        const currentTitle = event.getTitle()?.trim() || '';
        const currentContactName = formatContactName(currentTitle);
        const currentStartTime = event.getStartTime();
        const currentDateStr = formatDate(new Date(currentStartTime), "yyyy-MM-dd");
        const currentTimeStr = Utilities.formatDate(currentStartTime, scriptTimeZone, "HH:mm");

        if (cachedContactName !== currentContactName || cachedDateStr !== currentDateStr || cachedTimeStr !== currentTimeStr) {
          Logger.log(`Quick check: Riga cache ${i + 1} (ID: ${eventId}, ${cachedContactName}) - Dettagli appuntamento cambiati (Nome, Data, Ora). RICHIESTA FULL SYNC.`);
          return true;
        }

        eventMapInWindowQuickCheck.delete(eventId);
      }

      const quickCheckComparisonsEndTime = new Date();
      logDebug_(`Quick check: Tempo impiegato totale per confronti cache/calendario: ${quickCheckComparisonsEndTime - quickCheckComparisonsStartTime}ms.`);

      if (eventMapInWindowQuickCheck.size > 0) {
        Logger.log(`Quick check: Trovati ${eventMapInWindowQuickCheck.size} nuovi eventi in calendario nella finestra che non erano in cache. RICHIESTA FULL SYNC.`);
        return true;
      }

      const props = PropertiesService.getScriptProperties();
      const retryMin = Number(props.getProperty(CONFIG_KEYS.PHONE_RETRY_MINUTES) || '10');
      const lastRetryMs = Number(props.getProperty('LAST_PHONE_RETRY_MS') || '0');
      const nowMs = now.getTime();

      if (needsPhoneRetry_(cacheData, nowMs, lastRetryMs, retryMin)) {
        Logger.log(`Quick check: Trovati telefoni mancanti e trascorsi almeno ${retryMin} minuti dall'ultimo tentativo. RICHIESTA FULL SYNC.`);
        markPhoneRetry_(nowMs);
        return true;
      }

      Logger.log("Quick check completato. Nessuna modifica rilevata nella finestra di cache. Uscita rapida.");
      return false;
    }
  } catch (e) {
    Logger.log(`--- Errore critico nel Quick Check: ${e} --- `);

    return true;
  }
}

/**
 * Resolves the client for a calendar event: looks up or saves the client,
 * searches for the phone number if needed (new client, missing phone, or forced sync),
 * updates the clients sheet / sync tracking if the phone changed,
 * and returns the phone number to store in cache.
 *
 * @param {{
 *   clientsMap: Map<string, {name: string, phone: string, rowIndex: number}>,
 *   clientsSheet: GoogleAppsScript.Spreadsheet.Sheet,
 *   existingClientNamesSet: Set<string>,
 *   clientPhoneUpdates: Map<number, string>
 * }} sync
 * @param {string} contactName
 * @param {boolean} isForced
 * @return {string}
 */
function resolveClientForEvent_(sync, contactName, isForced) {
  const clientNameLower = contactName.trim().toLowerCase();
  const currentClientInfo = sync.clientsMap.get(clientNameLower);

  if (!currentClientInfo) {
    Logger.log(`Nuovo cliente identificato per appuntamento: "${contactName}". Cerco il numero in rubrica e lo aggiungo al foglio clienti.`);
    const peopleResult = searchInPeople(contactName);
    const clientToSave = {
      name: contactName,
      formattedPhone: peopleResult.phoneNumber ? formatPhoneNumber(peopleResult.phoneNumber) : undefined
    };

    const savedClientInfo = saveClient(
      clientToSave,
      sync.clientsSheet,
      sync.clientsMap,
      sync.existingClientNamesSet,
      CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME
    );

    return savedClientInfo.formattedPhone || '';
  }

  if (isForced || !currentClientInfo.phone) {
    Logger.log(`Ricerca numero per cliente "${contactName}" (forzata o numero mancante nel foglio).`);
    const peopleResult = searchInPeople(contactName);
    const latestFormattedPhone = peopleResult.phoneNumber ? formatPhoneNumber(peopleResult.phoneNumber) : undefined;

    if (currentClientInfo.phone !== latestFormattedPhone) {
      Logger.log(`Aggiornamento numero per cliente "${contactName}": da "${currentClientInfo.phone}" a "${latestFormattedPhone}". Segnato per aggiornamento foglio Clienti.`);
      sync.clientPhoneUpdates.set(currentClientInfo.rowIndex, latestFormattedPhone || '');
      currentClientInfo.phone = latestFormattedPhone;
      sync.clientsMap.set(clientNameLower, currentClientInfo);
    } else {
      Logger.log(`Numero per cliente "${contactName}" già aggiornato o non trovato in rubrica.`);
    }
  } else {
    Logger.log(`Saltata ricerca numero per cliente "${contactName}" (non forzata e numero già presente nel foglio).`);
  }

  return currentClientInfo.phone || '';
}

function fullSync(isForced) {
  const fullSyncStartTime = new Date();
  Logger.log("--- Avvio Sincronizzazione Completa ---");

  try {

    const calendar = getCalendar();

    const appointmentsSheet = getClientSheet(CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME);
    const clientsSheet = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);

    const appointmentsData = appointmentsSheet.getDataRange().getDisplayValues();
    const clientsData = clientsSheet.getDataRange().getDisplayValues();

    const cacheAppointmentsRows = [];
    cacheAppointmentsRows.push(["ID Appuntamento", "Nome Cliente", "Telefono", "Data", "Ora"]);

    const clientsMap = new Map();
    const clientRowIndexMap = new Map();

    clientsData.slice(1).forEach((row, index) => {

      if (row[CLIENTS_COL_NAME]) {
        const clientNameLower = row[CLIENTS_COL_NAME].trim().toLowerCase();
        const clientInfo = {
          name: row[CLIENTS_COL_NAME],
          phone: row[CLIENTS_COL_PHONE],
          rowIndex: index + 2
        };
        clientsMap.set(clientNameLower, clientInfo);
        clientRowIndexMap.set(clientNameLower, index + 2);
      }
    });

    const existingClientNamesSet = new Set(clientsMap.keys());

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);

    const events = calendar.getEvents(start, end);

    const eventMap = new Map();
    events.forEach(event => {
      eventMap.set(event.getId(), event);
    });

    const futureLimit = new Date(end.getTime());

    const rowsToDelete = [];
    const appointmentRowsToUpdate = [];
    const clientPhoneUpdates = new Map();
    const syncContext = {
      clientsMap,
      clientsSheet,
      existingClientNamesSet,
      clientPhoneUpdates
    };

    appointmentsData.slice(1).forEach((row, index) => {

      const sheetRowIndex = index + 2;

      const eventId = row[APPOINTMENTS_COL_EVENT_ID];
      const originalContactName = row[APPOINTMENTS_COL_CONTACT_NAME];
      const originalDateStr = row[APPOINTMENTS_COL_DATE];
      const originalTimeStr = row[APPOINTMENTS_COL_TIME];

      if (!eventId) return;

      const originalSheetApptDate = new Date(originalDateStr);

      if (isNaN(originalSheetApptDate.getTime())) {
        Logger.log(`Riga Appuntamenti ${sheetRowIndex}: Data appuntamento non valida '${originalDateStr}'. Salto elaborazione riga.`);
        return;
      }

      const event = eventMap.get(eventId);

      if (!event) {

        if (originalSheetApptDate >= start && originalSheetApptDate <= end) {

          Logger.log(`Riga Appuntamenti ${sheetRowIndex}: Evento ID ${eventId} non trovato nel calendario (probabilmente cancellato). Segnato per eliminazione dal foglio.`);
          rowsToDelete.push(sheetRowIndex);
        } else {

        }

        return;
      }

      const newStartTime = event.getStartTime();
      const newTitle = event.getTitle()?.trim() || '';
      const newContactName = formatContactName(newTitle);
      const newDateStr = formatDate(new Date(newStartTime), "yyyy-MM-dd");

      const newTimeStr = Utilities.formatDate(newStartTime, Session.getScriptTimeZone(), "HH:mm");

      if (newStartTime.getTime() > futureLimit.getTime()) {
        Logger.log(`Riga Appuntamenti ${sheetRowIndex}: Evento ID ${eventId} spostato oltre il limite futuro (${newDateStr} ${newTimeStr}). Segnato per eliminazione dal foglio.`);
        rowsToDelete.push(sheetRowIndex);

        eventMap.delete(eventId);
      } else {

        let appointmentChanged = false;
        if (originalContactName !== newContactName || originalDateStr !== newDateStr || originalTimeStr !== newTimeStr) {

          appointmentRowsToUpdate.push({
            rowIndex: sheetRowIndex,
            values: [newContactName, newDateStr, newTimeStr]
          });
          appointmentChanged = true;
          Logger.log(`Riga Appuntamenti ${sheetRowIndex}: Dettagli modificati per Evento ID ${eventId}. Segnato per aggiornamento.`);
        }

        const phoneNumberForCache = resolveClientForEvent_(syncContext, newContactName, isForced);

        cacheAppointmentsRows.push([eventId, newContactName, phoneNumberForCache, newDateStr, newTimeStr]);

        eventMap.delete(eventId);
      }
    });

    if (appointmentRowsToUpdate.length > 0) {
      Logger.log(`Applicazione di ${appointmentRowsToUpdate.length} aggiornamenti al foglio Appuntamenti...`);

      appointmentRowsToUpdate.forEach(update => {

        appointmentsSheet.getRange(update.rowIndex, APPOINTMENTS_COL_CONTACT_NAME + 1, 1, update.values.length).setValues([update.values]);
      });
      Logger.log("Aggiornamenti foglio Appuntamenti completati.");
    }

    const newAppointmentsToAdd = [];
    eventMap.forEach(event => {
      const eventId = event.getId();
      const title = event.getTitle()?.trim() || '';

      if (title !== "Messaggi Appuntamenti") {
        const contactName = formatContactName(title);
        const startDate = event.getStartTime();

        if (startDate.getTime() <= futureLimit.getTime()) {
          const dateStr = formatDate(new Date(startDate), "yyyy-MM-dd");
          const timeStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), "HH:mm");

          newAppointmentsToAdd.push([eventId, contactName, dateStr, timeStr]);
          Logger.log(`Nuovo appuntamento trovato in calendario: "${contactName}" il ${dateStr} alle ${timeStr} (ID: ${eventId}). Segnato per aggiunta al foglio Appuntamenti.`);

          const phoneNumberForCache = resolveClientForEvent_(syncContext, contactName, isForced);

          cacheAppointmentsRows.push([eventId, contactName, phoneNumberForCache, dateStr, timeStr]);
          Logger.log(`Aggiunto nuovo evento (ID: ${eventId}) alla cache.`);

        } else {
          Logger.log(`Nuovo evento (ID: ${eventId}) oltre il limite futuro (${dateStr} ${timeStr}). Ignorato.`);
        }
      }
    });

    if (clientPhoneUpdates.size > 0) {
      Logger.log(`Applicazione di ${clientPhoneUpdates.size} aggiornamenti al numero di telefono nel foglio Clienti...`);
      setColumnValues_(clientsSheet, CLIENTS_COL_PHONE + 1, clientPhoneUpdates);
      Logger.log("Aggiornamenti numeri di telefono foglio Clienti completati.");
    }

    if (newAppointmentsToAdd.length > 0) {
      Logger.log(`Aggiunta di ${newAppointmentsToAdd.length} nuovi appuntamenti al foglio Appuntamenti...`);
      appendRows_(appointmentsSheet, newAppointmentsToAdd);
      Logger.log("Aggiunta nuovi appuntamenti completata.");
    }

    if (rowsToDelete.length > 0) {
      Logger.log(`Eliminazione di ${rowsToDelete.length} righe obsolete dal foglio Appuntamenti (dalla fine)...`);
      rowsToDelete.sort((a, b) => b - a)
        .forEach(rowNum => {
          appointmentsSheet.deleteRow(rowNum);
        });
      Logger.log("Eliminazione righe obsolete completata.");

    }

    sortAppointmentsByDate();

    sortClientsByName();

    Logger.log("--- Sincronizzazione appuntamenti completata con successo ---");

    updateReminderCacheSheet(cacheAppointmentsRows);

    sortCacheAppointmentsByDate();

    markPhoneRetry_(now.getTime());

  } catch (e) {

    Logger.log(`Errore critico in syncAppointmentsFromCalendar: ${e} `);

    throw new Error(`Sincronizzazione fallita: ${e.message} `);
  } finally {
    const fullSyncEndTime = new Date();
    Logger.log(`Sincronizzazione Completa completata in ${fullSyncEndTime - fullSyncStartTime}ms.`);
  }
}

function forceSyncAndUpdatePhones() {
  Logger.log("--- Avvio sincronizzazione forzata (da interfaccia utente) ---");
  try {
    const lockResult = syncAppointmentsFromCalendar(true, 30000);
    if (!lockResult || !lockResult.ran) {
      Logger.log("--- Sincronizzazione forzata saltata: lock occupato. ---");
      return "Sincronizzazione già in corso, riprova tra poco.";
    }
    Logger.log("--- Sincronizzazione forzata completata. ---");
    return "Sincronizzazione completata con successo!";
  } catch (e) {
    Logger.log(`--- Errore durante la sincronizzazione forzata: ${e} ---`);
    throw new Error(`Errore durante la sincronizzazione: ${e.message}`);
  }
}

function updateReminderCacheSheet(data) {
  const sheet = getClientSheet(CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME);
  sheet.clearContents();
  if (data.length > 0) {

    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
  Logger.log("Cache sheet aggiornato.");
}

function setupSyncAppointmentsFromCalendar() {
  Logger.log("Configurazione trigger per syncAppointmentsFromCalendar...");

  const triggers = ScriptApp.getProjectTriggers();

  for (const trigger of triggers) {

    if (trigger.getHandlerFunction() === 'syncAppointmentsFromCalendar') {

      Logger.log(`Rimosso trigger esistente per '${trigger.getHandlerFunction()}'.`);
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger('syncAppointmentsFromCalendar')
    .timeBased()

    .everyMinutes(1)
    .create();

  Logger.log("Trigger per syncAppointmentsFromCalendar configurato con successo (frequenza: ogni minuto).");

  return 'Trigger di sincronizzazione configurato con successo';
}