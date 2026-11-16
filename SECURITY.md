# Securitate și confidențialitate

## Suprafață verificabilă

Programul nu folosește servicii AI, conturi, formulare de autentificare, telemetrie, reclame, fonturi externe sau scripturi CDN. Nu are dependențe JavaScript de la terți la rulare. Modulele servite sunt fișiere sursă lizibile, fără minificare sau lanț de build care ascunde logica.

Solicitările aplicației sunt citiri ale fișierelor proprii, ale configurării opționale a pachetului de previzualizare și ale pachetului ales pentru descărcare. Nu există cod de încărcare a imaginilor, răspunsurilor sau progresului pe un server. Verificările native de actualizare ale Service Worker presupun acces la gazdă. Furnizorul de găzduire poate păstra jurnale; GitHub Pages înregistrează IP-uri în scop de securitate.

Datele sunt protejate de regulile de origine ale browserului. Aplicația nu pretinde că rezistă unui browser compromis sau unui cod nou malițios publicat ulterior pe aceeași origine. O verificare a repository-ului trebuie corelată cu octeții livrați și cu workerul activ.

## Date neîncrezătoare

Importul validează structura ZIP, limitele, căile, duplicatele, metoda de compresie, antetele locale/centrale, suprapunerile, CRC-ul și numărul efectiv de octeți decomprimați. Operațiile ZIP rulează într-un Worker terminabil. Se acceptă numai formate de date și imagini aprobate. Niciun fișier din arhivă nu este extras pe discul utilizatorului sau executat.

JSON are limite de mărime și validare explicită. Cheile de prototip sunt respinse. Validatorul reconstruiește obiectele permise. Imaginile sunt verificate după semnătură, dimensiuni și, dacă există, SHA-256. Hashul detectează modificarea conținutului; nu autentifică autorul pachetului.

Textul importat este inserat ca text prin DOM, nu prin `innerHTML`. Geometria reperelor este numerică, normalizată și referă ID-uri existente. SVG/HTML importat, URL-uri externe de imagini și fișiere executabile nu sunt acceptate. CSP interzice scripturi inline, obiecte, formulare și resurse externe.

Cititorul ZIP are un domeniu intenționat restrâns; decomprimarea propriu-zisă este făcută de browser. Pachetele neconforme trebuie reexportate curat; tolerarea tuturor extensiilor ZIP nu este un obiectiv al v1.

## Stocare și restaurare

Nu se cere implicit permisiune pentru directoare, cameră, microfon, geolocalizare sau notificări. Selectarea unui fișier oferă aplicației acel fișier; IndexedDB este stocare administrată de browser, nu acces la alte fișiere ale dispozitivului. Cererea de stocare persistentă este opțională și explicită.

Înlocuirile de pachete sunt tranzacționale. Importul unui backup complet validează fiecare pachet înainte de a începe scrierea. Restaurările JSON îmbină marcajele și aleg înregistrările de progres mai recente, fără a aduna de două ori aceleași contoare.

Fișierele de backup sunt descărcări obișnuite, necriptate de aplicație. Stocarea locală nu este o copie de siguranță. Păstrează copii externe ale pachetelor și progresului; proiectele Studio trebuie exportate regulat.

## Audit reproductibil

1. Rulează testele și `node tools/check.mjs`.
2. Rulează `node tools/release.mjs`; verifică `release.json` în fiecare distribuție.
3. Compară SHA-256 pentru fișierele din distribuție cu cele livrate de gazdă, inclusiv Service Worker.
4. Inspectează Network la import, răspuns, backup și după activarea modului avion.
5. Verifică aplicațiile pe origini distincte și verifică workerul activ, nu numai sursa de pe server.

Un audit static sau o opinie AI nu poate garanta absența oricărei vulnerabilități. Versiunea inițială are teste de logică, date și arhive; testarea efectivă în browsere și pe dispozitive este documentată separat în `docs/verification.md`.
