# UniPOS Node JS API Documentation

## Introduction
Welcome to the UniPOS API documentation. This API serves as the backend for the UniPOS system, supporting both the Admin Panel and POS Terminals. It provides endpoints for authentication, order management, point-of-sale functionality, product management, and more.

**Base URL**: `http://<your-server>/api`
**Current Version**: `1.0.0`
**Content Type**: All requests and responses should use `application/json`.

---

## Authentication & Authorization
There are three kinds of credentials:

| Who | Token | How to get it |
|-----|-------|---------------|
| POS terminal | **POS session token** (`pst_…`, opaque, not a JWT) | `POST /terminal/login` → `data.session_token` |
| Admin | JWT | `POST /auth/login` |
| QR menu guest | JWT (`type: "qr_user"`) | `POST /qr-auth/login` (section 8) |

All are sent the same way:
```http
Authorization: Bearer <token>
```

### POS session token
POS endpoints (`/pos/*` except the public ones below, `/orders/*`, `/products/*`, `/tables/*`, `/waiters/*`, `/terminal/me`) are protected by the POS session. The server setting `POS_AUTH_MODE` decides what happens without a token:

| `POS_AUTH_MODE` | No token | Valid token | Invalid / revoked token |
|-----------------|----------|-------------|-------------------------|
| `compat` (default) | Allowed (old POS builds keep working) | Allowed, scoped to the session's restaurant | `401` |
| `strict` | `401 token_missing` | Allowed, scoped to the session's restaurant | `401` |

With a token, the restaurant comes from the session: a `profileId` (URL, body or query) of a different restaurant returns `403 profile_mismatch`, and `orderId` / `itemId` of another restaurant's order returns `Order not found` / `Item not found`.

The session never expires while it is used: it ends after `POS_SESSION_IDLE_DAYS` (default 90) days **without any request**, when the terminal password changes, when the terminal is deleted, or on `POST /terminal/logout`. There is no refresh token. If the profile is deactivated (`is_working = 0`) requests return `403 account_inactive`, but the session is kept and works again once the profile is reactivated.

**Public endpoints (no token, used by the QR menu):** `GET /pos/menu/:username`, `GET /pos/reviews/:id`, `POST /pos/reviews`, `/modifiers/*`, `/qr-orders/*`, `/qr-auth/*`, `POST /terminal/login`, `POST /pos/profile`, `GET /health`.

**Session error responses** (`success: false`, `status: "error"`):

| HTTP | `code` | Meaning — what the POS should do |
|------|--------|----------------------------------|
| 401 | `token_missing` | No token (strict mode) — log in |
| 401 | `invalid_token` | Unknown token — log in |
| 401 | `session_revoked` | Password changed / terminal removed / logged out — log in |
| 401 | `session_expired` | Unused for `POS_SESSION_IDLE_DAYS` days — log in |
| 403 | `account_inactive` | Profile deactivated — show blocked screen, keep the token |
| 403 | `profile_mismatch` | Request names another restaurant — client bug |

Full POS integration guide: [`docs/POS_SESSION_AUTH.md`](docs/POS_SESSION_AUTH.md).

---

## Rate Limiting
To ensure service stability, rate limiting is applied to all `/api` routes:
- **Window**: 15 minutes
- **Max limit**: 3000 requests per IP address

Terminal logins (`POST /terminal/login`, `POST /pos/profile`) have an extra limit: **20 failed attempts per 15 minutes per IP + restaurant**. Successful logins are not counted. When exceeded: `429` with `code: "too_many_attempts"` and a `Retry-After` header.

If the limit is exceeded, the server returns a `429 Too Many Requests` status with the message: 
`"Çox çox sorğu göndərdiniz. Zəhmət olmasa bir az gözləyin."`

---

## 1. Authentication Endpoints

### 1.1 Admin Login
Authenticate an admin user and receive a JWT token.

- **URL**: `/auth/login`
- **Method**: `POST`
- **Auth Required**: No

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Administrator username. |
| `password` | string | Yes | Administrator password. |

**Example Request**:
```json
{
  "username": "admin",
  "password": "password123"
}
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Uğurla daxil oldunuz!",
  "data": {
    "token": "eyJhbG...",
    "user": {
      "id": 1,
      "username": "admin",
      "restaurant_name": "My Restaurant",
      "logo": "logo.png",
      "is_pos": 1,
      "is_menu": 1
    }
  }
}
```

