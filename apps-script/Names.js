/**
 * Name matching and People API warm-up.
 *
 * normalizeName / namesMatch make the address-book lookup tolerant of accents, case, punctuation,
 * extra spaces and word order, but never of different words: "Mario Rossi" and "Mario Rosso" are different people.
 */

function normalizeName(s) {

  if (typeof s !== "string") return "";

  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a, b) {

  const na = normalizeName(a);
  const nb = normalizeName(b);

  if (!na || !nb) return false;
  if (na === nb) return true;

  const wordsA = na.split(" ").sort();
  const wordsB = nb.split(" ").sort();

  return wordsA.length === wordsB.length && wordsA.every((w, i) => w === wordsB[i]);
}

// The People API searchContacts cache is cold at the start of an execution: the first real query can return
// nothing. One empty-query request per execution primes it. The flag is set before the call, so a failing
// warm-up is not retried within the same execution.
var peopleSearchWarmedUp_ = false;

function warmUpPeopleSearch_() {

  if (peopleSearchWarmedUp_) return;
  peopleSearchWarmedUp_ = true;

  try {
    People.People.searchContacts({ query: "", readMask: "names" });
  } catch (e) {
    Logger.log(`[Warm-up People] Ignorato errore: ${e}`);
  }
}
