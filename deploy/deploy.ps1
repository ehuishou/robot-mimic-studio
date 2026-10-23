param(
  [string]$Server = 'root@121.199.30.133',
  [string]$KeyPath = 'C:\Users\19122\密钥'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed' }
  $commit = git rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Cannot determine release commit' }
  $versionJson = @{ commit = $commit; builtAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
  [System.IO.File]::WriteAllText((Join-Path $projectRoot 'dist\version.json'), $versionJson, [System.Text.UTF8Encoding]::new($false))
  $release = Get-Date -Format 'yyyyMMdd-HHmmss'
  $bundle = Join-Path $projectRoot 'artifacts\robot-studio-release.tar.gz'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bundle) | Out-Null
  tar -czf $bundle dist deploy
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
  scp -i $KeyPath $bundle "${Server}:/tmp/robot-studio-$release.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
  $remoteLines = @(
    'set -eu',
    'release="/opt/robot-studio/releases/RELEASE_ID"',
    'mkdir -p "$release"',
    'tar -xzf /tmp/robot-studio-RELEASE_ID.tar.gz -C "$release"',
    'chmod -R a+rX "$release"',
    'if [ -e /opt/robot-studio/current ]; then readlink -f /opt/robot-studio/current > /opt/robot-studio/previous-release; fi',
    'ln -s "$release" /opt/robot-studio/current-RELEASE_ID',
    'mv -Tf /opt/robot-studio/current-RELEASE_ID /opt/robot-studio/current',
    'install -m 644 "$release/deploy/robot-studio.service" /etc/systemd/system/robot-studio.service',
    'systemctl daemon-reload',
    'systemctl enable --now robot-studio',
    'systemctl restart robot-studio',
    'curl --fail --retry 5 --retry-delay 1 --retry-connrefused -s http://127.0.0.1/ > /dev/null',
    'systemctl is-active robot-studio'
  )
  $remote = ($remoteLines -join "`n").Replace('RELEASE_ID', $release)
  $remoteScript = Join-Path $projectRoot "artifacts\robot-studio-deploy-$release.sh"
  [System.IO.File]::WriteAllText($remoteScript, $remote + "`n", [System.Text.UTF8Encoding]::new($false))
  scp -i $KeyPath $remoteScript "${Server}:/tmp/robot-studio-deploy-$release.sh"
  if ($LASTEXITCODE -ne 0) { throw 'Remote script upload failed' }
  ssh -i $KeyPath $Server "bash /tmp/robot-studio-deploy-$release.sh"
  if ($LASTEXITCODE -ne 0) { throw 'Remote deployment failed; inspect systemctl status robot-studio' }
  Write-Output "Deployed release $release"
} finally { Pop-Location }
