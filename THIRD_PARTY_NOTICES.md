# Third-party notices

## Data

| Data                                          | Source                                                                                                                                          | Terms                                                                                    | Used for                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| Service points (DIDOK, atlas v2)              | [opentransportdata.swiss](https://data.opentransportdata.swiss/dataset/service-point-v2), snapshot in `public/data/stops.v1.json` (date inside) | [Terms of use opentransportdata.swiss](https://opentransportdata.swiss/en/terms-of-use/) | Station search, coordinates |
| Timetable, realtime and disruptions (OJP 2.0) | [opentransportdata.swiss](https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/) through this app's Worker                      | Same                                                                                     | Trip planning               |
| Map tiles, glyphs, sprites                    | [OpenFreeMap](https://openfreemap.org/), from [OpenMapTiles](https://openmaptiles.org/)                                                         | Free to use                                                                              | Map                         |
| Map data                                      | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors                                                                         | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)                                   | Map                         |
| Route templates, segments, GA exceptions      | Curated for this app (`src/data/`)                                                                                                              | AGPL-3.0-or-later with the app                                                           | Planning rules              |

Map attribution is shown on the map itself.

## Libraries bundled with the app

| Library                       | Licence      |
| ----------------------------- | ------------ |
| React, React DOM              | MIT          |
| zustand                       | MIT          |
| idb-keyval                    | Apache-2.0   |
| MapLibre GL JS                | BSD-3-Clause |
| Workbox (via vite-plugin-pwa) | MIT          |
| uqr (QR codes for sync)       | MIT          |
| jsQR (reading QR codes)       | Apache-2.0   |
| fast-xml-parser               | MIT          |
| AndroidX (Android app)        | Apache-2.0   |
| Capacitor                     | MIT          |

Full licence texts ship in each package under `node_modules/<name>/LICENSE`.
