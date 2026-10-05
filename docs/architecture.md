# Manuale operativo Google Apps Script — WhatsApp Reminder

Questo documento descrive l'architettura, la configurazione, i trigger, le proprietà e le procedure operative del sistema Google Apps Script per la sincronizzazione del calendario e l'invio dei promemoria WhatsApp.

---

## 1. Flusso dei Dati

```
Google Calendar (finestra oggi + 3 giorni)
       │
       ▼
 [Quick Check (ogni minuto)] ──(se modifiche o retry telefono)──┐
       │ (se nessuna modifica)                                    │
       ▼                                                          ▼
  Uscita rapida (0 scritture)                             [Full Sync]
                                                                  │
                                            ┌─────────────────────┴─────────────────────┐
                                            ▼                                           ▼
                                 Google People API (rubrica)                     Google Sheets
                                  - tolleranza accenti/ordine                    - Clienti
                                  - normalizzazione telefono (+39)               - Storico appuntamenti
                                  - disambiguazione omonimi                      - Cache promemoria
                                                                                        │
                                                                                        ▼
                                                                                 Dashboard WebApp
                                                                                 & Invio WAHA (ore 9:00)
```

1. **Trigger periodico (1 min):** `syncAppointmentsFromCalendar` esegue prima un `quickCheckSync`. Se la cache corrisponde agli eventi nel calendario (nella finestra di 3 giorni) e non è trascorso l'intervallo `PHONE_RETRY_MINUTES` per i numeri mancanti, l'esecuzione termina subito senza alcuna scrittura su foglio.
2. **Sincronizzazione completa (`fullSync`):** se rilevate differenze, aggiorna gli appuntamenti, rimuove gli eliminati, cerca i numeri mancanti su People API (con warm-up preventivo) e popola il foglio cache.
3. **Pannello WebApp:** interfaccia web per visualizzare gli appuntamenti (Oggi / Domani / Dopodomani), inviare manualmente via link WhatsApp, cercare clienti e sincronizzare forzatamente (`forceSyncAndUpdatePhones`).
4. **Invio automatico (ore 9:00):** `sendAutomaticReminders` (in `AutomaticSender.js`) invia i promemoria via API WAHA.

---

## 2. Fogli e Struttura Colonne

> [!NOTE]
> **Quirk sui nomi dei fogli (Ruling R8):** la funzione `getClientSheet` cerca i fogli usando il valore letterale della costante di configurazione (es. `ALL_CLIENTS_SHEET_NAME`), mentre `getAllClientNames` cerca il valore configurato nelle Script Properties. Verificare che i nomi delle schede nel foglio Google corrispondano.

### Foglio Clienti (`ALL_CLIENTS_SHEET_NAME`)
| Indice | Nome Colonna | Descrizione |
|---|---|---|
| 0 (A) | `Nome` | Nome completo del cliente (formattato) |
| 1 (B) | `Telefono` | Numero normalizzato (es. `393471234567`) |
| 2 (C) | `Ultimo Appuntamento` | Formula di calcolo data ultimo appuntamento |
| 3 (D) | `Appuntamenti Totali` | Formula di conteggio totale appuntamenti |

### Foglio Storico Appuntamenti (`ALL_APPOINTMENTS_SHEET_NAME`)
| Indice | Nome Colonna | Descrizione |
|---|---|---|
| 0 (A) | `ID Appuntamento` | ID univoco dell'evento Google Calendar |
| 1 (B) | `Nome Cliente` | Nome del cliente associato |
| 2 (C) | `Data` | Data appuntamento (`yyyy-MM-dd`) |
| 3 (D) | `Ora` | Ora appuntamento (`HH:mm`) |

### Foglio Cache Promemoria (`CACHED_APPOINTMENTS_SHEET_NAME`)
Finestra attiva a scorrimento (oggi + 3 giorni).
| Indice | Nome Colonna | Descrizione |
|---|---|---|
| 0 (A) | `ID Appuntamento` | ID evento Google Calendar |
| 1 (B) | `Nome Cliente` | Nome del cliente |
| 2 (C) | `Telefono` | Numero telefono normalizzato |
| 3 (D) | `Data` | Data appuntamento (`yyyy-MM-dd`) |
| 4 (E) | `Ora` | Ora appuntamento (`HH:mm`) |

