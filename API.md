# Authenticator API Documentation

Phone-number authentication service (JWT access + refresh tokens) with a push-notification API for partner "services". Built with FastAPI, async SQLAlchemy (Postgres) and Firebase Cloud Messaging (FCM).

> This document was written from a full read of the source code (`main.py`, `routers/*`, `deps.py`, `security.py`, `models.py`, `schemas.py`, `services/*`, `alembic/*`, `config.py`, `database.py`). It describes what the code **actually does today**. Places where that differs from what was clearly intended are marked with ⚠️ and explained in [Known issues](#known-issues).

---

## Contents

1. [Overview](#overview)
2. [Authentication and headers](#authentication-and-headers)
3. [Roles and permissions](#roles-and-permissions)
4. [Users / Auth endpoints](#users--auth-endpoints)
5. [Services endpoints](#services-endpoints)
6. [Notifications endpoints](#notifications-endpoints)
7. [Static files and health](#static-files-and-health)
8. [Push notifications (FCM)](#push-notifications-fcm)
9. [Data models](#data-models)
10. [Errors](#errors)
11. [Quick start (curl)](#quick-start-curl)
12. [Configuration](#configuration)
13. [Known issues](#known-issues)

---

## Overview

| | |
|---|---|
| **Local base URL** | `http://127.0.0.1:8000` |
| **Production base URL** | `https://<your-project>.vercel.app` |
| **Swagger UI** | `/docs` (see ⚠️ K7: the *Authorize* button does not work) |
| **OpenAPI schema** | `/openapi.json` |
| **Body format** | JSON (`Content-Type: application/json`), except `POST /services/register` which is `multipart/form-data` |
| **CORS** | Origins from `CORS_ORIGINS` (default `*`), all methods, all headers, credentials allowed |

### Endpoint index

| Method | Path | Auth | Role |
|---|---|---|---|
| `POST` | `/api/v1/users/register` | – | – |
| `POST` | `/api/v1/users/login` | – | – |
| `POST` | `/api/v1/users/refresh` | – (refresh token in body) | – |
| `POST` | `/api/v1/users/logout` | 🔒 Bearer | any |
| `GET` | `/api/v1/users/me` | 🔒 Bearer | any |
| `POST` | `/services/register` | 🔒 Bearer | `owner` |
| `GET` | `/services/get` | 🔒 Bearer | `owner` |
| `POST` | `/services/delete` | 🔒 Bearer | `owner`, `admin` |
| `POST` | `/services/messages/send` | 🔒 Bearer + service token | `owner` |
| `POST` | `/services/broadcast` | 🔒 Bearer | `admin`, `owner` |
| `GET` | `/api/v1/notifications` | 🔒 Bearer | any |
| `PATCH` | `/api/v1/notifications/{notification_id}/read` | 🔒 Bearer | any |
| `GET` | `/static/{filename}` | – | – |
| `GET` | `/`, `/health` | – | – |

> Note the prefixes: users and notifications live under `/api/v1/...`, but the services router is mounted at `/services/...` (no `/api/v1`).

---

## Authentication and headers

### Which header to send

Every 🔒 endpoint requires the **access token** in the standard `Authorization` header, using the `Bearer` scheme:

```http
Authorization: Bearer <access_token>
```

- There is exactly one space between `Bearer` and the token. The scheme name is case-insensitive.
- Do **not** send the refresh token here. A refresh token in the `Authorization` header is rejected with `401`.
- Do **not** send the access token to `/refresh`. That endpoint only accepts a refresh token, in the JSON body.

| Request type | Headers |
|---|---|
| Public endpoints (`register`, `login`, `refresh`, `/health`, `/static/*`) | `Content-Type: application/json` (when there is a body) |
| Protected JSON endpoints | `Authorization: Bearer <access_token>` + `Content-Type: application/json` (when there is a body) |
| `POST /services/register` | `Authorization: Bearer <access_token>` + `Content-Type: multipart/form-data` (let your HTTP client set the boundary automatically; do not set it by hand) |
| `POST /services/messages/send` | Same as protected JSON, **plus** the service's `token` inside the JSON body |

### The credentials in this API

| Credential | Issued by | Sent where | Lifetime (defaults) |
|---|---|---|---|
| **Access token** (JWT, `type: "access"`) | register / login / refresh | `Authorization: Bearer ...` header | `ACCESS_TOKEN_EXPIRE_DAYS` = **30 days** |
| **Refresh token** (JWT, `type: "refresh"`) | register / login / refresh | JSON body of `POST /api/v1/users/refresh` | `REFRESH_TOKEN_EXPIRE_DAYS` = **60 days** |
| **Service token** (`srv_token_<48 hex chars>`) | `POST /services/register` | JSON body field `token` of `POST /services/messages/send` | does not expire |

### Token details

- Algorithm: `HS256`, signed with `SECRET_KEY`.
- Access token claims: `sub` (user UUID), `phone_number`, `exp`, `type: "access"`.
- Refresh token claims: `sub` (user UUID), `exp`, `type: "refresh"`.
- The `type` claim keeps them from being interchangeable: a refresh token cannot authenticate a request, and an access token cannot be exchanged at `/refresh`.
- The user is re-loaded from the database on every authenticated request, so a deleted user's token stops working immediately.

### Refresh-token rotation (important for client developers)

The server stores a SHA-256 hash of **one** refresh token per user (`users.refresh_token_hash`). Consequences:

1. Every call to `register`, `login` or `refresh` overwrites that hash. Only the **most recently issued** refresh token is valid.
2. After `POST /refresh`, the old refresh token is dead immediately. Always store **both** new tokens.
3. **Single device:** logging in on a second device invalidates the first device's refresh token. The first device keeps working until its access token expires (up to 30 days), then has to log in again.
4. **Parallel refreshes break:** if two requests refresh at the same time with the same refresh token, the second one fails with `401`. Use a single in-flight refresh (see the example below).
5. `POST /logout` clears the stored hash, so the refresh token stops working. The **access token stays valid until it expires** (JWTs are stateless). Logout also does not clear `device_token` (see K9).

### When to refresh

Only refresh when the failure detail says the token is bad or expired:

| `401` detail | Meaning | What the client should do |
|---|---|---|
| `Not authenticated` | No `Authorization` header (or not `Bearer ...`) | Fix the request, do not refresh |
| `Token yaroqsiz yoki muddati o'tgan!` | Invalid or expired access token, a refresh token was sent as Bearer, or the user no longer exists | Call `/refresh` once, then retry |
| `Refresh token yaroqsiz yoki muddati o'tgan!` | Refresh failed | Clear stored tokens and send the user to login |

All 401 responses include `WWW-Authenticate: Bearer`.

### Example: sending the token

**curl**

```bash
curl https://<host>/api/v1/users/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**JavaScript (fetch) with automatic refresh**

```js
const BASE = "https://<host>";
let tokens = JSON.parse(localStorage.getItem("tokens") || "null"); // { access_token, refresh_token }
let refreshing = null; // shared promise, so only one refresh runs at a time

async function refreshTokens() {
  const res = await fetch(`${BASE}/api/v1/users/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) {
    localStorage.removeItem("tokens");
    throw new Error("login required");
  }
  tokens = await res.json(); // store BOTH new tokens
  localStorage.setItem("tokens", JSON.stringify(tokens));
}

async function api(path, options = {}) {
  const send = () =>
    fetch(BASE + path, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${tokens.access_token}` },
    });

  let res = await send();
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.detail === "Token yaroqsiz yoki muddati o'tgan!") {
      refreshing ??= refreshTokens().finally(() => (refreshing = null));
      await refreshing;
      res = await send(); // retry once
    }
  }
  return res;
}
```

---

## Roles and permissions

`users.role` is one of `owner`, `admin`, `user`.

- Everyone who registers through the API gets **`user`**. There is no endpoint to change a role. Promote accounts directly in the database. Check the exact enum labels first: `SELECT enum_range(NULL::userrole);` (see K6; SQLAlchemy stores the member **names**, i.e. `OWNER`, `ADMIN`, `USER`, by default).
- The role is returned as a lowercase string (`"owner"`, `"admin"`, `"user"`) in `UserOut.role`.

| Action | `user` | `admin` | `owner` |
|---|:-:|:-:|:-:|
| Register / login / refresh | ✅ | ✅ | ✅ |
| `me`, `logout` | ✅ | ✅ | ✅ |
| Own notifications (list, mark read) | ✅ | ✅ | ✅ |
| Register a service | ❌ | ❌ | ✅ |
| List services (`/services/get`) | ❌ | ❌ | ✅ |
| Send a message to one user (`/services/messages/send`) | ❌ | ❌ | ✅ |
| Broadcast to all devices | ❌ | ✅ | ✅ |
| Delete a service | ❌ | ✅ own services only | ✅ any service |

---

## Users / Auth endpoints

Base path: `/api/v1/users`

All three token-issuing endpoints (`register`, `login`, `refresh`) return the same body, `TokenSchema`:

```json
{
  "status": "success",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": "5b1f7e2a-9c3d-4e21-8a4f-2d6c1f9b7a10",
    "full_name": "Ibrohim Aliyev",
    "phone_number": "+998901234567",
    "role": "user"
  }
}
```

### 1. Register

Creates the account immediately and returns tokens. There is no OTP, SMS or Telegram step.

```
POST /api/v1/users/register
```

**Auth:** none · **Content-Type:** `application/json`

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `full_name` | string | ✅ | Stored up to 250 characters |
| `phone_number` | string | ✅ | Unique, up to 20 characters. Stored **exactly as sent**, with no normalization. Use one consistent format (for example `+998901234567`), because `messages/send` matches it by exact string. |
| `password` | string | ✅ | Hashed with bcrypt. No length or strength validation. |
| `device_token` | string | ❌ | FCM device token, stored on the user |

```bash
curl -X POST $BASE/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Ibrohim Aliyev","phone_number":"+998901234567","password":"S3cur3Pass!","device_token":"fcm_token_here"}'
```

**Response `200`:** `TokenSchema` (above), with `role: "user"`.

| Status | `detail` | Cause |
|---|---|---|
| `400` | `Ushbu telefon raqam allaqachon ro'yxatdan o'tgan!` ("This phone number is already registered") | Duplicate phone number |
| `422` | validation array | Missing or wrongly typed field |

---

### 2. Login

```
POST /api/v1/users/login
```

**Auth:** none · **Content-Type:** `application/json` (⚠️ JSON, not form data)

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `phone_number` | string | ✅ | |
| `password` | string | ✅ | |
| `device_token` | string | ❌ | If provided, **replaces** the stored device token |

```bash
curl -X POST $BASE/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+998901234567","password":"S3cur3Pass!","device_token":"fcm_token_here"}'
```

**Response `200`:** `TokenSchema`. A new access/refresh pair is issued and **replaces** any previous refresh token (see [rotation](#refresh-token-rotation-important-for-client-developers)).

| Status | `detail` | Cause |
|---|---|---|
| `404` | `Bunday telefon raqam avval ro'yxatdan o'tmagan!` ("No account with this phone number") | Unknown phone number |
| `401` | `Telefon raqam yoki parol noto'g'ri!` ("Wrong phone number or password") | Wrong password |
| `422` | validation array | Missing or wrongly typed field |

---

### 3. Refresh

Exchanges a valid, not-yet-superseded refresh token for a brand-new access **and** refresh token.

```
POST /api/v1/users/refresh
```

**Auth:** none (the refresh token goes in the body) · **Content-Type:** `application/json`

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `refresh_token` | string | ✅ | The most recently issued refresh token |

```bash
curl -X POST $BASE/api/v1/users/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"eyJhbGciOi..."}'
```

**Response `200`:** `TokenSchema`. The old refresh token stops working immediately.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Refresh token yaroqsiz yoki muddati o'tgan!` | Bad signature or expired, wrong `type` (for example an access token), missing or invalid `sub`, user not found, user logged out (no stored hash), or the token was already rotated or superseded |
| `422` | validation array | `refresh_token` missing |

---

### 4. Logout 🔒

Clears the user's stored refresh-token hash, so the refresh token can no longer be used.

```
POST /api/v1/users/logout
```

**Auth:** `Authorization: Bearer <access_token>` · **Body:** none

```bash
curl -X POST $BASE/api/v1/users/logout -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Response `200`**

```json
{ "detail": "Tizimdan muvaffaqiyatli chiqildi" }
```

> The current access token remains valid until it expires, and `device_token` is not cleared. See K9.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |

---

### 5. Current user 🔒

```
GET /api/v1/users/me
```

**Auth:** `Authorization: Bearer <access_token>`

**Response `200`**

```json
{
  "id": "5b1f7e2a-9c3d-4e21-8a4f-2d6c1f9b7a10",
  "full_name": "Ibrohim Aliyev",
  "phone_number": "+998901234567",
  "role": "user"
}
```

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` | No Bearer header |
| `401` | `Token yaroqsiz yoki muddati o'tgan!` | Invalid or expired token, or a refresh token was used |

---

## Services endpoints

Base path: `/services` (no `/api/v1`). A **service** is an external app (a savings app, an e-commerce app, ...) that is allowed to push notifications to users. All endpoints here require a Bearer access token.

### 1. Register a service 🔒 (owner)

Creates a service and returns its permanent service `token`. Optionally uploads a logo.

```
POST /services/register
```

**Auth:** `Authorization: Bearer <access_token>` · role `owner` · **Content-Type:** `multipart/form-data`

| Form field | Type | Required | Rules |
|---|---|:-:|---|
| `name` | string | ✅ | 3–50 characters, must be unique (for example `jamgarma_app`) |
| `title` | string | ✅ | 2–150 characters. Used as the push-notification title. |
| `about` | string | ❌ | Free text |
| `logo` | file | ❌ | `.jpg`, `.jpeg`, `.png` or `.webp`. Checked by **file extension only**, with no size limit. |

```bash
curl -X POST $BASE/services/register \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "name=jamgarma_app" \
  -F "title=Jamg'arma Moliya Tashkiloti MCHJ" \
  -F "about=Onlayn jamg'arma xizmati" \
  -F "logo=@./logo.png"
```

**Response `201`** (intended; see ⚠️ K1, which currently returns `500`)

```json
{
  "status": "success",
  "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
  "token": "srv_token_3f9a...48 hex chars..."
}
```

The logo is saved under a random name and exposed at `/static/<uuid>.<ext>` (the stored `logo_url` is relative, so prefix the base URL).

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | Caller is not `owner` |
| `400` | `Bunday nomli servis allaqachon ro'yxatdan o'tgan.` | `name` already taken |
| `400` | `Faqat rasm fayllari (.jpg, .jpeg, .png, .webp) qabul qilinadi.` | Unsupported logo extension |
| `422` | validation array | Missing field, or `name`/`title` length out of range |
| `500` | – | ⚠️ K1: `user_id` is never set on the new service |

---

### 2. List services 🔒 (owner)

```
GET /services/get
```

**Auth:** `Authorization: Bearer <access_token>` · role `owner` (strictly `owner`; `admin` gets `403`)

**Response `200`**

```json
[
  {
    "id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
    "name": "jamgarma_app",
    "title": "Jamg'arma Moliya Tashkiloti MCHJ",
    "logo_url": "/static/6f1c...e2.png",
    "about": "Onlayn jamg'arma xizmati",
    "token": "srv_token_3f9a..."
  }
]
```

> It returns **all** services in the system (not only the caller's), including each service's secret `token`. See K8.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |
| `403` | `Ushbu amalni bajarishda sizda yetarlicha huquq yo'q!` | Caller is not `owner` |
| `404` | `Sizda hali Servicelar mavjud emas` | There are no services. An empty result is reported as `404`, **not** `[]`, so clients should treat `404` as an empty list. |

---

### 3. Delete a service 🔒 (owner, admin)

```
POST /services/delete?service_token=<service_token>
```

**Auth:** `Authorization: Bearer <access_token>` · role `owner` or `admin` · **Body:** none. `service_token` is a **query parameter**, not a JSON field.

```bash
curl -X POST "$BASE/services/delete?service_token=srv_token_3f9a..." \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Response `200`** (HTTP status is 200; the `status` field in the body is a number copied from the 204 constant)

```json
{ "message": "Service muvaffaqiyatli o'chirildi !", "status": 204 }
```

Deleting a service also deletes all its notifications (cascade).

**Permission behaviour:**

| Caller | Result |
|---|---|
| `user` | `403` `Huquqingiz yetarli emas !` |
| `owner` | `200` — can delete **any** service |
| `admin` | `200` — can delete **own** services only |
| `admin`, service belongs to someone else | `403` `Service sizga tegishli emas!` |
| any role, unknown `service_token` | `404` `Service topilmadi` |

---

### 4. Send a message to one user 🔒 (owner)

Stores a notification for the user with the given phone number and, if that user has a `device_token`, pushes it via FCM.

```
POST /services/messages/send
```

**Auth:** `Authorization: Bearer <access_token>` (role `owner`) **and** the service's `token` in the body. Both are required: the partner backend that calls this endpoint needs an `owner` JWT as well as the service token.

**Content-Type:** `application/json`

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `service_id` | UUID | ✅ | From service registration |
| `token` | string | ✅ | That service's `srv_token_...` |
| `user_phone` | string | ✅ | Recipient's phone number, matched by exact string |
| `message` | string | ✅ | Stored as `Notification.message`; also used as the push body |

```bash
curl -X POST $BASE/services/messages/send \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
    "token": "srv_token_3f9a...",
    "user_phone": "+998901234567",
    "message": "To'\''lovingiz muvaffaqiyatli amalga oshirildi."
  }'
```

**Response `200`**

```json
{ "status": "success", "message": "Xabar yetkazildi", "push_sent": true }
```

`push_sent` is `false` if the user has no `device_token` or FCM rejected the send. ⚠️ K2: if the recipient **has** a `device_token`, the call currently crashes with `500` after the notification has already been saved.

Order of operations: (1) role check → (2) service lookup by `service_id` + `token` + `is_active` → (3) user lookup by phone → (4) notification saved → (5) FCM push.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | Caller is not `owner` |
| `401` | `Yaroqsiz service_id yoki token!` | Wrong `service_id`/`token` pair, or the service is inactive |
| `404` | `Ushbu telefon raqamli foydalanuvchi topilmadi` | No user with that phone number |
| `422` | validation array | Missing field, or `service_id` is not a UUID |
| `500` | – | ⚠️ K2 (recipient has a `device_token`) |

---

### 5. Broadcast to all devices 🔒 (admin, owner)

Queues a push to **every user that has a non-empty `device_token`**. The endpoint answers immediately; the sending happens in a FastAPI background task.

```
POST /services/broadcast
```

**Auth:** `Authorization: Bearer <access_token>` · role `admin` or `owner` · **Content-Type:** `application/json`

| Field | Type | Required | Rules |
|---|---|:-:|---|
| `title` | string | ✅ | max 150 characters |
| `message` | string | ✅ | max 1000 characters |

```bash
curl -X POST $BASE/services/broadcast \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Yangilanish","message":"Ilovaning yangi versiyasi chiqdi!"}'
```

**Response `200`**

```json
{
  "status": "success",
  "message": "Ommaviy xabar fonda yuborish uchun navbatga qo'shildi."
}
```

The response only means "queued". There is no delivery report, and no `Notification` rows are created for broadcasts, so they never appear in `GET /api/v1/notifications`. ⚠️ K4: as written, the background sender fails for every device, so nothing is actually delivered.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |
| `403` | `Ommaviy xabar yuborish uchun faqat Admin yoki Owner huquqi kerak.` | Caller is a plain `user` |
| `422` | validation array | Missing field, or `title`/`message` too long |

---

## Notifications endpoints

Base path: `/api/v1/notifications`. All endpoints require a Bearer access token and only ever touch the **caller's own** notifications.

### 1. List notifications 🔒

```
GET /api/v1/notifications
```

**Response `200`**: newest first, no pagination. `[]` when the user has none.

```json
[
  {
    "id": "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
    "message": "To'lovingiz muvaffaqiyatli amalga oshirildi.",
    "is_read": false,
    "sent_at": "2026-10-17T14:02:11.482913+00:00"
  }
]
```

> A notification stores only `message`. The sender's title, logo and description are **not** part of this response, and regular users have no endpoint to look a service up by `service_id`. See K14.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |

---

### 2. Mark as read 🔒

```
PATCH /api/v1/notifications/{notification_id}/read
```

| Path param | Type | Notes |
|---|---|---|
| `notification_id` | UUID | Must belong to the caller |

```bash
curl -X PATCH $BASE/api/v1/notifications/1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f/read \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Response `200`**: the updated notification with `"is_read": true`.

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing or invalid access token |
| `404` | `Bildirishnoma topilmadi` | Does not exist, or belongs to another user |
| `422` | validation array | `notification_id` is not a valid UUID |

---

## Static files and health

### Static files

```
GET /static/{filename}
```

Public, no auth. Serves uploaded service logos. A service's `logo_url` is relative (`/static/<uuid>.<ext>`), so the full URL is `BASE + logo_url`. Files are stored in `./uploads` locally and in the system temp directory (`/tmp`) on Vercel, which is **ephemeral** (see K12).

### Health

```
GET /          → {"project": "Authenticator by iDev", "status": "Working 200 OK"}
GET /health    → {"status": "ok"}
```

No auth. Useful for uptime checks.

---

## Push notifications (FCM)

- Each user can have one `device_token` (an FCM registration token). It is set via `device_token` on **register** or **login**; a later login with a new `device_token` replaces it. There is no dedicated endpoint to update or clear it.
- **Single send** (`/services/messages/send`): title = the service's `title`, body = `message`. Intended extra data payload for the mobile app: `service_id`, `service_name`, `service_title`, `logo_url`, `about` (⚠️ not delivered today, K2).
- **Broadcast** (`/services/broadcast`): title and body from the request, sent to every non-empty `device_token`, one by one (⚠️ K4).
- Android messages use high priority with the default sound. iOS messages use APNs priority `10` with `content_available`.
- Firebase is initialised with `firebase_admin.initialize_app()` and **no arguments**, so credentials come from Google Application Default Credentials (for example the `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing to a service-account JSON). This variable is not listed in `.env.example`. Without credentials, pushes fail and the error is only logged.

---

## Data models

**User** (`users`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `full_name` | string(250) | |
| `phone_number` | string(20) | unique, indexed |
| `hashed_password` | string(255) | bcrypt |
| `is_active` | bool | default `true` (⚠️ never checked, K10) |
| `device_token` | text, nullable | FCM token |
| `role` | enum `owner` / `admin` / `user` | default `user` |
| `refresh_token_hash` | string(64), nullable | SHA-256 of the current refresh token |
| `created_at` | timestamptz | |

**Service** (`services`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users.id`, `ON DELETE CASCADE`, NOT NULL |
| `name` | string(100) | unique |
| `title` | string(255) | |
| `logo_url` | text, nullable | relative path |
| `about` | text, nullable | |
| `token` | string(255) | unique, indexed (`srv_token_...`) |
| `is_active` | bool | default `true`; no endpoint changes it |
| `created_at` | timestamptz | |

**Notification** (`notifications`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users.id`, `ON DELETE CASCADE` |
| `service_id` | UUID | FK → `services.id`, `ON DELETE CASCADE` |
| `message` | text | |
| `is_read` | bool | default `false` |
| `sent_at` | timestamptz | |

Deleting a user deletes their services and notifications; deleting a service deletes its notifications.

---

## Errors

Errors use FastAPI's default shape:

```json
{ "detail": "Telefon raqam yoki parol noto'g'ri!" }
```

Validation errors (`422`) return an array:

```json
{
  "detail": [
    { "type": "missing", "loc": ["body", "phone_number"], "msg": "Field required", "input": {} }
  ]
}
```

| Status | Meaning in this API |
|---|---|
| `200` | Success |
| `201` | Service created |
| `400` | Business-rule failure (duplicate phone, duplicate service name, bad logo type) |
| `401` | Missing/invalid access token, bad login password, bad refresh token, bad service id/token pair |
| `403` | Authenticated, but the role is not allowed |
| `404` | Not found (unknown phone at login, unknown recipient, notification not found, no services) |
| `422` | Request failed schema validation |
| `500` | Unhandled server error (see Known issues K1, K2) |

---

## Quick start (curl)

```bash
BASE=http://127.0.0.1:8000

# 1) Register (returns tokens)
curl -s -X POST $BASE/api/v1/users/register -H "Content-Type: application/json" \
  -d '{"full_name":"Ibrohim Aliyev","phone_number":"+998901234567","password":"S3cur3Pass!"}'

# Put the tokens from the response into variables
ACCESS=<access_token>
REFRESH=<refresh_token>

# 2) Call a protected endpoint with the access token header
curl -s $BASE/api/v1/users/me -H "Authorization: Bearer $ACCESS"

# 3) Read your notifications
curl -s $BASE/api/v1/notifications -H "Authorization: Bearer $ACCESS"

# 4) Get a new pair when the access token expires (store BOTH new tokens!)
curl -s -X POST $BASE/api/v1/users/refresh -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"

# 5) Logout
curl -s -X POST $BASE/api/v1/users/logout -H "Authorization: Bearer $ACCESS"
```

**Typical partner flow** (needs an `owner` account; promote one in the DB first): log in as `owner` → `POST /services/register` (save `service_id` + `token`) → `POST /services/messages/send` with `Authorization: Bearer <owner access token>` and the service `token` in the body → the user sees it in `GET /api/v1/notifications` and, if they have a `device_token`, as a push.

---

## Configuration

Read from environment variables (`.env` locally, Vercel dashboard in production). Nothing sensitive is hardcoded.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | **required** | Postgres connection string (async driver). See K5. |
| `SECRET_KEY` | **required** | JWT signing key (`openssl rand -hex 32`) |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_DAYS` | `30` | Access-token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `60` | Refresh-token lifetime |
| `CORS_ORIGINS` | `*` | Comma-separated origins, or `*` |
| `DEBUG` | `false` | Enables SQLAlchemy SQL echo |
| `VERCEL` | set by Vercel | Switches the upload directory to `/tmp` |
| `GOOGLE_APPLICATION_CREDENTIALS` | – | Needed for FCM (not in `.env.example`) |

Run locally: `pip install -r requirements.txt` → fill `.env` → `alembic upgrade head` (⚠️ see K6) → `uvicorn main:app --reload`.

---

## Known issues

Found while reading the code. Nothing here was run against a live database, so the "what happens" column comes from reading the source; verify before relying on it.

| # | Severity | Where | What happens | Suggested fix |
|---|---|---|---|---|
| **K1** | 🔴 Blocker | `routers/service.py` · `register_service` | `Service(...)` is created **without `user_id`**, but `services.user_id` is `NOT NULL`, so the insert fails and the endpoint returns `500`. (The `f90e95ae0777` migration also adds that NOT NULL column, which fails if `services` already has rows. Backfill first.) | Pass `user_id=user.id` when creating the `Service`. |
| **K2** | 🔴 Blocker | `routers/service.py` · `send_message` → `services/fcm.py` | The call passes `extra_data=...`, but `send_fcm_notification` has no such parameter, so a `TypeError` is raised and the request returns `500`. This only happens when the recipient has a `device_token`, and the notification row is already committed by then. | Add `extra_data: dict[str, str] | None = None` to the function and pass it as `data=` in `messaging.Message(...)` (FCM data values must be strings). |
| **K3** | ✅ Fixed | `routers/service.py` · `delete_service` | Previously `A or B and C` operator precedence caused `owner` to always get `403`. Now fixed: `owner` can delete any service, `admin` can delete own services only, unknown token returns `404`. | — |
| **K4** | 🟠 High | `services/background.py` | The file redefines `send_fcm_notification` with `notification=messaging.AndroidConfig(sound=...)`. That raises a `TypeError`, which the function's own `try/except` swallows, so it returns `False` for **every** device: broadcast delivers nothing. `process_broadcast` is an unused stub. Broadcasts also create no `Notification` rows, and on Vercel a long background loop may be cut off when the function stops. | Import `send_fcm_notification` from `services.fcm` instead of redefining it, use `AndroidNotification`, and consider `messaging.send_each_for_multicast` in batches. |
| **K5** | 🟠 High | `database.py` | `connect_args={"prepare_threshold": None}` is a **psycopg 3** option. With the `postgresql+asyncpg://` URL from `.env.example`, `asyncpg.connect()` has no such parameter (checked in the installed asyncpg source), so the first DB connection should fail with a `TypeError`. If production works, its `DATABASE_URL` probably differs. | Either use `postgresql+psycopg://...` (psycopg 3 is in `requirements.txt`), or stay on asyncpg and use `connect_args={"statement_cache_size": 0}` with `?prepared_statement_cache_size=0` (needed behind pgbouncer transaction mode). |
| **K6** | 🟠 High | `alembic/versions/*` | There is no migration that creates the base tables, and none for `users.refresh_token_hash` (the README mentions `2f6a1d9c7b3e_add_refresh_token_hash.py`, which is not in the repo). `31a0a82b5c23` adds `users.role` with labels `admin/user/moderator`; `e9e7b210773e` adds the same column again with `OWNER/USER`; the model uses `OWNER/ADMIN/USER`. `alembic upgrade head` on a fresh database will fail. | Regenerate one clean initial migration from the models (`alembic revision --autogenerate`) and, for the existing DB, `alembic stamp` it. |
| **K7** | 🟡 Medium | `deps.py` | `OAuth2PasswordBearer(tokenUrl="/api/v1/users/login")` makes Swagger's *Authorize* dialog post **form** fields to `/login`, which expects **JSON**, so it returns `422`. You cannot authorize in `/docs`. | Use `HTTPBearer()` (a simple "paste your token" box) or call the API with curl/Postman. |
| **K8** | 🟡 Medium | `GET /services/get` | Returns every service from every owner, **including secret service tokens**. An empty result is `404`, not `[]`. | Filter by `Service.user_id == user.id` (or keep tokens out of list responses) and return `[]` when empty. |
| **K9** | 🟡 Medium | `logout` | Does not invalidate the access token (valid up to 30 days) and does not clear `device_token`, so the logged-out device keeps receiving pushes. | Set `device_token = None` on logout; consider shorter access-token lifetimes (hours) and rely on refresh. |
| **K10** | 🟢 Low | `users.is_active`, `services.is_active` | `User.is_active` is never checked, so a "deactivated" user can still log in. `Service.is_active` is checked only when sending. No endpoint toggles either flag. | Check `is_active` in `login`, `/refresh` and `get_current_user`. |
| **K11** | 🟢 Low | `login` / `register` | `404` vs `401` at login reveals whether a phone number is registered. No rate limiting; no phone-format or password-strength validation; phone numbers are not normalized. | Return one generic `401`, add rate limiting, validate/normalize to E.164. |
| **K12** | 🟢 Low | `register_service` logo upload | On Vercel, files go to `/tmp`, which is ephemeral and per-instance, so logos will disappear. No size limit; only the extension is checked. | Store logos in object storage (for example Supabase Storage / S3) and save that URL. |
| **K13** | ⚪ Info | routing | Users/notifications use `/api/v1/...`, services use `/services/...`. Verb-style paths (`/services/get`, `/services/delete`) and `POST` for delete. | Consider `/api/v1/services` with `GET`/`POST`/`DELETE /{id}`. |
| **K14** | ⚪ Info | notifications | A stored notification has only `message`: no title, and no way for a regular user to fetch a service's `title`/`logo_url`/`about` by `service_id`. (`UPDATES.todo` already lists this requirement.) | Add a user-readable `GET /api/v1/services/{id}` (public fields only) and/or embed a service summary in `NotificationOut`. |