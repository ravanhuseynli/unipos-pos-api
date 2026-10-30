# POS sessiya tokeni — POS inteqrasiya təlimatı

> Kimə: POS (Electron) developeri. Server: **UniPOS Node JS Api** — POS üçün ünvan: **`https://pos-api.unipos.tech/api`**.
> QR sifariş socket-i üçün: **`https://qrapi.unipos.tech`** (addım 6). IP ünvanı (`46.224.8.157:35627`) heç yerdə istifadə olunmamalıdır.
> Server tərəfi hazırdır və **köhnə POS-ları sındırmır** (`POS_AUTH_MODE=compat`). Bu sənəddəki dəyişikliklər POS-a edilməlidir.

## 1. Niyə

İndiyə qədər bu API-nin POS endpoint-ləri (`/pos/*`, `/orders/*`, `/products`, `/tables`, `/waiters`) **heç bir yoxlama olmadan** işləyirdi — restoran sadəcə URL / body-dəki `profileId` ilə seçilirdi. `profileId`-ni dəyişən hər kəs başqa restoranın məlumatlarını oxuya, çekini ödəyə / silə bilərdi. `GET /terminal/me/:profileId` isə bütün terminal şifrələrini qaytarırdı.

`LoginController.js`-dəki hardcoded JWT (`let token = "eyJ..."`, müddəti 2027-01-26) heç bir sorğuya əlavə olunmurdu — **ölü koddur, silinməlidir** (bax: addım 8).

Yeni mexanizm: terminal login olanda server **sessiya tokeni** verir, POS onu bütün sorğularda göndərir, server restoranı tokendən götürür.

## 2. Token haqqında qısa

| | |
|---|---|
| Format | `pst_` + 43 simvol (opaque, JWT **deyil** — içini oxumağa çalışmayın) |
| Harada | `POST /api/terminal/login` cavabında `data.session_token` |
| Necə göndərilir | `Authorization: Bearer <session_token>` |
| Ömrü | **Sürüşən 90 gün**: hər istifadədə uzanır. İşləyən kassa heç vaxt çıxmır. Refresh token **yoxdur**. |
| Nə vaxt bitir | 90 gün heç bir sorğu olmayanda · terminal şifrəsi dəyişəndə · terminal silinəndə · `POST /api/terminal/logout` |
| Limit | Terminal başına sessiya limiti yoxdur |

Profil deaktiv olanda (`is_working = 0`) sorğular `403 account_inactive` qaytarır, amma **token silinmir** — abunəlik bərpa olunanda kassa login etmədən davam edir.

## 3. Login — tokeni almaq və saxlamaq

`LoginController.getLogin` artıq `POST /api/terminal/login` çağırır (`http://46.224.8.157:35627/api/terminal/login`). Ünvan `https://pos-api.unipos.tech/api/terminal/login` olur. Dəyişikliklər:

```js
const previousToken = await sessionStore.get(terminalId); // bu terminalın köhnə tokeni (yoxdursa null)

response = await axios.post(
  `${POS_API}/terminal/login`,
  {
    username,
    terminal_id: terminalId,
    terminal_password: password,
    device_name: os.hostname(),            // istəyə bağlı — sessiyanı tanımaq üçün
  },
  {
    timeout: 15000,
    // Köhnə tokeni göndərin: server onu bağlayır (rotasiya), sessiyalar yığılmır.
    // POS hər açılışda authPos ilə yenidən login etdiyi üçün bu VACİBDİR.
    headers: previousToken ? { Authorization: `Bearer ${previousToken}` } : {},
  },
);

const sessionToken = response.data?.data?.session_token;
if (sessionToken) await sessionStore.set(terminalId, sessionToken);
```

- Tokeni **terminal ID-yə bağlı** saxlayın (lokal SQLite / electron-store). Log-a yazmayın, UI-a göstərməyin.
- `session_token` nadir hallarda `null` ola bilər (serverdə yazılmayıb) — onda köhnə tokeni saxlayın / heç nə saxlamayın, POS əvvəlki kimi işləsin.
- `data.token` (köhnə JWT) **deprecated**-dir, istifadə etməyin.

## 4. ⚠️ Master / slave qaydası (ən vacib hissə)

Slave kassanın login-i **master-in backend-i** (`http://<masterIp>:55667/api/login`) vasitəsilə bu API-yə gedir, slave-in öz `terminal_id` + şifrəsi ilə. Yəni **slave-in tokeni də master-in backend-inə gəlir**.

Qaydalar:

