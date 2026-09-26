#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04/26.04 Vultr instance. Run as root:
#   ssh root@<ip> 'bash -s' < infra/scripts/server-bootstrap.sh
# Installs Docker Engine from Docker's apt repository (deb822 format, per
# docs.docker.com/engine/install/ubuntu), creates a non-root `deploy` user that
# can run docker, and prepares /opt/reefatlas.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/opt/reefatlas
DEPLOY_USER=deploy

apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl rsync git unattended-upgrades

# ------------------------------------------------------------------ Docker Engine
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<SRC
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SRC
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# rotate container logs and keep containers up across daemon restarts
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
systemctl enable --now docker
systemctl restart docker

# ------------------------------------------------------------------ deploy user
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [[ -f /root/.ssh/authorized_keys ]]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

# ------------------------------------------------------------------ host firewall
# The Vultr firewall group is the perimeter. If ufw is active, open the web
# ports too (Docker-published ports bypass ufw, so this keeps rules truthful).
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
fi

# ------------------------------------------------------------------ SSH hardening
# Only once a key is installed, so a password-only login is never locked out.
if [[ -s /root/.ssh/authorized_keys ]]; then
  cat >/etc/ssh/sshd_config.d/00-reefatlas.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
  sshd -t
  systemctl reload ssh
fi

docker --version
docker compose version
echo "Bootstrap complete. Deploy user: $DEPLOY_USER, app dir: $APP_DIR"
