# NexusOS backend deployment

Production target:

- API: `https://api-nexusos.sparkpair.dev`
- Frontend origin: `https://nexusos.sparkpair.dev`
- Media: Cloudflare R2 through `/api/media/:key`

## Cloudflare DNS

Create this DNS record after the VPS public IP is ready:

```text
Type: A
Name: api-nexusos
Content: <CONTABO_VPS_PUBLIC_IP>
Proxy: DNS only while issuing SSL, then Proxied is OK
```

The frontend record will be managed from Vercel:

```text
Type: CNAME
Name: nexusos
Content: cname.vercel-dns.com
```

## VPS first-time setup

Run these commands on Ubuntu/Debian VPS as a sudo user.

```bash
sudo apt update
sudo apt install -y git nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo useradd --system --create-home --shell /usr/sbin/nologin nexusos || true
sudo mkdir -p /var/www
```

Clone the backend:

```bash
cd /var/www
sudo git clone https://github.com/Spark-Pair/nexusos-backend.git
sudo chown -R nexusos:www-data /var/www/nexusos-backend
cd /var/www/nexusos-backend
```

Create PostgreSQL database and user:

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE nexusos;
CREATE USER nexusos WITH PASSWORD 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE nexusos TO nexusos;
\q
```

Create `/var/www/nexusos-backend/.env`:

```env
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://nexusos.sparkpair.dev
FRONTEND_ORIGINS=https://nexusos.sparkpair.dev
DATABASE_URL=postgresql://nexusos:replace-with-a-strong-password@127.0.0.1:5432/nexusos
JWT_SECRET=replace-with-at-least-32-random-characters
JWT_ISSUER=nexusos-api
GOOGLE_CLIENT_ID=
OTP_DELIVERY_MODE=development
ALLOW_DEVELOPMENT_OTP_IN_PRODUCTION=true
ADMIN_EMAILS=admin@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
R2_ACCOUNT_ID=
R2_BUCKET=nexusos-dev-media
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

For the first private client demo, `OTP_DELIVERY_MODE=development` with `ALLOW_DEVELOPMENT_OTP_IN_PRODUCTION=true` lets the server start without an SMS provider. Before public production, add a real SMS provider, set `OTP_DELIVERY_MODE=sms`, and remove that allowance.

Build and migrate:

```bash
sudo -u nexusos npm ci
sudo -u nexusos npm run build
sudo -u nexusos npm run db:migrate
sudo -u nexusos npm prune --omit=dev
```

## Running with PM2

This VPS already uses PM2 for other apps, so PM2 is the simplest process manager.

```bash
cd /var/www/nexusos-backend
sudo -u nexusos pm2 start ecosystem.config.cjs
sudo -u nexusos pm2 save
sudo -u nexusos pm2 status
```

If PM2 was installed under `root` for the existing apps and you want to keep one PM2 list, use:

```bash
cd /var/www/nexusos-backend
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

The process name will be:

```text
nexusos-api
```

## Alternative: running with systemd

Use systemd only if you do not want NexusOS in PM2.

```bash
sudo cp deploy/nexusos-api.service /etc/systemd/system/nexusos-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now nexusos-api
sudo systemctl status nexusos-api
```

Install Nginx:

```bash
sudo cp deploy/nginx-nexusos-api.conf /etc/nginx/sites-available/nexusos-api
sudo ln -s /etc/nginx/sites-available/nexusos-api /etc/nginx/sites-enabled/nexusos-api
sudo nginx -t
sudo systemctl reload nginx
```

Add SSL with Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api-nexusos.sparkpair.dev
```

Health check:

```bash
curl https://api-nexusos.sparkpair.dev/api/health
```

Expected:

```json
{ "status": "ok" }
```

## Updating after a push

```bash
cd /var/www/nexusos-backend
sudo -u nexusos git pull
sudo -u nexusos npm ci
sudo -u nexusos npm run build
sudo -u nexusos npm run db:migrate
sudo -u nexusos npm prune --omit=dev
pm2 restart nexusos-api
pm2 status
```
