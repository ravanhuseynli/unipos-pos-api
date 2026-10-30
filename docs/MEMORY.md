# Layihə yaddaşı

Kodda / git-də görünməyən faktlar və səbəblər. Yeni fakt öyrənəndə bura əlavə edin, səhv çıxanı silin.

## Mühit və serverlər

- Bu API-nin ünvanları (hamısı eyni proses, eyni baza):
  - `https://pos-api.unipos.tech/api` — **POS login və REST sorğuları** (2026-10-30-dan; openresty/nginx arxasında)
  - `http://46.224.8.157:35627` — köhnə birbaşa ünvan; POS-un **QR sifariş socket-i** (`/pos`) burada qalır, şəkil URL-ləri də
  - `https://qrapi.unipos.tech/api` — QR menyu (qr.unipos.tech)
- Nginx arxasında `.env`-də `TRUST_PROXY=1` olmalıdır, yoxsa rate limit bütün sorğuları nginx-in IP-si sayır.
- `api.unipos.tech` — ayrı backend (admin, `/api/sync`, məhsul yaratma, `pos-live` socket), **bu API ilə eyni bazanı** istifadə edir.
- `46.224.8.157:8089` — POS-un istifadə etdiyi daha bir admin API (növbə/sifariş).
- Lokal `.env` `localhost:3306/beta_unipos`-a baxır (MySQL servisi adətən sönülüdür).

## POS (klient) faktları — POS-ReDesing

- POS hər açılışda yaddaşdakı məlumatlarla `authPos` → lokal backend `/login` → bu API `/terminal/login` edir. Yəni hər açılış = yeni login → **rotasiya** lazımdır (köhnə token `Authorization`-da gəlir, eyni terminaldırsa bağlanır).
- Slave kassanın frontendi master-in backend-inə (`http://<masterIp>:55667/api`) qoşulur; slave login-i master-in `LoginController`-i vasitəsilə bu API-yə slave-in öz credentials-ı ilə gedir.
- Master-slave rejimində bulud sorğularını master-in backend-i edir. Tək kassa həmişə master-dir.
- `LoginController.js:45`-dəki hardcoded JWT heç yerdə istifadə olunmur (payload: profile 14, exp 2027-01-26).
- POS-un istifadə etdiyi endpoint-lərin siyahısı: `docs/POS_SESSION_AUTH.md` → addım 5.
- Bu API-nin `/orders/*`, `/pos/terminals`, `/terminal/me` endpoint-lərini heç bir məlum klient çağırmır.

## QR menyu (unipos-qr-next) faktları

- İstifadə etdiyi endpoint-lər: `GET /pos/menu/:username`, `GET /modifiers/:profileId`, `/qr-orders/*`, `/qr-auth/*`. Planşet tətbiqi də `/pos/menu`. Köhnə "Unipos QR menu" `/pos/reviews` istifadə edir.

## POS sessiya mexanizmi — tələlər

- Yoxlama nəticəsi 60 san keşdə qalır → şifrə dəyişikliyi / deaktivasiya ən gec 60 san sonra təsir edir.
- Şifrə dəyişikliyini aşkar etmək: `password_fingerprint = sha256(token_hash:terminal_password)` — gizli açar lazım deyil, açar rotasiyası hamını çıxarmaz.
- `last_used_at` ən çox saatda bir yenilənir (yazma yükü).
- Socket qoşulduqdan sonra token ləğv olunsa bağlantı qopmur, növbəti qoşulmada rədd olunur.
- Login limiti açarı `IP|restoran` — nginx arxasında bir restoranın səhvləri digərlərini bloklamasın. `POST /pos/profile` uğursuzluqda 200 qaytarır → `res.locals.loginFailed = true` ilə sayılır.
- `router.param('profileId', checkProfileParam)` — profileId həm rəqəm (id), həm username ola bilər (`/pos/categories/:profileId` və s.).
- `express-rate-limit` 7.5.1.

## Lokal test (müvəqqəti MariaDB)

```bash
S=<scratchpad>; mariadb-install-db --no-defaults --datadir=$S/db/data
cd $S/db && mariadbd --no-defaults --datadir=$S/db/data --socket=s --port=33999 --bind-address=127.0.0.1 &
# socket yolu 107 simvoldan uzun olmasın — nisbi `--socket=s`
DB_HOST=127.0.0.1 DB_PORT=33999 DB_USER=root DB_PASSWORD= DB_NAME=unipos_test PORT=35991 POS_AUTH_MODE=compat node src/app.js
```
`dotenv` mövcud env dəyişənlərini əvəz etmir — override işləyir. Minimal sxem: profiles, terminal_groups, profile_taxes, tags, waiters, tables, table_groups, orders, orders_items (+ menyu üçün categories, products, reviews, product_modifier*).
`pkill -f "<sətir>"` istifadə etməyin — komandanın özünü də öldürür; `kill $(lsof -t -i:PORT)`.
