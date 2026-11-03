# Plan və iş jurnalı

## Aktiv: R1 — POS sessiya tokeni

Tələb: [`REQUIREMENTS.md` → R1](REQUIREMENTS.md). Branch: `feat/pos-session-auth`.

### Mərhələlər

- [x] Mövcud vəziyyətin analizi (auth yoxdur, terminal şifrəsi sızması, hardcoded JWT ölü kod)
- [x] Server: `terminal_sessions` cədvəli + avtomatik yaradılma
- [x] Server: login-də `session_token`, rotasiya, `/terminal/logout`, `/terminal/session`
- [x] Server: `posAuth` middleware (`compat` / `strict`), profileId yoxlaması, order/item sahiblik yoxlaması
- [x] Server: `/terminal/me`, `/pos/terminals` cavabından şifrələr çıxarıldı
- [x] Server: socket `/pos` — `auth: { token }`
- [x] Server: login brute-force limiti (IP + restoran, 20 uğursuz / 15 dəq)
- [x] Sənədlər: `API_DOCUMENTATION.md`, `docs/POS_SESSION_AUTH.md` (POS developeri üçün)
- [x] POS üçün domen: login/REST → `https://pos-api.unipos.tech`, QR socket → `https://qrapi.unipos.tech` (IP yox) — sənədlərə yazıldı
- [ ] Deploy (`POS_AUTH_MODE=compat`, `TRUST_PROXY=1` — pos-api nginx/openresty arxasındadır)
- [x] POS inteqrasiyası — biz yazdıq: `unipostech/POS-ReDesing` `feat/pos-session-auth` (push olundu, PR gözləyir)
- [ ] PR birləşdirilir → POS release (avto-yeniləmə) → mobile.unipos.tech deploy
- [ ] POS lokal API `strict` (bütün kassalar + mobil yeniləndikdən sonra)
- [ ] Loglarda "POS tokensiz sorğular" itəndən sonra `POS_AUTH_MODE=strict`
- [x] Admin backend (`api.unipos.tech`) eyni tokeni POS yollarında qəbul edir, `POS_AUTH_MODE` — admin `redesign/web-admin-v2`-yə push olundu (`2fa8f72`, `de8b95b`)
- [ ] Admin backend deploy (`POS_AUTH_MODE=compat`)

## Jurnal

Hər addım və commit bura yazılır (ən yenisi aşağıda).

