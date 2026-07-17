# IMDF Map Platform — Operations Runbook

Single always-on Windows PC serving the app to the LAN over plain HTTP as an
auto-starting, auto-restarting Windows service (NSSM).

- **Repo / app:** `C:\imdf-platform\app`
- **Data:** `C:\imdf-platform\data` (all state; outside the repo — never touched by pull/rebuild)
- **Logs:** `C:\imdf-platform\logs\` (`out.log`, `err.log`)
- **NSSM:** `C:\imdf-platform\nssm\nssm.exe` (or on PATH via winget)
- **Service:** `imdf-platform` · **Port:** `8080` · **Account:** LocalSystem

All commands run in an **elevated (Administrator) PowerShell** unless noted.

---

## PREREQUISITE — publish the branch before deploying to the remote PC

The remote PC clones from GitHub. The deployable feature (`feature/gdb-import`,
which includes the in-browser GDB→IMDF conversion the deployment is verified
against) plus these deploy scripts **must be pushed to GitHub first**, or the
remote clone installs stale code:

```powershell
# on the development machine, from the repo:
git push origin feature/gdb-import
```

Confirm the remote is up to date (0 local-only commits):

```powershell
git rev-list --left-right --count HEAD...origin/feature/gdb-import   # expect: 0   0
```

---

## First-time install (on the host PC, elevated)

1. Install Node LTS and git if not present. Ensure the PC can reach GitHub
   (SSH key for `git@github.com:...`, or switch `-RepoUrl` to the https URL).
2. Copy `deploy\install-windows-service.ps1` to the PC (or clone the repo once
   manually), then run elevated:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-windows-service.ps1 `
       -RepoUrl git@github.com:dmalmq/imdf-map-application.git -Branch feature/gdb-import
   ```

   The script lays out directories, clones, builds, installs + configures the
   NSSM service (auto-start + auto-restart + logging), opens the firewall, and
   starts the service.
3. Create the first admin account (interactive password prompt):

   ```powershell
   cd C:\imdf-platform\app
   node server\dist\main.js add-user admin --role admin --data C:\imdf-platform\data
   ```

   Expected: `Stored admin account "admin" in C:\imdf-platform\data`.

---

## Recurring procedures

### Update to the latest code
```powershell
nssm stop imdf-platform
cd C:\imdf-platform\app
git pull --ff-only
corepack pnpm install
corepack pnpm build
corepack pnpm build:server
nssm start imdf-platform
```

### Add a user
```powershell
cd C:\imdf-platform\app
node server\dist\main.js add-user <name> --role admin|user --data C:\imdf-platform\data
```
`user` = view + comment; `admin` = also publish/delete datasets. Password is
prompted interactively; pass `--password <pw>` to script it non-interactively.

### Backup
Files are written atomically (`rename`), so no stop is required. Copy
`C:\imdf-platform\data` to backup storage.
**Restore:** `nssm stop imdf-platform` → replace the `data` folder → `nssm start imdf-platform`.

### Logs
`Get-Content C:\imdf-platform\logs\out.log -Tail 50` (and `err.log`).

---

## Verification (run on the host after install)

1. **Service up:** `nssm status imdf-platform` → `SERVICE_RUNNING`.
   `Get-Content C:\imdf-platform\logs\out.log` contains
   `GIS dataset platform listening on`.
2. **API responds:** `curl.exe -s http://127.0.0.1:8080/api/catalog`
   → `{"datasets":[]}` (empty on fresh install).
3. **WASM MIME** — the static server serves the in-browser converter with the
   correct type. Use **GET** (`-D -`), not `-I`/HEAD: this server returns HTTP
   405 for HEAD on static assets (browsers fetch WASM via GET, so this is
   cosmetic), while GET is 200:

   ```powershell
   $w = (Get-ChildItem C:\imdf-platform\app\dist\assets\gdal3WebAssembly-*.wasm | Select-Object -First 1).Name
   curl.exe -s -o NUL -D - "http://127.0.0.1:8080/assets/$w"
   ```
   → `HTTP/1.1 200 OK` and `content-type: application/wasm`.
4. **Auth round-trip:**
   ```powershell
   curl.exe -s -c cookies.txt -H "content-type: application/json" `
     -d '{\"username\":\"admin\",\"password\":\"<PW>\"}' http://127.0.0.1:8080/api/login
   curl.exe -s -b cookies.txt http://127.0.0.1:8080/api/me
   Remove-Item cookies.txt
   ```
   → both return `{"account":{"username":"admin","role":"admin"}}`.
5. **Colleague reachability:** from another LAN PC open
   `http://<host-pc-name>:8080/`, sign in, import a `.gdb.zip`, confirm the
   venue renders (proves the browser-side WASM conversion works in production).
6. **Boot persistence:** reboot the host; re-run checks 1–2 without starting
   anything → service `SERVICE_RUNNING`, `/api/catalog` responds.
7. **Crash recovery:** `Stop-Process -Name node -Force`; wait ~5 s; re-run
   check 1 → `SERVICE_RUNNING` again (NSSM restarted it).

---

## Contingencies

- **Port 8080 in use** (`Get-NetTCPConnection -LocalPort 8080`): re-run the
  install script with `-Port 8081` (updates both the service and firewall rule).
- **Corepack/pnpm version error:** `corepack prepare pnpm@11.12.0 --activate`, then retry.
- **NSSM:** the script tries winget, then downloads `nssm-2.24.zip` from
  https://nssm.cc/download and extracts `win64\nssm.exe`.
- **Large uploads OOM** (publishes up to 600 MiB buffer in memory):
  `nssm set imdf-platform AppEnvironmentExtra NODE_OPTIONS=--max-old-space-size=2048` → restart.
- **HTTPS** (excluded by design; cookies are not `Secure`-flagged): front the
  service with Caddy on 443 → `127.0.0.1:8080`; no app change needed.