1. Master **öz tokenini** yalnız **öz login-i** (`isMaster`) zamanı yeniləyir. Slave-in login-i gələndə master-in saxladığı token **dəyişməməlidir** — bu, kodda artıq olan "slave login master-in lokal profilini əvəz etməsin" qaydasının eynisidir.
2. Slave login-ini ötürəndə `Authorization`-a **slave-in köhnə tokenini** qoyun (varsa), master-in tokenini yox. (Səhvən master-in tokeni getsə server onu bağlamır — fərqli terminaldır — amma rotasiya da işləməz.)
3. Buluda (bu API-yə) gedən bütün sorğular — tags, printers, menyu, max-checks, masalar, ofisiantlar və s. — **həmin sorğunu göndərən backend-in öz terminalının tokeni** ilə gedir. Master-slave rejimində bu, praktik olaraq həmişə master-in tokenidir.
4. Slave-in tokenini slave-in frontendinə ötürmək lazım deyil — master-slave rejimində slave buluda müraciət etmir. Tək kassa (standalone) həmişə master-dir, öz tokenini istifadə edir.

Sadə həll: `sessionStore` açarı `terminalId` olsun; bulud sorğularında `sessionStore.get(<bu backend-in öz terminal ID-si>)` istifadə olunsun.

## 5. Hər sorğuya header əlavə etmək

Bu API-yə gedən bütün sorğular üçün bir axios instance / interceptor:

```js
// backend/utils/posApi.js
const axios = require('axios');
const POS_API = 'https://pos-api.unipos.tech/api';

const posApi = axios.create({ baseURL: POS_API, timeout: 15000 });

posApi.interceptors.request.use(async (config) => {
  const token = await sessionStore.get(await ownTerminalId());
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

posApi.interceptors.response.use(undefined, async (error) => {
  const code = error.response?.data?.code;
  if (['session_revoked', 'session_expired', 'invalid_token', 'token_missing'].includes(code)) {
    await handleSessionLost(code); // bax: addım 7
  }
  throw error;
});

module.exports = { posApi, POS_API };
```

**Tokeni YALNIZ bu API-yə göndərin.** `api.unipos.tech`, `wpbot`, `sapi`, vergi (DataPay), səs (voice) və s. üçün bu interceptor istifadə olunmamalıdır.

Hazırda bu API-yə müraciət edən yerlər (`46.224.8.157:35627/api` axtarışı ilə tapılıb) — hamısı `posApi`-yə (yəni `https://pos-api.unipos.tech/api`-yə) keçməlidir:

| Fayl | Endpoint |
|---|---|
| `data/TagsData.js` | `GET /pos/tags/:profileId` |
| `data/PrintersData.js` | `GET /pos/printers/:profileId` |
| `data/SalesTypesData.js` | `GET /pos/sale-types/:profileId` |
| `data/PaymentMethodsData.js` | `GET /pos/payment-methods/:profileId` |
| `data/ProductsData.js` | `GET /pos/general-categories/:id`, `GET /pos/categories/:id`, `GET /products/:id`, `GET /modifiers/:id` |
| `data/TablesData.js` | `GET /tables/halls/:id`, `GET /tables/:id` |
| `data/WaitersData.js` | `GET /waiters/:id` |
| `services/MaxCheckService.js` | `GET /pos/max-checks/:id`, `POST /pos/max-checks` |
| `router/AppRouter.js` | `/pos/active-orders` |
| `controller/HotelController.js` | `FALLBACK_API` |
| `services/SyncService.js` | `GET /health` (token lazım deyil, zərəri yoxdur) |
| `front/src/redux/Slices/CouriersSlice.js` | baza ünvanı `http://46.224.8.157:35627/api` |

QR sifariş socket-i bu cədvələ daxil deyil — o, `qrapi.unipos.tech`-ə keçir (addım 6).

`profileId`-ni URL-də göndərməyə davam edin — server onu tokenin restoranı ilə müqayisə edir. Uyğun gəlməsə `403 profile_mismatch` (bu, POS-da bug deməkdir).

## 6. QR sifariş socket-i (`/pos` namespace)

**Ünvan:** `QR_SOCKET_DEFAULT_BASE` IP-dən `qrapi` domeninə keçir:

```js
// front/src/utils/qrSocket.js
export const QR_SOCKET_DEFAULT_BASE = "https://qrapi.unipos.tech";
```

`qrapi.unipos.tech` websocket-i ötürür (yoxlanılıb: `transports: ["websocket"]` ilə server cavab verir). Bu, `pos-api.unipos.tech` ilə **eyni server və eyni bazadır** — `pos-api`-dən alınan token socket-də də keçərlidir.

Diqqət: `localStorage.pos_qr_api_base` override-ı köhnə quraşdırmalarda IP ilə yazılıbsa, defolt dəyişsə də IP işlənəcək. Override IP-dirsə (`46.224.8.157`) onu silin / nəzərə almayın.

`front/src/utils/qrSocket.js` hazırda `{ restaurantName, terminalId, terminalPassword }` göndərir. Bu fayl **frontend**-dədir, token isə backend-də saxlanılır — tokeni frontend-ə ötürmək lazımdır (məs. `/login` cavabında `authResult.data.session_token` kimi qalsın, və ya IPC ilə). Slave-in frontendi də QR socket-ə qoşulursa, **öz** tokenini istifadə etməlidir (server sifarişi `is_master`-ə görə master kassaya yönləndirir). Token ilə:

