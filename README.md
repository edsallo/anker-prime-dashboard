# Anker Prime Dashboard

[Русская инструкция](README.ru.md) · [License](LICENSE) · [Third-party notices](THIRD_PARTY.md)

A self-hosted web dashboard for the **Anker Prime A2345 250 W desktop charger**, running in Docker. It connects directly to Anker Cloud using HTTPS and MQTT/TLS. **Homey, Synology and a phone acting as a bridge are not required.** Internet access and an existing Anker account are required.

Default external port: **80**. The application listens on **8080 inside the container**. Open http://YOUR_SERVER_IP/ in your browser. The Docker image is built locally from this repository; there is no published Docker Hub image to pull.

The dashboard currently uses Russian labels. Installation and project documentation are available in English and Russian. This is an unofficial community integration, not an Anker product.

## Experimental Anker settings and cloud profiles (1.1.0)

Settings → Тестовые exposes Maximum Compatibility, Custom Charging Mode enablement and Charging Device Identification. The A2345-specific identification endpoint is used; the older identity flag does not represent this model's current setting. Identification cannot be enabled while compatibility is on.

The Profiles Anker button beside charging mode loads profiles from the account. Save current limits/protocols into a free slot (maximum four), rename, change auto-exit, overwrite with current limits, apply or delete with confirmation. Saving a profile does not apply it; applying sends the complete profile/protocols and waits for device confirmation. Saved profiles are shared with the official app.

The identification switch is implemented; decoded recognized-device names in port cards are **not yet implemented**. View those names in the official app. No reliable identifier-to-model mapping has been verified yet.

Live verification: cloud settings changed and restored; a temporary cloud profile created, updated and removed; original profile preserved. Automated tests also cover correct A2345 endpoints, compatibility dependency, protocol preservation and profile limits.

## Purpose

See which ports are charging, compare voltage/current/power, change supported charger settings, distribute a power budget and review usage history from a phone or computer browser. The server continues collecting history while the browser is closed. Each installation maintains its own history and energy counters.

## Features

| Feature | Behavior |
| --- | --- |
| Live telemetry | Power (W), voltage (V), current (A) for C1–C4 and A1–A2, total output and data freshness. |
| Port switching | Four independent USB-C groups and one shared USB-A group. A1/A2 share switching, power limit and resettable energy, but have separate measurements/charts. |
| Charging modes | AI Power, connection priority, dual-laptop, low-power and custom mode. Saved custom limits are shown as limits only in custom mode. |
| Power limits | USB-C controls in 5 W steps; shared USB-A allocation 0/15/24 W. Budget preview and automatic reduction of other USB-C limits within 250 W. |
| Output energy | Estimated energy since reset, reset date and confirmation before reset. Independent persistent counters. |
| Timers | Supported port/group timers and charging schedules. |
| Display | Brightness, display timeout and nine known screensaver themes. |
| Clock/control | Clock options, holiday appearance, clock schedule, encoder direction and port priority. |
| Names | Custom port/group names saved on the server. |
| History | Separate W/V/A charts for six ports; 1/6/24 hours and 7/30 days; peak power, estimated energy, charging time and data coverage. |
| Account | First-run email/password/region/country form, reconnect after restart and account replacement from the Account link. |

Limits represent a charger allocation setting. Actual voltage and power depend on USB-PD negotiation and the connected device. Forced fixed voltage is not implemented. Fine-grained power enforcement still requires electronic-load verification; a 5 W UI step is not a measured guarantee of physical limiting precision.

Samples are collected approximately every 10 seconds and retained for 30 days. Energy is integrated from measured output power; long gaps are not extrapolated. It is output energy, not mains consumption. History/counters are not imported from Anker, Homey Insights or the earlier Synology website. A new installation starts collecting after login.

## Requirements

- A2345 already linked to your account in the official Anker app, connected to Wi-Fi and online.
- That account's email/password, correct cloud region (EU/Global) and two-letter registration country.
- Linux server with Docker Engine and the Compose plugin, internet access, a stable LAN IP and space for the image/history.
- Tested deployment: Ubuntu 24.04 x86_64. Other Docker hosts/architectures have not been verified by this project.
- A free external port; **80 is the default**. Host Node.js is not required.

