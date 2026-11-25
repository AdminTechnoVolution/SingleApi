# Kultura API contract (SingleApi, branch `feature/kultura-backend`)

This file is the source of truth for the iOS (Kultura) agents. Everything listed here is **additive**. A request that does not use the new fields gets exactly the old behaviour, which is how the Android app keeps working without changes.

All responses use the existing envelope:

```json
{ "success": true, "messages": ["SUCCESS"], "data": { } }
```

Errors return `success: false` and an error code in `messages[0]`, for example `{"success":false,"messages":["ERROR_NEXT_LEVEL_NOT_ELIGIBLE"],"data":null}`.

## 0. Headers the iOS app must send

| Header | Value | Effect |
|---|---|---|
| `Authorization` | `Bearer <token>` | as today |
| `X-App-Platform` | `ios` | Discover, likes, quick messages and rooms default to `intent=language_exchange` when no intent is sent. Version policy uses the `IOS_*` configs. |
| `X-App-Version` | integer build number (`CFBundleVersion`) | version policy, stored in `clientInfo` |

The `platform` body field of `POST /api/login` and `/api/login/refresh` uses the enum `"iOS"` / `"Android"`, which is a different spelling from the header.

## 1. Concepts and enums

* **Intent** (`preferences.intents[]`, `intent` on likes, connections and rooms): `friends` | `language_exchange` | `dating`.
  * No intents means a **legacy** user or client, which is treated as dating (Single).
  * `dating` is only ever enabled from Settings ("Open to something more"). It is never the default.
* **openToDating** (`profileConfig.openToDating`, default `false`) is the "Open to something more" toggle. It unlocks dating rooms, the dating feed and Next level.
* **Connection** = a match. `chatId === matchId`, as today.

## 2. Master data: interests

### `GET /api/master/interest` (public)

There are 32 conversation topics, localized in en/es/fr/pt/it/de. The shape is the same as the other master endpoints (`/api/master/language`, `/api/master/looking-for`). The seed lives in `scripts/data.interests.json` (collection `interests`).

```json
{
  "success": true, "messages": [],
  "data": [
    { "_id": "1", "language": [ { "iso6391": "en", "name": "Travel" }, { "iso6391": "es", "name": "Viajes" }, { "iso6391": "fr", "name": "Voyages" }, { "iso6391": "pt", "name": "Viagens" }, { "iso6391": "it", "name": "Viaggi" }, { "iso6391": "de", "name": "Reisen" } ], "status": "A" }
  ]
}
```

Languages still come from `GET /api/master/language` and are used for both `languages` and `learningLanguages`.

## 3. User fields

New fields on the user document. They are returned by `GET /api/user/me`:

```json
{
  "userInfo": {
    "languages": ["1", "2"],
    "learningLanguages": ["3"],
    "interests": ["1", "17", "28"]
  },
  "preferences": {
    "intents": ["language_exchange", "friends"],
    "preferences": [],
    "lookingFor": null
  },
  "profileConfig": {
    "openToDating": false,
    "openToDatingUpdatedAt": "2026-11-25T12:00:00.000Z"
  }
}
```

* `userInfo.languages` and `userInfo.learningLanguages` hold ids from `/api/master/language`. Each list must have unique values, and every id must exist (`languages.notFound`, `learningLanguages.notFound`).
* `userInfo.interests` holds ids from `/api/master/interest`: at most 30, unique, existing (`interests.notFound`).
* `profileConfig.openToDatingUpdatedAt` is set by the server whenever the client sends `openToDating`. Clients never send it.
* **Privacy:** another user's profile never includes `profileConfig.openToDating` or `openToDatingUpdatedAt`, and `dating` is removed from their `preferences.intents`. This applies to `GET /api/user/discover`, `GET /api/user/:userId` and the room reveal. `sexualOrientation` and `lookingFor` are still returned as before, because Android needs them. **iOS must show them only when Next level is unlocked with that person.**

### Registration: `POST /api/user/register` (multipart, as today)

The dating fields `userInfo.sexualOrientation`, `preferences.preferences` and `preferences.lookingFor` are **required only when `preferences.intents` is absent (legacy) or includes `dating`**. Kultura registration therefore sends:

```json
{
  "email": "kenji@example.com",
  "password": "StrongPassword1",
  "userInfo": {
    "fullName": "Kenji Sato",
    "birthdate": "1994-05-06",
    "gender": "M",
    "languages": ["7"],
    "learningLanguages": ["2"],
    "interests": ["1", "17"]
  },
  "preferences": { "intents": ["language_exchange", "friends"] },
  "location": { "coordinates": [139.69, 35.68], "country": "Japan", "city": "Tokyo" },
  "profileConfig": { "openToDating": false }
}
```

