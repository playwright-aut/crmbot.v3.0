# CRM-BOT-V3 INSTALLER

Ez a csomag egy teljesen új Mac gépre telepíti a CRM-BOT-V3 rendszert.

A rendszer közvetlenül a CRM `sales-lead-overview` oldalát figyeli, felismeri az új top leadet, majd a CRM rendszerben automatikusan feldolgozza azt.

## Fő működés

1. CRM figyelés
2. új top lead felismerése
3. lead azonosító kinyerése
4. lead megnyitása a CRM-ben
5. státuszok beállítása:
   - ASSIGNED
   - IN_PROCESS
6. ügyféladatok kiolvasása
7. push értesítés küldése
8. recovery / autologin hiba esetén

## Telepítés

### 1. lépés

A projekt letöltése ZIP fájlként GitHubról:

    https://github.com/playwright-aut/crmbot.v3.0

A GitHub oldalon:
- Code
- Download ZIP

### 2. lépés

Node.js telepítése:

    https://nodejs.org

Innen a macOS installer letöltése és telepítése szükséges.

### 3. lépés

Telepítő futtatása Terminálból:

    cd ~/Downloads/crmbot.v3.0-main
    chmod +x install.sh
    ./install.sh

## A telepítő mit csinál

- ellenőrzi a Node.js és npm jelenlétét
- létrehozza a célmappát
- bemásolja a rendszerfájlokat
- létrehozza a szükséges runtime mappákat
- bekéri a szükséges belépési adatokat
- létrehozza a `.env` fájlt
- futtatja az `npm install` parancsot
- telepíti a Playwright Chromium-ot
- telepíti a `vu3crm` CLI parancsot

## Bekért adatok

### CRM
- CRM felhasználónév
- CRM jelszó

### Push értesítés
- Pushover token
- Pushover user key

## Elérhető parancsok

### Bot indítása
    vu3crm on

### Bot leállítása
    vu3crm off

### Állapot lekérdezése
    vu3crm status

### Bot újraindítása
    vu3crm restart

### CRM automata megnyitása, Enterre zár
    vu3crm crm-open

### Súgó
    vu3crm help

## Runtime mappák

A rendszer működés közben ezeket a mappákat használja:

- `debug`
- `state`
- `VU3Queue`
- `VU3QueueProcessing`
- `VU3QueueProcessed`
- `VU3QueueBlocked`

## Fontos megjegyzés

A Playwright profilok és a futási logok nem részei a telepíthető core csomagnak. Ezek működés közben automatikusan jönnek létre.

A rendszer úgy van kialakítva, hogy a `vu3crm off` után:
- leállít minden futó folyamatot
- kijelentkezteti a CRM sessiont
- törli a Playwright profilokat

Így a következő indulás tiszta állapotból történik.

## Hiba esetén

Állapot ellenőrzése:

    vu3crm status

Ha a CRM session megszakad vagy kijelentkezik, a rendszer ezt automatikusan érzékeli, headed autologinnal visszalépteti a CRM-et, majd újraindítja a figyelő és feldolgozó folyamatokat.

## Projekt célja

A cél egy hordozható, új gépre is telepíthető, automatizált CRM lead-kezelő rendszer, amely stabilan és minimális kézi beavatkozással működik, Outlook-függőség nélkül.