**Error Responses**:
- `400 Bad Request`: "İstifadəçi adı və şifrə tələb olunur." (Missing fields)
- `401 Unauthorized`: "İstifadəçi adı və ya şifrə yanlışdır." (Invalid credentials)
- `403 Forbidden`: "Hesabınız aktiv deyil. Zəhmət olmasa dəstək xidməti ilə əlaqə saxlayın." (Account inactive)

### 1.2 Get Current Admin Profile
Retrieve information about the currently authenticated admin.

- **URL**: `/auth/me`
- **Method**: `GET`
- **Auth Required**: Yes (Bearer Token)

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "admin",
    "restaurant_name": "My Restaurant",
    "logo": "logo.png",
    "boss_name": "John Doe",
    "boss_phone_number": "+1234567890",
    "region": "Baku",
    "email": "admin@example.com",
    "phone": "+1234567890",
    "address": "Baku, Azerbaijan",
    "is_working": 1,
    "is_pos": 1,
    "is_menu": 1,
    "is_tax": 1,
    "service_fee": 10,
    "tax_percent": 18
  }
}
```
**Error Responses**:
- `404 Not Found`: "İstifadəçi tapılmadı." (User not found)

---

## 2. Terminal Endpoints

### 2.1 Terminal Login
Authenticate a POS terminal and receive a POS session token (`data.session_token`).

- **URL**: `/terminal/login`
- **Method**: `POST`
- **Auth Required**: No

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Associated profile/admin username. |
| `terminal_id` | string | Yes | The ID of the terminal to login. |
| `terminal_password` | string | Yes | The password for the specific terminal. |
| `device_name` | string | No | Free text shown in the session list (e.g. `"Kassa-1 / DESKTOP-AB12"`). |

**Example Request**:
```json
{
  "username": "admin",
  "terminal_id": "TERM_01",
  "terminal_password": "tpass"
}
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Terminal uğurla daxil oldu!",
  "data": {
    "token": "eyJhbG...",
    "session_token": "pst_4mN0q...",
    "session_idle_days": 90,
    "profile": {
      "id": 1,
      "username": "admin",
      "restaurant_name": "My Restaurant",
      "logo": "logo.png",
      "is_pos": 1,
      "is_menu": 1
    },
    "terminal": {
      "id": 5,
      "terminal_id": "TERM_01",
      "is_master": 1,
      "terminal_type": null
    }
  }
}
```
- `session_token` — send it as `Authorization: Bearer <session_token>` on every POS request and in the `/pos` socket handshake (`auth: { token }`). Every login creates a new session; there is no limit per terminal. It is `null` only if the session could not be stored (compat mode keeps the login working).
- `token` — legacy JWT, **deprecated**. No endpoint checks it; it stays only for compatibility.

**Error Responses**:
- `400 Bad Request`: "İstifadəçi adı, terminal ID və terminal şifrəsi tələb olunur."
- `401 Unauthorized`: "İstifadəçi tapılmadı." OR "Terminal ID və ya şifrə yanlışdır."
- `403 Forbidden`: "Hesab aktiv deyil. Dəstək xidməti ilə əlaqə saxlayın."
- `429 Too Many Requests`: `code: "too_many_attempts"` (see Rate Limiting)

### 2.2 Get Terminal Info
Retrieve information about all terminals under a specific profile.

- **URL**: `/terminal/me/:profileId`
- **Method**: `GET`
- **Auth Required**: POS session (`POS_AUTH_MODE`)

Terminal passwords (`terminal_password`) and the profile `password` are **not** returned.

**URL Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profileId` | integer | Yes | ID of the parent profile (restaurant/admin). |

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": 1,
      "username": "admin",
      "restaurant_name": "My Restaurant"
      // Profile details...
    },
    "terminals": [
      {
        "id": 5,
        "profile_id": 1,
        "terminal_id": "TERM_01",
        "is_master": 1
      }
    ]
  }
}
```
**Error Responses**:
- `400 Bad Request`: "Profile ID tələb olunur."
- `404 Not Found`: "Profil tapılmadı."

### 2.3 Check Session
Checks that the session token is valid and returns its terminal. Useful on POS start-up.

- **URL**: `/terminal/session`
- **Method**: `GET`
- **Auth Required**: POS session (always, regardless of `POS_AUTH_MODE`)

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "profile_id": 14,
    "username": "unipos",
    "terminal_id": 60152735,
    "terminal_group_id": 211,
    "is_master": 1
  }
}
```
**Error Responses**: session errors (see *Authentication & Authorization*).

