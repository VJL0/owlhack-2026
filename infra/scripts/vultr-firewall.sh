#!/usr/bin/env bash
# Create (or reuse) a Vultr firewall group for the web server and attach it.
# Runs locally. Requires vultr-cli and VULTR_API_KEY in the environment.
#
#   VULTR_API_KEY=... ./infra/scripts/vultr-firewall.sh
#   SSH_CIDR=203.0.113.7/32 ./infra/scripts/vultr-firewall.sh   # restrict SSH to your IP
set -euo pipefail

INSTANCE_LABEL="${INSTANCE_LABEL:-reefatlas}"
GROUP_DESC="${GROUP_DESC:-reefatlas-web}"
SSH_CIDR="${SSH_CIDR:-0.0.0.0/0}"

: "${VULTR_API_KEY:?Set VULTR_API_KEY}"
command -v vultr-cli >/dev/null || { echo "vultr-cli not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

instance_id=$(vultr-cli instance list -o json | jq -r --arg l "$INSTANCE_LABEL" '.instances[] | select(.label == $l) | .id' | head -n1)
[[ -n "$instance_id" ]] || { echo "No instance labelled '$INSTANCE_LABEL'" >&2; exit 1; }

group_id=$(vultr-cli firewall group list -o json | jq -r --arg d "$GROUP_DESC" '.firewall_groups[] | select(.description == $d) | .id' | head -n1)
if [[ -z "$group_id" ]]; then
  group_id=$(vultr-cli firewall group create --description "$GROUP_DESC" -o json | jq -r '.firewall_group.id')
  echo "Created firewall group $GROUP_DESC ($group_id)"
else
  echo "Using firewall group $GROUP_DESC ($group_id)"
fi

existing=$(vultr-cli firewall rule list "$group_id" -o json | jq -r '.firewall_rules[]? | "\(.protocol):\(.port):\(.subnet)/\(.subnet_size)"')
add_rule() { # protocol port cidr notes
  local proto=$1 port=$2 cidr=$3 notes=$4 subnet=${3%/*} size=${3#*/}
  if grep -qx "$proto:$port:$cidr" <<<"$existing"; then
    echo "  = $proto $port from $cidr"
    return
  fi
  local args=(--ip-type v4 --protocol "$proto" --subnet "$subnet" --size "$size" --notes "$notes")
  [[ -n "$port" ]] && args+=(--port "$port")
  vultr-cli firewall rule create "$group_id" "${args[@]}" >/dev/null
  echo "  + $proto $port from $cidr"
}

add_rule tcp 22 "$SSH_CIDR" "ssh"
add_rule tcp 80 0.0.0.0/0 "http (ACME + redirect)"
add_rule tcp 443 0.0.0.0/0 "https"
add_rule udp 443 0.0.0.0/0 "http/3"
add_rule icmp "" 0.0.0.0/0 "ping"

vultr-cli instance update-firewall-group "$instance_id" --firewall-group-id "$group_id" >/dev/null
echo "Attached $GROUP_DESC to instance $INSTANCE_LABEL ($instance_id)"
