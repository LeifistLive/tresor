<div align="center">

<img src="apps/web/public/favicon.svg" width="72" height="72" alt="Tresor-Logo" />

# Tresor

**Selbst gehosteter, verschlüsselter Tresor für Notizen, Matter-Codes, Zugangsdaten und andere Geheimnisse.**

[English](README.md) · [Dokumentation](docs/) · [Changelog](CHANGELOG.md) · [Sicherheit](.github/SECURITY.md)

</div>

Tresor läuft mit Docker Compose auf deinem Home-Server und arbeitet nach dem **Zero-Knowledge-Prinzip**: Jeder
Eintrag, jede Datei und jeder Tresor-Name wird **schon in deinem Browser** verschlüsselt, bevor er gesendet wird. Der
Server speichert nur Chiffretext und sieht weder dein Passwort noch deine Schlüssel. Auch Administratoren können die
Einträge anderer nicht lesen, und eine gestohlene Datenbank oder ein Backup ist wertlos.

## Funktionen

| | |
|---|---|
| **Sechs Eintragstypen** | Notizen (Markdown), **Matter-Geräte** (Kopplungscode + QR, dekodierte Hersteller-/Produkt-ID), Zugangsdaten (mit Live-**2FA-Codes**), WLAN (mit Verbindungs-QR), Karten & Ausweise, Schlüssel & Codes – plus eigene Felder, Tags und Ablaufdaten |
| **QR-Scanner** | Matter-, WLAN- und 2FA-QR-Codes per Kamera (oder Foto) scannen – die Felder füllen sich selbst |
| **Smart-Home-Ansicht** | Matter-Geräte nach Raum und Netzwerk, druckbare QR-Etiketten und WLAN-Gästekarte |
| **Zero Knowledge** | Verschlüsselt im Browser: Argon2id · AES-256-GCM pro Eintrag und Datei · X25519 fürs Teilen · der Server sieht nie Passwörter, Schlüssel oder Klartext · zusätzlich rotierbarer Server-Master-Key |
| **Anmeldung** | Passwort + optional TOTP, **Passkeys** (Face ID / Touch ID / Sicherheitsschlüssel, Entsperren per PRF), Wiederherstellungsschlüssel, Auto-Sperre |
| **Freigaben** | Gemeinsame Tresore (Besitzer / Bearbeiten / Nur lesen) mit eigenem Schlüssel, der beim Austritt eines Mitglieds erneuert wird; Schlüssel-Fingerabdrücke zum Abgleichen |
| **Notfallzugriff** | Vertrauenspersonen erhalten nach einer Wartezeit Lesezugriff – sofern du nicht widersprichst |
| **Verlauf & Dateien** | Versionsverlauf mit Wiederherstellen, verschlüsselte Anhänge (Bilder, PDFs, beliebige Dateien) |
| **Dashboard** | Aktivität, Verteilung nach Typ, bald ablaufende Einträge, **Passwort-Gesundheit** (schwach / mehrfach / alt), Sicherheits-Score |
| **Admin-Dashboard** | Benutzerverwaltung, Anmelde-Statistik, Systeminfos, Audit-Log |
| **Benachrichtigungen** | ntfy, Gotify oder Webhook: neue Anmeldungen, Fehlversuche, Notfall-Anfragen, Ablauf-Erinnerungen |
| **Export / Import** | JSON, Markdown (ZIP) oder verschlüsseltes `.tresor`-Backup – inkl. Anhänge; nächtliche DB-Dumps, optional off-site per rclone |
| **Oberfläche** | Dunkel/Hell/System, Deutsch & Englisch, Befehlspalette (⌘K), Vorlagen, responsiv bis aufs Smartphone |

Der Design-Entwurf liegt auf einem [Design-Canvas](docs/design.md) (Dashboard, Einträge mit Matter-Detail,
Login mit 2FA, Admin-Dashboard, Mobile).

## Schnellstart

Voraussetzung: Docker mit Compose-Plugin (Linux, Unraid, Synology, Raspberry Pi 4/5 …).

