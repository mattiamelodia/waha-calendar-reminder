var cachedSpreadsheet_ = null;

function appendRows_(sheet, rows) {
  if (!sheet || !rows || rows.length === 0) return;
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function setColumnValues_(sheet, colIndex, updates) {
  if (!sheet || !updates || updates.size === 0) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return;

  const range = sheet.getRange(1, colIndex, lastRow, 1);
  const values = range.getValues();

  for (const [rowNum, val] of updates.entries()) {
    if (rowNum >= 1 && rowNum <= lastRow) {
      values[rowNum - 1][0] = val;
    }
  }

  range.setValues(values);
}

function initClientDatabase() {
  if (cachedSpreadsheet_) {
    return cachedSpreadsheet_;
  }

  const spreadsheetId = getConfig(CONFIG_KEYS.SHEET_ID, null);

  try {

    if (spreadsheetId) {
      cachedSpreadsheet_ = SpreadsheetApp.openById(spreadsheetId);
      return cachedSpreadsheet_;
    }

    Logger.log("ID database non trovato nelle proprietà. Creazione nuovo database...");
    const ss = SpreadsheetApp.create("WhatsApp Reminder - Database Clienti");
    Logger.log(`Nuovo database creato con ID: ${ss.getId()}`);

    let sheet = ss.getActiveSheet().setName(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);
    sheet.appendRow([
      "Nome",
      "Telefono",
      "Ultimo Appuntamento",
      "Appuntamenti Totali",
    ]);
    Logger.log(`Foglio "${CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME}" configurato.`);

    sheet = ss.insertSheet(CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME);
    sheet.appendRow([
      "ID Appuntamento",
      "Nome Cliente",
      "Data",
      "Ora"
    ]);
    Logger.log(`Foglio "${CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME}" configurato.`);

    PropertiesService.getScriptProperties().setProperty(
      CONFIG_KEYS.SHEET_ID,
      ss.getId()
    );
    Logger.log(`ID database salvato nelle proprietà script.`);

    cachedSpreadsheet_ = ss;
    return cachedSpreadsheet_;

  } catch (e) {

    Logger.log(`Errore critico nell'inizializzazione del database: ${e}`);

    throw new Error(
      `Impossibile inizializzare il database clienti: ${e.message}`
    );
  }
}

function getAllClientNames() {

  const sheetId = getConfig(CONFIG_KEYS.SHEET_ID, null);
  const sheetName = getConfig(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME, null);

  if (!sheetId || !sheetName) {
    Logger.log(
      `Errore: Le proprietà ${CONFIG_KEYS.SHEET_ID} e/o ${CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME} non sono configurate correttamente nelle Proprietà Script. Impossibile recuperare i nomi clienti.`
    );
    return [];
  }

  try {

    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log(
        `Errore: Impossibile trovare il foglio chiamato "${sheetName}" nello Spreadsheet con ID "${sheetId}". Impossibile recuperare i nomi clienti.`
      );
      return [];
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`Foglio "${sheetName}" vuoto o contiene solo l'intestazione. Nessun cliente da recuperare.`);
      return [];
    }
    const range = sheet.getRange("A2:A" + lastRow);

    const values = range.getValues();

    const clientNames = values
      .map((row) => row[0]?.toString().trim())
      .filter((name) => name !== "" && name !== null && name !== undefined);

    Logger.log(
      `Recuperati ${clientNames.length} nomi clienti dal foglio "${sheetName}".`
    );

    return clientNames;

  } catch (e) {

    Logger.log(
      `Errore durante la lettura della lista clienti dal foglio "${sheetName}" (ID: ${sheetId}): ${e}`
    );
    return [];
  }
}

function getClientSheet(sheetName) {

  const ss = initClientDatabase();

  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log(`Foglio "${sheetName}" non trovato. Creazione in corso...`);
    sheet = ss.insertSheet(sheetName);
    Logger.log(`Foglio "${sheetName}" creato.`);

    if (sheetName === CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME) {

      sheet.appendRow([
        "Nome",
        "Telefono",
        "Ultimo Appuntamento",
        "Appuntamenti Totali",
      ]);
      Logger.log(`Intestazione aggiunta al foglio "${sheetName}".`);
    } else if (sheetName === CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME) {

      sheet.appendRow(["ID Appuntamento", "Nome Cliente", "Data", "Ora"]);
      Logger.log(`Intestazione aggiunta al foglio "${sheetName}".`);
    }

  }

  return sheet;
}

