# Tələblər

## R1 — POS API təhlükəsizliyi: terminal sessiya tokeni (2026-10-30)

**İstək:** POS API təhlükəsiz olsun. Hardcoded, 2027-ə qədər keçərli JWT yerinə terminal login olanda unikal sessiya tokeni verilsin, POS bütün sorğularda onu göndərsin. Terminal logout olmasın, hər dəfə login tələb olunmasın.

**Qəbul olunmuş qərarlar:**

| # | Qərar | Səbəb |
|---|---|---|
| 1 | JWT yox, **opaque token**, bazada yalnız SHA-256 hash | Dərhal ləğv etmək olur (şifrə dəyişəndə, logout-da); JWT-ni geri çağırmaq olmur |
| 2 | **Sürüşən 90 gün**, refresh token yoxdur | Kassa heç vaxt çıxmasın; refresh token DB-li sessiyada təhlükəsizlik vermir, offline/restart-da kassanı çıxara bilər |
| 3 | `.env`: `POS_AUTH_MODE=compat` (defolt) / `strict` | Köhnə POS-lar normal işləsin; hamısı yenilənəndən sonra strict |
| 4 | **Sessiya limiti yoxdur** | İstifadəçi istəyi. Yığılmanın qarşısını rotasiya + gündəlik təmizlik alır |
| 5 | Yalnız bu API dəyişir; POS üçün MD hazırlanır | POS-u başqa developer inteqrasiya edəcək → [`POS_SESSION_AUTH.md`](POS_SESSION_AUTH.md) |
| 6 | QR menyunun endpoint-ləri açıq qalır, cavabları dəyişmir; **`cost_price` qalır** | Bəzi restoranlar maya qiymətinə satır; QR menyu (qr.unipos.tech) asılıdır |
| 7 | Tək kassa həmişə master-dir; slave-lər login-i master-in backend-i vasitəsilə edir | POS kodu yoxlanılıb — MD-də master/slave qaydası |
| 8 | Profil deaktivdirsə 403, amma sessiya silinmir | Abunəlik bərpa olunanda yenidən login lazım olmasın |
| 9 | POS login və REST sorğuları `https://pos-api.unipos.tech/api`-yə; QR sifariş socket-i `https://qrapi.unipos.tech`-ə. POS IP ünvanını (`46.224.8.157:35627`) işlətmir | İstifadəçi API-ni domenə keçirdi (2026-10-30); HTTPS — token və şifrə şəbəkədə açıq getmir. Eyni server olduğu üçün token socket-də də keçərlidir |

| 10 | Admin backend (`api.unipos.tech`, repo `../uniposnewadmin/unipos-admin-yeni`) eyni `pst_` tokenini POS yollarında qəbul edir; `POS_AUTH_MODE=compat\|strict` orada da var | İstifadəçi istəyi (2026-10-31). Admin-də artıq `AUTH_ENFORCE=off\|compat\|strict` var idi, amma POS yolları bütün rejimlərdə tokensiz açıq idi |

**Əhatə xarici (sonraya):**
- Login cavablarında `profile.password` (admin şifrəsi, açıq mətn) qaytarılır — POS `TerminalControlSocket` üçün istifadə edir, ona görə toxunulmayıb.
- `terminal_password` bazada açıq mətndir (superadmin idarə edir).
