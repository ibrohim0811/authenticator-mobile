# Authenticator API Documentation

Phone-number authentication service with **JWT access + refresh tokens**, **user roles**,
and a **notification API** (stored notifications + FCM push) that lets service owners
send messages to users.

> **Version:** v2.0 · **Last verified against source:** 2026-10-03
>
> **Changelog**
> - **v2.0** — ⚠️ *breaking changes*
>   - `POST /users/login` now returns **`404`** when the phone number is not registered
>     (previously `401`); `401` now means *wrong password* only.
>   - Service endpoints **moved** from `/api/v1/services/register` and `/api/v1/messages/send`
>     to **`/services/register`** and **`/services/messages/send`**.
>   - Service endpoints now require an **`OWNER`** user's access token (`403` for everyone else).
>   - `POST /services/register` is now `multipart/form-data` (optional **logo upload**) and returns `201`.
>   - Messages are now also sent as **FCM push notifications**; response has a new `push_sent` field.
>   - New: user **roles**, static file serving at `/static/...`.
> - **v1.1** — added `POST /users/logout`.

---

## Table of contents

1. [Quick start (for frontend / mobile)](#1-quick-start-for-frontend--mobile)
2. [General conventions](#2-general-conventions)
3. [Authentication model](#3-authentication-model)
4. [Users API](#4-users-api)
   - [Register](#41-register)
   - [Login](#42-login)
   - [Refresh tokens](#43-refresh-tokens)
   - [Current user](#44-current-user-)
   - [Logout](#45-logout-)
5. [Notifications API](#5-notifications-api)
   - [List notifications](#51-list-notifications-)
   - [Mark as read](#52-mark-as-read-)
6. [Services API (OWNER only)](#6-services-api-owner-only)
   - [Register a service](#61-register-a-service--owner)
   - [Send a message](#62-send-a-message--owner)
   - [Static files (logos)](#63-static-files-logos)
7. [Health checks](#7-health-checks)
8. [Data models](#8-data-models)
9. [Errors](#9-errors)
10. [Troubleshooting](#10-troubleshooting)
11. [Frontend integration example](#11-frontend-integration-example)

Legend: 🔒 = requires `Authorization: Bearer <access_token>` · 👑 = additionally requires role `OWNER`.

---

## 1. Quick start (for frontend / mobile)

```text
┌──────────┐   POST /api/v1/users/register  or  /login      ┌────────┐
│  Client  │ ─────────────────────────────────────────────▶ │  API   │
│          │ ◀───────────────  access_token + refresh_token │        │
│          │                                                │        │
│          │   GET /api/v1/users/me                         │        │
│          │   Authorization: Bearer <access_token>  ─────▶ │        │
│          │                                                │        │
│          │   access token expired (401)?                  │        │
│          │   POST /api/v1/users/refresh {refresh_token} ─▶│        │
│          │ ◀───────────  NEW access_token + refresh_token │        │
│          │                                                │        │
│          │   POST /api/v1/users/logout                    │        │
│          │   Authorization: Bearer <access_token>  ─────▶ │        │
│          │ ◀─────────────  refresh token revoked on server│        │
│          │   (client then deletes both tokens locally)    │        │
└──────────┘                                                └────────┘
```

**The 6 rules that avoid 95% of integration problems:**

1. Send **JSON** (`Content-Type: application/json`), **not** form data — *except*
   `POST /services/register`, which is `multipart/form-data`.
   Login does **not** use `username`/`password` — the fields are `phone_number` and `password`.
2. Send the phone number in **exactly the same format** on register and login
   (recommended: `+998901234567`). The server does **not** normalize it, and a different
   format is treated as "not registered" (`404`) — see [Phone number format](#phone-number-format).
3. Send the **access** token as `Authorization: Bearer <access_token>`
   (never the refresh token, no quotes, no missing `Bearer ` prefix).
4. **Always save the newest `refresh_token`** — every `/refresh` (and every login)
   invalidates the previous one.
5. Call URLs **without a trailing slash** (`/api/v1/notifications`, not `/api/v1/notifications/`).
6. On logout, call `POST /api/v1/users/logout` **and** delete both tokens on the device.
   The server cannot revoke an access token — see [Logout](#45-logout-).

### Endpoint overview

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/users/register` | – | – | Create account, get tokens |
| `POST` | `/api/v1/users/login` | – | – | Log in, get tokens |
| `POST` | `/api/v1/users/refresh` | refresh token (body) | – | Rotate tokens |
| `POST` | `/api/v1/users/logout` | 🔒 | – | Revoke refresh token |
| `GET` | `/api/v1/users/me` | 🔒 | – | Current user |
| `GET` | `/api/v1/notifications` | 🔒 | – | List my notifications |
| `PATCH` | `/api/v1/notifications/{id}/read` | 🔒 | – | Mark notification as read |
| `POST` | `/services/register` | 🔒 | 👑 `OWNER` | Register a service (+ optional logo) |
| `POST` | `/services/messages/send` | 🔒 | 👑 `OWNER` | Send a notification (+ push) to a user |
| `GET` | `/static/{filename}` | – | – | Uploaded logos |
| `GET` | `/`, `/health` | – | – | Health checks |

> ⚠️ Note that the service endpoints live under **`/services`**, *not* under `/api/v1`.

---

## 2. General conventions

### Base URL

| Environment | URL |
|---|---|
| Local | `http://127.0.0.1:8000` |
| Production | `https://<your-vercel-project>.vercel.app` |

Interactive Swagger UI: `GET /docs` · Raw OpenAPI schema: `GET /openapi.json`

### Requests & responses

| Item | Value |
|---|---|
| Format | JSON (`Content-Type: application/json`); `multipart/form-data` only for `POST /services/register` |
| Success status | `200 OK` for every endpoint, except `POST /services/register` → `201 Created` |
| IDs | UUID v4 strings |
| Timestamps | ISO 8601, UTC (e.g. `2026-09-26T14:02:11.482913+00:00`) |
| CORS | Controlled by the `CORS_ORIGINS` env var (`*` by default) |
| Error messages | The `detail` text is in **Uzbek** (see [Errors](#9-errors)) |

### Phone number format

The phone number is stored and compared as an **exact string** — there is no
trimming, no removal of spaces and no country-code normalization on the server.

| Sent at register | Sent at login | Result |
|---|---|---|
| `+998901234567` | `+998901234567` | ✅ works |
| `+998901234567` | `998901234567` | ❌ `404` (treated as a different, unregistered number) |
| `+998901234567` | `+998 90 123 45 67` | ❌ `404` |
| `+998901234567` | `+998901234567 ` (trailing space) | ❌ `404` |

**Recommendation:** normalize on the client before every request (digits only,
prefixed with `+`, no spaces/dashes/brackets). Max length is **20 characters**.
The same exact-match rule applies to `user_phone` in [Send a message](#62-send-a-message--owner).

### Trailing slashes

`POST /api/v1/users/login/` (with `/`) does **not** return the login response —
it returns a `307` redirect to the URL without the slash. Some HTTP clients drop
the `Authorization` header or change the scheme when following redirects. Always
call the exact paths shown in this document.

---

## 3. Authentication model

The API uses these kinds of credentials:

| Credential | Used by | How it is sent |
|---|---|---|
| **Access token** (JWT) | Everyone logged in (mobile / web app, service owners) | `Authorization: Bearer <access_token>` header |
| **Refresh token** (JWT) | End users, **only** for `POST /api/v1/users/refresh` | JSON body |
| **Service token** | Used **together with** an OWNER's access token in `POST /services/messages/send` | JSON body (`service_id` + `token`) |

### Tokens

| | Access token | Refresh token |
|---|---|---|
| Lifetime (defaults) | **30 days** (`ACCESS_TOKEN_EXPIRE_DAYS`) | **60 days** (`REFRESH_TOKEN_EXPIRE_DAYS`) |
| Algorithm | HS256 | HS256 |
| Claims | `sub` (user id), `phone_number`, `exp`, `type: "access"` | `sub` (user id), `exp`, `type: "refresh"` |
| Accepted by | All 🔒 endpoints | `POST /users/refresh` only |

The `type` claim is enforced: a refresh token is **rejected** on 🔒 endpoints and
an access token is **rejected** on `/refresh`.

### Refresh-token rotation (important)

The server stores a hash of **one** refresh token per user — the most recently issued one.
A new refresh token is issued on **register**, **login** and **refresh**; each time,
the previous refresh token stops working immediately.

Consequences for the client:

- **Always replace the stored refresh token** with the one from the latest response.
- **Single device per user for refresh:** logging in on device B invalidates device A's
  refresh token. Device A's current *access* token keeps working until it expires,
  but once it does, device A must log in again.
- **Never run two `/refresh` calls at once.** If two requests fire in parallel with the
  same refresh token, the second one gets `401`. Queue them behind a single in-flight
  refresh (see [example](#11-frontend-integration-example)).
- **Logout clears that one stored hash**, so it signs the user out of refresh on **all**
  devices at once (there is no per-device session). See [Logout](#45-logout-).
- There is **no OTP, SMS or Telegram step** — register and login are immediate.

### Logout and access tokens (important)

Access tokens are stateless JWTs: the server does **not** keep a list of them, so it
cannot revoke one. After `POST /users/logout`:

| Token | Still works? |
|---|---|
| **Refresh token** (any device) | ❌ No — `/refresh` returns `401` |
| **Access token** (any device) | ✅ **Yes**, until it expires (up to 30 days by default) |

So "logged out" means *"can no longer obtain new tokens"*. The client **must** delete both
tokens locally; otherwise the old access token still works against 🔒 endpoints.

### Roles and permissions

Every user has exactly one role:

| Role | How a user gets it | Permissions |
|---|---|---|
| `USER` | Default for everyone who registers | Everything under `/api/v1/users` and `/api/v1/notifications` |
| `OWNER` | Assigned **manually in the database** (`users.role`) — there is no API for it | Everything a `USER` can do **plus** `POST /services/register` and `POST /services/messages/send` |

Things to know:

- **The role is not returned by any endpoint** — not by login/register/refresh (`user` object)
  and not by `/users/me`. A client can only discover that a user lacks permission by getting
  **`403`**. Treat `403` as "not allowed" and hide owner-only UI accordingly.
- Registration always creates a `USER`; an account can't promote itself.
- The role is checked on **every request** from the database, so a promotion/demotion takes
  effect immediately (no need to log in again).
- `403` means *authenticated but not allowed* — **do not** refresh the token or log the user out.

---

## 4. Users API

Base path: `/api/v1/users`

### 4.1 Register

Creates the account immediately (role `USER`) and returns tokens.

```http
POST /api/v1/users/register
Content-Type: application/json
```

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | ✅ | Max 250 characters |
| `phone_number` | string | ✅ | Max 20 characters, must be unique. See [format](#phone-number-format) |
| `password` | string | ✅ | Max **72 bytes** (bcrypt limit). Stored as a bcrypt hash |
| `device_token` | string | ❌ | FCM device token — **used for push notifications**, saved on the user |

```json
{
  "full_name": "Ibrohim Aliyev",
  "phone_number": "+998901234567",
  "password": "S3cur3Pass!",
  "device_token": "fcm_device_token_here"
}
```

**Response `200`** — see [`TokenResponse`](#tokenresponse)

```json
{
  "status": "success",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": "5b1f7e2a-9c3d-4e21-8a4f-2d6c1f9b7a10",
    "full_name": "Ibrohim Aliyev",
    "phone_number": "+998901234567"
  }
}
```

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `400` | `Ushbu telefon raqam allaqachon ro'yxatdan o'tgan!` | Phone number already registered |
| `422` | *(validation array)* | Missing/invalid field |

**cURL**

```bash
curl -X POST http://127.0.0.1:8000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Ibrohim Aliyev","phone_number":"+998901234567","password":"S3cur3Pass!"}'
```

---

### 4.2 Login

```http
POST /api/v1/users/login
Content-Type: application/json
```

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone_number` | string | ✅ | Must match the registered value **exactly** |
| `password` | string | ✅ | |
| `device_token` | string | ❌ | If provided, replaces the stored FCM device token |

```json
{
  "phone_number": "+998901234567",
  "password": "S3cur3Pass!"
}
```

**Response `200`** — same shape as [Register](#41-register). A new access/refresh
pair is issued and **replaces** the user's previous refresh token.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `404` | `Bunday telefon raqam avval ro'yxatdan o'tmagan!` | **No user with this exact `phone_number`** (not registered, or sent in a different format) |
| `401` | `Telefon raqam yoki parol noto'g'ri!` | Phone number exists, but the **password is wrong** |
| `422` | *(validation array)* | Body is not JSON / a field is missing (e.g. you sent `username` or form-data) |

> 💡 Since v2.0 the two failure cases are distinguishable:
> **`404` → phone problem**, **`401` → password problem**. A UI can use `404` to suggest
> "Sign up" instead. (Note this also reveals whether a number is registered.)
> See [Troubleshooting](#10-troubleshooting).

**cURL**

```bash
curl -X POST http://127.0.0.1:8000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+998901234567","password":"S3cur3Pass!"}'
```

---

### 4.3 Refresh tokens

Exchanges a valid refresh token for a **new** access token **and** a **new** refresh token.
Use it when the access token has expired (or is about to) instead of sending the user
back to the login screen.

```http
POST /api/v1/users/refresh
Content-Type: application/json
```

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `refresh_token` | string | ✅ | The **latest** refresh token you received |

```json
{ "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

**Response `200`** — same shape as [Register](#41-register). The old refresh token
stops working immediately.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Refresh token yaroqsiz yoki muddati o'tgan!` | Token malformed / expired / not of type `refresh` / already rotated / user logged in elsewhere / user logged out |
| `422` | *(validation array)* | `refresh_token` missing |

On `401` from this endpoint, clear stored tokens and send the user to the login screen.

---

### 4.4 Current user 🔒

Returns the account that owns the access token. Handy for checking on app start
that a stored token is still valid.

```http
GET /api/v1/users/me
Authorization: Bearer <access_token>
```

**Response `200`**

```json
{
  "id": "5b1f7e2a-9c3d-4e21-8a4f-2d6c1f9b7a10",
  "full_name": "Ibrohim Aliyev",
  "phone_number": "+998901234567"
}
```

> The user's `role` is **not** included in this response.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` | `Authorization` header missing, or not in `Bearer <token>` form |
| `401` | `Token yaroqsiz yoki muddati o'tgan!` | Token invalid / expired / is a **refresh** token / user no longer exists |

Both `401` responses include the header `WWW-Authenticate: Bearer`.

---

### 4.5 Logout 🔒

Signs the user out by deleting the server-side refresh-token hash. After this call no
refresh token for this user can be exchanged at [`/refresh`](#43-refresh-tokens)
until the user logs in again.

```http
POST /api/v1/users/logout
Authorization: Bearer <access_token>
```

No request body (anything sent is ignored).

**Response `200`**

```json
{ "detail": "Tizimdan muvaffaqiyatli chiqildi" }
```

> ⚠️ This success response uses the key `detail` (like error responses) and has **no**
> `status` field, unlike register/login/refresh. Decide success by the **HTTP status
> code (`200`)**, not by the presence of `detail`.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` | `Authorization` header missing, or not in `Bearer <token>` form |
| `401` | `Token yaroqsiz yoki muddati o'tgan!` | Access token invalid / expired, or you sent the **refresh** token |
| `405` | `Method Not Allowed` | Called with `GET` instead of `POST` |

**Behavior to know about**

| Topic | What happens |
|---|---|
| Scope | Affects **all devices** of the user — there is one refresh-token hash per user, so logging out on one device also kills the refresh token of every other device |
| Refresh after logout | `POST /users/refresh` → `401` (`Refresh token yaroqsiz yoki muddati o'tgan!`) |
| Access token after logout | Keeps working until it expires — see [Logout and access tokens](#logout-and-access-tokens-important) |
| Repeating the call | Harmless — returns `200` again while the access token is still valid |
| Device token | `device_token` is **not** cleared. Since push is now live, **a logged-out device keeps receiving push notifications** for this account until another login/register sends a new `device_token` |
| Logging in again | Works normally; issues a fresh access/refresh pair |
| Expired access token | `/logout` returns `401` and the refresh token is **not** revoked (it stays valid on the server until it expires). To revoke it, call [`/refresh`](#43-refresh-tokens) first, then `/logout` with the new access token — or accept that a locally deleted token is enough |

**Recommended client flow**

```text
1. POST /api/v1/users/logout   (best effort — ignore network errors / 401;
                                 a 401 here means the refresh token was NOT revoked)
2. Delete access_token and refresh_token from storage
3. Clear in-memory user state and cached notifications
4. Navigate to the login screen
```

Always do steps 2–4 **even if step 1 fails**, so the UI never gets stuck logged in.

**cURL**

```bash
curl -X POST http://127.0.0.1:8000/api/v1/users/logout \
  -H "Authorization: Bearer <access_token>"
```

---

## 5. Notifications API

Base path: `/api/v1/notifications` — every endpoint requires a user's **access
token** and only ever touches **that user's** notifications.

### 5.1 List notifications 🔒

```http
GET /api/v1/notifications
Authorization: Bearer <access_token>
```

**Response `200`** — array of [`Notification`](#notification), **newest first**
(no pagination yet — the full list is returned).

```json
[
  {
    "id": "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
    "message": "To'lovingiz muvaffaqiyatli amalga oshirildi.",
    "is_read": false,
    "sent_at": "2026-09-26T14:02:11.482913+00:00"
  }
]
```

An empty array `[]` means the user has no notifications.

> ℹ️ Each item contains only the `service_id`. **No endpoint currently returns a service's
> `title` or `logo_url`**, so the app can't resolve the sender's name/logo from the API yet.
> (The push notification itself carries the service title.)

**Errors:** `401` (see [Current user](#44-current-user-)).

> ⚠️ Use `/api/v1/notifications` **without** a trailing slash — with one, the server
> answers `307` (redirect) instead of the data.

---

### 5.2 Mark as read 🔒

```http
PATCH /api/v1/notifications/{notification_id}/read
Authorization: Bearer <access_token>
```

| Path param | Type | Notes |
|---|---|---|
| `notification_id` | UUID | Notification `id` from the list |

No request body.

**Response `200`** — the updated [`Notification`](#notification) with `"is_read": true`.
Calling it again on an already-read notification is harmless.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | see above | Missing/invalid access token |
| `404` | `Bildirishnoma topilmadi` | Notification doesn't exist **or belongs to another user** |
| `422` | *(validation array)* | `notification_id` is not a valid UUID |

---

## 6. Services API (OWNER only)

Base path: **`/services`** (not `/api/v1`)

A *service* is a sender identity (e.g. a savings app, an e-commerce app) on whose behalf
notifications are delivered to users. Both endpoints below require:

1. a valid **access token** (`Authorization: Bearer ...`), **and**
2. the caller's role to be **`OWNER`** — otherwise `403`.

> ℹ️ **Flow for a partner backend:** the partner uses an `OWNER` account to log in
> (`/api/v1/users/login`), keeps its tokens fresh via `/refresh`, and calls these endpoints
> with that access token **plus** the service's own `service_id`/`token` pair in the body
> of `messages/send`. The service `token` alone is no longer enough.
>
> These endpoints are **not for end-user apps** — don't ship the service `token` or an
> owner account in a client app.

### 6.1 Register a service 🔒 👑

Creates a service and returns a permanent `token`. **The token is shown only once** —
store it securely.

```http
POST /services/register
Authorization: Bearer <owner_access_token>
Content-Type: multipart/form-data
```

**Form fields**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | ✅ | **3–50** characters, must be unique (e.g. `jamgarma_app`) |
| `title` | string | ✅ | **2–150** characters (display name; also used as the **push notification title**) |
| `about` | string | ❌ | Free text |
| `logo` | file | ❌ | Image file; extension must be `.jpg`, `.jpeg`, `.png` or `.webp` (case-insensitive) |

> The file type is validated **by extension only** (not by content), and the API sets no
> explicit size limit — keep logos small (serverless platforms cap request bodies at a few MB).

**Response `201 Created`**

```json
{
  "status": "success",
  "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
  "token": "srv_token_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"
}
```

If a logo was uploaded, it is saved under a random name and the service's `logo_url` is
stored as a **relative** path such as `/static/3f9c1d7e-....png` (see
[Static files](#63-static-files-logos)). The response does **not** include `logo_url`.

> ⚠️ **Logos on Vercel are not persistent.** On Vercel, uploads are written to `/tmp`,
> which is temporary and per-instance: logo files can disappear after a cold start or
> redeploy, and `/static/...` then returns `404`. For production, store logos in external
> object storage (S3, Firebase Storage, Supabase Storage, …).

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing/invalid access token |
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | Caller is not an `OWNER` |
| `400` | `Bunday nomli servis allaqachon ro'yxatdan o'tgan.` | `name` already taken |
| `400` | `Faqat rasm fayllari (.jpg, .jpeg, .png, .webp) qabul qilinadi.` | Unsupported logo extension |
| `422` | *(validation array)* | `name`/`title` missing or outside length limits, or the request was sent as JSON instead of form data |

**cURL**

```bash
curl -X POST http://127.0.0.1:8000/services/register \
  -H "Authorization: Bearer <owner_access_token>" \
  -F "name=jamgarma_app" \
  -F "title=Jamg'arma Moliya Tashkiloti MCHJ" \
  -F "about=Onlayn jamg'arma xizmati" \
  -F "logo=@./logo.png"
```

---

### 6.2 Send a message 🔒 👑

Stores a notification for the user with the given phone number and, if that user has a
`device_token`, also sends an **FCM push notification**.

```http
POST /services/messages/send
Authorization: Bearer <owner_access_token>
Content-Type: application/json
```

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_id` | UUID | ✅ | From [Register a service](#61-register-a-service--owner) |
| `token` | string | ✅ | That service's token |
| `user_phone` | string | ✅ | Target user's phone — must match their registered value **exactly** |
| `message` | string | ✅ | Notification text |

```json
{
  "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
  "token": "srv_token_a1b2c3d4e5f6...",
  "user_phone": "+998901234567",
  "message": "To'lovingiz muvaffaqiyatli amalga oshirildi."
}
```

**Response `200`**

```json
{
  "status": "success",
  "message": "Xabar yetkazildi",
  "push_sent": true
}
```

| Field | Description |
|---|---|
| `status` | Always `"success"` |
| `message` | Always `"Xabar yetkazildi"` |
| `push_sent` | `true` if Firebase accepted the push. `false` if the user has **no `device_token`**, or FCM failed / isn't configured on the server |

Important:

- The notification is **saved in either case** — `push_sent: false` does **not** mean the
  message wasn't delivered to the in-app list ([List notifications](#51-list-notifications-)).
- Push content: **title** = the service's `title`, **body** = `message`.
- `push_sent` does not report the device actually displaying the push, only that FCM accepted it.
- Server-side, push requires Firebase credentials (Application Default Credentials, e.g. a
  service-account JSON referenced by `GOOGLE_APPLICATION_CREDENTIALS`). Without them,
  `push_sent` is always `false`.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Not authenticated` / `Token yaroqsiz yoki muddati o'tgan!` | Missing/invalid **access token** |
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | Caller is not an `OWNER` |
| `401` | `Yaroqsiz service_id yoki token!` | Wrong `service_id`/`token` pair, or the service is inactive |
| `404` | `Ushbu telefon raqamli foydalanuvchi topilmadi` | No user with that phone number |
| `422` | *(validation array)* | Missing field, or `service_id` isn't a UUID |

> ⚠️ **Two different `401`s.** `Yaroqsiz service_id yoki token!` is about the **service
> credentials**, not the session — do **not** refresh the access token or log the owner out
> because of it. Check the `detail` text before reacting to a `401`
> (the [example client](#11-frontend-integration-example) does).

**cURL**

```bash
curl -X POST http://127.0.0.1:8000/services/messages/send \
  -H "Authorization: Bearer <owner_access_token>" \
  -H "Content-Type: application/json" \
  -d '{"service_id":"<service_id>","token":"<service_token>","user_phone":"+998901234567","message":"Salom!"}'
```

---

### 6.3 Static files (logos)

```http
GET /static/{filename}
```

No authentication. Serves files uploaded via [Register a service](#61-register-a-service--owner).
Because `logo_url` is stored as a **relative** path, prefix it with the Base URL:

```js
const logoSrc = `${BASE_URL}${service.logo_url}`;  // e.g. https://api.example.com/static/3f9c….png
```

| Status | Meaning |
|---|---|
| `200` | File returned with its image content type |
| `404` | File doesn't exist (also happens on Vercel after the temporary storage is cleared) |

---

## 7. Health checks

No authentication required.

```http
GET /
```

```json
{ "project": "Authenticator by iDev", "status": "Working 200 OK" }
```

```http
GET /health
```

```json
{ "status": "ok" }
```

---

## 8. Data models

### TokenResponse

Returned by **register**, **login** and **refresh**.

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"success"` |
| `access_token` | string | JWT, send as `Bearer` token |
| `refresh_token` | string | JWT, send only to `/users/refresh`. **Replace the stored one every time** |
| `token_type` | string | Always `"bearer"` |
| `user` | [`User`](#user) | The authenticated user |

### User

| Field | Type | Description |
|---|---|---|
| `id` | UUID | |
| `full_name` | string | |
| `phone_number` | string | |

(The `role` is intentionally/currently **not** part of this object.)

### Notification

| Field | Type | Description |
|---|---|---|
| `id` | UUID | |
| `service_id` | UUID | The service that sent it |
| `message` | string | |
| `is_read` | boolean | `false` until marked as read |
| `sent_at` | datetime (UTC) | |

### RegisterServiceResponse

| Field | Type | Description |
|---|---|---|
| `status` | string | `"success"` |
| `service_id` | UUID string | |
| `token` | string | Service secret, shown once |

### SendMessageResponse

| Field | Type | Description |
|---|---|---|
| `status` | string | `"success"` |
| `message` | string | `"Xabar yetkazildi"` |
| `push_sent` | boolean | Whether FCM accepted the push |

---

## 9. Errors

### Business errors

Errors raised by the API have this shape (`detail` is a **string**):

```json
{ "detail": "Telefon raqam yoki parol noto'g'ri!" }
```

### Validation errors (`422`)

When the body/params don't match the schema, FastAPI returns `detail` as an
**array** of objects — not a string. Make sure your client handles both shapes:

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "phone_number"],
      "msg": "Field required",
      "input": { "full_name": "A" }
    }
  ]
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created (`POST /services/register`) |
| `307` | You used a URL with a trailing slash — the server is redirecting to the slash-less URL |
| `400` | Business-rule violation (duplicate phone number, duplicate service name, bad logo extension) |
| `401` | Invalid credentials: wrong password, bad/missing access token, bad refresh token, or bad service credentials |
| `403` | Authenticated, but the role is not allowed (`OWNER` required) |
| `404` | Resource not found (unregistered phone on login, unknown notification, unknown user for a message, missing static file, unknown path) |
| `405` | Wrong HTTP method for the path (e.g. `GET /users/logout`) — body: `{"detail":"Method Not Allowed"}` |
| `422` | Request failed schema validation (missing/malformed field, wrong content type) |
| `500` | Server error (e.g. misconfigured environment variables / database) |

### Every error message

| Endpoint | Status | `detail` |
|---|---|---|
| `POST /users/register` | 400 | `Ushbu telefon raqam allaqachon ro'yxatdan o'tgan!` |
| `POST /users/login` | 404 | `Bunday telefon raqam avval ro'yxatdan o'tmagan!` |
| `POST /users/login` | 401 | `Telefon raqam yoki parol noto'g'ri!` |
| `POST /users/refresh` | 401 | `Refresh token yaroqsiz yoki muddati o'tgan!` |
| `POST /users/logout` | 200 | `Tizimdan muvaffaqiyatli chiqildi` *(success — not an error)* |
| 🔒 endpoints | 401 | `Not authenticated` (no/incorrect `Authorization` header) |
| 🔒 endpoints | 401 | `Token yaroqsiz yoki muddati o'tgan!` |
| 👑 endpoints | 403 | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` |
| `PATCH /notifications/{id}/read` | 404 | `Bildirishnoma topilmadi` |
| `POST /services/register` | 400 | `Bunday nomli servis allaqachon ro'yxatdan o'tgan.` |
| `POST /services/register` | 400 | `Faqat rasm fayllari (.jpg, .jpeg, .png, .webp) qabul qilinadi.` |
| `POST /services/messages/send` | 401 | `Yaroqsiz service_id yoki token!` |
| `POST /services/messages/send` | 404 | `Ushbu telefon raqamli foydalanuvchi topilmadi` |

---

## 10. Troubleshooting

**First step: read the HTTP status *and* the `detail` text in the response body.**
They tell you exactly where to look.

### Login problems

| Status | `detail` | Likely cause | Fix |
|---|---|---|---|
| `404` | `Bunday telefon raqam avval ro'yxatdan o'tmagan!` | Number never registered, **or** sent in a different format than at register (`+` missing, spaces, trailing space, `0` prefix, …) | Normalize the phone number identically for register and login; log the exact string you send |
| `404` | same | User was registered on a **different environment** (local DB vs. production DB) | Use the same Base URL for register and login, or register again on the target environment |
| `401` | `Telefon raqam yoki parol noto'g'ri!` | The phone exists but the **password is wrong**, or the input field trimmed/modified it | Compare the raw value; test the same credentials in `/docs` |
| `422` | *(array)* | Body isn't JSON (form-data / `x-www-form-urlencoded`), or you sent `username` instead of `phone_number` | Send JSON with `phone_number` + `password` |
| `307` | – | URL has a trailing slash (`/login/`) | Remove the slash |

### Token problems (🔒 endpoints)

| Status | `detail` | Likely cause | Fix |
|---|---|---|---|
| `401` | `Not authenticated` | No `Authorization` header, or it doesn't start with `Bearer ` | Send `Authorization: Bearer <access_token>` |
| `401` | `Token yaroqsiz yoki muddati o'tgan!` | Sent the **refresh** token instead of the access token | Use `access_token` for API calls |
| `401` | same | Token wrapped in quotes / contains whitespace or newline / was `JSON.stringify`-ed into storage | Store and send the raw string |
| `401` | same | Access token expired (30 days by default) | Call `/users/refresh`, then retry |
| `401` | same | Token was issued by a server with a different `SECRET_KEY` (e.g. local token used against production) | Log in against the same environment you call |
| `401` | `Refresh token yaroqsiz yoki muddati o'tgan!` (`/refresh`) | Refresh token already used (rotated) — often two parallel refresh calls, or the old token was saved | Always save the newest refresh token; serialize refresh calls |
| `401` | same | The user logged in on another device, **or logged out** (either invalidates the refresh token) | Send the user to the login screen |

### Services problems

| Status | `detail` / symptom | Likely cause | Fix |
|---|---|---|---|
| `404` | `Not Found` on `/api/v1/services/register` or `/api/v1/messages/send` | Using the **old v1 paths** | Use `/services/register` and `/services/messages/send` |
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | The logged-in user isn't an `OWNER` | Use an owner account (role is set in the database); don't log the user out |
| `401` | `Yaroqsiz service_id yoki token!` | Wrong `service_id`/`token` pair or inactive service | Re-check the values returned by `/services/register`. This is **not** an expired session |
| `422` | `loc: ["body","name"] … Field required` on register | Request sent as JSON, but this endpoint needs `multipart/form-data` | Send `FormData` / `-F` fields |
| `422` | Upload fails only from your own `fetch` code | You set `Content-Type` manually on a `FormData` body | **Don't** set `Content-Type` — the browser must add the multipart boundary itself |
| `400` | `Faqat rasm fayllari …` | Logo isn't `.jpg/.jpeg/.png/.webp` | Convert the image |
| `200` but `push_sent: false` | – | Target user has no `device_token`, or the server has no Firebase credentials / the token is invalid | Send `device_token` on register/login; check server FCM config |
| `404` on `/static/...` | Logo missing | Vercel's `/tmp` storage was cleared (cold start / redeploy) | Use external object storage for logos |

### Other

| Symptom | Cause |
|---|---|
| `405` on logout | You called `GET /users/logout`; it must be `POST` |
| `500` on register | Password longer than 72 bytes, or phone number longer than 20 characters (database limit) |
| Swagger "Authorize" button fails | The Authorize dialog sends a *form* to `/login`, but this endpoint accepts JSON only. Call `/login` via "Try it out", then paste the `access_token` into the Authorize dialog |

**Quick isolation test** — if this works but your app doesn't, the problem is in the client's request:

```bash
# 1. Register (once)
curl -s -X POST "$BASE/api/v1/users/register" -H "Content-Type: application/json" \
  -d '{"full_name":"Test","phone_number":"+998901234567","password":"S3cur3Pass!"}'

# 2. Login
curl -s -X POST "$BASE/api/v1/users/login" -H "Content-Type: application/json" \
  -d '{"phone_number":"+998901234567","password":"S3cur3Pass!"}'

# 3. Use the access token
curl -s "$BASE/api/v1/users/me" -H "Authorization: Bearer <access_token>"
```

---

## 11. Frontend integration example

A minimal `fetch` wrapper (JavaScript) that attaches the token, refreshes it once when the
**session** is invalid, supports `FormData` uploads, and makes sure only one refresh runs
at a time.

```js
const BASE_URL = "https://<your-vercel-project>.vercel.app";

// Keep the same phone format on register AND login.
export const normalizePhone = (raw) => "+" + raw.replace(/\D/g, "");

const tokens = {
  get access() { return localStorage.getItem("access_token"); },
  get refresh() { return localStorage.getItem("refresh_token"); },
  save(data) {
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token); // always overwrite!
  },
  clear() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  },
};

export async function login(phone, password) {
  const res = await fetch(`${BASE_URL}/api/v1/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: normalizePhone(phone), password }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(typeof data.detail === "string" ? data.detail : "Validation error");
    err.status = res.status; // 404 = number not registered, 401 = wrong password
    throw err;
  }
  tokens.save(data);
  return data.user;
}

export async function logout() {
  try {
    // Best effort: revokes the refresh token on the server (for ALL devices).
    if (tokens.access) {
      await fetch(`${BASE_URL}/api/v1/users/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access}` },
      });
    }
  } catch (_) {
    // Network error: still log out locally.
  } finally {
    // The access token stays valid server-side until it expires,
    // so deleting it locally is what actually ends the session on this device.
    tokens.clear();
  }
}

let refreshing = null; // single in-flight refresh

async function refreshTokens() {
  refreshing ??= fetch(`${BASE_URL}/api/v1/users/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh }),
  })
    .then(async (res) => {
      if (!res.ok) { tokens.clear(); throw new Error("SESSION_EXPIRED"); }
      tokens.save(await res.json());
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// Only these 401s mean "the access token is bad". Other 401s
// (e.g. "Yaroqsiz service_id yoki token!") must NOT trigger a refresh.
const SESSION_401 = ["Not authenticated", "Token yaroqsiz yoki muddati o'tgan!"];

async function isSessionError(res) {
  if (res.status !== 401) return false;
  const body = await res.clone().json().catch(() => null);
  return SESSION_401.includes(body?.detail);
}

export async function api(path, options = {}, retry = true) {
  const headers = { ...options.headers, Authorization: `Bearer ${tokens.access}` };
  // For FormData the browser must set Content-Type (with the multipart boundary) itself.
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (retry && tokens.refresh && (await isSessionError(res))) {
    await refreshTokens();               // throws SESSION_EXPIRED -> go to login screen
    return api(path, options, false);    // retry once with the new token
  }
  return res; // 403 = not allowed (don't log out), other 401s are handled by the caller
}

// ---- Usage -------------------------------------------------------------
// const me   = await (await api("/api/v1/users/me")).json();
// const list = await (await api("/api/v1/notifications")).json();
// await api(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
// await logout();  // then navigate to the login screen

// ---- OWNER-only calls --------------------------------------------------
// Register a service (multipart, optional logo):
// const form = new FormData();
// form.append("name", "jamgarma_app");
// form.append("title", "Jamg'arma Moliya Tashkiloti MCHJ");
// form.append("about", "Onlayn jamg'arma xizmati");
// form.append("logo", fileInput.files[0]);               // optional
// const res = await api("/services/register", { method: "POST", body: form });
// if (res.status === 403) { /* current user is not an OWNER */ }
// const { service_id, token } = await res.json();        // 201 — save the token now!
//
// Send a message (+ push):
// const res = await api("/services/messages/send", {
//   method: "POST",
//   body: JSON.stringify({ service_id, token, user_phone: normalizePhone("90 123 45 67"), message: "Salom!" }),
// });
// const { push_sent } = await res.json();
```

> On mobile, store tokens in the platform's secure storage (Keychain / Keystore)
> rather than plain `localStorage` / `SharedPreferences`.