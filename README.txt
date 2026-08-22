BREAKTIME - Three.js stress-release FPS prototype

FILES
- index.html
- style.css
- game.js

RUN
Because the project uses JavaScript modules, run it through a local web server instead of double-clicking index.html.

Easy options:
1. VS Code Live Server extension
2. Python: python -m http.server 8080
3. Deploy the folder directly to Vercel / GitHub Pages.

CONTROLS
Desktop:
- WASD: move
- Mouse: look
- Left click: whack / throw held object
- E: pick up / put down
- Q: drop held object
- Double tap A or D: dodge

Mobile:
- Left circular control: movement
- Drag right side: look
- WHACK: attack / throw
- PICK UP: grab / drop item
- Swipe quickly left/right on the look area: dodge

NOTES
- No database, login, account, score, or save system.
- Refreshing resets everything.
- Vibration uses the browser Vibration API and therefore depends on device/browser support.
- Stylised blood can be disabled on the start screen.
- No external models or textures are required. Three.js itself loads from jsDelivr CDN.
