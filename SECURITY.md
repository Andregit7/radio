# Security and privacy

## Verifiable surface

The program uses no AI services, accounts, sign-in forms, telemetry, ads, external fonts or CDN scripts. It has no third-party JavaScript dependencies at runtime. The modules served are readable source files, with no minification or build chain hiding the logic.

The application's requests are reads of its own files, of the optional configuration of the preview pack and of the pack chosen for download. There is no code that uploads images, answers or progress to a server. The Service Worker's native update checks assume access to the host. The hosting provider may retain logs; GitHub Pages records IP addresses for security purposes.

The data is protected by the browser's origin rules. The application does not claim to withstand a compromised browser or new malicious code published later on the same origin. A check of the repository must be correlated with the bytes delivered and with the active Worker.

## Untrusted data

Import validates the ZIP structure, limits, paths, duplicates, compression method, local/central headers, overlaps, CRC and the actual number of decompressed bytes. ZIP operations run in a terminable Worker. Only approved image and data formats are accepted. No file from the archive is extracted to the user's disk or executed.

JSON has size limits and explicit validation. Prototype keys are rejected. The validator rebuilds the allowed objects. Images are checked by signature, dimensions and, if present, SHA-256. The hash detects a change of content; it does not authenticate the author of the pack.

Imported text is inserted as text through the DOM, not through `innerHTML`. The geometry of the annotations is numeric, normalised and refers to existing IDs. Imported SVG/HTML, external image URLs and executable files are not accepted. CSP forbids inline scripts, objects, forms and external resources.

The ZIP reader has an intentionally narrow scope; the actual decompression is done by the browser. Non-conforming packs must be re-exported cleanly; tolerating every ZIP extension is not a v1 goal.

## Storage and restore

No permission is requested by default for directories, camera, microphone, geolocation or notifications. Selecting a file gives the application that file; IndexedDB is browser-managed storage, not access to other files on the device. The request for persistent storage is optional and explicit.

Pack replacements are transactional. Importing a full backup validates every pack before writing begins. JSON restores merge the bookmarks and choose the more recent progress records, without counting the same counters twice.

Backup files are ordinary downloads, not encrypted by the application. Local storage is not a backup copy. Keep external copies of the packs and of the progress; Studio projects must be exported regularly.

## Reproducible audit

1. Run the tests and `node tools/check.mjs`.
2. Run `node tools/release.mjs`; check `release.json` in each distribution.
3. Compare the SHA-256 for the files in the distribution with those delivered by the host, including the Service Worker.
4. Inspect Network on import, answer, backup and after enabling airplane mode.
5. Check the applications on distinct origins and check the active Worker, not only the source on the server.

A static audit or an AI opinion cannot guarantee the absence of any vulnerability. The initial version has logic, data and archive tests; actual testing in browsers and on devices is documented separately in `docs/verification.md`.