### Foglio Archivio Clienti Riscossi (`ARCHIVE_SHEET_NAME`)
Clienti senza numero rimossi dalla pulizia notturna.
| Indice | Nome Colonna | Descrizione |
|---|---|---|
| 0 (A) | `Nome` | Nome del cliente |
| 1 (B) | `Telefono` | Telefono precedente (se presente) |
| 2 (C) | `Ultimo Appuntamento` | Data ultimo appuntamento registrata |
| 3 (D) | `Appuntamenti Totali` | Conteggio visite |
| 4 (E) | `Data Rimozione` | Data ISO/stringa della rimozione |
| 5 (F) | `Motivo` | Motivo archiviazione (es. `Senza numero di telefono`) |

---

## 3. Tabella dei Trigger

| Funzione Handler | Orario / Frequenza | Lock Timeout | Scopo |
|---|---|---|---|
| `syncAppointmentsFromCalendar` | Ogni 1 minuto | `0 ms` (salta se occupato) | Sincronizzazione incrementale calendario → fogli |
| `sendAutomaticReminders` | Ogni giorno alle 9:00 | N/A | Invio automatico promemoria del giorno successivo |
| `cleanupSentStatusProperties` | Ogni giorno alle 3:00 (`nearMinute(0)`) | `20000 ms` | Pulizia chiavi proprietà invio, archiviazione clienti orfani e verifica quota |
| `removeUnregisteredAppointmentsYesterday` | Ogni giorno alle 3:30 (`nearMinute(30)`) | `20000 ms` | Pulizia appuntamenti del giorno prima per clienti non registrati |
| `checkTomorrowNumbers` | Ogni giorno alle 8:30 (`nearMinute(30)`) | N/A | Controllo presenze numeri di domani e avviso Gotify se mancanti |
| `forceSyncAndUpdatePhones` | Manuale da UI WebApp | `30000 ms` | Sincronizzazione forzata richiesta dall'utente da browser |

---

## 4. Proprietà dello Script (Script Properties)

Tutte le impostazioni sono conservate nelle Script Properties del progetto Google Apps Script (**File > Impostazioni progetto > Proprietà script**). **Nessun segreto deve essere committato nel repository.**

| Nome Proprietà | Significato | Valore Predefinito / Note |
|---|---|---|
| `SHEET_ID` | ID dello Spreadsheet Google su cui risiedono i fogli | Inserito dall'utente (obbligatorio) |
| `ALL_CLIENTS_SHEET_NAME` | Nome/chiave scheda Clienti | Predefinito: `Clienti` |
| `ALL_APPOINTMENTS_SHEET_NAME` | Nome/chiave scheda Storico | Predefinito: `Storico` |
| `CACHED_APPOINTMENTS_SHEET_NAME` | Nome/chiave scheda Cache | Predefinito: `CachePromemoria` |
| `ARCHIVE_SHEET_NAME` | Nome scheda Archivio clienti rimossi | Predefinito: `Archivio` |
| `WEBHOOK_URL` | URL endpoint WAHA sul VPS (`https://waha.<dominio>/api/sendText`) | Senza barra finale |
| `WEBHOOK_SECRET` | Chiave API di WAHA (`WAHA_API_KEY`) | Segreto |
| `WAHA_SESSION` | Nome della sessione WAHA da cui inviare i messaggi | Predefinito: `default` |
| `GOTIFY_URL` | URL istanza Gotify per avvisi operativi | Senza barra finale |
| `GOTIFY_TOKEN` | Token applicazione Gotify | Segreto |
| `TEMPLATE_MESSAGE` | Testo del promemoria con placeholder `%NOME%`, `%DATA%`, `%ORE%` | Testo personalizzabile |
| `TEST_NUMBER` | Numero di test per `sendTestMessage` | Es. `393471234567` |
| `PHONE_RETRY_MINUTES` | Intervallo minimo (in minuti) tra retry di ricerca numeri vuoti | Default `10` |
| `QUOTA_MINUTES` | Limite massimo stimato di minuti trigger al giorno | Default `90` (account consumer gratuiti) |
| `DEBUG_LOG` | Abilita log dettagliati delle operazioni di sync e metriche | `true` o `false` |
| `COUNTRY_CODE` | Prefisso internazionale predefinito per numeri locali | Default `39` (Italia) |
| `WORDS_TO_REMOVE` | Array JSON di parole o servizi da rimuovere dal titolo evento | Es. `["piedi", "refill", "m+p"]` |
| `SYNC_FAIL_STREAK_COUNT` | Contatore interno di fallimenti consecutivi della sync | Gestito automaticamente |
| `LAST_PHONE_RETRY_MS` | Timestamp millisecondi dell'ultimo tentativo di retry numeri | Gestito automaticamente |
| `RUNSTATS_<yyyy-MM-dd>` | Statistiche giornaliere di esecuzione `{ runs, ms, errors }` | Gestito automaticamente |
| `LASTNOTIFY_<key>` | Timestamp millisecondi anti-spam per notifiche Gotify | Gestito automaticamente |