function getClientsPage(page = 1) {
  try {

    const sheet = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);

    const data = sheet.getDataRange().getDisplayValues();

    const clients = data.slice(1);

    const totalClientsCount = clients.length;

    const totalPages = Math.ceil(totalClientsCount / 10);

    page = Math.max(1, Math.min(page, totalPages > 0 ? totalPages : 1));

    const startIndex = (page - 1) * 10;
    const endIndex = Math.min(startIndex + 10, totalClientsCount);

    const pageClients = clients
      .slice(startIndex, endIndex)
      .map((row) => createClientObject(row));

    return {
      clients: pageClients,
      currentPage: page,
      totalPages: totalPages,
      totalClients: totalClientsCount,
      isSearch: false,
    };

  } catch (e) {

    Logger.log(`Errore nel recupero della pagina di clienti: ${e}`);

    throw new Error(`Impossibile recuperare i clienti: ${e.message}`);
  }
}

function saveClient(clientData, clientsSheet, clientsMap, existingClientNamesSet, appointmentsSheetName) {

  const clientNameLower = clientData.name?.trim().toLowerCase();

  if (!clientNameLower) {
    Logger.log("saveClient chiamato con nome cliente vuoto o non valido. Operazione annullata.");
    return clientData;
  }

  try {

    const existingClient = clientsMap.get(clientNameLower);

    Logger.log(`saveClient - Cliente '${clientNameLower}' existing in map: ${!!existingClient}`);

    if (existingClient) {

      const rowIndex = existingClient.rowIndex;

      const existingRowData = clientsSheet.getRange(rowIndex, 1, 1, clientsSheet.getLastColumn()).getValues()[0];

      const updatedPhone = clientData.formattedPhone !== undefined
        ? clientData.formattedPhone
        : existingRowData[CLIENTS_COL_PHONE];

      const rowData = [
        clientData.name,
        updatedPhone

      ];

      clientsSheet.getRange(rowIndex, CLIENTS_COL_NAME + 1, 1, rowData.length).setValues([rowData]);

      existingClient.phone = updatedPhone;

    } else {

      const newRowValues = [clientData.name, clientData.formattedPhone || "", "", ""];

      clientsSheet.appendRow(newRowValues);

      const newRowIndex = clientsSheet.getLastRow();

      SpreadsheetApp.flush();

      const formulaUltimoApp = `=IFERROR(INDEX(SORT(FILTER('${appointmentsSheetName}'!C:C;'${appointmentsSheetName}'!B:B = A${newRowIndex};'${appointmentsSheetName}'!C:C <= TODAY());1;FALSE);1);"")`;
      const formulaConteggio = `=IFERROR(COUNTIF('${appointmentsSheetName}'!B:B; A${newRowIndex});"")`;

      clientsSheet.getRange(newRowIndex, CLIENTS_COL_LAST_APPOINTMENT + 1).setFormula(formulaUltimoApp);
      clientsSheet.getRange(newRowIndex, CLIENTS_COL_APPOINTMENT_COUNT + 1).setFormula(formulaConteggio);

      clientsMap.set(clientNameLower, {
        name: clientData.name,
        phone: clientData.formattedPhone || "",
        rowIndex: newRowIndex
      });
      existingClientNamesSet.add(clientNameLower);

    }

    return clientData;
  } catch (e) {

    Logger.log(`Errore nel salvataggio/aggiornamento del cliente "${clientData.name}": ${e}`);

    throw new Error(`Impossibile salvare il cliente "${clientData.name}": ${e.message}`);
  }
}

function createClientObject(rowData) {

  return {
    name: rowData[0],
    formattedPhone: formatPhoneForDisplay(rowData[1]?.toString() || ""),
    lastVisit: rowData[2] || "",
    totalVisits: rowData[3] || 0,
  };
}