Fields are sent as multipart form fields with bracket notation, as today: `userInfo[learningLanguages][0]=2`, `preferences[intents][0]=language_exchange`, `profileConfig[openToDating]=false`, plus `images` files (1 to 6).

* `userInfo.gender` **is still required**, because Discover and rooms use it.
* `preferences.intents` must be valid, unique and non-empty (`intents.invalid`, `intents.duplicates`, `intents.required`).
* If `profileConfig.openToDating` is omitted, it becomes `intents.includes('dating')`.
* Sign in with Apple registration is covered in §9.

Legacy (Android) registrations are unchanged. The server additionally stores `intents=['dating']` (or `['friends']` when `lookingFor` is `"5"`) and `openToDating=true` or `false` to match.

### Update: `PUT /api/user/me` (JSON)

All fields are optional, as today. New accepted fields:

```json
{
  "userInfo": { "learningLanguages": ["2", "4"], "interests": ["3", "9"] },
  "preferences": { "intents": ["language_exchange", "dating"] },
  "profileConfig": { "openToDating": true }
}
```

Turning dating on means `intents` containing `dating` or `openToDating: true`. It requires a complete dating profile, sent in the same request or already stored: `userInfo.sexualOrientation`, a non-empty `preferences.preferences`, and `preferences.lookingFor`. Otherwise the server returns `400 datingProfile.incomplete`. A typical "Open to something more" save looks like this:

```json
{
  "userInfo": { "sexualOrientation": "ST" },
  "preferences": { "intents": ["language_exchange", "dating"], "preferences": ["F"], "lookingFor": "2" },
  "profileConfig": { "openToDating": true }
}
```

To turn it off, send `{"preferences":{"intents":["language_exchange"]},"profileConfig":{"openToDating":false}}`. The dating fields are kept but stop being used.

## 4. Discover: `GET /api/user/discover`

| Query | Values | Default |
|---|---|---|
| `cursor` | opaque | as today |
| `intent` | `friends` \| `language_exchange` \| `dating` | `language_exchange` if `X-App-Platform: ios`, otherwise the **legacy dating feed** (Android, unchanged) |

Behaviour by intent:

* **`language_exchange` / `friends`**
  * Only users whose `preferences.intents` contain that intent. Dating-only users are excluded.
  * **No gender filter.**
  * Distance and age range still apply, as today.
  * Order: language overlap first (what I learn that they speak, plus what they learn that I speak), then shared interests, then random among ties. A new round starts when there is no cursor.
* **`dating`**
  * Requires the requester to have `openToDating=true`, a gender and gender preferences. Otherwise the response is an empty page.
  * Candidates must be dating profiles: intents include `dating`, or legacy users. Candidates who switched it off are excluded.
  * The mutual gender filter applies, as today.
* **No intent from a non-iOS client:** the old feed, with the mutual gender filter. The only difference is that users who explicitly switched "Open to something more" off in the new app are excluded.

Invalid intent: `400 intent.invalid`. The response shape is unchanged:

```json
{ "success": true, "messages": [], "data": { "results": [ { "_id": "…", "userInfo": { "fullName": "Ana", "age": 28, "languages": ["2"], "learningLanguages": ["1"], "interests": ["1"] }, "preferences": { "intents": ["language_exchange"] }, "likedByMe": false, "dislikedByMe": false, "distance": 1520.4 } ], "pagination": { "nextCursor": "a1b2c3d4e5f6.30", "pageSize": 30, "hasMore": true } } }
```

Keep sending the same `intent` with every `cursor` of a round.

## 5. Greetings (likes), quick messages and connections

### `POST /api/actions/like`

```json
{ "toUserId": "68c490865d8254ec33d4fb5f", "intent": "language_exchange" }
```

* `intent` is optional. It is the feed the profile came from. iOS without `intent` is treated as `language_exchange`. `intent: "dating"` requires `openToDating`, otherwise `400 ERROR_OPEN_TO_DATING_REQUIRED`.
* On a mutual like, the response adds `intent` (when it is not legacy):

```json
{ "success": true, "messages": ["SUCCESS"], "data": { "isMatch": true, "matchId": "…", "chatId": "…", "intent": "language_exchange" } }
```

