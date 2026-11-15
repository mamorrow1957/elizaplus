#!/bin/bash
# elizaplus deploy: publishes this checkout to the nginx docroot /var/www/elizaplus.
# Never touches /var/www/html (a different site on the same server).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=/var/www/elizaplus
[ -n "${SRC}" ] && [ -f "${SRC}/index.html" ] || { echo "SRC does not look like the eliza checkout: ${SRC}"; exit 1; }
[ "${DEST}" = "/var/www/elizaplus" ] || exit 1

if sudo test -d ${DEST}; then
  backup="${DEST}.backup.$(date +%Y%m%d_%H%M%S)"
  echo "Backing up ${DEST} to ${backup}..."
  sudo cp -a ${DEST} "${backup}"
  echo "Backup complete."

  # Keep only the 3 most recent backups (names sort by date and time); delete the older ones.
  keep=3
  old_backups="$(ls -1d ${DEST}.backup.[0-9]*_[0-9]* 2>/dev/null | sort | head -n "-${keep}" || true)"
  if [ -n "${old_backups}" ]; then
    echo "Removing backups older than the newest ${keep}:"
    while IFS= read -r old; do
      echo "  ${old}"
      sudo rm -rf -- "${old}"
    done <<< "${old_backups}"
  fi
fi

echo "Copying ${SRC} to ${DEST}..."
sudo rsync -av --delete --delete-excluded \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='.claude' \
  --exclude='node_modules' \
  --exclude='tests' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  --exclude='package.json' \
  --exclude='package-lock.json' \
  --exclude='playwright.config.js' \
  --exclude='*.md' \
  --exclude='scripts' \
  --exclude='deploy' \
  --exclude='.gitlab-ci.yml' \
  --exclude='.gitignore' \
  --exclude='.github' \
  --exclude='LICENSE' \
  ${SRC}/ ${DEST}/

# Footer timestamp: when the deployed code last changed (commit time of the checkout's HEAD).
commit_time="$(git -C ${SRC} log -1 --format=%cI)"
echo "Writing last-updated.js (${commit_time})..."
printf 'window.ELIZA_LAST_UPDATED = "%s";\n' "${commit_time}" | sudo tee ${DEST}/last-updated.js >/dev/null

# Cache busting: Cloudflare and browsers cache .js files, so stamp the commit into the script URLs of the
# deployed page (eliza.js?v=abc1234). Only the deployed copy of index.html is rewritten, never the repo's.
version="$(git -C ${SRC} rev-parse --short HEAD)"
echo "Stamping script URLs with v=${version}..."
sudo sed -i \
  -e "s|src=\"last-updated.js\"|src=\"last-updated.js?v=${version}\"|" \
  -e "s|src=\"eliza.js\"|src=\"eliza.js?v=${version}\"|" \
  ${DEST}/index.html
for name in eliza.js last-updated.js; do
  sudo grep -q "src=\"${name}?v=${version}\"" ${DEST}/index.html || { echo "ERROR: ${name} version stamp was not applied"; exit 1; }
done
echo "Done."
