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
- [x] POS üçün domen: `https://pos-api.unipos.tech` (QR socket köhnə ünvanda qalır) — sənədlərə yazıldı
- [ ] Deploy (`POS_AUTH_MODE=compat`, `TRUST_PROXY=1` — pos-api nginx/openresty arxasındadır)
- [ ] POS inteqrasiyası (POS developeri, `docs/POS_SESSION_AUTH.md`)
- [ ] Loglarda "POS tokensiz sorğular" itəndən sonra `POS_AUTH_MODE=strict`
- [ ] (Sonra) `api.unipos.tech` eyni tokeni qəbul etsin

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
