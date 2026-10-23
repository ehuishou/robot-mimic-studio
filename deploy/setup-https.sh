#!/usr/bin/env bash
# Run as root after deploying the release containing the ACME HTTP handler.
set -euo pipefail
cd /opt/robot-studio/current
if [ ! -x /opt/robot-studio-certbot/bin/certbot ]; then
  python3 -m venv /opt/robot-studio-certbot
fi
/opt/robot-studio-certbot/bin/python -m pip install --index-url https://pypi.org/simple certbot==5.4.0 acme==5.4.0
mkdir -p /var/lib/robot-studio-acme/.well-known/acme-challenge
chmod 755 /var/lib/robot-studio-acme /var/lib/robot-studio-acme/.well-known /var/lib/robot-studio-acme/.well-known/acme-challenge
# Account and certificate keys stay on this server, outside release directories.
/opt/robot-studio-certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot -w /var/lib/robot-studio-acme --ip-address 121.199.30.133 --required-profile shortlived --cert-name robot-studio-ip
install -d -m 755 /etc/systemd/system/robot-studio.service.d
install -m 644 deploy/robot-studio-tls.conf /etc/systemd/system/robot-studio.service.d/tls.conf
install -m 644 deploy/robot-studio-certbot.service /etc/systemd/system/robot-studio-certbot.service
install -m 644 deploy/robot-studio-certbot.timer /etc/systemd/system/robot-studio-certbot.timer
systemctl daemon-reload
systemctl restart robot-studio
systemctl enable --now robot-studio-certbot.timer
curl --fail --retry 5 --retry-delay 1 --retry-connrefused -s https://121.199.30.133/pose.html >/dev/null
systemctl is-active robot-studio
systemctl list-timers robot-studio-certbot.timer --no-pager
