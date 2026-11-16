# Verificarea versiunii inițiale

## Verificat automat

- Teste Node: căutare cu diacritice și aliasuri, filtrare pe programă, notare prin ID, selectare multiplă, intervale de recapitulare și selecție de examen.
- Detectarea schimbării cheii/enunțului fără a depinde de ordinea opțiunilor.
- Validarea pachetelor, referințelor, imaginilor, hashurilor, coordonatelor și backupurilor.
- ZIP stored și deflate produse independent cu Python; export/import binar; respingerea arhivelor malițioase și corupte.
- Pachetul complet: 80 de imagini cu hashuri, 60 de diagnostice și 21 de grile.
- Verificări statice de sintaxă, importuri locale, CSP, fișiere de cache, manifest și identitatea modulelor comune.

Comenzile exacte și rezultatul ultimei rulări se află în `verification-results.json` din distribuția de proiect. Numerele nu includ teste de browser care nu au fost executate.

## Limită a mediului de lucru

Serverul local a pornit, însă conexiunile de verificare la loopback au fost respinse cu `EACCES`, iar legătura cu previzualizarea în browser nu a putut deschide o filă controlabilă. Prin urmare, această sesiune nu confirmă aspectul randat, funcționarea interactivă în browser, comportamentul IndexedDB/Worker în browsere reale, instalarea PWA, modul avion sau consumul pe telefoane modeste.

Există un test de integrare în `dist/checks.html`, executabil pe dispozitivul dezvoltatorului. El verifică tranzacția cu eroare injectată, restaurarea fără dublare, arhiva în Worker, selecția explicită și reperele. Folosește o bază temporară și nu citește progresul real.

## Listă manuală înainte de distribuția către colegi

| Verificare | Rezultatul așteptat |
|---|---|
| Deschidere proaspătă Study | Bibliotecă goală, fără cont sau cereri de permisiuni |
| Importul pachetului de curs | 80 de cazuri, 4 capitole; imaginile și notițele se deschid |
| Primul caz, observația legată | Selectarea textului evidențiază elipsa și invers |
| Zoom și schimbarea orientării | Reperul rămâne pe aceeași regiune |
| Caz numai cu diagnostic | Secțiunile lipsă sunt marcate explicit |
| p054 | Poate fi studiat, fără întrebare automată de diagnostic |
| Catalog, `cancer`, `endobronsic`, `potcoava` | Filtrare fără diacritice, titlu complet, numai capitole cu potriviri |
| Un singur rezultat în catalog | Rămâne necesară selecția și confirmarea |
| Căutare fără text | Capitolele se pot extinde/restrânge; lista rămâne aceeași pentru cazurile din aceeași programă |
| Grile | Amestecarea opțiunilor nu schimbă cheia; click dublu nu dublează încercarea |
| Simulare | Nicio explicație sau indicație de corectitudine înainte de final |
| Pauză/reîncărcare | Sesiunea continuă fără pierderea răspunsurilor confirmate |
| Export/import JSON de două ori | Contoarele nu se dublează; imaginile nu sunt promise în JSON |
| Backup complet pe o origine nouă | Se restaurează pachetele, marcajele și progresul |
| Import anulat sau eșuat | Pachetul existent rămâne utilizabil |
| ZIP malițios | Mesaj clar, fără înlocuirea datelor existente |
| Mod avion, închidere și redeschidere | Aplicația și pachetul deja importat rămân disponibile |
| Actualizare în timpul testului | Nu este activată în sesiunea proprie neterminată |
| Network | Niciun material, răspuns sau progres încărcat pe server |
| Studio, creare/editare/export | Pachetul rezultat poate fi importat în Study |
| Studio, modificarea unui caz | Grilele afectate revin în starea schiță |
| Studio, închidere/redeschidere | Proiectul salvat local este păstrat |

Matrice minimă: Windows cu Chrome/Edge, Android cu Chrome pe un telefon modest, iOS cu Safari și aplicația instalată, macOS cu Safari și Chrome. Verifică separat instalarea dintr-un browser extern după deschiderea inițială a linkului în Discord. Pentru testarea pe telefon folosește găzduire HTTPS; serverul local este intenționat limitat la loopback.

Nu marca distribuția drept validată pe toate platformele înainte de efectuarea acestor verificări.