### 2.4 Terminal Logout
Revokes the current session. Other sessions (other devices) are not affected.

- **URL**: `/terminal/logout`
- **Method**: `POST`
- **Auth Required**: POS session (always)

**Success Response (200 OK)**: `{ "success": true, "message": "Sessiya bağlandı." }`

---

## 3. Product Endpoints

### 3.1 Get All Products
Retrieve all products for a profile, ordered by sorting config.

- **URL**: `/products/:profileId`
- **Method**: `GET`
- **Auth Required**: POS session (`POS_AUTH_MODE`)

**URL Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profileId` | integer/string | Yes | Parent profile ID or Username. |

**Success Response (200 OK)**:
```json
{
  "success": true,
  "count": 50,
  "data": [
    {
      "id": 1,
      "profile_id": 1,
      "category_id": 2,
      "name": "Margarita Pizza",
      "price": 12.00,
      "img": "pizza.png",
      "is_hidden_pos": 0
    }
  ]
}
```

### 3.2 Get Product by ID
Retrieve a specific product by its ID under a specific profile.

- **URL**: `/products/:profileId/:id`
- **Method**: `GET`
- **Auth Required**: POS session (`POS_AUTH_MODE`)

**URL Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profileId` | integer/string | Yes | Profile ID or Username. |
| `id`       | integer | Yes | Product ID to fetch. |

**Success Response (200 OK)**: Returns a single product object.
- `404 Not Found`: "Məhsul tapılmadı."

### 3.3 Get Products by Category
Retrieve all products belonging to a specific category.

- **URL**: `/products/:profileId/category/:categoryId`
- **Method**: `GET`

---

## 4. Tables and Halls Endpoints

### 4.1 Get Halls (Table Groups)
Retrieve all logical halls configured for a profile.

- **URL**: `/tables/halls/:profileId`
- **Method**: `GET`

### 4.2 Get Halls With Tables
Retrieve all halls nested with their respective tables grouping.

- **URL**: `/tables/halls/:profileId/with-tables`
- **Method**: `GET`

### 4.3 Get Tables by Profile
- **URL**: `/tables/:profileId`
- **Method**: `GET`

### 4.4 Get Tables by Hall
- **URL**: `/tables/hall/:hallId`
- **Method**: `GET`

---

## 5. Waiter Endpoints

### 5.1 Get Waiters by Profile
Retrieve a list of waiters registered under a specific profile.

- **URL**: `/waiters/:profileId`
- **Method**: `GET`

### 5.2 Get Waiter by ID
Retrieve specific waiter details.

- **URL**: `/waiters/single/:id`
- **Method**: `GET`

---

## 6. Point of Sale (POS) Endpoints

These endpoints provide necessary reference data and functionality for POS terminals. They require the POS session (`POS_AUTH_MODE`), except the public `GET /pos/menu/:username`, `/pos/reviews` and `POST /pos/profile`.

### 6.1 Get Printers
Retrieve all printers or cash printers for a profile.
- **All Printers URL**: `/pos/printers/:profileId` (GET)
- **Cash Printers URL**: `/pos/cash-printers/:profileId` (GET)

### 6.2 Get Hierarchy & Menu
- **Categories**: `/pos/categories/:profileId` (GET) - *profileId can be ID or Username*
- **General Categories**: `/pos/general-categories/:profileId` (GET) - *profileId can be ID or Username*
- **Menu Structure**: `/pos/menu/:profileId` (GET) - Returns a fully nested menu.

#### QR menu appearance

The `profile` object carries two optional fields that control how the QR menu
renders. Both are nullable; the QR app silently falls back to its defaults
(`komur` / `yumsaq`) when a value is missing or unrecognised, so a typo can never
take a menu down — and adding a new theme later needs no change to this API.

```json
"profile": {
  "theme": "terrakota",
  "menu_style": "siyahi"
}
```

| Field | Values |
|---|---|
| `theme` | `komur` `terrakota` `mese` `gece` `deniz` `sarab` `safran` `nar` `zeytun` `kakao` `fistiq` `badimcan` `mermer` |
| `menu_style` | `yumsaq` `keskin` `siyahi` `klassik` |

Requires `sql/add_theme_columns.sql`. **Run that migration before deploying** —
the query selects these columns, so without them every menu request fails.