* Connection intent when the two likes differ: a non-dating intent wins over `dating`, and `language_exchange` wins over `friends`.
* The `newMatch` push payload `data` also gains `intent` when it is not legacy.

### `POST /api/actions/quick-message`

`{ "toUserId", "content", "intent"? }`. `intent` follows the same rules as for likes and is stored on the implied like.

### `GET /api/chats`

Every item gains two fields:

```json
{ "_id": "chatId", "lastMessage": { }, "unreadCounts": { }, "deletedAt": { }, "users": ["…"], "intent": "language_exchange", "nextLevelUnlocked": false }
```

`intent` is absent for legacy matches.

## 6. Next level 💫

Each participant's wish is **private**. The API never returns the other person's wish. The only signal is `unlocked`, which turns true once both want it.

Eligibility for the requester: `requester.openToDating == true` **and** at least one of:

* both have `openToDating`;
* 20 or more messages in the chat (both senders, `NEXT_LEVEL_MIN_MESSAGES`);
* at least one completed call: answered, then ended.

⚠️ Known disclosure inherent to these rules: if `eligible` becomes true before 20 messages or a call, the other person has "Open to something more" on. It does not tell you that they want Next level with you.

### `GET /api/connections/:chatId/next-level`

```json
{ "success": true, "messages": [], "data": { "chatId": "68c4…", "eligible": true, "iWant": false, "unlocked": false, "unlockedAt": null } }
```

### `POST /api/connections/:chatId/next-level`

The body is `{ "wants": true }` to propose privately, or `{ "wants": false }` to withdraw. It must be a JSON boolean.

```json
{ "success": true, "messages": ["SUCCESS"], "data": { "chatId": "68c4…", "eligible": true, "iWant": true, "unlocked": false, "unlockedAt": null } }
```

* When the second person says yes, the response comes back with `unlocked: true` and `unlockedAt`, and both users are notified (see below). Unlock happens exactly once.
* Once unlocked, it stays unlocked: a later `wants` is ignored. Unmatch or block ends the connection as today.

Errors:

| Code | Status | Cause |
|---|---|---|
| `ERROR_NEXT_LEVEL_NOT_ELIGIBLE` | 403 | `wants:true` when not eligible |
| `ERROR_CONNECTION_NOT_FOUND` | 404 | not a participant, invalid id, or the connection is not `matched` |
| `MALFORMED_BAD_REQUEST` | 400 | `wants` is not a boolean |

Storage, for reference: `match.nextLevel = { users: { "<userId>": Boolean }, unlockedAt: Date }`. This is a Map keyed by userId, the same pattern as `chat.unreadCounts`.

### Socket event `connection:nextLevel` (namespace `/ws/chats`)

The server emits it to every `/ws/chats` socket of **both** users at unlock. As with the other `/ws/chats` events, the payload is a **JSON string** of the envelope:

```json
"{\"success\":true,\"messages\":[],\"data\":{\"chatId\":\"68c4…\",\"unlockedAt\":\"2026-11-25T12:00:00.000Z\"}}"
```

### Push (FCM) `nextLevelUnlocked`

This is sent to both users with the existing helper. FCM `data` looks like this:

```json
{ "type": "nextLevelUnlocked", "custom_body": "Something new is waiting in one of your connections 💫", "payload": "{\"success\":true,\"messages\":[],\"data\":{\"chatId\":\"68c4…\",\"unlockedAt\":\"…\"}}" }
```

The visible text is deliberately neutral (title "Kultura"), so the lock screen does not show the romantic context. The current push helper sends no `apns` block, so on iOS this message arrives data-only, like every other push type today.

## 7. Rooms ("Salas" = blind dates with an intent)

The endpoints are the same as today (`/api/blind-dates…`, socket `/ws/blind-dates`). Premium is still required.

### `POST /api/blind-dates`

```json
{ "conditions": { "intent": "language_exchange", "language": "2", "topic": "Street food", "ageMin": 18, "ageMax": 99, "languages": [], "musicGenres": [] } }
```

* `conditions.intent` is `language_exchange` or `dating`. Without it: iOS gets `language_exchange`, legacy clients get a legacy blind date (dating). `friends` is treated as `language_exchange`.
* `language` is a Language id (optional). Guests must speak or be learning it.
* `topic` is free text, up to 80 characters (optional). It can hold an interest name.
* `language_exchange` rooms **ignore** `genders`, `lookingFor` and the mutual host-gender rule. They are stored empty.
* `intent: "dating"` from a new client requires `openToDating`, otherwise `400 ERROR_OPEN_TO_DATING_REQUIRED`.