```js
io(`${SOCKET_ORIGIN}/pos`, {
  auth: { token: sessionToken },   // köhnə sahələri göndərməyə ehtiyac yoxdur
  transports: ['websocket'],
});
```

`connect_error` → `err.message` dəyərləri: `invalid_token`, `session_revoked`, `session_expired`, `account_inactive`, `token_required` (strict rejimdə tokensiz), `too_many_attempts`. İlk dördü üçün addım 7-dəki davranış.

Qeyd: socket qoşulduqdan sonra token ləğv olunsa, mövcud bağlantı qopmur — növbəti yenidən qoşulmada rədd olunur.

## 7. Xətaların işlənməsi

| HTTP | `code` | POS nə etməlidir |
|---|---|---|
| 401 | `session_revoked` | Tokeni silin. Yaddaşdakı məlumatlarla **bir dəfə** səssiz login cəhd edin; uğursuzdursa (şifrə dəyişib) login ekranı. |
| 401 | `session_expired` | Eyni — səssiz login, olmasa login ekranı. |
| 401 | `invalid_token` / `token_missing` | Eyni. |
| 403 | `account_inactive` | Mövcud `/blocked` ekranı. **Tokeni silməyin.** |
| 403 | `profile_mismatch` | Bug — log yazın, istifadəçini çıxarmayın. |
| 429 | `too_many_attempts` | Login: `Retry-After` header-i qədər gözləyin (mövcud retry məntiqi bunu edir). |

İnternet yoxdursa (şəbəkə xətası, 5xx) — **heç vaxt** tokeni silməyin və login ekranına atmayın. Offline rejim əvvəlki kimi işləyir.

Səssiz login sonsuz dövrəyə düşməsin: eyni xəta üçün ən çox 1 cəhd, sonra login ekranı.

## 8. Silinməli kod

- `electron/backend/controller/LoginController.js:45-46` — `let token = "eyJhbGciOi..."` (hardcoded JWT, istifadə olunmur). Repo tarixçəsindən də silmək ideal olardı, amma token heç bir endpoint tərəfindən qəbul olunmadığı üçün kritik deyil.

## 9. Domen: `pos-api.unipos.tech` (HTTPS)

POS bu API-yə indiyə qədər `http://46.224.8.157:35627` ilə gedirdi — trafik şifrələnmirdi, eyni şəbəkədə olan biri tokeni və login-dəki terminal şifrəsini görə bilərdi. Login və bütün REST sorğuları üçün yeni ünvan:

```js
const POS_API = 'https://pos-api.unipos.tech/api';
```

QR sifariş socket-i: `https://qrapi.unipos.tech` (addım 6). Beləliklə POS bu API-yə IP ilə heç müraciət etmir.

## 10. Keçid planı

1. ✅ Server `POS_AUTH_MODE=compat` ilə deploy olunur — heç nə sınmır.
2. POS yeniləməsi: addım 3–8. Mövcud quraşdırmalarda token yoxdur — POS onsuz da hər açılışda `authPos` ilə login edir, ilk açılışda tokeni alacaq, istifadəçi heç nə hiss etməyəcək.
3. Server loglarında `⚠️  POS tokensiz sorğular (son 15 dəq): ...` xəbərdarlıqlarına baxılır. Bütün kassalar yenilənəndə bu sətir yox olur.
4. Server `.env`-də `POS_AUTH_MODE=strict` → restart.

## 11. Yoxlama siyahısı (POS developeri)

- [ ] Login cavabından `session_token` götürülür və terminal ID ilə saxlanılır
- [ ] Yenidən login-də köhnə token `Authorization`-da göndərilir (rotasiya)
- [ ] Slave login-i master-in tokenini əvəz etmir
- [ ] Bu API-yə gedən bütün sorğular `posApi` ilə (cədvəl, addım 5)
- [ ] Token başqa serverlərə getmir
- [ ] `qrSocket.js` → `auth: { token }`
- [ ] 401 / 403 davranışı (addım 7), offline-da token silinmir
- [ ] Hardcoded JWT silinib
- [ ] Login və REST sorğuları `https://pos-api.unipos.tech/api`-yə
- [ ] QR socket `https://qrapi.unipos.tech`-ə (`QR_SOCKET_DEFAULT_BASE`), IP override-ı nəzərə alınmır

Test üçün: `GET /api/terminal/session` (token ilə) → `200` və terminal məlumatı; tokensiz → `401 token_missing`.

## 12. Gələcək: `api.unipos.tech`

Çek sinxronu (`/api/sync`) və məhsul yaratma `api.unipos.tech`-dədir — ayrı server, **eyni baza**. O server də `terminal_sessions` cədvəlini oxuyub eyni tokeni qəbul edə bilər (`sha256(token)` → `token_hash`). Bu hələ edilməyib — o vaxta qədər tokeni `api.unipos.tech`-ə göndərməyin.