---

## 5. Metriche e Gestione Quota

Google impone limiti di tempo totale di esecuzione dei trigger al giorno:
- **Account Google gratuiti (@gmail.com):** 90 minuti / giorno totali.
- **Account Google Workspace (a pagamento):** 360 minuti (6 ore) / giorno.

### Come leggere `RUNSTATS_<yyyy-MM-dd>`
Nelle Proprietà dello script viene salvata una voce per ogni giorno con formato JSON:
```json
{
  "runs": 1420,
  "ms": 1560000,
  "errors": 2
}
```
- `runs`: numero totale di esecuzioni del trigger di sync.
- `ms`: millisecondi totali consumati (1.560.000 ms = 26 minuti, pari a ~28% della quota da 90 min).
- `errors`: conteggio errori non catturati.

### Avvisi automatici su Gotify
- **Sync ferma:** se la sincronizzazione fallisce per 3 esecuzioni consecutive, viene inviato un alert Gotify a priorità 8. Al ripristino viene inviato un messaggio di conferma.
- **Quota vicina al limite:** alle ore 3:00, `checkQuotaUsage_` calcola la percentuale di utilizzo della quota del giorno precedente. Se supera l'80%, invia un alert Gotify a priorità 7.
- **Numeri mancanti:** alle 8:30, `checkTomorrowNumbers` avvisa se per domani ci sono appuntamenti senza numero di telefono.

### Cosa fare se la quota si esaurisce
1. Verificare su Gotify o nelle Esecuzioni di Apps Script quale funzione sta consumando tempo.
2. Se un evento continua a causare fallimenti nel quick check, controllare i log di Apps Script.
3. Se necessario, aumentare temporaneamente `PHONE_RETRY_MINUTES` da `10` a `30` o `60` per ridurre le ricerche su People API.
4. Se il volume di appuntamenti cresce stabilmente, valutare il passaggio a un account Google Workspace (quota 6 ore).

---

## 6. Procedura di Deploy e Rollback (`clasp`)

> [!IMPORTANT]
> **Solo l'utente umano esegue `clasp push` o `clasp pull`.** Nessun comando clasp o accesso all'ambiente di produzione viene eseguito dagli agenti automatici.

### Requisiti locali
- `npm install -g @google/clasp`
- `clasp login`
- File `.clasp.json` (deve rimanere **escluso da git** via `.gitignore` per evitare di esporre lo `scriptId`).

Se `.clasp.json` non è presente:
```bash
clasp clone <IL_TUO_SCRIPT_ID> --rootDir apps-script
```
oppure creare manualmente `.clasp.json`:
```json
{"scriptId":"<IL_TUO_SCRIPT_ID>","rootDir":"apps-script"}
```

### Deploy in produzione
1. Eseguire sempre i test locali prima del push:
   ```bash
   make test-apps-script
   ```
