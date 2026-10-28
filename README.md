# Overspray

A livery builder for iRacing that runs in the browser. Paint on the flat
template panel by panel, set finishes, and see every change on the car.

It began as a fork of [Clearcoat by OblivionsPeak](https://github.com/OblivionsPeak/clearcoat)
and is built on it. It keeps the original's plumbing (reading templates,
drawing layers, writing the paint files, the iRacing folder link) under a
screen of its own. The original screen and the features only it had are not
in this repo any more; they are in the original repo and in this one's
history.

## Running it

It is a static site: no build step.

```
python -m http.server 8000
```

Then open `http://localhost:8000/` in Chrome or Edge. It has to be
`localhost` or https for the iRacing folder link to work. Saving to iRacing
and Live need Chrome or Edge; everything else works in other browsers.

## Where things are

- `index.html` — the app's page.
- `next/` — the app's code (the folder is named for when it was the new
  screen beside the original): `app.js` (state, drawing, actions),
  `ui.js` (menus, panels, dialogs), `tools.js` (pointer and keys on the
  sheet), `map.js` (Map mode), `icons.js` (icon search, SVG shapes),
  `picker.js` (the colour picker), `preview.js` (the finish preview).
- `js/` — everything with no page in it, so it runs under `node --test`:
  `engine.js` (the livery, painting it, the finish map, saving and loading),
  `shapes.js`, `mirror.js`, `finish.js`, `svgpath.js`, `trace.js`, `regions.js`,
  `zones.js`, `template.js`, `psd.js`, `tga.js`, `iracing.js`, `persist.js`.
- `test/` — `npm test`.
- `version.js` — the version, in one place. Bump it on every deploy.
- `sw.js` — the service worker. It names its cache after the version, which
  is how a browser notices a new one.

## Credits

Originally based on Clearcoat by OblivionsPeak; its code has since been
rewritten. The name is set in Rubik Spray Paint
(SIL Open Font License), from Google Fonts. Icons found through the search come
from Game Icons (CC BY 3.0), Material Symbols and Material Design Icons
(Apache 2.0) and Bootstrap Icons (MIT), by way of Iconify; each one's credit
is kept with the livery and listed under Help › About.

## Licence

Overspray is under the GNU Affero General Public License v3.0 only (see
`LICENSE`). If you run a changed copy for other people, online included, you
must share your changed source under the same licence. The bundled ag-psd
(`js/vendor/`) keeps its own MIT licence. Car maps in overspray-maps are
CC BY-SA 4.0.
