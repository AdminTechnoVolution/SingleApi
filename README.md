# Single APIs and Sockets

### Dependencies
* Node JS (required)
    * Version 24 +
* NPM (required)
    * Version 11 +
* Mongo Compass (optional)
* Redis Insight (optional)
* VSCode (optional)

### Validate
* Validate you can see the versions executing following terminal commands `node -v` and `npm -v`

### Setup
1. Add the missing values in the `.env` file for local purposes

2. Run `npm install` in the terminal to re-build the project

3. Run `npm run dev` in the terminal to start the project and avoid to restart in each change.<br>It can be used the `node server.js` to start the project, but you need to restart in each change

### Push notifications (Android and PWA)

SingleApi already supports multiple FCM registration tokens per user. Android's login flow registers its token, while the PWA registers its browser token through the authenticated routes:

- `PUT /api/user/devices/push-token` with JSON body `{ "token": "<FCM token>" }`
- `DELETE /api/user/devices/push-token` with JSON body `{ "token": "<FCM token>" }`

Both clients can coexist under the same user record in MongoDB (`fcmTokens` collection). The API sends each push to every token stored for that user, so enabling the PWA does not replace the Android device token.

The sender uses Firebase Admin SDK from `shared/config/firebase.js`. Set `FIREBASE_SERVICE_ACCOUNT` in the **SingleApi** environment to the Base64-encoded contents of a Firebase service-account JSON key. Its `project_id` must be the same Firebase project used by Android (`single-5d30b`) and by the PWA's `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. Keep this value private: configure it in the API's local `.env` for local development, and in the backend host's protected application settings for production (for example Azure App Service → Environment variables → App settings). Do not add it to SinglePwa, GitHub Actions Variables, or any `NEXT_PUBLIC_*` variable. Restart/redeploy the API after changing it.

To enable PWA delivery, no additional API route or token collection is required. Configure the PWA's public Firebase Web settings and VAPID public key as described in the SinglePwa README. Then test both devices signed into the same account: the API should register two distinct tokens and deliver a notification to both.

### User platform field

Each user document has a `platform` field with the values `Android` or `iOS`. The schema defaults new users and API clients that omit the field to `Android`, preserving compatibility with the released Android app. SinglePwa explicitly sends `iOS` on login and token refresh; Android's existing requests continue to be classified as `Android`. Since this is a single field on the user, the latest successful login/session refresh determines the stored platform if someone uses both clients.

For production users that already exist, deploy the API change and then run `npm run migrate:user-platform` once with `MONGO_URI` set to the production database. The migration only sets `Android` where `platform` does not exist, so it preserves any platform already recorded. Run it from a trusted environment and never paste the database URI into source control.

### URLs
* http://localhost:3000/api-docs