# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## PDF download notifications

When a user downloads a PDF, the app now:
- records an event in Firestore (`pdfDownloads`)
- increments monthly counters in Firestore (`pdfDownloadStatsByMonth`)
- emails project owners with the latest month-to-date total and recent monthly breakdown

Required server environment variables (used by `server/pdf-server.js`):

- `SMTP_HOST`
- `SMTP_PORT` (for example `587` or `465`)
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (optional; defaults to `SMTP_USER`)

Recipient list source:
- Emails are read from Firestore `allowedEmails` (document IDs).

Firebase Admin credentials for server-side Firestore writes:

- `FIREBASE_SERVICE_ACCOUNT_JSON` (recommended; full service account JSON string)
  - or `GOOGLE_SERVICE_ACCOUNT_JSON`
  - or Application Default Credentials (local/dev fallback)
- `FIREBASE_PROJECT_ID` (or `VITE_FIREBASE_PROJECT_ID`)