### `GET /api/blind-dates?intent=language_exchange&language=2`

* `intent` defaults to `language_exchange` on iOS. Without an intent on other clients, the response holds legacy and dating rooms only (Android unchanged).
* `intent=dating` returns an empty list unless the requester has `openToDating`.
* `language` (optional) shows only rooms in that language. Without it, the list holds rooms without a language plus rooms in a language I speak or learn.

Room view: `conditions` gains `intent`, `language` and `topic`, only for Kultura rooms:

```json
{ "_id": "…", "hostName": "Kenji", "hostAge": 31, "conditions": { "genders": [], "ageMin": 18, "ageMax": 99, "languages": [], "musicGenres": [], "lookingFor": [], "intent": "language_exchange", "language": "2", "topic": "Street food" }, "created_at": "…" }
```

* "Connect" at the end (`POST /api/blind-dates/:id/match`) creates a connection with the room's intent (`language_exchange` or `dating`). Legacy rooms create a legacy match.
* `GET /api/blind-dates/preferences` also returns `intent`, `language` and `topic` when they were used.

## 8. Version policy: `GET /api/app/version-policy` (public)

Send `X-App-Platform: ios` and `X-App-Version: <CFBundleVersion integer>`.

```json
{ "success": true, "messages": [], "data": { "platform": "ios", "minVersionCode": 12, "latestVersionCode": 15, "updateRequired": true, "updateAvailable": true } }
```

The thresholds come from `configs`: `IOS_MIN_VERSION_CODE` and `IOS_LATEST_VERSION_CODE`. A value of 0, or a missing config, disables the prompt. Seed them with `node scripts/seed-version-configs.js`, which never overwrites existing values. The App Store URL lives in the app.

## 9. Sign in with Apple

### Login: `POST /api/login`

```json
{ "authMethod": "apple", "socialToken": "<ASAuthorizationAppleIDCredential.identityToken as UTF-8 string>", "email": "optional", "fcmToken": "…", "platform": "iOS" }
```

* The server verifies `identityToken` against Apple's JWKS (`https://appleid.apple.com/auth/keys`): RS256 signature, `iss = https://appleid.apple.com`, `aud ∈ APPLE_BUNDLE_ID`, and `exp`.
* `email` is optional for Apple. The body email is never trusted.
* The user is looked up by Apple `sub` (`auth.socialId`). If none is found, it falls back to the **verified token email**, and on the first login it links `auth = {method:'apple', socialId: sub}`.
* Success returns `{ token, refreshToken }`, as today.
* Unknown user: `401 ERROR_LOGIN`, the same as Google. The app then continues to registration.
* Invalid or expired token: `401 ERROR_LOGIN`. Server not configured: `503 ERROR_SERVICE_UNAVAILABLE`.

### Registration with Apple: `POST /api/user/register`

Send `authMethod=apple`, `socialToken=<identityToken>`, and `email` = **the email inside the token**. That is the real or private-relay address Apple returned. Without it the server returns `400 email.invalid`.

* **Name:** Apple shares the name only with the app, and only on the **first** authorization. Send it as `userInfo.fullName`.
* Apple identity tokens are short-lived. If the 7-step registration takes long, request a fresh credential (`ASAuthorizationAppleIDProvider`) right before submitting.

## 10. App Store subscriptions (StoreKit 2)

### `POST /api/subscription/apple/verify` (auth)

Call it after every purchase, after every `Transaction.updates` / `Transaction.currentEntitlements` item for a subscription, and on Restore.

```json
{ "signedTransaction": "<Transaction.jwsRepresentation>" }
```

The server verifies the JWS with `@apple/app-store-server-library`:

* the x5c chain up to the bundled **Apple Root CA - G3**;
* the ES256 signature;
* the bundle id;
* the environment: Production, plus Sandbox and TestFlight unless disabled;
* OCSP checks when they are on.

It then maps `productId` to a plan (`APPLE_IAP_PRODUCT_PLANS`) and stores provider `app_store`. The record holds `currentPeriodEnd = expiresDate`, `originalTransactionId` and `appAccountToken` (set `Product.PurchaseOption.appAccountToken(UUID)` when purchasing; it is stored).