| Tarix | Addım | Commit |
|---|---|---|
| 2026-10-30 | Analiz: POS route-larının hamısı açıq, `profileId` ilə IDOR; `/terminal/me` terminal şifrələrini qaytarır; POS-dakı JWT istifadə olunmur; master/slave axını, QR menyunun endpoint-ləri, sync-in `api.unipos.tech`-də olduğu yoxlanıldı | — |
| 2026-10-30 | Server tərəfi yazıldı (cədvəl, servis, middleware, route-lar, controller yoxlamaları, socket, limit) | `a0e5970` |
| 2026-10-30 | Müvəqqəti MariaDB-də test: compat/strict, profile_mismatch, başqa restoranın çeki/itemi, split, şifrə dəyişikliyi → `password_changed`, 91 gün → `session_expired`, logout, `account_inactive` (sessiya qalır), rotasiya, slave login master tokenini bağlamır, socket token/köhnə giriş hər iki rejimdə, login limiti IP+restoran — hamısı keçdi | — |
| 2026-10-30 | Sənədlər: API_DOCUMENTATION, POS_SESSION_AUTH.md, CLAUDE.md, docs/* | `a0e5970` |
| 2026-10-30 | Jurnala commit hash-i yazıldı | `a09d93c` |
| 2026-10-30 | API `pos-api.unipos.tech`-ə keçirildi (istifadəçi). `/api/health` → 200, openresty; yeni kod hələ deploy olunmayıb (`/terminal/session` → 404). POS üçün login/REST → pos-api, QR socket köhnə ünvanda — POS_SESSION_AUTH.md, API_DOCUMENTATION, MEMORY, CLAUDE.md, REQUIREMENTS yeniləndi | `ccf56ae` |
| 2026-10-30 | QR socket də IP-dən `https://qrapi.unipos.tech`-ə (istifadəçi). Yoxlandı: qrapi və pos-api üzərindən `/guest` websocket və polling serverə çatır. POS_SESSION_AUTH.md (addım 6, 9, yoxlama siyahısı), MEMORY, CLAUDE.md, API_DOCUMENTATION, REQUIREMENTS yeniləndi | `8d900f6` |
| 2026-10-30 | `feat/pos-session-auth` → `main` fast-forward (konflikt yox, `main`-də itən commit yox), `origin/main`-ə push: `7eed8be..43d7cc6` | `43d7cc6` |
| 2026-10-31 | Production deploy-da xəta: `Unknown column 'token_hash'` — `terminal_sessions` adı eyni bazada superadmin-in cədvəlidir (terminal onlayn statusu). Login compat-da işlədi, `session_token: null` qaytardı; superadmin məlumatına toxunulmadı. Cədvəl `pos_auth_sessions` adlandırıldı; lokal test superadmin formatlı cədvəllə: token yaranır, superadmin sətri dəyişmir | `b60d931` |
| 2026-10-31 | Admin backend (`unipos-admin-yeni`, branch `feat/pos-session-token`): `services/posSession.js` (pos_auth_sessions-dan oxuyur), `adminAuth` — `pst_` yalnız POS yollarında + kassa-şifrə yolları (`/tables`, `/table-layouts`, `PATCH /folios/:id`, `GET /profiles`), checkTenant kassanın profili ilə, `/sync` massivlərində profile_id yoxlaması, `POS_AUTH_MODE`; posCredentials və `/pos-live` socket token. Test (harness, real middleware zənciri + test DB): 22 HTTP ssenari + 5 socket + şifrə dəyişikliyi/deaktiv/cədvəl yoxdur — hamısı keçdi | admin `2fa8f72` |
| 2026-10-31 | POS_SESSION_AUTH.md: addım 5 və 12 — token admin backend-ə də gedir, fayl-yol cədvəli; REQUIREMENTS (10), MEMORY | `c99de82` |
| 2026-10-31 | Admin: alış endpointləri (`ad1124c` — `/pos/suppliers`, `/pos/inventory-items`, `/pos/purchases`, `/pos/purchases/:id`) `/pos/` prefiksi ilə tokeni qəbul edir, amma `POST /pos/purchases` `viaCredentials` tələb etdiyi üçün tokenli kassaya 401 verirdi; TableController da kassa formatını/sahiblik yoxlamasını `viaCredentials`-a bağlayır. `resolvePosProfile` nişanlı sessiya üçün `viaCredentials: true`. `docs/POS_PURCHASES_API.md` yeniləndi | admin `de8b95b` |
| 2026-10-31 | Push: Node API `main` `07bbcf0..1e1cdf6`; admin `redesign/web-admin-v2` `ad1124c..de8b95b` (fast-forward). Admin `origin/main` köhnədir və ortaq tarixçəsi yoxdur — ora push edilmədi (istifadəçi qərarı) | — |
| 2026-10-31 | POS-un xarici serverləri araşdırıldı. `8089` = `api.unipos.tech` eyni proses (health uptime); POS-da qlobal `rejectUnauthorized: false` aşkarlandı. POS_SESSION_AUTH.md 9.1 (8089 → api.unipos.tech, ikiqat ordering) və 9.2 (TLS yoxlamasını açmaq) | `b1e79da` |
| 2026-10-31 | UniPOS-Lite istifadə olunmur (istifadəçi) — POS_SESSION_AUTH.md və CLAUDE.md-dən çıxarıldı, MEMORY-yə qeyd | `a1ce1dc` |
| 2026-10-31 | POS araşdırması (3 paralel agent): lokal API (55667) tam açıqdır, `PUT /printers/:id`-də PowerShell injection, POS hər 5 dəq login edir, slave login master-in vəziyyətini dəyişir (istifadəçi: toxunma). Node API: sessiya yalnız `want_session: true` / köhnə token ilə verilir — test: köhnə POS → null, want_session → token, rotasiya işləyir | `498cc22` |
| 2026-10-31 | POS `feat/pos-session-auth`: printer PowerShell injection (`e89db06`), ünvanlar IP → domen + ikiqat ordering (`505a2d7`), TLS yoxlaması (`5f8ea39`), bulud nişanı backend+front+socket-lər (`9542364`), lokal API/socket nişanı compat/strict (`fb30471`), təkrar LAN login-də lokal nişanın yenidən istifadəsi (`e894ba2`), `docs/SESSION_AUTH.md` (`34f892c`). Test: cloud interceptor (mock server), lokal API compat/strict HTTP+socket (LAN IP), tam login zənciri (real LoginController + test Node API), front `vite build`. Push: `origin/feat/pos-session-auth`; `gh` yoxdur — PR linki istifadəçiyə verildi | POS `34f892c` |
| 2026-10-31 | Node API sənədləri: REQUIREMENTS (11–14), MEMORY (POS faktları), POS_SESSION_AUTH.md qeyd | `07703d5` |
| 2026-10-31 | POS canlı test (bu kompüterdə `npm start`, sistem MariaDB `unipos-new` / istifadəçi `unipos`, production serverlər, demo restoran master terminalı — login-i istifadəçi etdi): bulud nişanı lokal bazada saxlandı, 136 məhsul / 28 masa / 4 ofisiant və s. yükləndi, açılan çek `is_synced=1` (api.unipos.tech qəbul etdi), loglarda nişan / TLS xətası yox, bütün bulud bağlantıları 443, köhnə 35627/8089 portlarına bağlantı yox. İlk cəhddə `terminal_locked` (superadmin kilidi — terminal başqa cihazda açıq idi, bizim dəyişiklikdən deyil); nişanın kilid yoxlamasından əvvəl saxlanması düzəldildi | POS `7536f6b` |
| 2026-11-01 | POS diaqnostikası: `UNIPOS_AUTH_DEBUG=1` (`708206f`); POS log siyasəti (`shared/consoleControl.js`) log/info/warn-ı susdurur — nişan logları `console.error`-a keçirildi (`4c933fe`); canlı logda bütün real sorğular (`/sync`, `product-availability`, `max-checks` …) `pst_…(47)` ilə 200; `api.unipos.tech/` 404 — bağlantı yoxlamasıdır (kök səhifə yoxdur, istənilən cavab "online"); yoxlamalara nişan qoşulmur (`b292064`) | POS `b292064` |
| 2026-11-03 | R2 — otel QR portalı: `GET /api/hotel/:username` (bölmələr, sətirlər, Bakı tarixinə görə story-lər, hero/sosial parametrləri), `/pos/menu` → `profile.is_hotel_mode`, `ensureColumns` ilə sütun. Müvəqqəti MariaDB-də test: otel deyil → 404, deaktiv bölmə/sətir/valideyn gizlənir, keçmiş və gələcək story süzülür, cədvəl yoxdursa boş məzmun. Admin `redesign/web-admin-v2` push olundu (`0eeadac`) | `4bf929c` |
| 2026-11-03 | R2 (11–13): portal menyunun özüdür — `/pos/menu`-ya `general_categories` + kateqoriya/məhsul QR sahələri, könüllü sütunlar yalnız mövcud olduqda seçilir (`config/menuColumns.js`); `/hotel` yalnız parametrlər + story-lər. Müvəqqəti MariaDB: sütunlarla / sütunsuz menyu 200, sahələr düzgün; admin `15b75c8` push | `211cb21` |
