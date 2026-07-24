param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$pwaHead = @"
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Seaweed Harvest">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="icon" href="./assets/images/seaweed-harvest-icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" sizes="180x180" href="./assets/images/seaweed-harvest-apple-touch-icon.png">
  <script type="module" src="./assets/js/pwa_bootstrap.js"></script>
"@

$managedPatterns = @(
    '<meta\s+name="mobile-web-app-capable"[^>]*>',
    '<meta\s+name="apple-mobile-web-app-capable"[^>]*>',
    '<meta\s+name="apple-mobile-web-app-status-bar-style"[^>]*>',
    '<meta\s+name="apple-mobile-web-app-title"[^>]*>',
    '<link\s+rel="manifest"[^>]*>',
    '<link\s+rel="icon"[^>]*seaweed-harvest-icon\.svg[^>]*>',
    '<link\s+rel="apple-touch-icon"[^>]*>',
    '<script\s+type="module"\s+src="\.\/assets\/js\/pwa_bootstrap\.js"><\/script>'
)

$pages = Get-ChildItem -LiteralPath $RepoRoot -File -Filter "*.html"
foreach ($page in $pages) {
    $html = Get-Content -LiteralPath $page.FullName -Raw
    foreach ($pattern in $managedPatterns) {
        $html = [regex]::Replace($html, "\s*$pattern", "", "IgnoreCase")
    }
    if ($html -notmatch '</head>') {
        throw "HTML page does not contain a closing head element: $($page.Name)"
    }
    $html = [regex]::Replace($html, '\s*</head>', "`r`n$pwaHead`r`n</head>", "IgnoreCase")
    $html = $html -replace "`r`n?", "`n"
    [System.IO.File]::WriteAllText($page.FullName, $html, [System.Text.UTF8Encoding]::new($false))
}

Write-Output "Applied shared PWA installation metadata to $($pages.Count) HTML pages."