2. Effettuare il push su Google Apps Script:
   ```bash
   clasp push
   ```
3. Se è la prima installazione o se sono stati aggiunti nuovi trigger, aprire l'editor Apps Script ed eseguire una volta `setup()` e `setupAlertTriggers()`.

### Rollback (Rientro)
In caso di anomalie dopo un push:
1. Eseguire il revert del commit su git:
   ```bash
   git revert HEAD
   ```
2. Effettuare nuovamente il push verso Apps Script:
   ```bash
   clasp push
   ```
3. Verificare che l'esecuzione riprenda regolarmente dalla dashboard delle Esecuzioni di Apps Script.

---

## 7. Controllo e Abilitazione Link di Conferma 1-Click

### Funzionamento
- **Attivazione tramite interruttore nella Dashboard:**
  - Proprietà di script: `ENABLE_CONFIRMATION_LINKS` (`'true'` / `'false'`, default `'true'`).
  - Nella WebApp (pannello centrale), il pulsante **"Conferma 1-clic"** permette all'operatore di attivare o disattivare istantaneamente l'inclusione del link nei promemoria WhatsApp.
  - Se attivo: il messaggio WhatsApp include il link monouso sicuro per confermare o richiedere lo spostamento con 1 clic.
  - Se disattivo: il messaggio invia il promemoria testuale standard senza alcun link.
- **Protezione integrità Rubrica e Calendario:**
  - La funzione `stripStatusPrefixes_` rimuove i prefissi `[OK]` e `[SPOSTARE]` dal titolo dell'evento durante la sincronizzazione con i fogli e con Google People API, preservando il nome anagrafico pulito ed evitando duplicati.


---

## 8. Link di Conferma 1-Click e Architettura di Sicurezza

### Funzionamento
- **Link usa-e-getta nel messaggio:**
  Il promemoria (inviato alle 9:00 o manualmente via WebApp/WAHA) include un link diretto sicuro:
  `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?c=<token>`
- **Esperienza cliente:**
  1. Cliccando sul link, si apre la pagina di conferma dedicata generata da [Confirmation.js](apps-script/Confirmation.js).
  2. Vengono mostrati i dati dell'appuntamento (Data e Ora) e due pulsanti:
     - `[ ✅ Confermo l'appuntamento ]`
     - `[ ❌ Vorrei spostare o annullare ]`
  3. Al tocco, la scelta viene inviata al server Google Apps Script (`submitClientConfirmation`).
  4. L'evento su Google Calendar si aggiorna istantaneamente in **Verde `[OK]`** o **Rosso `[SPOSTARE]`**.
  5. **Blocco anti-ripensamenti (Single-Use):**
     - Subito dopo il clic, la pagina si trasforma nella schermata di conferma definitiva e disabilita i pulsanti.
     - Se la cliente riapre o ricarica il link in seguito, i pulsanti non vengono mostrati: la pagina avvisa che la risposta è già stata registrata e che per ulteriori modifiche occorre contattare telefonicamente il salone.

### Architettura di Sicurezza Blindata
- **Isolamento della Dashboard:**
  In `doGet(e)`, se la richiesta non contiene un token `?c=<token>`, l'accesso alla Dashboard di gestione è consentito **esclusivamente**:
  1. All'account Google della titolare (`Session.getActiveUser().getEmail()`).
  2. Oppure tramite chiave di amministrazione configurata (`?admin=<ADMIN_SECRET>`).
  Qualsiasi utente anonimo o cliente che accede senza token riceve una schermata di blocco `Accesso Riservato` (403), garantendo la totale riservatezza della rubrica clienti e degli appuntamenti.
- **Token casuali crittografici:**
  I token sono generati tramite stringhe casuali univoche (UUID/hash), rendendo impossibile indovinare gli appuntamenti di altri clienti.
- **Nessuna dipendenza da Webhook:**
  Il link 1-click comunica direttamente tra il browser dello smartphone della cliente e Google Apps Script, aggiornando Google Calendar all'istante anche se i webhook di WAHA non fossero attivi.


