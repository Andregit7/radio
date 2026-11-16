# Arhitectură v1

## Aplicații independente

Study și Pack Studio sunt două aplicații statice, fiecare cu manifest, Service Worker și bază IndexedDB proprii. Nu există backend sau comunicare între aplicații. Transferul se face printr-un pachet ZIP. Modulele de validare și ZIP sunt comune la nivel de sursă și copiate explicit pentru distribuție; Studio nu încarcă module din originea Study.

Study nu oferă creare sau editare de pachete. Reperele livrate în pachet sunt afișate prin SVG generat din geometrie validată. În Studio v0.1 editorul de desen produce elipse și lucrează pe prima imagine a cazului; Study poate afișa și dreptunghiuri, poligoane, săgeți și mai multe imagini din pachete conforme.

## Contracte

Datele de curs, întrebările și algoritmii sunt separate:

- `pack.json`: curriculum, catalog, cazuri, explicații și repere;
- `questions.json`, opțional: grile cu enunț, opțiuni, cheie și feedback;
- aplicația: filtrare, prezentare, compunerea sesiunilor, notare, recapitulare.

Fiecare diagnostic are un ID canonic, denumire completă, aliasuri de căutare și capitole. Cazurile referă aceste ID-uri. Căutarea normalizează diacriticele, majusculele și punctuația, apoi cere potrivirea tuturor cuvintelor. Lista disponibilă depinde numai de programă, căutare și filtrul ales; funcția de căutare nu primește cazul sau răspunsul corect.

Un răspuns este o selecție explicită de identificatori. Șirul tastat nu este notat și un singur rezultat nu este confirmat automat. Sunt disponibile atât selecția din catalog, cât și grile cu opțiuni fixe. Nu există răspunsuri vocale, text liber notat, LLM sau generare clinică la rulare.

## Învățare

O sesiune de recapitulare prioritizează greșelile scadente, celelalte întrebări scadente, materialul nou și apoi întrebările programate în viitor. O greșeală revine după 10 minute; reușitele au intervale de 1, 3, 6, 12… zile, până la 90. Este o euristică transparentă, nu un model de memorie calibrat clinic sau o implementare FSRS.

Simularea distribuie întrebările între capitolele selectate fără a utiliza istoricul greșelilor. Explicațiile și corectitudinea sunt afișate numai la final. Numărul configurat reprezintă întrebări, nu radiografii distincte. Modul mixt evită dublarea aceleiași întrebări de diagnostic prin catalog și grilă.

Progresul este separat pe pachet, întrebare și mod de răspuns. O semnătură a enunțului, opțiunilor și cheii împiedică reutilizarea programării atunci când întrebarea se schimbă. Ordinea afișării opțiunilor nu modifică semnătura.

## Persistență și restaurare

Imaginile sunt Blob-uri în IndexedDB, cu referințe interne, fără URL-uri din pachet. O înlocuire scrie pachetul, banca și imaginile într-o singură tranzacție. Erorile anulează înlocuirea, păstrând versiunea precedentă. Imaginile vechi sunt eliminate în aceeași tranzacție, fără a atinge datele altor pachete.

Confirmarea unui răspuns salvează progresul și sesiunea într-o singură tranzacție. Restaurarea progresului păstrează înregistrarea cu data ultimei încercări mai recentă și unește marcajele fără dublare. Backupul complet validează toate datele înaintea tranzacției comune.

Această versiune este destinată utilizării într-o singură fereastră activă per aplicație. Actualizarea simultană a progresului în mai multe file nu are încă rezolvare de conflicte la nivel de eveniment.

## Offline și actualizări

Service Worker salvează atomic lista explicită a fișierelor aplicației. Materialele importate sunt în IndexedDB, separat de cache. Distribuția folosește un identificator de cache calculat din conținut, astfel încât o versiune incompletă nu înlocuiește cache-ul activ.

Study cere explicit activarea unei actualizări și nu o activează din propria sesiune neterminată. Nu șterge IndexedDB la activare. Curăță numai cache-urile sale, cu prefixul propriei origini/căi. Studio așteaptă închiderea ferestrelor vechi pentru activarea naturală a unei actualizări.

Pornirea inițială și importul unui pachet primit online necesită ca fișierele să fie deja descărcate. Ulterior, studierea, testele, editarea și exportul se bazează pe datele locale. Browserul și utilizatorul pot șterge stocarea; backupurile externe sunt necesare.
