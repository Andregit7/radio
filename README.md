# Radia · Study și Pack Studio

[Deschide Study](https://andregit7.github.io/radio/) · [Deschide Pack Studio](https://andregit7.github.io/radio/studio/) · [Cod sursă](https://github.com/Andregit7/radio)

Două aplicații web statice, fără conturi, backend, API-uri AI, fonturi externe sau dependențe JavaScript de la terți la rulare. Codul sursă este chiar codul servit browserului.

**Study** este pentru studenți: import de pachete, atlas, explicații structurate, repere legate de text, catalog de diagnostice cu căutare, grile, simulări, recapitulare și backup.

**Pack Studio** este aplicația separată pentru contributori: creare/import de pachete, editare de cazuri și diagnostice, programă, elipse legate de observații, grile și export validat. Study nu descarcă modulele de editare.

## Pornire locală

Este necesar Node.js 20+ pentru serverul de dezvoltare. Studenții care folosesc aplicația găzduită nu au nevoie de Node.js.

Din acest director:

```text
node tools/serve.mjs
```

Deschide `http://127.0.0.1:4173/` pentru Study. Pe Windows poți rula `start-study.cmd`.

În alt terminal:

```text
node tools/serve.mjs --studio
```

Deschide `http://127.0.0.1:4174/` pentru Studio. Pe Windows poți rula `start-studio.cmd`.

Porturile distincte separă originile și stocarea celor două aplicații. Serverele ascultă numai pe interfața locală. Fișierele HTML nu trebuie deschise direct prin `file://`: modulele, IndexedDB și Service Worker necesită o origine web potrivită.

## Primul pachet

În distribuția privată este inclus `course-pack/radiografii-explicate.study.zip`. Importă-l din Bibliotecă. Poate fi deschis și în Studio, prin „Deschide ZIP”.

Pachetul are 80 de cazuri, 60 de diagnostice canonice și 21 de grile derivate din notițe. Cele 80 de imagini sunt fluxurile JPEG exacte din PDF, fără recomprimare suplimentară. ZIP-ul are aproximativ 5,95 MB.

Un singur reper orientativ, marcat `draft`, demonstrează legătura text–imagine pe primul caz. Celelalte repere trebuie pregătite și verificate în Studio. Grilele `source-derived` nu reprezintă o validare medicală independentă.

Zece cazuri au numai un diagnostic. Cazul p054 nu are diagnostic pozitiv explicit și rămâne disponibil pentru studiu, fără întrebare automată de diagnostic. Limitele colocviilor nu au fost inventate.

Utilitarele de extragere a materialelor de curs sunt păstrate separat de codul public.

## Verificări

```text
node --test tests/*.test.mjs
node tools/prepare-studio.mjs
node tools/release.mjs
node tools/check.mjs
```

Testele Node verifică filtrarea românească, selecția și notarea prin identificatori, planificarea recapitulării, schimbarea cheilor, validarea datelor și importul/exportul ZIP. Arhivele de test includ traversare de directoare, nume duplicate, fișiere active, suprapuneri, dimensiuni excesive și CRC incorect. Dacă pachetul original nu este prezent, testul separat al celor 80 de cazuri este marcat „skipped”.

Pentru teste de integrare în browser, pornește Study și deschide `http://127.0.0.1:4173/checks.html`. Aceste teste folosesc o bază IndexedDB temporară, separată de datele de studiu. Verifică tranzacțiile, restaurarea fără dublare, workerul ZIP, catalogul și geometria reperelor. Testele nu intră în cache-ul aplicației. O copie pentru dezvoltatori este disponibilă la https://andregit7.github.io/radio/checks.html; distribuțiile statice generate rămân fără aceste fișiere auxiliare.

**Starea verificării acestei versiuni:** 26 de teste Node, 176 de verificări statice și 7 verificări de integrare în browser au trecut. Pachetul de 80 de cazuri a fost importat în Study și în Studio, iar primul caz și legătura observație–imagine au fost deschise. Instalarea pe cele patru platforme, pornirea în mod avion și măsurătorile pe un telefon modest rămân de efectuat. Dovezile sunt în `docs/browser-checks.json`.

Lista de verificare manuală este în `docs/verification.md`.

## Distribuție și GitHub Pages

`node tools/release.mjs` pregătește separat `releases/study-site/` și `releases/studio-site/`. Niciunul nu conține pachetul de curs sau date de utilizator. Fișierele sunt buildless; nu există instalare npm sau servicii externe necesare pentru publicare.

Pentru publicare pe GitHub Pages, pune conținutul directorului de distribuție în rădăcina unui repository public sau în directorul `docs/`, apoi configurează Pages pentru acel branch/director. Toate căile sunt relative, inclusiv `start_url`, `scope`, modulele și imaginile aplicației, pentru a funcționa și sub `/<repository>/`.

Pentru izolarea reală a celor două aplicații, folosește origini diferite. Două repository-uri Pages ale aceluiași proprietar împart de regulă originea `owner.github.io`; două căi nu sunt o barieră de securitate pentru IndexedDB. Poți utiliza proprietari/organizații diferite, fără domenii plătite.

Păstrează repository-ul aplicației separat de materialele de curs și de backupuri. `.gitignore` exclude pachetul generat și configurația privată de previzualizare. Licența MIT se aplică programului; nu transferă drepturi asupra imaginilor sau notițelor importate.

## Structură

| Director | Rol |
|---|---|
| `dist/` | Study, gata de servire statică |
| `studio/` | Pack Studio, aplicație separată |
| `studio/lib/` | Copii explicite ale modulelor comune, pregătite prin `tools/prepare-studio.mjs` |
| `tools/` | Servere locale, verificări și pregătirea distribuțiilor |
| `tests/` | Teste Node și fixture-uri ZIP/PNG independente |
| `docs/` | Contractul pachetelor, arhitectură, securitate și verificări |
| `starter-pack/` | Material generat privat; exclus din Git |
| `releases/` | Distribuții publicabile, generate local |

## Date și limite

Study folosește IndexedDB pentru pachete și imagini, iar Cache Storage pentru fișierele aplicației. Studio folosește o bază distinctă pentru proiecte. Exporturile sunt descărcări obișnuite; importurile citesc doar fișierele alese. Nu se solicită implicit acces persistent la directoare, cameră, microfon, notificări sau geolocalizare.

Backupul JSON include progresul și marcajele, fără imagini. Backupul complet ZIP include pachetele și progresul. Sesiunile neterminate sunt salvate local, dar nu sunt incluse în exporturile de backup. Data afișată este momentul pornirii exportului; aplicația nu poate confirma că sistemul de operare a păstrat efectiv descărcarea.

Pachetele ZIP standard acceptă metodele stored și deflate; decomprimarea deflate folosește `DecompressionStream('deflate-raw')`. Pe browsere fără acest format, pachetele stored funcționează în continuare dacă celelalte API-uri sunt disponibile. Exporturile aplicației folosesc stored, deoarece imaginile sunt deja comprimate.

Limitele inițiale sunt 32 MiB pentru arhivă, 64 MiB total dezarhivat, 12 MiB pentru o intrare, 3 MiB pentru un JSON, 1.200 de intrări și 12 megapixeli per imagine. Acestea sunt limite de protecție, nu rezultate ale unui benchmark pe dispozitive modeste. Împarte colecțiile mari în pachete mai mici.

Păstrează backupuri descărcate: stocarea browserului poate fi eliminată. Persistența suplimentară este o opțiune explicită în Study, nu o cerință de utilizare.
