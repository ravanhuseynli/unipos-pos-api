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

| 11 | POS tərəfini də biz yazırıq (POS developeri yazmayacaq); POS-un öz lokal API-si (55667, LAN) də nişanla qorunur — `compat` indi, `strict` bütün kassalar + mobile.unipos.tech yeniləndikdən sonra | İstifadəçi istəyi (2026-10-31). Lokal API tam açıq idi; printer endpoint-ində LAN-dan komanda icrası |
| 12 | Slave login-in master-in vəziyyətini dəyişməsi (terminal ID, is_master) düzəldilmir | İstifadəçi: "toxunma" (2026-10-31). Yalnız bulud nişanının saxlanılması localhost-a bağlandı |
| 13 | POS-da TLS sertifikat yoxlaması açılır | İstifadəçi qərarı; Node 16 ilə 4 domen yoxlanılıb. Risk: HTTPS-i yoxlayan antivirus. Ayrıca commit — geri qaytarmaq asandır |
| 14 | POS işi ayrıca branch + PR (`feat/pos-session-auth`) | POS reposunda başqa developer aktiv işləyir |

**Əhatə xarici (sonraya):**
- `sapi.unipos.tech` (superadmin): terminal-control socket admin şifrəsi ilə, push bildirişlərinin `X-API-Key`-i POS kodunda sabit yazılıb, `wpbot.unipos.tech` heç bir sirr olmadan.
- Login cavablarında `profile.password` (admin şifrəsi, açıq mətn) qaytarılır — POS `TerminalControlSocket` üçün istifadə edir, ona görə toxunulmayıb.
- `terminal_password` bazada açıq mətndir (superadmin idarə edir).

## R2 — Otel rejimi: QR qonaq portalı (2026-11-03)

**İstək:** `profiles.is_hotel_mode = 1` olan obyektlərdə QR-ın giriş səhifəsi otel dizaynına keçsin
(otel məlumatı, qida və içki, spa, əyləncə, əlaqə, günün təklifi, rəy, sosial şəbəkələr, AZ/EN/RU).
Məzmun web admin paneldən idarə olunur; otel olmayan restoranlara heç nə dəyişməsin.

| # | Qərar | Səbəb |
|---|---|---|
| 1 | Bu API yalnız oxuyur: `GET /api/hotel/:username`; cədvəllərin sahibi admin backend-dir | Yazan bir yer olsun, sxem iki yerdə ayrılmasın |
| 2 | `GET /pos/menu` cavabına yalnız `profile.is_hotel_mode` əlavə olundu | QR `/<u>`-da hansı görünüşü göstərəcəyini bilsin; mövcud sahələr dəyişmir |
| 3 | `is_hotel_mode` sütunu başlanğıcda `ensureColumns` ilə təmin olunur | Menyu sorğusu onu SELECT edir — sütun olmasa bütün menyular düşərdi |
| 4 | Cədvəllər yoxdursa boş məzmun, 500 yox | Admin backend gec deploy olunsa portal yenə açılır |
| 5 | Mətnlər `{az,en,ru}`; məhsullar tərcümə olunmur | İstifadəçi qərarı: «məhsullardan başqa hər şey 3 dildə» |
| 6 | Qida və içki məkanları otelin özünündür (ayrı filial deyil) — sətir + istəyə görə menyu kateqoriyası | İstifadəçi qərarı |
| 7 | «Rəy bildirin» mövcud `/review` səhifəsidir (giriş tələb edir) | İstifadəçi qərarı |
| 8 | Instagram tipli story-lər (`stories[]`), tarix aralığı Bakı vaxtı ilə API-də süzülür | Müştəri istəyi: «bugünün menyusu, bu gün hansı əyləncə» yuxarıda reklam kimi |
| 9 | Hero mətnləri (alt başlıq, şüar) və hero loqosu otelin öz məlumatıdır; sosial sıra maketdəki 5-i | İstifadəçi: «Pirgulu, Hotel & Spa restoran məlumatıdır» |
| 10 | Otel rejimini yalnız superadmin dəyişir — admin backend `PUT /profiles/:id` `is_hotel_mode`-u atır | İstifadəçi qərarı |

Müqavilə: admin repo `docs/hotel/QR_PORTAL_CONTRACT.md`.
