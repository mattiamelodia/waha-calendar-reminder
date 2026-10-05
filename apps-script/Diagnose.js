/**
 * READ-ONLY diagnostics for the "client number not synced" problem. It writes NOTHING (no sheet, no property, no
 * calendar): it only logs. Run it from the Apps Script editor and read the log in "Esecuzioni".
 *
 * Usage: edit the name in diagnoseClientDefault() (exactly as it appears in the calendar event, after the trailing
 * words are removed) and run it. Or call diagnoseClient('Mario Rossi') from your own function.
 */
function diagnoseClientDefault() {
  diagnoseClient('NOME COGNOME');
}

function diagnoseClient(name) {
  const norm = (s) => (s || '').trim().toLowerCase();
  Logger.log(`=== DIAGNOSI per "${name}" (lunghezza ${name.length}, normalizzato "${norm(name)}") ===`);

  // 1) What the sync does today
  const today = searchInPeople(name);
  Logger.log(`[1] searchInPeople (come fa la sync oggi): contatti=${today.contactsFound}, numero="${today.phoneNumber}", ` +
    `tipo=${today.numberType}, dopo formatPhoneNumber="${today.phoneNumber ? formatPhoneNumber(today.phoneNumber) : 'n/d'}"`);

  // 2) What the sheet currently holds for this client
  try {
    const rows = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME).getDataRange().getDisplayValues().slice(1);
    const hit = rows.map((r, i) => ({ r, i })).filter(({ r }) => norm(r[CLIENTS_COL_NAME]) === norm(name));
    if (hit.length === 0) Logger.log('[2] Foglio Clienti: nessuna riga con questo nome.');
    hit.forEach(({ r, i }) => Logger.log(`[2] Foglio Clienti riga ${i + 2}: nome="${r[CLIENTS_COL_NAME]}", telefono="${r[CLIENTS_COL_PHONE]}"`));
  } catch (e) {
    Logger.log('[2] Errore leggendo il foglio Clienti: ' + e);
  }

  // 3) Same search, but with the warm-up request that the People API documents for searchContacts
  try {
    People.People.searchContacts({ query: '', readMask: 'names' });
  } catch (e) {
    Logger.log('[3] warm-up (query vuota): ' + e);
  }
  Utilities.sleep(2000);
  logPeopleSearch_('[3] dopo warm-up, nome intero', name, name);

  // 4) Looser searches, to reveal naming differences (order, accents, extra words)
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    logPeopleSearch_('[4a] solo primo termine', parts[0], name);
    logPeopleSearch_('[4b] solo ultimo termine', parts[parts.length - 1], name);
  }
  Logger.log('=== FINE DIAGNOSI ===');
}

function logPeopleSearch_(label, query, wantedName) {
  const norm = (s) => (s || '').trim().toLowerCase();
  try {
    const results = (People.People.searchContacts({ query: query, readMask: 'names,phoneNumbers', pageSize: 20 }).results) || [];
    Logger.log(`${label} (query "${query}"): ${results.length} risultati`);
    results.forEach(({ person }, i) => {
      const display = person?.names?.[0]?.displayName;
      const numbers = (person?.phoneNumbers || []).map((p) => `${p.type || '?'}:${p.value} -> ${formatPhoneNumber(p.value)}`);
      Logger.log(`    #${i + 1} nome="${display}" esatto=${norm(display) === norm(wantedName)} numeri=[${numbers.join(' | ')}]`);
    });
  } catch (e) {
    Logger.log(`${label}: errore ${e}`);
  }
}