```json
{ "success": true, "messages": ["SUCCESS"], "data": { "premium": true, "provider": "app_store", "plan": "monthly", "productId": "com.technovolution.kultura.premium.monthly", "status": "active", "expiresAt": "2026-12-25T12:00:00.000Z", "renewsAt": "2026-12-25T12:00:00.000Z", "cancelAtPeriodEnd": false, "originalTransactionId": "2000000123456789", "environment": "Sandbox" } }
```

Errors:

| Code | Status | Cause |
|---|---|---|
| `ERROR_APPLE_TRANSACTION_INVALID` | 400 | bad signature, wrong bundle or environment, or not an auto-renewable subscription |
| `ERROR_APPLE_PRODUCT_UNKNOWN` | 400 | productId is not mapped |
| `ERROR_APPLE_TRANSACTION_OWNED` | 409 | this `originalTransactionId` already belongs to another account |
| `signedTransaction.required` | 400 | body without `signedTransaction` |

Premium status then shows up everywhere it is checked today:

* `GET /api/subscription/entitlement` returns `{ premium, provider: "app_store", renewsAt, cancelAtPeriodEnd }`.
* `GET /api/user/me` returns `subscription`.
* Likes, quick messages, rooms and calls run their premium checks against it.

Expired, refunded or revoked transactions return `premium: false`.

### `POST /api/subscription/apple/notifications` (called by Apple, no auth)

This is the App Store Server Notifications **v2** endpoint. The body is `{ "signedPayload": "…" }`. Configure this URL in App Store Connect, for both Production and Sandbox.

* `SUBSCRIBED`, `DID_RENEW`, `OFFER_REDEEMED`, `DID_CHANGE_RENEWAL_PREF`, `RENEWAL_EXTENDED`, `REFUND_REVERSED`: the record becomes `active` and takes the new expiry and transaction.
* `DID_CHANGE_RENEWAL_STATUS`: `cancelAtPeriodEnd = (autoRenewStatus == 0)`.
* `DID_FAIL_TO_RENEW`: with the `GRACE_PERIOD` subtype, access is kept until `gracePeriodExpiresDate`. Otherwise the status becomes `billing_retry` (no access).
* `EXPIRED`, `GRACE_PERIOD_EXPIRED`: `expired`.
* `REFUND`: `refunded`. `REVOKE`: `revoked`. Access ends at `revocationDate`.
* `TEST`: acknowledged.

The server responds 200 for every validly signed payload and 400 when the signature is invalid. It only updates subscriptions that were first linked through `/apple/verify`, so the app must always call `/apple/verify`.

## 11. Server configuration (env / configs)

| Key | Where | Example | Notes |
|---|---|---|---|
| `APPLE_BUNDLE_ID` | env | `com.technovolution.kultura` | Apple login audience and IAP bundle id. Comma-separated values add a Services ID for web login; IAP uses the first value. |
| `APPLE_APP_APPLE_ID` | env | `6740000000` | Numeric App Store app id. **Required to accept Production purchases.** |
| `APPLE_IAP_PRODUCT_PLANS` | env | `{"com.technovolution.kultura.premium.weekly":"weekly","com.technovolution.kultura.premium.monthly":"monthly","com.technovolution.kultura.premium.quarterly":"quarterly"}` | Also accepts `id:plan,id:plan`. |
| `APPLE_IAP_ALLOW_SANDBOX` | env | `true` (default) | Set to `false` to reject Sandbox and TestFlight. Keep it on for App Review. |
| `APPLE_IAP_ONLINE_CHECKS` | env | `true` (default) | OCSP revocation checks of the certificate chain. |
| `APPLE_ROOT_CA_PATHS` | env | optional | Extra root certificates. G3 is bundled at `shared/certs/AppleRootCA-G3.cer`. |
| App Store Server Notifications v2 URL | App Store Connect | `https://<api-host>/api/subscription/apple/notifications` | Production and Sandbox. |
| `IOS_MIN_VERSION_CODE`, `IOS_LATEST_VERSION_CODE` | `configs` collection | `0` | `scripts/seed-version-configs.js` |
| `NEXT_LEVEL_MIN_MESSAGES` | env | `20` (default) | |

## 12. Data migration

```bash
node scripts/backfill-user-intents.js           # dry run: prints counts only
node scripts/backfill-user-intents.js --apply   # writes
```

* Users without intents get `['friends']` when `lookingFor == '5'`, otherwise `['dating']`.
* Users without `openToDating` get `intents.includes('dating')`.
* Existing values are never overwritten, so the script is safe to re-run.
* Seed `interests` from `scripts/data.interests.json`, the same way as the other master collections.