Only the QR menu reads these fields; POS and mobile clients ignore them.

#### QR landing page

`profile.is_qr_landing` — set by the superadmin. `1` (default): the QR menu opens
the restaurant's landing page at `/<restaurant>`; `0`: it goes straight to the menu.
The column is created on server start if missing (`src/config/qrSchema.js`).

```json
"profile": {
  "is_qr_landing": 1
}
```

### 6.3 POS Configuration Lists (GET)
Retrieve POS configuration lists by Profile ID. All use **GET** method.
- **Payment Methods**: `/pos/payment-methods/:profileId`
- **Sale Types**: `/pos/sale-types/:profileId`
- **Tags**: `/pos/tags/:profileId`
- **Reasons by Type**: `/pos/reasons/:profileId/:type`
- **Delete Check Reasons**: `/pos/delete-check-reasons/:profileId`
- **Return Check Reasons**: `/pos/return-check-reasons/:profileId`

### 6.4 POS Actions (POST)

#### Waiter PIN Auth
Verify a waiter's PIN code.
- **URL**: `/pos/waiters-auth`
- **Method**: `POST`
- **Request Body**: `{ "pin": "1234", "profileId": 1 }`

#### Get Terminal Profile Info
Retrieve a specific terminal's profile.
- **URL**: `/pos/profile`
- **Method**: `POST`
- **Request Body**: `{ "restaurantName": "admin", "terminalId": "T1", "terminalPassword": "pass" }`

#### Get Terminals List
- **URL**: `/pos/terminals`
- **Method**: `POST`
- **Request Body**: `{ "profileId": 1 }`
- `terminal_password` is not returned.

#### Get Active Orders
Retrieve all currently open/active orders for a profile.
- **URL**: `/pos/active-orders`
- **Method**: `POST`
- **Request Body**: `{ "profileId": 1 }`

### 6.5 Reviews
- **Create**: `POST /pos/reviews` - Body: `{ "business": "admin_user", "rating": 5, "comment": "Great!" }`
- **List**: `GET /pos/reviews/:id` (id is profile id)

---

## 7. Order Endpoints

These endpoints handle all operations related to orders/checks, such as creation, item modifications, payments, and splits. All endpoints under `/api/orders` use the **POST** method and require a `profileId` parameter in the request body (or are explicitly tied to an `orderId`). They require the POS session (`POS_AUTH_MODE`); with a session `profileId` may be omitted — it is taken from the session.

### 7.1 Create Order
Create a new order and optionally add initial items.
- **URL**: `/orders`
- **Method**: `POST`

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profileId` | integer | Yes | Parent profile ID. |
| `tableId` | integer | No | ID of the table. |
| `hallId` | integer | No | ID of the hall. |
| `waiterId` | integer | No | ID of the waiter opening the order. |
| `terminalId` | string | No | Terminal creating the order. |
| `saleType` | integer | No | Type of sale (e.g. dine-in/takeaway). |
| `note` | string | No | Order note. |
| `items` | array | No | Initial order items array. `[{"productId": 1, "productName": "Burger", "price": 10.0, "count": 2, "discount": 0}]` |

**Success Response (200 OK)**:
Returns `orderId`, `uuid`, and `localId`.

### 7.2 Get Order Info
Retrieve details of a specific order along with its items.
- **URL**: `/orders/info`
- **Method**: `POST`

**Request Body**:
*At least one of `orderId` or `uuid` is required.*
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profileId` | integer | Yes | Profile ID. |
| `orderId` | integer | No | Internal Order ID. |
| `uuid` | string | No | Globally unique identifier. |

### 7.3 Get Active Orders
List all active/open orders.
- **URL**: `/orders/active`
- **Method**: `POST`
- **Request Body**: `{ "profileId": 1 }`

