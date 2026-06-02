Deploy files and quick guide for Oracle (public + private VMs)

Files in this folder:
- docker-compose.yml           # Public VM (Caddy + n8n)
- docker-compose-db.yml        # Private VM (Postgres)
- Caddyfile                    # reverse proxy & TLS (DuckDNS)

Quick checklist (copy-paste where indicated)

1) Prepare .env on the public VM (~/n8n-stack/.env)
   - Set DOMAIN=n8n-recruiter.duckdns.org
   - Set N8N_HOST and WEBHOOK_URL accordingly
   - Set POSTGRES_HOST to the private VM IP (example: 10.0.0.128)
   - Fill POSTGRES_USER/POSTGRES_PASSWORD and N8N_ENCRYPTION_KEY

2) Private VM (n8n-db) — deploy Postgres
   - Copy docker-compose-db.yml to ~/n8n-db/
   - Create .env or export POSTGRES_* env vars there
   - Run:
     cd ~/n8n-db
     docker compose up -d
   - Verify:
     docker compose ps
     # from public VM: nc -zv <PRIVATE_IP> 5432

3) Public VM (n8n-app) — deploy n8n + Caddy
   - Copy docker-compose.yml and Caddyfile to ~/n8n-stack/
   - Place .env in ~/n8n-stack (see step 1)
   - Run:
     cd ~/n8n-stack
     docker compose up -d
   - Check logs:
     docker compose logs -f n8n
     docker compose logs -f caddy

4) DNS
   - Ensure DuckDNS `n8n-recruiter.duckdns.org` resolves to the public VM IP
   - Test: dig +short n8n-recruiter.duckdns.org

5) SSH access / security
   - Limit SSH (port 22) in Security List/NSG to your current public IP (get it from https://ifconfig.me)
   - If you need to connect to private VM: use ProxyJump:
     ssh -i ~/path/to/key -J ubuntu@<PUBLIC_IP> ubuntu@<PRIVATE_IP>
   - For file copy via jump:
     scp -i key -o ProxyJump=ubuntu@<PUBLIC_IP> localfile ubuntu@<PRIVATE_IP>:/home/ubuntu/

6) Database migration (if needed)
   - Local dump:
     pg_dump -Fc -U <local_user> <local_db> -f n8n.dump
   - Copy via jump and restore on private VM:
     scp -i key -o ProxyJump=ubuntu@<PUBLIC_IP> n8n.dump ubuntu@<PRIVATE_IP>:/home/ubuntu/
     pg_restore -U ${POSTGRES_USER} -d ${POSTGRES_DB} /home/ubuntu/n8n.dump

7) Post-setup checks
   - Visit https://n8n-recruiter.duckdns.org — should show n8n UI
   - In n8n UI: create admin account and verify Webhook URL
   - Test webhook with curl or run scraper

8) Backups
   - Run daily pg_dump on private VM and upload to Object Storage or copy to public VM then push to object storage

Notes and tips
- Keep `POSTGRES_HOST` as private IP — do not expose Postgres to internet.
- Caddy handles TLS automatically via Let's Encrypt; ensure port 80/443 open on public-subnet.
- If Oracle returns "Out of host capacity" when creating instances, try different ADs or smaller shapes; or retry later.

If you want, I can also:
- create these files in a different path or add an example systemd unit to auto-start docker compose on boot,
- or produce a one-line script that mounts the files and starts the stack.

Tell me which extra option you want and I will add it.