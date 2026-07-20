# =============================================================================
# IR Timeline Constructor — Скрипт развёртывания
# Запускать ПОСЛЕ установки Docker и перезагрузки
# =============================================================================

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot

Write-Host "=== IR Timeline: развёртывание ===" -ForegroundColor Cyan
Set-Location $ProjectDir

# ── 1. Проверка Docker ────────────────────────────────────────────────────────
Write-Host "`n[1/5] Проверка Docker..." -ForegroundColor Yellow
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker не отвечает" }
    Write-Host "Docker работает." -ForegroundColor Green
} catch {
    Write-Host "Docker не запущен! Откройте Docker Desktop и дождитесь зелёного значка в трее." -ForegroundColor Red
    exit 1
}

# ── 2. Создаём .env ───────────────────────────────────────────────────────────
Write-Host "`n[2/5] Настройка .env..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"

    function New-RandomString([int]$len) {
        -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $len | ForEach-Object { [char]$_ })
    }

    $secret = New-RandomString 64
    $pgPass  = "Pg_$(New-RandomString 20)"
    $rdPass  = "Rd_$(New-RandomString 20)"
    $mnPass  = "Mn_$(New-RandomString 20)"

    $env_content = Get-Content ".env" -Raw
    $env_content = $env_content `
        -replace "CHANGE_ME_generate_a_random_64_char_hex_string_here_00000000000000", $secret `
        -replace "CHANGE_ME_postgres_strong_password", $pgPass `
        -replace "CHANGE_ME_redis_strong_password",    $rdPass `
        -replace "CHANGE_ME_minio_secret_min_8_chars", $mnPass
    $env_content | Set-Content ".env" -Encoding UTF8 -NoNewline

    Write-Host "Файл .env создан с авто-паролями." -ForegroundColor Green
    Write-Host "Пароли сохранены — не теряйте .env файл!" -ForegroundColor Yellow
} else {
    Write-Host "Файл .env уже существует." -ForegroundColor Green
}

# ── 3. TLS сертификат ─────────────────────────────────────────────────────────
Write-Host "`n[3/5] TLS сертификат..." -ForegroundColor Yellow
if (-not (Test-Path "nginx\ssl\cert.pem")) {
    $ssl_dir = "nginx\ssl"
    New-Item -ItemType Directory -Force -Path $ssl_dir | Out-Null

    # Ищем openssl (Git for Windows его включает)
    $openssl = $null
    foreach ($p in @("openssl", "C:\Program Files\Git\usr\bin\openssl.exe")) {
        if (Get-Command $p -ErrorAction SilentlyContinue) { $openssl = $p; break }
        if (Test-Path $p) { $openssl = $p; break }
    }

    if ($openssl) {
        & $openssl req -x509 -nodes -newkey rsa:2048 `
            -keyout "$ssl_dir\key.pem" -out "$ssl_dir\cert.pem" `
            -days 365 -subj "/CN=localhost/O=IR-Timeline/C=RU" 2>&1 | Out-Null
        Write-Host "Сертификат создан через openssl." -ForegroundColor Green
    } else {
        # PowerShell self-signed (без openssl)
        $cert = New-SelfSignedCertificate -DnsName "localhost" `
            -CertStoreLocation "cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddDays(365)
        $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        $pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($certBytes,"InsertLineBreaks") + "`n-----END CERTIFICATE-----"
        $pem | Set-Content "$ssl_dir\cert.pem" -Encoding ASCII

        # Нет openssl для ключа → переключаем на HTTP (dev конфиг)
        Copy-Item "nginx\nginx.dev.conf" "nginx\nginx.conf" -Force
        Write-Host "openssl не найден. Используется HTTP (nginx.dev.conf)." -ForegroundColor Yellow
    }
} else {
    Write-Host "Сертификат уже есть." -ForegroundColor Green
}

# ── 4. Сборка образов ─────────────────────────────────────────────────────────
Write-Host "`n[4/5] Сборка Docker образов..." -ForegroundColor Yellow
Write-Host "  Загрузка базовых образов (первый раз ~5 мин)..."
docker compose --env-file .env pull --ignore-buildable 2>&1 | Where-Object { $_ -match "Pull" -or $_ -match "pull" -or $_ -match "Pulling" } | Write-Host

Write-Host "  Сборка backend и frontend..."
docker compose --env-file .env build --no-cache
if ($LASTEXITCODE -ne 0) { Write-Host "Ошибка сборки!" -ForegroundColor Red; exit 1 }
Write-Host "Сборка завершена." -ForegroundColor Green

# ── 5. Запуск ─────────────────────────────────────────────────────────────────
Write-Host "`n[5/5] Запуск сервисов..." -ForegroundColor Yellow
docker compose --env-file .env up -d
if ($LASTEXITCODE -ne 0) { Write-Host "Ошибка запуска!" -ForegroundColor Red; exit 1 }

# Ожидание backend
Write-Host "Ожидание готовности backend..."
$maxWait = 120
$waited  = 0
do {
    Start-Sleep -Seconds 5
    $waited += 5
    $health = docker inspect irt-backend --format "{{.State.Health.Status}}" 2>$null
    Write-Host "  [${waited}s] backend: $health"
} while ($health -ne "healthy" -and $waited -lt $maxWait)

Write-Host ""
if ($health -eq "healthy") {
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║   IR Timeline успешно запущен!           ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
} else {
    Write-Host "Сервисы запущены (backend ещё стартует, подождите 1-2 мин)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Веб-интерфейс:  http://localhost" -ForegroundColor Cyan
Write-Host "  API Swagger:    http://localhost/api/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Логин по умолчанию:" -ForegroundColor White
Write-Host "    username: admin" -ForegroundColor White
Write-Host "    password: admin" -ForegroundColor White
Write-Host "  (смените пароль после первого входа!)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Управление:" -ForegroundColor White
Write-Host "    docker compose ps          # статус" -ForegroundColor Gray
Write-Host "    docker compose logs -f     # логи" -ForegroundColor Gray
Write-Host "    docker compose down        # остановить" -ForegroundColor Gray
