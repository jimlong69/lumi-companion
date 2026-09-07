# Lumi Companion

A mobile-first, text-only AI companion with an optional private visual check-in. Chat and image observations go through the Vercel serverless function at `/api/companion`; no AI credential is exposed to the browser.

## Deploy to Vercel

1. Push this directory to a Git repository and import it into Vercel.
2. Deploy using Vercel's generated HTTPS URL. Browser camera access requires HTTPS.
3. The server uses Vercel AI Gateway. On Vercel, `VERCEL_OIDC_TOKEN` is supplied automatically, so no model API key needs to be stored in the app.
4. Optionally set `AI_MODEL` to another vision-capable AI Gateway model. The default is `google/gemini-2.5-flash`.
5. Check `/api/health` after deployment.

For local development, set `AI_GATEWAY_API_KEY` in your shell and run `npx vercel dev`. Never put an AI credential in browser code or use a public environment-variable prefix.

## Privacy and camera behavior

- Camera is off by default and starts only after the user explicitly enables it.
- The app requests video only, never audio.
- Switching the camera off immediately stops all media tracks and cancels an in-flight visual request.
- Live check-ins use a downscaled JPEG held in memory once every 60 seconds. Selected photos follow the same path.
- The app does not persist images or conversation history.
- If camera permission is denied, unavailable, or the page is not secure, the app offers a one-photo fallback.

## API

`POST /api/companion` accepts a recent `messages` array and an optional base64 JPEG, PNG, or WebP `image`. It returns `{ "reply": "..." }`. Requests are validated and provider errors do not expose credentials.