## Installation from zero on Ubuntu

### 1. Connect to the server

Open Terminal on macOS/Linux or PowerShell on Windows:

~~~bash
ssh YOUR_UBUNTU_USER@YOUR_SERVER_IP
~~~

Replace placeholders. Enter the Ubuntu password when asked; no characters appear while typing. The following commands run on the server. sudo may ask for that password again. Do not enter your Anker password in terminal commands or .env.

### 2. Install Docker if missing

Check sudo docker --version and sudo docker compose version. If both work, skip this step. On a clean Ubuntu host, use Docker's signed official APT repository below. For an existing/conflicting installation, first follow [Docker's official installation instructions](https://docs.docker.com/engine/install/ubuntu/) rather than blindly removing packages.

~~~bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
~~~

### 3. Download this public repository

~~~bash
sudo apt install -y git
git clone https://github.com/edsallo/anker-prime-dashboard.git
cd anker-prime-dashboard
cp .env.example .env
nano .env
~~~

A GitHub account is not required. git clone downloads the source. nano opens an editor: after editing, press Ctrl+O, Enter to save, then Ctrl+X to exit.

### 4. Configure the address

Example .env for a server at 192.168.1.100:

~~~dotenv
SERVER_IP=192.168.1.100
WEB_PORT=80
PUBLIC_URL=http://192.168.1.100
~~~

Replace **both** IP occurrences with your server's LAN IP. SERVER_IP must be assigned to this machine; Docker binds only that address. PUBLIC_URL must match the browser origin exactly, without a trailing slash. For port 80 omit :80. Host/Origin requests are validated against this setting.

.env contains deployment configuration, not Anker credentials, and is excluded from Git and the Docker build. WEB_PORT defaults to 80 if omitted. SERVER_IP and PUBLIC_URL are required so the public project does not silently use the author's private address.

### 5. Prepare persistent storage and launch

~~~bash
sudo mkdir -p data
sudo chown 1000:1000 data
sudo chmod 700 data
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
~~~

The container runs as UID/GID 1000. Therefore data/ must belong to 1000:1000 even if your Ubuntu login has a different UID. The initial build downloads Node.js and dependencies and may take several minutes. Up (healthy) confirms the HTTP server is running, not that an Anker account has connected.

### 6. First-run account setup

Open http://192.168.1.100/ from the same LAN, replacing the IP. The site redirects to /setup.

1. Enter the email/password used in the Anker phone app.
2. Choose EU or Global and enter the account registration country, such as DE/RU/US. The form defaults to DE; change it if appropriate.
3. Press **Подключить зарядку** (Connect charger).
4. Supported A2345 chargers are discovered after successful cloud login and MQTT connection.

Credentials are saved encrypted and restored after restart. The **Аккаунт** (Account) link lets you replace the account; passwords are never prefilled. A failed replacement preserves the previous connection. Extra login steps such as MFA/CAPTCHA are not bypassed or implemented; accounts requiring them may fail to connect.

## Another external port

For port 8085:

~~~dotenv
SERVER_IP=192.168.1.100
WEB_PORT=8085
PUBLIC_URL=http://192.168.1.100:8085
~~~

Run sudo docker compose up -d, then open http://192.168.1.100:8085/. The internal port remains 8080. Multiple exact browser origins may be listed in PUBLIC_URL separated by commas; this does not create DNS records or certificates. Only one instance should write a given data/ directory.

## docker run alternative

From the downloaded project directory, after creating data/ with the permissions above:

~~~bash
sudo docker build -t anker-prime-dashboard .
sudo docker run -d --name anker-prime-dashboard \
  --restart unless-stopped --init --user 1000:1000 \
  --read-only --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 192.168.1.100:80:8080 \
  -e SITE_ORIGINS=http://192.168.1.100 \
  -e DATA_DIR=/data -e TZ=Europe/Moscow \
  -v "$PWD/data:/data" anker-prime-dashboard
~~~

Replace the IP in both places. Choose Compose **or** docker run; do not run both against the same storage. For this alternative use sudo docker logs anker-prime-dashboard and sudo docker restart anker-prime-dashboard.

## Maintenance and updates

For Compose, run inside the project directory:

~~~bash
sudo docker compose ps
sudo docker compose logs --tail=100 anker
sudo docker compose restart anker
sudo docker compose stop
sudo docker compose start
~~~

restart: unless-stopped restarts after failure and Docker/server startup, except when explicitly stopped by the user. Docker itself must be enabled at boot. Update source and rebuild:

~~~bash
git pull --ff-only
sudo docker compose up -d --build
~~~

Keep .env and data/. If Git reports local modifications, review them before updating; do not discard configuration or data to force an update.

## Backup and restore

Stop the container, copy the **entire** data/ folder, then start it. Example private backup outside the repository:

~~~bash
sudo docker compose stop
sudo sh -c 'umask 077; tar -czf /root/anker-prime-data-backup.tgz data'
sudo docker compose start
~~~

To restore, stop the destination instance, restore the data/ directory with the same structure, assign ownership 1000:1000 and directory permissions 700, then start. Restore the encryption key together with the encrypted account file. Do not publish backups to GitHub.

| Storage | Purpose |
| --- | --- |
| data/vault.key | Private local encryption key. |
| data/account.enc | AES-256-GCM encrypted account/session. |
| data/devices-state.json | Names and persistent resettable energy state. |
| data/history/ | Chart samples and device catalog. |
| .env | IP, port and allowed browser origins. |

Container replacement does not delete the bind-mounted data. Account files have restrictive permissions and are excluded from the image. Passwords/tokens are not intentionally logged. The key is stored alongside the ciphertext: encryption does not protect against full server/backup access. Remote HTTPS/MQTT connections validate certificates.

## Access model

The dashboard has **no separate visitor authentication** after account setup: anyone who can reach the allowed LAN address can view/control the charger. Host/Origin checks are not authentication. Browser access defaults to HTTP.

Keep it on a trusted LAN. Do not directly forward the port to the internet. Remote access requires an HTTPS reverse proxy with authentication and the corresponding PUBLIC_URL. Docker-published ports can bypass UFW rules; consult Docker's networking documentation when restricting access.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Port already allocated | Change WEB_PORT and PUBLIC_URL, then recreate with Compose. |
| Cannot assign requested address | SERVER_IP is not on this host. Check hostname -I. |
| Unknown host / Origin denied | Browser URL differs from PUBLIC_URL: IP, hostname, scheme or nonstandard port. |
| Unable to initialize Anker service | Check data/ permissions/ownership and free space. Do not delete vault.key to fix permissions. |
| Docker permission denied | Use the documented sudo docker commands. |
| Compose missing | Install docker-compose-plugin; use docker compose, not legacy docker-compose. |
| No supported devices | Check region/country/account, A2345 model and online status in the official app. |
| Login rejected | Check credentials/region. After repeated attempts wait at least one minute. |
| Stale readings | Check server internet and charger Wi-Fi; automatic reconnect retries run in the backend. |
| Empty charts | New installations need time to accumulate samples after connecting. |
| Different Homey/Synology counters | Each instance maintains independent counters/history. |

For issues include model, reproduction steps, Docker status and sanitized errors. Do not attach account files, keys, raw cloud payloads or backups.

## Development and verification

server.js serves HTTP/UI; service.js manages accounts/connections/energy; lib/ contains cloud, MQTT, protocol, budget and vault code; history.js collects/queries history; public/ contains UI; test/ contains tests.

For development with Node.js 22+:

~~~bash
npm ci
npm test
~~~

Tests cover protocol fixtures, command acknowledgements, cloud-session refresh, encrypted account persistence, energy gaps, history and HTTP request validation. Deployment/startup/restart have been checked on Ubuntu 24.04 with Docker. Actual device connection requires successful user login. All hardware power-limiting behavior has not yet been checked with an electronic load.

## Limitations and license

Only A2345 is discovered as supported. Cloud API and firmware behavior are undocumented and may change. Internet is required; this is not an offline LAN API. Display features depend on firmware/cloud support. Homey Flow/Insights/widgets are not part of this standalone site. Mains energy measurement and forced fixed voltage are not included.

MIT license: see LICENSE and THIRD_PARTY.md. Anker/product names belong to their respective owners.