### 7.4 Get All Orders (Filtered)
List all orders, allowing filtering by status, date and waiter.
- **URL**: `/orders/all`
- **Method**: `POST`

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profileId` | integer | Yes | Profile ID. |
| `status` | integer | No | Filter by status (e.g., 1 for active, 2 for paid). |
| `startDate` | string | No | Start date filter (YYYY-MM-DD HH:MM:SS) |
| `endDate` | string | No | End date filter. |
| `waiterId` | integer | No | Filter by waiter. |
| `limit` | integer | No | Max number of records (default 100). |

### 7.5 Update Order
Add new items, or update `note`, `discount`, or `serviceFee` of an existing order.
- **URL**: `/orders/update`
- **Method**: `POST`

**Request Body**:
Requires `orderId`. Optional parameters: `items` (array), `note`, `discount`, `serviceFee`.

### 7.6 Order Operations
| Operation | URL | Request Body | Description |
|-----------|-----|--------------|-------------|
| Delete Order | `/orders/delete` | `{ "orderId": 1, "reason": "Text", "waiterId": 5 }` | Cancels an order. |
| Pay Order | `/orders/pay` | `/orders/pay` | `{ "orderId": 1, "paymentMethodId": 1, "paidAmount": 100, "cashReceived": 100, "change": 0, "waiterId": 5 }` | Closes and pays an order. |
| Update Table | `/orders/update-table` | `{ "orderId": 1, "tableId": 10, "hallId": 2 }` | Moves order to another table. |
| Update Waiter| `/orders/update-waiter` | `{ "orderId": 1, "waiterId": 4 }` | Changes the assigned waiter. |
| Update Sale Type | `/orders/update-sale-type`| `{ "orderId": 1, "saleType": 2 }` | Changes sale type. |
| Reverse Order | `/orders/reverse` | `{ "orderId": 1 }` | Reopens a closed order. |
| Update Customer | `/orders/update-customer`| `{ "orderId": 1, "customerName": "John", "customerPhone": "123" }` | Attaches customer details. |
| Delete Item | `/orders/delete-item` | `{ "itemId": 15, "reason": "Cold", "waiterId": 5 }` | Removes an item from the check. |

### 7.7 Advanced Order Transactions
- **Split Order**: `/orders/split`
  - Moves specific items to a new order at a specified table.
  - Body: `{ "orderId": 1, "itemIds": [12, 13], "newTableId": 10, "newHallId": 2, "profileId": 1, "waiterId": 5 }`
- **Merge Orders**: `/orders/merge`
  - Merges items from one order into another, closing the source order.
  - Body: `{ "sourceOrderId": 1, "targetOrderId": 2 }`
- **Search Orders**: `/orders/search`
  - Body: `{ "profileId": 1, "query": "123", "searchBy": "id" }` (searchBy can be `id`, `uuid`, or `local_id`).

---

## 8. QR Menu Authentication Endpoints

These endpoints are used by the **QR Menu mobile app** for customer registration and login. Users are stored in the `qr_users` table. Phone numbers are sent in international E.164 format with the country code (`+994501234567`, `+905321234567`); the QR menu has a country picker. `+994` numbers must have exactly 9 digits after the code.

Phone ownership is verified with a **6-digit code sent via WhatsApp** (see 8.0). Registration and password reset both require it.

> **Token Type**: QR Menu tokens contain `"type": "qr_user"` in the payload and are separate from Admin tokens.

> **Sessions end on password change**: tokens carry `tv` (= `qr_users.token_version`). A password change (`PUT /qr-auth/update`) or reset (8.6) increments the version, so every older token — other devices included — is rejected with `401` and `code: "session_revoked"`. The device that changed the password gets a fresh `token` in the response. Tokens issued before this feature have no `tv` and count as version 0, so they stay valid until the first password change.

### 8.0 Send Verification Code (WhatsApp OTP)
Sends a 6-digit code to the phone number via the WhatsApp bot (`WHATSAPP_BOT_URL`, `POST /send-otp`).

- **URL**: `/qr-auth/otp/send`
- **Method**: `POST`
- **Auth Required**: No

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nomre` | string | Yes | Phone number in E.164 format. |
| `purpose` | string | No | `register` (default; number must NOT be registered) or `reset` (number must be registered). |

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Təsdiq kodu WhatsApp-a göndərildi.",
  "data": { "request_id": "980aff453c66f48ba8c636625464fb16", "expires_in": 300, "resend_in": 60, "code_length": 6 }
}
```

**Security rules**:
- The code is generated with `crypto.randomInt`; only its HMAC-SHA256 is stored (`QR_OTP_SECRET`). The HMAC includes `request_id`, phone and purpose, so a code is valid only for that request.
- Valid for 5 minutes, single use. A new code invalidates the previous one.
- Max 5 wrong attempts per code, then the code is blocked.
- Send limits: 1 per 60 s and 5 per hour per number; 20 per hour per IP (only when `TRUST_PROXY` is set behind a proxy); `QR_OTP_GLOBAL_HOURLY_LIMIT` (default 300) overall.

**Error Responses** (`code` field is machine-readable):
| Status | `code` | Cause |
|--------|--------|-------|
| `400` | — | Invalid phone format / unknown purpose |
| `409` | `phone_taken` | `register`: number already has an account |
| `404` | `phone_not_found` | `reset`: no account with this number |
| `422` | `not_on_whatsapp` | Number is not registered on WhatsApp |
| `429` | `otp_too_soon` / `otp_limit` | Rate limit; `retry_after` (seconds) is included |
| `503` | `otp_unavailable` | WhatsApp bot is down / not configured |

---

### 8.1 QR Menu Register (Qeydiyyat)
Register a new QR menu customer account. Requires a code from 8.0 (`purpose: "register"`). The code check and account creation happen in one transaction.

- **URL**: `/qr-auth/register`
- **Method**: `POST`
- **Auth Required**: No

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ad` | string | Yes | Customer's first name (min. 2 characters). |
| `soyad` | string | Yes | Customer's last name (min. 2 characters). |
| `nomre` | string | Yes | Phone number in E.164 format (e.g. `+994501234567`). |
| `sifre` | string | Yes | Password (min. 6 characters). Stored as bcrypt hash. |
| `request_id` | string | Yes* | From 8.0 response. |
| `kod` | string | Yes* | 6-digit code received on WhatsApp. |