function sortAppointmentsByDate() {

  const sheet = getClientSheet(CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    Logger.log(`Foglio "${CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME}" ha meno di 2 righe. Nessun ordinamento necessario.`);
    return;
  }

  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);

  range.sort([
    { column: 3, ascending: false },
    { column: 4, ascending: true }
  ]);
  Logger.log(`Foglio "${CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME}" ordinato per data decrescente.`);
}

function sortCacheAppointmentsByDate() {

  const sheet = getClientSheet(CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    Logger.log(`Foglio "${CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME}" ha meno di 2 righe. Nessun ordinamento necessario.`);
    return;
  }

  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);

  range.sort([
    { column: 4, ascending: false },
    { column: 5, ascending: true }
  ]);
  Logger.log(`Foglio "${CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME}" ordinato per data decrescente.`);
}

function sortClientsByName() {

  const sheet = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    Logger.log(`Foglio "${CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME}" ha meno di 2 righe. Nessun ordinamento necessario.`);
    return;
  }

  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);

  range.sort({ column: 1, ascending: true });
  Logger.log(`Foglio "${CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME}" ordinato per nome alfabetico.`);
}

function getClientHistory(clientName) {
  try {

    const sheet = getClientSheet(CONFIG_KEYS.ALL_APPOINTMENTS_SHEET_NAME);

    const data = sheet.getDataRange().getDisplayValues();

    const history = data
      .slice(1)
      .filter((row) => {

        return (
          row[1] &&
          row[1].toString().trim().toLowerCase() === clientName.toLowerCase()
        );
      })

      .map((row) => ({

        date: formatDate(new Date(row[2]), "dd/MM/yyyy") || "",

        time: row[3] || "",
      }));

    return history;

  } catch (e) {

    Logger.log(`Errore recupero storico appuntamenti per ${clientName}: ${e}`);
    return [];
  }
}

function archiveRemovedClients_(rows) {
  if (!rows || rows.length === 0) return;
  const ss = initClientDatabase();
  let sheet = ss.getSheetByName(ARCHIVE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ARCHIVE_SHEET_NAME);
    sheet.appendRow(["Nome Cliente", "Data Rimozione"]);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Nome Cliente", "Data Rimozione"]);
  }

  for (const row of rows) {
    sheet.appendRow(row);
  }
}

function removeClientsWithoutPhone() {
  const clientSheet = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);
  const clientData = clientSheet.getDataRange().getValues();

  const cacheSheet = getClientSheet(CONFIG_KEYS.CACHED_APPOINTMENTS_SHEET_NAME);
  const cacheData = cacheSheet.getDataRange().getDisplayValues();
  const namesInCache = new Set();
  for (let i = 1; i < cacheData.length; i++) {
    const name = cacheData[i][CACHE_COL_NAME];
    if (name) {
      namesInCache.add(name.trim().toLowerCase());
    }
  }

  const rowsToDelete = [];
  const rowsToArchive = [];
  const todayStr = formatDate(new Date(), "yyyy-MM-dd");

  for (let i = 1; i < clientData.length; i++) {
    const phone = clientData[i][CLIENTS_COL_PHONE];
    if (!phone || phone.toString().trim() === '') {
      const clientName = (clientData[i][CLIENTS_COL_NAME] || '').toString().trim();
      const clientNameLower = clientName.toLowerCase();

      if (namesInCache.has(clientNameLower)) {
        Logger.log(`Cliente "${clientName}" senza numero ma con appuntamento in finestra (in cache). Mantenuto.`);
      } else {
        rowsToDelete.push(i + 1);
        rowsToArchive.push([clientName, todayStr]);
        Logger.log(`Riga ${i + 1} ("${clientName}") senza numero e senza appuntamenti in cache. Segnata per eliminazione.`);
      }
    }
  }

  if (rowsToArchive.length > 0) {
    archiveRemovedClients_(rowsToArchive);
  }

  rowsToDelete.reverse().forEach(rowNum => {
    clientSheet.deleteRow(rowNum);
  });

  Logger.log(`Eliminate ${rowsToDelete.length} righe senza numero di telefono.`);
  return rowsToDelete.length;
}