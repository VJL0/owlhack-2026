#!/usr/bin/env bash
# Deploy the committed main branch through the same audited CI path.
set -euo pipefail
gh workflow run deploy.yml --repo VJL0/owlhack-2026 --ref main
echo 'Deployment queued. Follow it with: gh run list --repo VJL0/owlhack-2026 --workflow deploy.yml'
