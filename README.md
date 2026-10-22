# UniManager Backend API

A lightweight and robust REST API powering the UniManager classroom and academic management platform. Built with Express 5, TypeScript, Drizzle ORM, Neon PostgreSQL, Better Auth, and Arcjet security.

---

## Tech Stack

- **Runtime & Language:** Node.js (ESM), TypeScript
- **Framework:** Express 5
- **Database & ORM:** PostgreSQL (Neon Serverless), Drizzle ORM, Drizzle Kit
- **Authentication:** Better Auth
- **Security & Rate Limiting:** Arcjet (bot detection, shield, role-based rate limiting)
- **Monitoring:** Site24x7 APM Insight
- **Dev Tooling:** tsx, dotenv, cors

---

## Getting Started

### 1. Prerequisites

- Node.js (v18 or higher)
- A PostgreSQL database instance (e.g., [Neon](https://neon.tech))

### 2. Installation

```bash
# Navigate to the backend folder
cd classroom-backend

# Install dependencies
npm install
```

### 3. Environment Variables

Create a `.env` file in the root of `classroom-backend/` based on `.env.example`:

```env
PORT=8000
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
BETTER_AUTH_SECRET=your_better_auth_secret_here
BETTER_AUTH_URL=http://localhost:8000
ARCJET_KEY=your_arcjet_key_here
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

### 4. Database Setup & Migrations

```bash
# Generate Drizzle migration files
npm run db:generate

# Apply migrations to database
npm run db:migrate

# (Optional) Seed initial demo data (departments, subjects, classes, sample users)
npx tsx src/seed.ts
```

### 5. Running the Server

```bash
# Run in development mode (hot reload via tsx)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run in production mode
npm start
```

The API server will start on `http://localhost:8000` (or the configured `PORT`).

---

## API Endpoints Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check endpoint |
| `ALL` | `/api/auth/*` | Better Auth endpoints (login, signup, session, signout) |
| `GET` | `/api/dashboard/stats` | Academic analytics, capacity warnings, 14-day trends |
| `GET` | `/api/search?q=:query` | Global search across classes, subjects, users, departments |
| `GET, POST` | `/api/classes` | List classes (with filters & pagination) / Create class |
| `GET, PUT, DELETE`| `/api/classes/:id` | Get class details / Update / Delete class |
| `POST` | `/api/classes/:id/enroll` | Enroll a student into a class (capacity enforced) |
| `DELETE` | `/api/classes/:id/enrollments/:studentId` | Unenroll a student from a class |
| `POST` | `/api/classes/join-by-invite` | Student enroll via 7-character invite code |
| `GET` | `/api/enrollments/my` | List enrolled classes for authenticated student |
| `GET, POST` | `/api/departments` | List departments / Create department |
| `GET, PUT, DELETE`| `/api/departments/:id` | Get department / Update / Delete department |
| `GET, POST` | `/api/subjects` | List subjects / Create subject |
| `GET, PUT, DELETE`| `/api/subjects/:id` | Get subject / Update / Delete subject |
| `GET, POST` | `/api/users` | List users (students, teachers, admins) / Create user |
| `GET, PUT, DELETE`| `/api/users/:id` | Get user profile / Update / Delete user |

---

## Security & Rate Limiting

The backend uses **Arcjet** to protect API routes against malicious traffic:
- **Bot Detection:** Automatically blocks scrapers and automated attacks.
- **Shield Protection:** Inspects requests for common exploit vectors and SQL injection.
- **Role-Based Rate Limiting:**
  - `Admin`: 300 req/min (dev) / 20 req/min (prod)
  - `Teacher` / `Student`: 200 req/min (dev) / 10 req/min (prod)
  - `Guest`: 200 req/min (dev) / 10 req/min (prod)

---

## Project Structure

```
classroom-backend/
├── src/
│   ├── config/          # Arcjet security configuration
│   ├── db/              # Drizzle client, connection pool & schema definitions
│   │   └── schema/      # Tables: departments, subjects, classes, enrollments, auth
│   ├── lib/             # Better Auth server setup
│   ├── middleware/      # Arcjet rate limiting & security middleware
│   ├── routes/          # Express route handlers (classes, dashboard, users, etc.)
│   ├── index.ts         # Main Express entry point & middleware mounting
│   └── seed.ts          # Database seed script
├── drizzle.config.ts    # Drizzle Kit configuration
├── package.json
└── tsconfig.json
```

---

## License

ISC

