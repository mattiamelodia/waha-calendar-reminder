function searchInPeople(contactName) {

  const result = { contactsFound: 0, phoneNumber: null, numberType: null, status: "not_found" };

  if (!contactName?.trim()) {
    Logger.log("searchInPeople chiamata con nome contatto vuoto. Ritorno risultato predefinito.");
    return result;
  }

  try {

    warmUpPeopleSearch_();

    const response = People.People.searchContacts({
      query: contactName,
      readMask: "names,phoneNumbers",
      pageSize: 20
    });

    const results = response?.results || [];
    result.contactsFound = results.length;

    if (results.length === 0) {
      Logger.log(`People API: Nessun contatto trovato per la query "${contactName}".`);
      return result;
    }
    Logger.log(`People API: Trovati ${results.length} contatti per la query "${contactName}". Ricerca corrispondenza del nome...`);

    const matches = results
      .map(({ person }) => person)
      .filter((person) => person?.names?.some((n) => namesMatch(n?.displayName, contactName)));

    if (matches.length === 0) {
      Logger.log(`Nessuna corrispondenza per il nome "${contactName}" trovata tra i risultati API.`);
      result.status = "no_match";
      return result;
    }

    // Per matched person: the mobile number if any, otherwise the first one.
    const phones = matches
      .map((person) =>
        person.phoneNumbers?.find((p) => p.type?.toLowerCase() === "mobile") || person.phoneNumbers?.[0])
      .filter((p) => p?.value);

    if (phones.length === 0) {
      Logger.log(`Nessun numero di telefono trovato per la corrispondenza "${contactName}".`);
      result.status = "no_number";
      return result;
    }

    const distinctNumbers = new Set(phones.map((p) => formatPhoneNumber(p.value) || p.value));

    if (distinctNumbers.size > 1) {
      Logger.log(`Omonimi con numeri diversi per "${contactName}": nessuna scelta automatica.`);
      result.status = "ambiguous";
      return result;
    }

    result.phoneNumber = phones[0].value;
    result.numberType = phones[0].type || "unknown";
    result.status = "found";
    Logger.log(`Numero trovato per "${contactName}": ${result.phoneNumber} (Tipo: ${result.numberType})`);

  } catch (e) {

    Logger.log(`[Errore] Si è verificato un errore durante la ricerca in People API per "${contactName}": ${e}`);
    result.status = "error";
    result.phoneNumber = null;
    result.numberType = null;
  }

  return result;
}

function searchInSheets(searchTerm) {
  try {

    const sheet = getClientSheet(CONFIG_KEYS.ALL_CLIENTS_SHEET_NAME);

    const data = sheet.getDataRange().getDisplayValues();

    const allClients = data.slice(1);

    const matchedClients = allClients
      .filter((row) => {

        const clientName = row[0]?.toString().toLowerCase() || "";

        return clientName.includes(searchTerm?.toLowerCase() || "");
      })

      .map((row) => createClientObject(row));

    Logger.log("Clienti trovati tramite ricerca nel foglio: " + JSON.stringify(matchedClients));

    return {
      clients: matchedClients,
      currentPage: 1,
      totalPages: 1,
      isSearch: true,
    };
  } catch (e) {

    Logger.log(`Errore nella ricerca dei clienti per nome nel foglio: ${e}`);

    throw new Error(`Impossibile cercare i clienti nel foglio: ${e.message}`);
  }
}