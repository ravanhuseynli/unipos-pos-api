# CLAUDE.md — UniPOS Node JS Api

POS kassaları (Electron), QR menyu (`unipos-qr-next`, qr.unipos.tech) və planşet tətbiqi üçün Express + MySQL API.
Production (eyni server): `https://pos-api.unipos.tech/api` (POS), `https://qrapi.unipos.tech` (QR menyu + POS-un QR sifariş socket-i), `46.224.8.157:35627` (köhnə birbaşa IP, işlədilməməlidir). `api.unipos.tech` — **ayrı** server (admin backend, sync), amma **eyni baza**.

## İş qaydası (məcburi)

Hər tapşırıqda bu sənədlər oxunur və yenilənir:

| Fayl | Nə üçün |
|---|---|
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | İstifadəçinin tələbləri və qəbul olunmuş qərarlar |
| [`docs/PLAN.md`](docs/PLAN.md) | Aktiv plan + **addım / commit jurnalı** — hər addım və hər commit (hash ilə) bura yazılır |
| [`docs/MEMORY.md`](docs/MEMORY.md) | Kodda görünməyən faktlar, səbəblər, tələlər |
| [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) | Endpoint-lər — endpoint dəyişəndə yenilənir |

Sənədlər azərbaycanca yazılır (API_DOCUMENTATION ingiliscədir).

## Əmrlər

```bash
npm install
npm run dev     # nodemon src/app.js
npm start
```

Test / lint yoxdur. Yoxlama: müvəqqəti MariaDB qaldırıb (`docs/MEMORY.md` → "Lokal test") serveri env override ilə işə salmaq və `curl` ilə ssenariləri yoxlamaq. **Lokal `.env`-dəki bazaya test yazmayın.**

## Struktur

```
src/app.js                 — giriş nöqtəsi; sxem yoxlaması, socket, rate limit
src/routes/*.routes.js     — route-lar (hansının açıq / qorunan olduğu burada)
src/controllers/           — sorğu məntiqi (SQL birbaşa, ORM yoxdur)
src/middleware/            — auth: pos_auth (POS sessiyası), auth (admin JWT), qr_auth (QR qonaq JWT)
src/services/              — terminalSession, qrOrder, qrOtp, whatsapp
src/config/*Schema.js      — server açılanda çatışmayan cədvəl/sütunlar avtomatik yaradılır (sql/*.sql)
src/socket/index.js        — socket.io: /pos (kassalar), /guest (QR qonaq)
sql/                       — CREATE TABLE IF NOT EXISTS faylları
docs/                      — tələblər, plan, yaddaş, POS inteqrasiya təlimatı
```

## Auth modeli (qısa)

- **POS**: `POST /api/terminal/login` → `data.session_token` (opaque, DB-də hash). `posAuth` middleware. `POS_AUTH_MODE=compat|strict`. Ətraflı: [`docs/POS_SESSION_AUTH.md`](docs/POS_SESSION_AUTH.md).
- **Açıq (QR menyu)**: `/pos/menu/:username`, `/pos/reviews`, `/modifiers/*`, `/qr-orders/*`, `/qr-auth/*`. Bunların cavablarını (o cümlədən `cost_price`) dəyişməyin — QR menyu asılıdır.
- **Admin**: `/auth/*` — JWT (`JWT_SECRET`).
- Sessiya varsa restoran `req.terminal.profileId`-dən gəlir; `orderId`/`itemId` ilə işləyən yerlərdə sahiblik yoxlanır (`ensureOrdersOwned`).

## Kod qaydaları

- Şərhlər azərbaycanca, "niyə"-ni izah edir.
- **Line ending**: köhnə fayllar (controllers, routes, `app.js`, `API_DOCUMENTATION.md`) **CRLF**, yeniləri LF. Redaktədə mövcud line ending-i saxlayın, yoxsa diff bütün faylı dəyişmiş göstərir.
- Cavab formatı endpoint-ə görə fərqlidir (`{status: 'success'}` köhnə POS endpoint-lərində, `{success: true}` yenilərində) — mövcud formatı saxlayın, klientlər ona bağlıdır.
- Yeni cədvəl: `sql/<ad>.sql` + `config/*Schema.js`-də `ensureTable`. Server sxem xətasında çökmür, xəbərdarlıq yazır.
- Klientlər: POS — `../POS-ReDesing/POS-ReDesing/electron`, `../UniPOS-Lite`; QR — `../unipos-qr-next`. Endpoint cavabını dəyişməzdən əvvəl orada istifadəsini yoxlayın.