\* Not required only when `QR_OTP_REQUIRED=0` (transition / bot testing).

**Example Request**:
```json
{
  "ad": "Ravan",
  "soyad": "Hüseynli",
  "nomre": "+994501234567",
  "sifre": "123456",
  "request_id": "980aff453c66f48ba8c636625464fb16",
  "kod": "553896"
}
```

**Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Qeydiyyat uğurla tamamlandı!",
  "data": {
    "token": "eyJhbG...",
    "user": {
      "id": 1,
      "ad": "Ravan",
      "soyad": "Hüseynli",
      "nomre": "+994501234567",
      "phone_verified": true
    }
  }
}
```

**Error Responses**:
| Status | Message | Cause |
|--------|---------|-------|
| `400` | "Ad, soyad, nömrə və şifrə tələb olunur." | Missing fields |
| `400` | "Ad ən azı 2 simvol olmalıdır." | First name too short |
| `400` | "Soyad ən azı 2 simvol olmalıdır." | Last name too short |
| `400` | "Telefon nömrəsi düzgün formatda deyil." | Invalid phone format |
| `400` | "Şifrə ən azı 6 simvol olmalıdır." | Password too short |
| `400` | `code: otp_required` | `request_id` / `kod` missing |
| `400` | `code: otp_wrong` | Wrong code; `attempts_left` included |
| `400` | `code: otp_blocked` / `otp_expired` / `otp_replaced` / `otp_invalid` | Code can no longer be used — request a new one |
| `409` | "Bu nömrə ilə artıq hesab mövcuddur." | Phone number already registered |

---

### 8.2 QR Menu Login (Daxil ol)
Authenticate a QR menu customer using phone number and password.

- **URL**: `/qr-auth/login`
- **Method**: `POST`
- **Auth Required**: No

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nomre` | string | Yes | Phone number in `+994XXXXXXXXX` format. |
| `sifre` | string | Yes | Account password. |

**Example Request**:
```json
{
  "nomre": "+994501234567",
  "sifre": "123456"
}
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Uğurla daxil oldunuz!",
  "data": {
    "token": "eyJhbG...",
    "user": {
      "id": 1,
      "ad": "Ravan",
      "soyad": "Hüseynli",
      "nomre": "+994501234567"
    }
  }
}
```

**Error Responses**:
| Status | Message | Cause |
|--------|---------|-------|
| `400` | "Nömrə və şifrə tələb olunur." | Missing fields |
| `400` | "Telefon nömrəsi düzgün formatda deyil. (+994XXXXXXXXX)" | Invalid phone format |
| `401` | "Nömrə və ya şifrə yanlışdır." | Wrong phone or password |

---

### 8.3 Get QR Menu User Profile
Retrieve the currently authenticated QR menu user's profile.

- **URL**: `/qr-auth/me`
- **Method**: `GET`
- **Auth Required**: Yes (Bearer Token — QR user token)

**Headers**:
```http
Authorization: Bearer <qr_user_jwt_token>
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "ad": "Ravan",
    "soyad": "Hüseynli",
    "nomre": "+994501234567",
    "created_at": "2026-04-12T12:00:00.000Z"
  }
}
```

