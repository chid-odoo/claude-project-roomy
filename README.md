# roomy

Roomy is a browser app for designing things to build from plywood and other
sheet stock: boxes, shelves, cabinets, crates. You model a project in 3D out
of boards, and Roomy tells you what to cut and how many sheets to buy.

It runs on desktop and phone browsers, works offline once loaded, and can be
installed as an app. The ? button in the app explains how to use it.

## Features

- **3D design** with Three.js: orbit, pan and zoom with mouse or touch.
- **Boxes in one step**: enter outside width x height x depth and the plywood
  thickness; Roomy sizes butt-jointed panels and groups them as "Box 1".
  Open-topped by default, with a closed-top option.
- **Pieces** with width, height, depth, position and rotation, edited by typing
  (fractions like `1 1/2` or `1' 6"` work) or by dragging a field up and down.
- **Selection**: click, double-click into groups, Shift+click or "Select
  multiple" for several; arrow keys and -/+ buttons move the selection.
- **Groups** that can nest, rotate about their centre, be renamed and
  duplicated.
- **Undo and redo** (100 steps) for every change to the design.
- **Units**: mm, cm, m, inches, or feet and inches, with imperial sizes to the
  nearest 1/16".
- **Cut list** grouping identical pieces.
- **Sheets to buy**: packs the pieces onto stock sheets (4' x 8' by default),
  shows how many each thickness needs, and draws a to-scale cutting diagram
  for every sheet.
- **Save and share** designs as `.json` files; the current design is also
  kept in the browser automatically.

## Getting started

Needs Node.js 18 or newer.

    npm install
    npm run dev

Open the `Local` URL it prints. To try it on a phone, see "Running on your
local network" below.

## Scripts

- `npm run dev` - dev server with hot reload, reachable from other devices on the network
- `npm run build` - production build into `dist/`, deployable to any static host
- `npm run preview` - serve the production build
- `npm run cert` - make HTTPS certificates for installing on a phone (see below)
- `npm run phone` - build, then serve it over HTTPS on the network (port 4173)
- `npm test` - run the tests

## How the code works

Plain JavaScript modules, built with Vite. There is no UI framework: the side
panel is built with DOM calls, the 3D view with Three.js.

    src/
      main.js            wires everything together
      model/             the design and the maths, no DOM or WebGL
        project.js       Project: pieces, groups, selection, undo history
        box.js           box template -> butt-jointed panels
        geometry.js      rotation (quaternions), corners, bounding boxes
        units.js         unit conversion, parsing and formatting lengths
        cutlist.js       cut list rows
        sheets.js        sheet estimate (guillotine packing)
        storage.js       JSON save/load format, auto-save
      view/              the 3D scene
        scene.js         DesignScene: meshes, camera, labels, picking
        transform.js     model mm -> scene metres
      ui/                the side panel and input
        panel.js         Panel: every section of the side panel
        input.js         click/double-click picking rules, keyboard shortcuts
        scrub.js         drag-to-change number fields
        sheetDiagram.js  SVG cutting diagrams
        help.js          Help view text
      pwa.js             service worker registration
    public/              copied as-is: manifest, service worker, icons
    test/                Vitest tests, one file per module
    scripts/make-cert.sh local HTTPS certificates

**One source of truth.** A single `Project` holds the whole design. The 3D
scene and the panel never change each other; they call `Project` methods, and
`Project` notifies its listeners (`onChange`) after every change. On each
notification `DesignScene.sync()` updates meshes and labels and
`Panel.render()` refreshes the fields, piece list, cut list and estimate.

**Pieces and groups.** A piece is a board: width (X), height (Y, up), depth
(Z), a position (its corner nearest the origin, before rotation) and a
rotation in degrees about its centre. Groups are a tree: each piece has a
`groupId`, each group a `parentId`. Pieces and groups are both "nodes",
addressed by keys like `piece:3` or `group:2`; the selection is a list of
keys. A group left with fewer than two children dissolves.

**Units.** Everything is stored in millimetres. Units only matter at the
edges: parsing what you type, and formatting labels, fields and lists. The 3D
scene works in metres so the camera behaves the same for a drawer or a shed.