```bash
git clone https://github.com/leifistlive/tresor.git && cd tresor
cp .env.example .env
openssl rand -hex 32                   # zweimal ausführen: je ein Wert für POSTGRES_PASSWORD und VAULT_MASTER_KEY
nano .env                              # die beiden Geheimnisse, TRESOR_HOSTNAME und TRUST_PROXY=true eintragen
docker compose --profile https up -d   # baut das Image, startet Tresor + PostgreSQL + lokales HTTPS
```

`TRESOR_HOSTNAME` ist die IP-Adresse oder der Name, unter dem deine Geräte den Server erreichen, z. B. `192.168.178.20`.

Öffne `https://<TRESOR_HOSTNAME>:8443`, lege das Administrator-Konto an und **sichere den
Wiederherstellungsschlüssel**, der genau einmal angezeigt wird. Sichere außerdem `VAULT_MASTER_KEY` aus der `.env`.
Browser erlauben die Verschlüsselung im Browser nur über **HTTPS** (oder auf `localhost`) – daher das mitgelieferte
`https`-Profil (Caddy mit eigener lokaler Zertifizierungsstelle) oder dein eigener Reverse-Proxy.

HTTPS, Reverse-Proxy, Unraid und Updates: siehe [docs/installation.md](docs/installation.md).

## Wichtig zu wissen

- **Zero Knowledge heißt auch:** Niemand – auch kein Admin – kann dein Passwort zurücksetzen und dabei deine Daten
  retten. Bewahre den Wiederherstellungsschlüssel offline auf.
- **Passwort vergessen?** Mit dem Wiederherstellungsschlüssel setzt du auf der Login-Seite ein neues Passwort –
  alle Einträge bleiben erhalten.
- **Passwort und Wiederherstellungsschlüssel verloren?** Dann kann niemand die Einträge entschlüsseln. Ein Admin
  kann das Konto nur zurücksetzen (Einträge werden dabei gelöscht).
- **Admins** sehen Benutzer, Anzahl der Einträge, Anmeldungen und das Audit-Log – aber nie Inhalte.
- **Backups:** `docker compose --profile backup up -d` legt nächtliche Datenbank-Dumps an, mit `--profile offsite`
  zusätzlich verschlüsselt per rclone außer Haus. Zum Wiederherstellen wird derselbe `VAULT_MASTER_KEY` benötigt –
  bei Verdacht auf Leck lässt er sich mit `node dist/cli.js rotate-master-key` austauschen.
  Details: [docs/backup-restore.md](docs/backup-restore.md).
- **Passkeys** brauchen zusätzlich einen Hostnamen statt einer IP-Adresse (z. B. `tresor.fritz.box`).

## Dokumentation

| Thema | |
|---|---|
| [Installation & Betrieb](docs/installation.md) | Compose, Reverse-Proxy, Unraid, Updates, Fehlersuche |
| [Konfiguration](docs/configuration.md) | Alle Umgebungsvariablen |
| [Sicherheitsmodell](docs/security.md) | Zero-Knowledge-Design, Bedrohungsmodell, Grenzen, Sicherheits-Review |
| [Backup & Wiederherstellung](docs/backup-restore.md) | Dumps, verschlüsselte Exporte, Notfall |
| [Architektur](docs/architecture.md) | Stack, Monorepo, Datenmodell |
| [API](docs/api.md) | REST-Endpunkte |
| [Entwicklung](docs/development.md) | Lokales Setup, Tests, Konventionen, Releases |
| [Design](docs/design.md) | Design-Entwurf, Tokens, Typografie |

Die ausführliche Dokumentation ist auf Englisch.

## Versionierung

Semantic Versioning, Änderungen in [CHANGELOG.md](CHANGELOG.md). Die Schritte für ein Release stehen in
[docs/development.md](docs/development.md#releasing). Ein gepushtes `v*.*.*`-Tag baut ein Multi-Arch-Image
(amd64/arm64) und veröffentlicht es unter `ghcr.io/leifistlive/tresor`.

## Lizenz

[MIT](LICENSE)
