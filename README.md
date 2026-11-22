# SAU Campus Connect — Full-stack project

A full-stack campus clubs and societies recruitment portal built with HTML, CSS, vanilla JavaScript, Node.js, Express and CockroachDB. It retains the original SAU blue/navy visual direction and replaces browser-local demo authentication/application storage with a shared SQL database and REST API.

## Features

### Students
- Registration restricted to `@students.sau.ac.in` email addresses.
- Email verification before sign-in (SMTP email, or a terminal verification link in local development when SMTP is unset).
- Secure password hashing with bcrypt and an HTTP-only JWT session cookie.
- Browse/search/filter clubs, view club details and current announcements/quotes.
- Save and unsave clubs in the database.
- Submit one application per club, with course, academic year and motivation statement.
- Track application status and status history; see manager notes and withdraw eligible applications.

### Club managers
- A manager account can only be created by an administrator promoting a verified student account.
- Admin assigns one or more clubs to a manager.
- Managers can review applications for their assigned clubs and update phases: Under review, Shortlisted, Interview scheduled, Selected or Rejected.
- Publish club announcements, optional image (JPG/PNG/WEBP, maximum 3 MB), and motivation quotes.
- Remove announcements/quotes belonging to their assigned clubs.

### Administrators
- Create clubs, promote/demote verified student accounts to/from manager, assign club managers.
- Open or close club recruitment.
- View portal statistics, users and all applications; update application statuses.
- Admin role is provisioned through the server-side seed script, not public registration.

## Requirements
- Node.js 18 or newer
- A CockroachDB cluster
- npm

## Setup (Windows)

1. Install Node.js and create or start a CockroachDB cluster.
2. Open this project folder in VS Code or a terminal and configure `.env` with the CockroachDB connection details. You can start from `.env.example`.
3. In the CockroachDB SQL Console, select the database configured in `.env` and run the contents of `database-cockroachdb.sql`. This creates the tables and seeds the starter clubs. The server defaults to port `26257` and TLS; set `DB_SSL=false` only for a local database that does not use TLS.

4. Set a unique `JWT_SECRET` of at least 32 characters in `.env`, then install dependencies:

   ```bash
   npm install
   ```

5. Start the application:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000` and create an account with an `@students.sau.ac.in` email. In development, when SMTP settings are blank, the verification link appears in the server terminal.

## Email verification

For local development, leave `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` blank to print a one-time verification link in the server terminal. Open that link in your browser. If SMTP is configured, the server sends the link by email instead. This development shortcut is intentionally disabled in production.

For production, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, set `NODE_ENV=production`, set `APP_URL` to your HTTPS site URL, and set `COOKIE_SECURE=true`. The `nodemailer` package sends verification emails.

## First-use workflow

1. Create a normal student account using a real `@students.sau.ac.in` mailbox and verify it.
2. Sign in as the seeded administrator.
3. In Admin control centre → University accounts, promote the verified student to `Manager`.
4. In Assign club managers, assign that manager to one or more clubs.
5. The manager signs out and signs back in. Their manager workspace will now show only their assigned clubs and applications.
6. Students can submit applications and view status changes from their dashboard.

## Main API routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create SAU student account |
| GET | `/api/auth/verify?token=...` | Public | Verify email |
| POST | `/api/auth/login` | Public | Sign in |
| POST | `/api/auth/logout` | Signed in | Sign out |
| GET | `/api/auth/me` | Signed in | Current user |
| GET | `/api/clubs` | Public | Club directory |
| GET | `/api/clubs/:id` | Public | Club details and updates |
| GET | `/api/feed` | Public | Announcements and quotes |
| POST | `/api/applications` | Student | Submit application |
| GET | `/api/applications/mine` | Student | Track own applications |
| GET | `/api/applications/managed` | Manager/Admin | Review applications (manager sees assigned clubs) |
| PATCH | `/api/applications/:id/status` | Manager/Admin | Update application phase |
| GET/POST/DELETE | `/api/saved` and `/api/saved/:clubId` | Signed in | Manage saved clubs |
| POST | `/api/manager/announcements` | Manager/Admin | Publish announcement |
| POST | `/api/manager/quotes` | Manager/Admin | Publish motivation quote |
| GET | `/api/admin/overview` | Admin | Dashboard statistics |
| GET | `/api/admin/users` | Admin | List portal accounts |
| PATCH | `/api/admin/users/:id/role` | Admin | Promote/demote manager |
| PATCH | `/api/admin/clubs/:id/manager` | Admin | Assign manager |
| POST | `/api/admin/clubs` | Admin | Create club |
| PATCH | `/api/admin/clubs/:id` | Admin | Open/close recruitment |

## Security notes / production checklist

- The public registration endpoint never accepts a role; new accounts are always students. Admin and manager privileges are assigned server-side.
- All SQL queries use parameterized statements. Passwords are hashed with bcrypt. Sessions use HTTP-only cookies. API routes have role checks and rate limits.
- Email-domain validation plus mailbox verification is used. A typed email suffix by itself is not proof of university affiliation; production deployment should additionally confirm that the university controls the domain and that mailbox verification is reliable.
- Serve the site only over HTTPS in production, use a strong unique JWT secret, configure SMTP, back up MySQL, and restrict database access. Review university privacy/data-retention requirements before collecting real student applications.
- Uploaded images are limited to common image MIME types and 3 MB. For a public deployment, consider virus scanning, image re-encoding, object storage and a retention policy.
- This is a functional academic project starter, not a university-approved production service. It has not been penetration-tested or audited.

## Original files

The `original-*-reference` files preserve the three files you uploaded. The active application is in `public/`, with backend in `server.js` and schema in `database.sql`.