**Undo.** Before a change, `Project` stores a JSON snapshot of the design;
undo and redo swap snapshots. A drag or a held arrow key is wrapped in
`beginBatch()`/`endBatch()` so it is one step. Selection, units and sheet
settings are not part of the history.

**Saving.** `storage.js` defines a versioned JSON format (`format`,
`version`, pieces, groups, settings) and checks every field when loading, so
a bad file is rejected without touching the current design. The same format
is used for the auto-save in `localStorage`.

**Sheet estimate.** For each thickness, pieces are placed biggest first into
the free space they fit most snugly, and the leftover space is split along
its shorter side. That gives guillotine layouts (every cut goes straight
across), which can be cut on a table saw or with a circular saw. A saw kerf
gap is kept between pieces. It is a heuristic, so the count is a good
estimate rather than a proven minimum.

**Offline and install.** `public/manifest.webmanifest` describes the app;
`public/sw.js` caches it (pages network-first, built files cache-first). The
service worker is only registered in production builds so `npm run dev`
always shows fresh code.

**Tests.** `npm test` runs Vitest. Model tests run in Node; `panel.test.js`
uses jsdom to click and type in the real panel; the service worker is tested
against fake browser APIs. The 3D scene needs WebGL and is checked by hand.

## Running on your local network

`npm run dev` listens on the network. On a phone on the same Wi-Fi, open the
`Network` URL it prints (`http://<computer-ip>:5173/`). If it times out, the
computer's firewall is probably blocking it; with ufw, allow your home network
only, e.g. `sudo ufw allow from 10.0.0.0/24 to any port 5173 proto tcp`.

### Installing on your phone (local network)

Phones only install web apps from HTTPS sites they trust. To do that locally:

1. `npm run cert` creates `.cert/roomy-local-ca.crt`, a small certificate
   authority, and a certificate for this computer signed by it. Run it again
   if the computer's network address changes (the CA stays the same).
2. Get `roomy-local-ca.crt` onto the phone (email, AirDrop, or run
   `python3 -m http.server --directory .cert 8000` and open
   `http://<computer-ip>:8000/roomy-local-ca.crt` on the phone), then trust it:
   - Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate.
   - iPhone: open the file, install the profile in Settings > General > VPN & Device Management,
     then turn it on in Settings > General > About > Certificate Trust Settings.
3. `npm run phone`, then open `https://<computer-ip>:4173/` on the phone
   (allow port 4173 in the firewall as above).
4. Install: Android Chrome menu > Install app; iPhone Safari Share > Add to Home Screen.

Only trust this CA on your own devices, and keep `.cert/ca-key.pem` private:
anyone with it could make certificates your phone would trust. `.cert/` is
ignored by git. To stop trusting it, remove the certificate in the same
phone settings.

## GitHub Pages

`.github/workflows/pages.yml` tests, builds and publishes `dist/` to GitHub
Pages. It only runs when started by hand: Actions tab > "Deploy to GitHub
Pages" > Run workflow. Before the first run, set Settings > Pages > Source to
"GitHub Actions". The site will be at `https://<user>.github.io/roomy/` and
can be installed from there on any phone, no certificates needed.

## Future goals

- **Publish on GitHub Pages**, then deploy automatically on every push to the
  main line instead of by hand.
- **Better sheet layouts**: an option for tighter, non-guillotine packing for
  track saws and CNC, different sheet sizes per thickness, and printing or
  exporting the cutting diagrams (PDF) to take to the saw.
- **Joinery**: dados, rabbets and other joints besides butt joints, with the
  cut list adjusting piece sizes to match.
- **More templates** beyond the box, such as shelves, drawers and cabinets.
- **Direct manipulation in 3D**: drag pieces and groups with on-screen handles,
  snapping to other pieces' edges and the floor.
- **Materials**: board lumber as well as sheets, with a shopping list and
  price estimate.
- **Comfort**: collapsible groups in the piece list, keeping pieces above the
  floor, and a dark theme.
- **Desktop or mobile packaging** if a store app is ever needed; the web code
  can be wrapped (e.g. Electron or Capacitor) without changing it.
