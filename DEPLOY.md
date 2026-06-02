# Deploying Scour (Oracle Cloud "Always Free" + Docker)

Scour is a stateful, native-heavy app (local ML embeddings, headless Chromium,
SQLite). It needs a long-running container with a persistent disk, not
serverless. Oracle's Always Free Ampere VM runs it for **$0** and stays on.

After the one-time setup below, **shipping an update is just `git push`** — the
GitHub Action rebuilds on the VM and restarts. Your data (the SQLite volume) is
never touched.

---

## 1. Create the VM

1. Sign up at <https://cloud.oracle.com> (a card is required for identity
   verification; Always Free resources are never charged).
2. **Compute → Instances → Create instance:**
   - **Shape:** change to **Ampere → `VM.Standard.A1.Flex`**, set **2 OCPU /
     12 GB** (well within the Always Free 4 OCPU / 24 GB allowance). Do **not**
     use the `E2.1.Micro` (1 GB) — Chromium + the model will OOM.
   - **Image:** Ubuntu 22.04 (aarch64).
   - **SSH keys:** upload your public key (or let it generate one and download
     the private key).
   - Create. Note the **public IP**.

> If you hit "out of host capacity," try a different Availability Domain or
> region — A1 capacity is regional. Retrying over a day usually works.

## 2. Open ports 80 + 443

Two layers — both are required on Oracle:

**a) VCN security list** (Networking → your VCN → Subnet → Security List → Add
Ingress Rules): source `0.0.0.0/0`, TCP, destination ports `80` and `443`.

**b) OS firewall** (Oracle's Ubuntu image ships restrictive iptables) — SSH in
and run:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in so the group applies
```

## 4. First deploy (manual, one time)

```bash
mkdir -p ~/scour && cd ~/scour
# get the code there once (clone, or scp from your machine):
git clone <your-repo-url> .

cp .env.example .env
nano .env          # add GROQ_API_KEY; set SITE_ADDRESS (see below)

docker compose up -d --build   # first build ~3–6 min on 2 OCPU
docker compose logs -f app     # watch: migrate → seed → "starting Next.js"
```

Visit `http://<public-ip>` (with `SITE_ADDRESS=:80`). Run a search to confirm.

## 5. Auto-deploy on every push

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**, add three:

| Secret     | Value                                              |
|------------|----------------------------------------------------|
| `SSH_HOST` | the VM's public IP                                 |
| `SSH_USER` | `ubuntu`                                            |
| `SSH_KEY`  | the **private** SSH key (full text) for that user  |

Now any push to `main` runs `.github/workflows/deploy.yml`: it rsyncs the
source to `~/scour`, rebuilds, and restarts. `.env` and the DB volume are
excluded from the sync, so secrets and data persist.

## 6. HTTPS (optional but recommended)

Edit `~/scour/.env`, set `SITE_ADDRESS`, then `docker compose up -d`:

- **No domain:** `SITE_ADDRESS=203-0-113-5.sslip.io` (your IP with dashes).
  `sslip.io` resolves to that IP, and Caddy auto-issues a Let's Encrypt cert.
- **Your domain:** point an `A` record at the IP, then
  `SITE_ADDRESS=scour.example.com`.

Caddy handles certs and renewals automatically (stored in the `caddy-data`
volume).

---

## Day-2 operations

```bash
docker compose logs -f app                 # tail logs
docker compose restart app                 # restart
docker compose down                        # stop (data is kept in the volume)

# Back up the database:
docker run --rm -v scour-data:/data -v "$PWD":/backup alpine \
  cp /data/scour.db /backup/scour-backup-$(date +%F).db

# Re-seed sources after editing prisma/seed.ts (idempotent):
docker compose exec app npx tsx prisma/seed.ts
```

**Migrations** run automatically on every container start
(`prisma migrate deploy` in the entrypoint), so new schema changes apply on
deploy with no manual step.

## How the pieces fit

| File                          | Role                                                        |
|-------------------------------|-------------------------------------------------------------|
| `Dockerfile`                  | Builds the app; bakes in the model + Chromium               |
| `docker-entrypoint.sh`        | On boot: migrate → seed → start Next.js                     |
| `docker-compose.yml`          | Runs app + Caddy; `scour-data` volume holds the SQLite DB   |
| `Caddyfile`                   | Reverse proxy + automatic HTTPS                             |
| `.github/workflows/deploy.yml`| `git push` → rebuild on the VM                              |
| `.env`                        | Secrets + `SITE_ADDRESS` (lives on the VM, never committed) |
