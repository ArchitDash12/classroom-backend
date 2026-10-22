import AgentAPI from 'apminsight'
AgentAPI.config()

import express from "express";
import subjectsRouter from "./routes/subjects.js";
import cors from "cors";
import securityMiddleware from "./middleware/security.js";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";

const app = express();
const port = process.env.PORT;

if(!process.env.FRONTEND_URL) throw new Error('FRONTEND_URL is not set in .env file')

app.use(cors({
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))

app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json());

app.use(securityMiddleware)

app.use('/api/subjects', subjectsRouter)

app.get("/", (req, res) => {
  res.send("Classroom backend is running");
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});