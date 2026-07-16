# IMDF Map Viewer / GIS Dataset Sharing Platform

Browser-first indoor map viewer for Apple-validated IMDF ZIPs and Esri File
Geodatabase imports, plus an optional intranet sharing platform for publishing
reviewed datasets to colleagues.

## Local development

```bash
corepack pnpm install
corepack pnpm dev
```

Useful scripts:

```bash
corepack pnpm typecheck
corepack pnpm test --run
corepack pnpm build
corepack pnpm build:server
corepack pnpm exec playwright test --project=chromium
```

## Sharing platform (intranet server)

The viewer doubles as an ACC/Forma-style dataset sharing platform backed by a
single dependency-free Node service.

### Build and run

```bash
corepack pnpm build          # frontend -> dist/
corepack pnpm build:server   # server   -> server/dist/
node server/dist/main.js --port 8080 --data D:\gis-platform-data --app dist
```

The `--data` directory is the entire persistent state (datasets, catalog,
comments, accounts, sessions) — back it up as one folder. Run the process
under Task Scheduler or NSSM on a Windows VM. Expose it on the intranet only:
reads are public by design; sign-in credentials transit as plain HTTP unless
IT terminates TLS in front (IIS/ARR reverse proxy).

### Accounts

Accounts are CLI-managed (no UI). Roles: `admin` publishes and deletes,
`user` comments.

```bash
node server/dist/main.js add-user daniel --role admin --data D:\gis-platform-data
node server/dist/main.js add-user alice --role user --data D:\gis-platform-data
```

Re-running `add-user` for an existing name resets the password/role.

### Publishing and sharing

1. Open the viewer menu and sign in, then open a GDB folder/archive or an IMDF ZIP locally.
2. Review the GDB mapping as usual, import, then click 公開 (Publish).
3. Share the view URL (`/?dataset=<id>`) or embed URL
   (`/?dataset=<id>&embed=1&level=b1f&lang=ja`) — the same `level`, `lang`,
   and `theme` deep-link parameters work for datasets.
