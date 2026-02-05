# IACP-Skirmish-Async
IACP - Skirmish Async

## Command card images (CC folder)

- **Naming:** Images in `vassal_extracted/images/cc/` use standardized filenames so the folder sorts A–Z: base game `CardName.ext`, IACP variants `CardName (IACP).ext` when both exist. The script strips `C card--` / `IACP_C card--` prefixes and keeps whatever name is in the file. Run `npm run normalize-cc-images`.
- **Cursor / internal storage:** To use images from Cursor’s internal storage (or any editor), **save them into the workspace** so the bot and scripts can read them:
  - Save path: `vassal_extracted/images/cc/CardName.png` (exact card name, e.g. `All in a Day's Work.png`).
  - The CC review server and normalize script only read from the project filesystem; they cannot access Cursor’s internal blob storage. Saving the file into `vassal_extracted/images/cc/` with the card name is the fix.
