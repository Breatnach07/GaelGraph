# Gaeilge Daily

A static HTML/CSS/vanilla-JavaScript daily Irish-learning game backed by a Cloudflare Worker and D1. Protected pages request the session profile before rendering authenticated content. Google identity tokens are verified server-side, and the Worker issues an HttpOnly, Secure, SameSite session cookie.

## Deploy

1. Install Wrangler and authenticate with Cloudflare.
2. Create a D1 database named `gaeilge-daily`. Put its ID in `wrangler.toml`.
3. Create a Google OAuth 2.0 Web client, add the deployed site's origin to its authorized JavaScript origins, and set its client ID in `wrangler.toml`.
4. Set a strong, random Worker secret:

   ```powershell
   npx wrangler secret put SESSION_SECRET
   ```

5. Apply the schema and deploy:

   ```powershell
   npx wrangler d1 migrations apply gaeilge-daily --remote
   npx wrangler deploy
   ```

For local development, use `npx wrangler d1 migrations apply gaeilge-daily --local` and `npx wrangler dev`. Set `GOOGLE_CLIENT_ID` in a local `.dev.vars` file and keep that file out of source control.

## Question bank and rotation

Import at least 80 active questions before enabling the daily game; 300+ is recommended. Maintain at least 21 easy, 21 medium, and 28 hard questions to sustain the daily difficulty mix across the full no-repeat window. The scheduled Worker selects three easy, three medium, and four hard questions at 00:05 UTC, in that order, and excludes every question assigned during the preceding seven UTC dates. If any difficulty tier has too few eligible questions, the game returns an explicit unavailable response rather than repeating a recent question.

Each `questions` row has a unique `question_id`, an image path/URL, a JSON array of four Irish-language answers in `options_json`, `correct_index`, `close_index` (the designated partial-credit answer), and `difficulty` (`easy`, `medium`, or `hard`). `correct_index` and `close_index` must differ. The Worker API never sends either answer index to the browser.

Daily scores are computed and persisted by the Worker. The game submission accepts choices only; score and correctness are re-evaluated server-side. The browser includes render/click timestamps for diagnostics, while speed scoring uses server-measured session duration so client-provided clocks cannot inflate points. Each exact answer earns up to 100 points, the configured close answer earns half credit, and the speed multiplier declines from 1.0 to a floor of 0.5 over two minutes.

## API and data behavior

- `GET /api/me` returns the authenticated user's profile and today's result in one D1 read.
- `GET /api/leaderboard?scope=global|local&period=daily|weekly` runs one aggregate query.
- `GET /api/game` serves today's ten questions and creates an opaque, user-bound one-time game session.
- A score is unique per user and UTC day. The home page uses `/api/me` to display today's score.
- Friend requests are identified by the opaque profile `user_id`; never use Google subject IDs as public friend IDs.

The frontend uses no framework or runtime package dependencies. Static assets are served by Cloudflare's asset binding; D1 and the Worker handle private data and score calculations.

## Worker source layout

- `src/worker.js` is the Cloudflare entry point and owns static routing and the daily cron trigger.
- `src/routes/` contains API dispatch and the auth, profile, game, leaderboard, and friends handlers.
- `src/services/daily-questions.js` handles scheduled question selection and the seven-day no-repeat rule.
- `src/lib/` contains shared request/response, date, and signed-session helpers.

The normal game-load path batches the score and daily-question reads with conditional session creation in a single D1 round trip. Authentication uses the signed cookie without a database lookup; profile details are fetched only by the profile endpoint.

## Coming-soon redirect

The Worker is attached to `gaelgraph.com/*` and `www.gaelgraph.com/*` and redirects page requests to `/comingsoon/index.html` with a temporary `302` response. `run_worker_first` ensures the Worker can redirect before the assets binding serves `public/index.html`. The coming-soon document and `/assets/` files are served normally, while `/api/` remains available for the application backend. Both hostnames must be active in the same Cloudflare zone and proxied through Cloudflare. Update the Worker routing in `src/worker.js` when the full site is ready to go live.
