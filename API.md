# Authenticator API Reference

Phone-number authentication service (JWT access + refresh tokens) with a
notification API: partner "services" can push messages to users, and owners
can broadcast to everyone. Push delivery goes through Firebase Cloud
Messaging (FCM).

> **Version:** v1 · **Verified against source:** 2026-10-14
> Every path, field, status code and error string below was checked against
> the code in `main.py`, `routers/*`, `schemas.py`, `models.py`, `deps.py`,
> `security.py` and `services/*`. Anything that does **not** behave the way
> you would expect is called out in a **Caveat** box and collected in
> [Known issues](#13-known-issues).

---

## Contents

1. [Overview](#1-overview)
2. [Endpoint summary](#2-endpoint-summary)
3. [Authentication & authorization](#3-authentication--authorization)
4. [Users](#4-users)
5. [Notifications](#5-notifications)
6. [Services (owner only)](#6-services-owner-only)
7. [Static files](#7-static-files)
8. [Health checks](#8-health-checks)
9. [Data models](#9-data-models)
10. [Errors](#10-errors)
11. [Push notifications (FCM)](#11-push-notifications-fcm)
12. [Client integration guide](#12-client-integration-guide)
13. [Known issues](#13-known-issues)
14. [Configuration](#14-configuration)

---

## 1. Overview

| | |
|---|---|
| **Base URL (local)** | `http://127.0.0.1:8000` |
| **Base URL (production)** | `https://<your-vercel-project>.vercel.app` |
| **Interactive docs** | `GET /docs` (Swagger UI), `GET /redoc`, `GET /openapi.json` |
| **Content type** | `application/json`, except [`POST /services/register`](#61-register-a-service) which is `multipart/form-data` |
| **Timestamps** | ISO 8601 with timezone, always UTC (e.g. `2026-10-14T09:30:11.482913+00:00`) |
| **IDs** | UUID v4 strings |
| **CORS** | Controlled by `CORS_ORIGINS` (default `*`), credentials allowed, all methods and headers |
| **Pagination / rate limiting** | None |

Legend used below: **Auth: Bearer** means the request needs
`Authorization: Bearer <access_token>`.

> **Caveat – URL prefixes are not uniform.** Users and notifications live
> under `/api/v1/...`, but the services endpoints are mounted at
> `/services/...` (no `/api/v1`). Use the paths exactly as listed here.

---

## 2. Endpoint summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/users/register` | none | Create account, returns tokens |
| `POST` | `/api/v1/users/login` | none | Log in, returns tokens |
| `POST` | `/api/v1/users/refresh` | refresh token in body | Rotate token pair |
| `POST` | `/api/v1/users/logout` | Bearer | Invalidate refresh token |
| `GET` | `/api/v1/users/me` | Bearer | Current user |
| `GET` | `/api/v1/notifications` | Bearer | List my notifications |
| `PATCH` | `/api/v1/notifications/{notification_id}/read` | Bearer | Mark one notification read |
| `POST` | `/services/register` | Bearer, role `owner` | Create a service (+ optional logo) |
| `GET` | `/services/get` | Bearer, role `owner` | List all services |
| `POST` | `/services/messages/send` | Bearer, role `owner` + service token | Send a message to one user |
| `POST` | `/services/broadcast` | Bearer, role `owner` | Push to every user — **currently broken, see [6.4](#64-broadcast-to-all-users)** |
| `GET` | `/static/{filename}` | none | Uploaded service logos |
| `GET` | `/` | none | Welcome / status |
| `GET` | `/health` | none | Health check |

---

## 3. Authentication & authorization

### 3.1 Credentials

| Credential | Held by | Sent as |
|---|---|---|
| **Access token** (JWT) | Every logged-in client | `Authorization: Bearer <access_token>` |
| **Refresh token** (JWT) | Every logged-in client | JSON body of `POST /api/v1/users/refresh` only |
| **Service token** (`srv_token_…`) | Whoever operates a registered service | `token` field in the body of `POST /services/messages/send` |

Register, login and refresh all return an access **and** a refresh token.

### 3.2 Token details

| | Access token | Refresh token |
|---|---|---|
| Algorithm | HS256 (configurable via `ALGORITHM`) | same |
| Lifetime | `ACCESS_TOKEN_EXPIRE_DAYS`, default **30 days** | `REFRESH_TOKEN_EXPIRE_DAYS`, default **60 days** |
| `type` claim | `"access"` | `"refresh"` |
| Other claims | `sub` (user id), `phone_number`, `exp` | `sub` (user id), `exp` |
| Accepted by | every Bearer-protected endpoint | `/refresh` only |

The `type` claim is enforced: a refresh token sent as a Bearer token is
rejected with `401`, and an access token sent to `/refresh` is rejected with
`401`.

### 3.3 Refresh-token rotation

The server stores a SHA-256 hash of **one** refresh token per user. Every
call to register, login or refresh overwrites it. Consequences:

- After `/refresh`, the previous refresh token is dead immediately. Replaying
  it returns `401`.
- **Only one session per user.** Logging in on a second device issues a new
  refresh token and silently invalidates the first device's refresh token.
  The first device keeps working until its access token expires, then fails
  to refresh.
- Two parallel `/refresh` calls with the same token will race: one wins, the
  other gets `401`. Clients must serialise refreshes (see
  [12.2](#122-token-handling-with-automatic-refresh)).
- `POST /logout` clears the stored hash, so the refresh token stops working.
  It does **not** revoke the access token, which stays valid until it
  expires (see [Known issues](#13-known-issues)).

### 3.4 Roles

| Role | Value in responses | How to get it |
|---|---|---|
| User | `"user"` | Default for every new registration |
| Owner | `"owner"` | Set directly in the database; there is no endpoint to change roles |

Promoting a user (check the enum labels in your DB first, since SQLAlchemy
stores enum *names* by default):

```sql
SELECT unnest(enum_range(NULL::userrole));          -- see which labels exist
UPDATE users SET role = 'OWNER' WHERE phone_number = '+998901234567';
```

The code also references an `ADMIN` role in one place, but the role enum
only defines `OWNER` and `USER` (see [6.4](#64-broadcast-to-all-users)).

### 3.5 Missing or invalid Bearer token

| Situation | Status | Body |
|---|---|---|
| No `Authorization` header | `401` | `{"detail": "Not authenticated"}` |
| Malformed, expired, wrong signature, wrong `type`, or user no longer exists | `401` | `{"detail": "Token yaroqsiz yoki muddati o'tgan!"}` plus header `WWW-Authenticate: Bearer` |

> **Note on Swagger UI:** the "Authorize" button in `/docs` posts a
> form-encoded `username`/`password` to `/api/v1/users/login`, but that
> endpoint takes JSON with `phone_number`. Authorizing through the dialog
> will not work. Log in via the endpoint, then paste the `access_token` into
> the dialog's token field, or send the header yourself.

---

## 4. Users

Base path: `/api/v1/users`

### 4.1 Register

Creates the account immediately and returns tokens. There is no OTP, SMS or
confirmation step.

```
POST /api/v1/users/register
```

**Body (JSON)**

| Field | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | yes | Max 250 characters in the database |
| `phone_number` | string | yes | Unique; max 20 characters in the database. **No format validation**, so keep the format consistent (e.g. E.164 `+998901234567`) because lookups are exact string matches |
| `password` | string | yes | Hashed with bcrypt. No length or strength rules are enforced |
| `device_token` | string | no | FCM registration token for push notifications |

```json
{
  "full_name": "Ibrohim Aliyev",
  "phone_number": "+998901234567",
  "password": "S3cur3Pass!",
  "device_token": "fcm-device-token-from-the-app"
}
```

**Response `200`** ([`TokenResponse`](#token-response))

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

> Note that it returns `200`, not `201`.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `400` | `Ushbu telefon raqam allaqachon ro'yxatdan o'tgan!` | Phone number already registered |
| `422` | validation array | Missing or wrong-typed field |

```bash
curl -X POST "$BASE/api/v1/users/register" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Ibrohim Aliyev","phone_number":"+998901234567","password":"S3cur3Pass!"}'
```

---

### 4.2 Login

```
POST /api/v1/users/login
```

**Body (JSON)**

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone_number` | string | yes | |
| `password` | string | yes | |
| `device_token` | string | no | If provided and non-empty, **replaces** the stored device token |

```json
{ "phone_number": "+998901234567", "password": "S3cur3Pass!" }
```

**Response `200`**: same shape as [Register](#41-register). A new token pair
is issued and replaces the user's previous refresh token (see
[3.3](#33-refresh-token-rotation)).

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `404` | `Bunday telefon raqam avval ro'yxatdan o'tmagan!` | No account with this phone number |
| `401` | `Telefon raqam yoki parol noto'g'ri!` | Wrong password |
| `422` | validation array | Missing or wrong-typed field |

> **Caveat:** because unknown numbers return `404` and wrong passwords return
> `401`, the endpoint reveals which phone numbers are registered.
> `User.is_active` is stored but **not checked** at login.

```bash
curl -X POST "$BASE/api/v1/users/login" \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+998901234567","password":"S3cur3Pass!","device_token":"fcm-..."}'
```

---

### 4.3 Refresh

Exchanges a valid, not-yet-superseded refresh token for a new access +
refresh pair. The old refresh token stops working immediately.

```
POST /api/v1/users/refresh
```

**Body (JSON)**

| Field | Type | Required |
|---|---|---|
| `refresh_token` | string | yes |

```json
{ "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

**Response `200`**: same shape as [Register](#41-register).

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `401` | `Refresh token yaroqsiz yoki muddati o'tgan!` | Bad signature, expired, not of type `refresh`, no/invalid `sub`, user not found, user logged out, or token already rotated |
| `422` | validation array | `refresh_token` missing |

```bash
curl -X POST "$BASE/api/v1/users/refresh" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"eyJ..."}'
```

---

### 4.4 Logout

Clears the stored refresh-token hash so the current refresh token can no
longer be used.

```
POST /api/v1/users/logout
```

**Auth: Bearer**. No body.

**Response `200`**

```json
{ "detail": "Tizimdan muvaffaqiyatli chiqildi" }
```

**Errors:** `401` (see [3.5](#35-missing-or-invalid-bearer-token)).

> **Caveat:** logout does **not** invalidate the access token (it stays valid
> until `exp`) and does **not** clear `device_token`, so the device keeps
> receiving push notifications for that account after logout. The client
> should discard both tokens locally.

```bash
curl -X POST "$BASE/api/v1/users/logout" -H "Authorization: Bearer $ACCESS"
```

---

### 4.5 Current user

```
GET /api/v1/users/me
```

**Auth: Bearer**

**Response `200`** ([`User`](#user))

```json
{
  "id": "5b1f7e2a-9c3d-4e21-8a4f-2d6c1f9b7a10",
  "full_name": "Ibrohim Aliyev",
  "phone_number": "+998901234567",
  "role": "user"
}
```

**Errors:** `401`. Useful for checking on app start whether a stored access
token is still valid.

```bash
curl "$BASE/api/v1/users/me" -H "Authorization: Bearer $ACCESS"
```

---

## 5. Notifications

Base path: `/api/v1/notifications`. All endpoints need a Bearer token and
only ever touch the caller's own notifications.

Notifications are created by [`POST /services/messages/send`](#62-send-a-message).
Broadcasts are **not** stored (see [6.4](#64-broadcast-to-all-users)).

### 5.1 List notifications

```
GET /api/v1/notifications
```

**Auth: Bearer**

**Response `200`**: array of [`Notification`](#notification), newest first
(`sent_at` descending). The whole list is returned; there is no pagination
or filtering. An empty array means no notifications.

```json
[
  {
    "id": "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
    "message": "To'lovingiz muvaffaqiyatli amalga oshirildi.",
    "is_read": false,
    "sent_at": "2026-10-14T09:30:11.482913+00:00"
  }
]
```

> **Caveat:** a notification only carries `service_id`. Regular users have no
> endpoint to look up a service's name or logo (`GET /services/get` is
> owner-only). Either ship the service list with the app, or add a public
> lookup endpoint.

```bash
curl "$BASE/api/v1/notifications" -H "Authorization: Bearer $ACCESS"
```

---

### 5.2 Mark as read

```
PATCH /api/v1/notifications/{notification_id}/read
```

**Auth: Bearer**

| Path parameter | Type | Notes |
|---|---|---|
| `notification_id` | UUID | A non-UUID value returns `422` |

**Response `200`**: the updated [`Notification`](#notification) with
`"is_read": true`. The call is idempotent.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `404` | `Bildirishnoma topilmadi` | Doesn't exist, or belongs to another user |
| `401` | see [3.5](#35-missing-or-invalid-bearer-token) | |
| `422` | validation array | `notification_id` is not a UUID |

There is no "mark all as read" and no delete endpoint.

```bash
curl -X PATCH "$BASE/api/v1/notifications/$NOTIF_ID/read" \
  -H "Authorization: Bearer $ACCESS"
```

---

## 6. Services (owner only)

Base path: `/services`

A **service** is an external app (a savings app, a shop, etc.) on whose
behalf messages are delivered to users. Every endpoint in this section
requires a Bearer token belonging to a user with role `owner`; other roles get
`403`.

> **Caveat – the service token is not a standalone credential.** Sending a
> message needs an **owner's access token** *and* the matching
> `service_id` + `token` in the body. A partner backend that only holds a
> service token cannot call the API on its own; it would have to hold an
> owner login too. See [Known issues](#13-known-issues).

### 6.1 Register a service

Creates a service, optionally with a logo, and returns its token.

```
POST /services/register
Content-Type: multipart/form-data
```

**Auth: Bearer, role `owner`**

**Form fields**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | string | yes | 3–50 chars, **unique**, e.g. `jamgarma_app` |
| `title` | string | yes | 2–150 chars. Shown as the push notification title |
| `about` | string | no | Free text |
| `logo` | file | no | Extension must be `.jpg`, `.jpeg`, `.png` or `.webp` (checked by filename only). No size limit |

**Response `201`**

```json
{
  "status": "success",
  "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
  "token": "srv_token_3f9a1c7e5b2d8f40a6c1e9b7d3f5a2c8e4b6d0f1a9c7e5b3"
}
```

The token is `srv_token_` followed by 48 hex characters. The logo is stored
on the server and `logo_url` is set to `/static/<uuid>.<ext>` (see
[Static files](#7-static-files)); the response does not echo `logo_url`, use
[`GET /services/get`](#63-list-services) to read it.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | Caller is not `owner` |
| `400` | `Bunday nomli servis allaqachon ro'yxatdan o'tgan.` | `name` already taken |
| `400` | `Faqat rasm fayllari (.jpg, .jpeg, .png, .webp) qabul qilinadi.` | Disallowed logo extension |
| `422` | validation array | Missing field, or length constraint violated |
| `401` | see [3.5](#35-missing-or-invalid-bearer-token) | |

```bash
curl -X POST "$BASE/services/register" \
  -H "Authorization: Bearer $ACCESS" \
  -F name=jamgarma_app \
  -F title="Jamg'arma Moliya Tashkiloti MCHJ" \
  -F about="Onlayn jamg'arma xizmati" \
  -F logo=@./logo.png
```

---

### 6.2 Send a message

Stores a notification for one user (identified by phone number) on behalf of
an active service, then tries to deliver it as a push notification.

```
POST /services/messages/send
```

**Auth: Bearer, role `owner`**

**Body (JSON)**

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_id` | UUID | yes | From [Register a service](#61-register-a-service) |
| `token` | string | yes | That service's token |
| `user_phone` | string | yes | Recipient's phone number, exact match |
| `message` | string | yes | Stored as text; used as the push body |

```json
{
  "service_id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
  "token": "srv_token_3f9a1c7e5b2d8f40a6c1e9b7d3f5a2c8e4b6d0f1a9c7e5b3",
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

| Field | Meaning |
|---|---|
| `status` | Always `"success"` |
| `message` | Always `"Xabar yetkazildi"` ("message delivered"). This only means the notification was **saved**; check `push_sent` for the push |
| `push_sent` | `true` if FCM accepted the push. `false` if the user has no `device_token` **or** FCM failed. In both cases the notification is still saved and visible in [`GET /api/v1/notifications`](#51-list-notifications) |

The push uses the service's `title` as its title and `message` as its body.
The request waits for FCM to answer before returning.

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `403` | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | Caller is not `owner` |
| `401` | `Yaroqsiz service_id yoki token!` | Unknown `service_id`, wrong `token`, or service is inactive |
| `404` | `Ushbu telefon raqamli foydalanuvchi topilmadi` | No user with that phone number |
| `422` | validation array | Missing field, or `service_id` is not a UUID |

> This `401` is about the *service* credentials, so don't treat it as "access
> token expired" and trigger a refresh loop; check the `detail` text, or just
> don't auto-refresh on this endpoint.

```bash
curl -X POST "$BASE/services/messages/send" \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"service_id":"8f2a...","token":"srv_token_...","user_phone":"+998901234567","message":"Salom!"}'
```

---

### 6.3 List services

```
GET /services/get
```

**Auth: Bearer, role `owner`**

**Response `200`**: array of [`Service`](#service)

```json
[
  {
    "id": "8f2a1c3d-4b5e-4f6a-9d7c-1e2b3a4c5d6e",
    "name": "jamgarma_app",
    "title": "Jamg'arma Moliya Tashkiloti MCHJ",
    "logo_url": "/static/0b6f2d9e-7a41-4c1d-9a55-3f0c8e1b2a77.png",
    "about": "Onlayn jamg'arma xizmati",
    "token": "srv_token_3f9a1c7e5b2d8f40a6c1e9b7d3f5a2c8e4b6d0f1a9c7e5b3"
  }
]
```

**Errors**

| Status | `detail` | Cause |
|---|---|---|
| `403` | `Ushbu amalni bajarishda sizda yetarlicha huquq yo'q!` | Caller is not `owner` |
| `404` | `Sizda hali Servicelar mavjud emas` | **There are no services at all.** Clients must treat this `404` as an empty list |
| `401` | see [3.5](#35-missing-or-invalid-bearer-token) | |

> **Caveats:** this returns **every** service in the system (services are not
> linked to the owner who created them), and it returns each service's
> secret `token` in plaintext every time. Anything that logs responses or
> caches this endpoint is holding live credentials.

```bash
curl "$BASE/services/get" -H "Authorization: Bearer $ACCESS"
```

---

### 6.4 Broadcast to all users

Intended behaviour: queue a push notification to every user who has a
device token, and return immediately.

```
POST /services/broadcast
```

**Auth: Bearer, role `owner`** (the code intends `admin` or `owner`)

**Body (JSON)**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `title` | string | yes | max 150 characters |
| `message` | string | yes | max 1000 characters |

```json
{ "title": "Texnik ishlar", "message": "Bugun 23:00 da xizmat 10 daqiqaga to'xtaydi." }
```

**Intended response `200`**

```json
{
  "status": "success",
  "message": "Ommaviy xabar fonda yuborish uchun navbatga qo'shildi."
}
```

**Intended error:** `403` with
`Ommaviy xabar yuborish uchun faqat Admin yoki Owner huquqi kerak.`, plus
`401` and `422` as usual.

> ### Caveat – currently returns `500` for every authenticated call
> The role check is `current_user.role not in [UserRole.ADMIN, UserRole.OWNER]`,
> but `UserRole` only defines `OWNER` and `USER`. Evaluating `UserRole.ADMIN`
> raises `AttributeError`, so any request that gets past authentication fails
> with `500 Internal Server Error`. Fix either way:
> - Only owners should broadcast: use `[UserRole.OWNER]`, or
> - add `ADMIN = "admin"` to `UserRole` **and** a migration for the enum
>   (this also resolves the `.TODO` note about admin users).

**How it works once fixed** (from `services/background.py`):

- The request returns immediately; delivery happens in a background task.
- The task selects every user whose `device_token` is non-null and non-empty
  and sends one FCM push per device, **sequentially**.
- Failures are only printed to the server log. There is no per-device result
  and no response field reporting how many were sent.
- Broadcasts are **not** saved to the `notifications` table, so they will not
  appear in `GET /api/v1/notifications`.
- On Vercel (serverless), work scheduled after the response may be cut off
  when the function freezes, and the function has a 30 s `maxDuration`
  (`vercel.json`). Large user bases may not be fully reached. For anything
  beyond a small audience, use FCM topics or a proper queue.

```bash
curl -X POST "$BASE/services/broadcast" \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"title":"Texnik ishlar","message":"Bugun 23:00 da xizmat 10 daqiqaga to'\''xtaydi."}'
```

---

## 7. Static files

```
GET /static/{filename}
```

Public, no auth. Serves files from the upload directory, which is how
service logos are exposed: `logo_url` values look like
`/static/<uuid>.<ext>`, and are **relative**, so prepend the base URL:
`https://<host>/static/0b6f2d9e-....png`.

| Environment | Upload directory |
|---|---|
| Local | `./uploads` (created on startup) |
| Vercel (`VERCEL` env var set) | the system temp dir (`/tmp`) |

> **Caveat:** on Vercel `/tmp` is ephemeral and per-instance. Uploaded logos
> disappear on cold starts and redeploys and may not be visible from other
> instances, which leaves `logo_url` pointing at a `404`. For production,
> store logos in object storage (e.g. Supabase Storage, which this project
> already depends on for Postgres) and save the full public URL.

---

## 8. Health checks

```
GET /
```

```json
{ "project": "Authenticator by iDev", "status": "Working 200 OK" }
```

```
GET /health
```

```json
{ "status": "ok" }
```

Both are public and return `200`.

---

## 9. Data models

### User

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `full_name` | string | |
| `phone_number` | string | Unique |
| `role` | string | `"user"` or `"owner"` |

(Stored but never returned: `hashed_password`, `device_token`,
`refresh_token_hash`, `is_active`, `created_at`.)

### Token response

Returned by register, login and refresh.

| Field | Type | Notes |
|---|---|---|
| `status` | string | Always `"success"` |
| `access_token` | string | JWT |
| `refresh_token` | string | JWT |
| `token_type` | string | Always `"bearer"` |
| `user` | [`User`](#user) | |

### Notification

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `service_id` | UUID | The service that sent it |
| `message` | string | |
| `is_read` | boolean | Starts `false` |
| `sent_at` | datetime | UTC |

### Service

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | Unique, 3–50 chars at registration |
| `title` | string | 2–150 chars at registration |
| `logo_url` | string \| null | Relative path, e.g. `/static/<uuid>.png` |
| `about` | string \| null | |
| `token` | string | `srv_token_` + 48 hex chars |

(Stored but never returned: `is_active`, `created_at`. There is no endpoint
to deactivate a service.)

---

## 10. Errors

### 10.1 Format

Every error is FastAPI's default shape. `detail` is a string for business and
auth errors:

```json
{ "detail": "Telefon raqam yoki parol noto'g'ri!" }
```

For `422` it is an array, one entry per invalid field:

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "phone_number"],
      "msg": "Field required",
      "input": { "full_name": "Ibrohim Aliyev", "password": "S3cur3Pass!" }
    }
  ]
}
```

> **Don't switch on `detail` text.** Most messages are in Uzbek, a few
> (`Not authenticated`, `422` messages) are in English, and the wording may
> change. Branch on the HTTP status, and show or log `detail` for humans.

### 10.2 Status codes

| Code | Meaning in this API |
|---|---|
| `200` | Success (including register) |
| `201` | Service created |
| `400` | Duplicate phone number, duplicate service name, or disallowed logo type |
| `401` | Bad/missing access token, bad refresh token, wrong password, or invalid service credentials |
| `403` | Authenticated, but not an `owner` |
| `404` | Unknown phone number (login), unknown recipient, notification not found, or no services exist |
| `422` | Request failed schema validation |
| `500` | Unhandled server error (e.g. [broadcast](#64-broadcast-to-all-users) today) |

### 10.3 Every `detail` string

| Status | `detail` | Endpoint(s) |
|---|---|---|
| 400 | `Ushbu telefon raqam allaqachon ro'yxatdan o'tgan!` | register |
| 404 | `Bunday telefon raqam avval ro'yxatdan o'tmagan!` | login |
| 401 | `Telefon raqam yoki parol noto'g'ri!` | login |
| 401 | `Refresh token yaroqsiz yoki muddati o'tgan!` | refresh |
| 401 | `Token yaroqsiz yoki muddati o'tgan!` | all Bearer endpoints |
| 401 | `Not authenticated` | all Bearer endpoints (header missing) |
| 404 | `Bildirishnoma topilmadi` | mark read |
| 403 | `Ushbu amalni bajarish uchun sizda yetarli huquq yo'q.` | services/register, services/messages/send |
| 403 | `Ushbu amalni bajarishda sizda yetarlicha huquq yo'q!` | services/get |
| 403 | `Ommaviy xabar yuborish uchun faqat Admin yoki Owner huquqi kerak.` | services/broadcast (unreachable today) |
| 400 | `Bunday nomli servis allaqachon ro'yxatdan o'tgan.` | services/register |
| 400 | `Faqat rasm fayllari (.jpg, .jpeg, .png, .webp) qabul qilinadi.` | services/register |
| 401 | `Yaroqsiz service_id yoki token!` | services/messages/send |
| 404 | `Ushbu telefon raqamli foydalanuvchi topilmadi` | services/messages/send |
| 404 | `Sizda hali Servicelar mavjud emas` | services/get |

---

## 11. Push notifications (FCM)

- Delivery uses the Firebase Admin SDK. Pushes are sent as high-priority
  messages with the default sound; for iOS the APNs priority is `10` and
  `content_available` is set.
- A user receives pushes only if their `device_token` is set. Tokens are
  saved by **register** and **login** (login only overwrites when a
  non-empty token is sent). There is no endpoint to update the token
  without logging in again.
- **Re-send `device_token` on every login**, and log in again (or add an
  endpoint) when FCM rotates the token, otherwise pushes go to a dead token.
- Each user has **one** device token, so a second device overwrites the
  first.
- Invalid or expired device tokens are not cleaned up; FCM errors only
  produce `push_sent: false` (single message) or a log line (broadcast).
- The server needs Firebase credentials at startup. `services/fcm.py` calls
  `firebase_admin.initialize_app()` with no arguments, which uses Google
  Application Default Credentials (typically the `GOOGLE_APPLICATION_CREDENTIALS`
  environment variable pointing to a service-account JSON). If they are
  missing, the app fails to import. This variable is not in `.env.example`.

---

## 12. Client integration guide

### 12.1 Typical flow

```
 App start
   ├─ no stored tokens ─────────────▶ Register / Login ──▶ store both tokens
   └─ tokens stored ────▶ GET /me
                            ├─ 200 ─▶ continue
                            └─ 401 ─▶ POST /refresh
                                        ├─ 200 ─▶ store NEW pair, retry
                                        └─ 401 ─▶ clear tokens, show Login

 Normal use    : GET /notifications, PATCH /notifications/{id}/read
 Sign out      : POST /logout, then delete both tokens locally
```

Always **replace both tokens** after `/refresh`; the old refresh token no
longer works.

### 12.2 Token handling with automatic refresh

Serialise refreshes so concurrent requests don't burn the rotated token:

```js
const BASE = "https://<your-project>.vercel.app";
let tokens = JSON.parse(localStorage.getItem("tokens") || "null"); // {access_token, refresh_token}
let refreshInFlight = null;

function saveTokens(t) {
  tokens = t;
  localStorage.setItem("tokens", JSON.stringify(t));
}

async function refreshTokens() {
  const res = await fetch(`${BASE}/api/v1/users/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
  return true;
}

export async function api(path, options = {}) {
  const send = () =>
    fetch(BASE + path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${tokens.access_token}` },
    });

  let res = await send();
  if (res.status === 401) {
    // one shared refresh for all requests that failed at the same time
    refreshInFlight ??= refreshTokens().finally(() => { refreshInFlight = null; });
    if (await refreshInFlight) res = await send();
    else { localStorage.removeItem("tokens"); tokens = null; /* redirect to login */ }
  }
  return res;
}
```

Use it for Bearer endpoints, not for `/login` or `/register`. For
`POST /services/messages/send`, remember that a `401` can mean bad service
credentials instead of an expired access token.

### 12.3 Smoke test from the command line

```bash
BASE=http://127.0.0.1:8000

# register (or login) and capture the tokens
RESP=$(curl -s -X POST $BASE/api/v1/users/register -H "Content-Type: application/json" \
  -d '{"full_name":"Test User","phone_number":"+998900000001","password":"Passw0rd!"}')
ACCESS=$(echo "$RESP"  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
REFRESH=$(echo "$RESP" | python -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])")

curl -s $BASE/api/v1/users/me -H "Authorization: Bearer $ACCESS"
curl -s -X POST $BASE/api/v1/users/refresh -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"
curl -s $BASE/api/v1/notifications -H "Authorization: Bearer $ACCESS"
```

---

## 13. Known issues

Ordered roughly by impact. None of these are documentation errors; they are
properties of the current code.

| # | Issue | Impact | Suggested fix |
|---|---|---|---|
| 1 | `POST /services/broadcast` references `UserRole.ADMIN`, which doesn't exist | Always `500` after auth | Use `[UserRole.OWNER]` or add `ADMIN` to the enum + migration |
| 2 | Sending a message needs an **owner JWT** *and* the service token | Partner backends can't integrate with only a service token | Authenticate `messages/send` by service token alone (e.g. `X-Service-Token` header) and drop the owner requirement |
| 3 | `GET /services/get` returns every service's plaintext `token`, to any owner | Credential exposure; no ownership scoping | Return the token only at creation, store it hashed, link services to their owner |
| 4 | Logout doesn't revoke the access token (30-day default lifetime) | A stolen access token stays valid for weeks | Shorten `ACCESS_TOKEN_EXPIRE_DAYS` (e.g. 15–60 min) now that refresh exists |
| 5 | Logout keeps `device_token` | Pushes continue to a logged-out device | Null `device_token` in `/logout` |
| 6 | One refresh-token hash per user | Logging in on a new device logs out the old one | Store sessions in a separate table if multi-device is needed |
| 7 | `User.is_active` and `Service.is_active` have no admin endpoints; `User.is_active` is never enforced | Can't disable a user; deactivating a service needs SQL | Check `is_active` in login and `get_current_user`; add toggle endpoints |
| 8 | Login returns `404` vs `401` | Phone-number enumeration | Return one generic `401` for both cases |
| 9 | No phone or password validation | Inconsistent phone formats create duplicate-looking accounts; weak passwords | Add `pattern`/`min_length` constraints in `RegisterSchema`, normalise numbers |
| 10 | Logos are written to local disk / `/tmp` | Lost on Vercel cold start/redeploy | Use object storage and store the full URL |
| 11 | Broadcast is sequential, unstored, and runs after the response | Truncated on serverless, no delivery report, no in-app history | FCM topic or queue; optionally also insert `Notification` rows |
| 12 | Users can't resolve `service_id` to a name/logo | Notification list can't show who sent it | Add an authenticated read-only `GET /api/v1/services` |
| 13 | `/docs` Authorize dialog posts form data but login takes JSON | Swagger "Authorize" doesn't work | Add a form-based `/token` endpoint, or accept both |
| 14 | Mixed prefixes: `/api/v1/...` vs `/services/...` | Easy to call the wrong path | Mount the services router under `/api/v1/services` (breaking change) |
| 15 | Migrations disagree on the `userrole` enum (initial migration creates `admin`/`user`/`moderator`; the next one adds the `role` column again as `OWNER`/`USER`) | `alembic upgrade head` on a fresh DB may fail or leave unexpected labels | Verify the DB with `enum_range(NULL::userrole)` and reconcile into one clean migration |

---

## 14. Configuration

Read by `config.py` from environment variables (a local `.env` in
development, Vercel project settings in production). Copy `.env.example` to
`.env` to start.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | | SQLAlchemy async URL, e.g. `postgresql+asyncpg://USER:PASSWORD@HOST:6543/postgres` (Supabase pooler) |
| `SECRET_KEY` | yes | | JWT signing key. Generate with `openssl rand -hex 32` |
| `ALGORITHM` | no | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_DAYS` | no | `30` | Access token lifetime in **days** |
| `REFRESH_TOKEN_EXPIRE_DAYS` | no | `60` | Refresh token lifetime in **days** |
| `CORS_ORIGINS` | no | `*` | Comma-separated origins, or `*` |
| `DEBUG` | no | `false` | Enables SQLAlchemy SQL echo |
| `GOOGLE_APPLICATION_CREDENTIALS` | yes, for FCM | | Path to a Firebase service-account JSON (see [11](#11-push-notifications-fcm)). Not in `.env.example` |
| `VERCEL` | auto | | Set by Vercel; switches the upload directory to `/tmp` |

Run locally:

```bash
pip install -r requirements.txt
cp .env.example .env            # fill in real values
alembic upgrade head            # create/update tables
uvicorn main:app --reload
```

`GET /health` should return `{"status": "ok"}` once the app is up.