**Error Responses**:
| Status | Message | Cause |
|--------|---------|-------|
| `401` | "Giriş üçün token tələb olunur." | No token provided |
| `401` | "Token müddəti bitib. Yenidən daxil olun." | Expired token |
| `401` | "Token etibarsızdır." | Invalid/malformed token |
| `403` | "Bu endpointe giriş icazəniz yoxdur." | Token is not a QR user token |
| `404` | "İstifadəçi tapılmadı." | User deleted from DB |

---

### 8.4 QR Menu Send Review (Rəy göndər)
Allows an authenticated QR menu user to submit a review for a restaurant. The user's name is automatically prepended to the comment.

- **URL**: `/qr-auth/review`
- **Method**: `POST`
- **Auth Required**: Yes (Bearer Token — QR user token)

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `business` | string | Yes | The restaurant username/business name. |
| `rating` | integer | Yes | Star rating (1-5). |
| `comment` | string | No | Optional review text. |
| `profile_id` | integer | No | ID of the restaurant profile. |

**Example Request**:
```json
{
  "business": "admin",
  "rating": 5,
  "comment": "Yeməklər çox dadlı idi!",
  "profile_id": 14
}
```

**Success Response (201 Created)**:
```json
{
  "success": true,
  "message": "Rəyiniz uğurla göndərildi. Təşəkkür edirik!"
}
```

**Error Responses**:
| Status | Message | Cause |
|--------|---------|-------|
| `400` | "Zəhmət olmasa qiymətləndirməni seçin və biznes adını qeyd edin." | Missing fields |
| `401` | "Token müddəti bitib. Yenidən daxil olun." | Expired token |

---

### 8.5 Database Table — `qr_users`
```sql
CREATE TABLE IF NOT EXISTS qr_users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    ad          VARCHAR(100)  NOT NULL,
    soyad       VARCHAR(100)  NOT NULL,
    nomre       VARCHAR(20)   NOT NULL UNIQUE,   -- E.164, e.g. +994501234567
    sifre       VARCHAR(255)  NOT NULL,           -- bcrypt hash
    phone_verified_at DATETIME NULL,              -- set when verified via WhatsApp code (NULL = old account)
    token_version INT NOT NULL DEFAULT 0,         -- +1 on password change/reset → older tokens rejected
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

`phone_verified_at` and the `qr_phone_otps` table (`sql/qr_phone_otps.sql`) are created automatically on server start (`src/config/qrSchema.js`). `user` objects returned by register / login / me / update include `phone_verified` (boolean).

---

### 8.6 Password Reset (Şifrəni unutdum)
Sets a new password using a WhatsApp code from 8.0 (`purpose: "reset"`). Also marks the phone as verified. The response is the same as login, so the user is signed in immediately.

- **URL**: `/qr-auth/password/reset`
- **Method**: `POST`
- **Auth Required**: No

**Request Body**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nomre` | string | Yes | Phone number (E.164). |
| `request_id` | string | Yes | From 8.0 response. |
| `kod` | string | Yes | 6-digit code. |
| `yeni_sifre` | string | Yes | New password (min. 6 characters). |

**Success Response (200 OK)**: `{ "success": true, "message": "Şifrə yeniləndi!", "data": { "token": "...", "user": { ... } } }`

Errors: the same `otp_*` codes as 8.1, `404 phone_not_found`, `400` for a short password.

> Password change for a signed-in user is `PUT /qr-auth/update` with `kohne_sifre` + `yeni_sifre`. When the password changes, the response also contains a top-level `token` (the old one is revoked) — clients must store it.

---

## 9. Error Handling

We use standard HTTP status codes:
- `200/201`: Success
- `400`: Bad request (e.g. missing required parameter, shown in message body)
- `401/403`: Unauthorized / Forbidden (Invalid credentials, tokens or disabled account)
- `404`: Resource not found (e.g. invalid Product ID or User Profile)
- `429`: Too Many Requests (Rate limit exceeded)
- `500`: Internal Server Error (Something went wrong on the server)

Standard Error Format:
```json
{
  "success": false,
  "message": "Human-readable error explanation."
}
```

*Note: For endpoints that don't enforce `success` prefix flags, they typically return `{ "status": "error", "message": "..." }` or `{ "false": true, "message": "..." }` based on POS integrations.*

---
**End of Documentation**

