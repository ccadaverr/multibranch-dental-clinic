# Credits: images, icons and fonts

Every visual asset used by the application, with its source and licence. Add a row before adding any new asset.
Scraped or unlicensed assets are not allowed.

| Asset | Where it is used | Source | Licence |
| --- | --- | --- | --- |
| Clinic logo `public/images/logo.png` | Sign-in, sidebar, assistant avatar, emails and PDFs | Supplied by the clinic | Owned by the clinic |
| Clinic artwork `public/images/logo-with-name.png` | Only where approved | Supplied by the clinic | Owned by the clinic |
| Interface icons (`ICON_PATHS` in `src/components.jsx`, including the patient-portal icons: pin, clock, check, chevronLeft, download, lock, phone, mail, alert, star) | All screens | Drawn for this project as simple 24×24 stroke paths | Project's own work |
| Landing page hero illustration (phone with a booking calendar, tooth and message; inline SVG in `src/pages/PublicSite.jsx`) | Public landing page | Drawn for this project | Project's own work |
| Fonts | All screens | System font stack (`ui-sans-serif`, `system-ui`, …); no font files are bundled | Provided by the device |

No stock photos (Unsplash, Pexels or other) are used in the patient portal. If one is added, record the photo page URL, the
photographer and the licence (Unsplash License / Pexels License) here.

## Libraries for the counter registration (intake)

| Library | Where it is used | Source | Licence |
| --- | --- | --- | --- |
| Tesseract.js 7.0.0 (and tesseract.js-core) | On-device OCR for "Scan your ID to fill this in" (`src/intake/id-scan.js`); files self-hosted under `/ocr`, loaded only when a patient taps Scan | https://github.com/naptha/tesseract.js | Apache-2.0 |
| Tesseract English model `eng.traineddata` (4.0.0 best_int, via `@tesseract.js-data/eng`) | The OCR language data, self-hosted under `/ocr` | https://github.com/tesseract-ocr/tessdata_best | Apache-2.0 (package: MIT) |
| jsQR 1.4.0 | Reads the PhilID / ePhilID QR code on the device (name and birth date only) | https://github.com/cozmo/jsQR | Apache-2.0 |
| bacon/bacon-qr-code 3 | The QR code on the branch counter poster (PDF) | https://github.com/Bacon/BaconQrCode | BSD-2-Clause |
| Synthetic specimen ID images (`docs/ui-review/intake/specimens/`) | Scan accuracy tests | Drawn for this project with fake names, marked "SPECIMEN — NOT A REAL ID" | Project's own work |

The four original parametric tooth meshes in `public/models/dental-crowns.glb` were generated for this project and are released under CC0 1.0. They illustrate tooth position and type. They are independent of individual patients’ scans.
