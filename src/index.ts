import express from "express";
import subjectsRouter from "./routes/subjects"
import cors from 'cors'

const app = express();
const PORT = 8000;

if(!process.env.FRONTEND_URL) throw new Error('FRONTEND_URL is not set in .env file')

app.use(cors({
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))

app.use(express.json());

app.use('/api/subjects', subjectsRouter)

app.get("/", (req, res) => {
  res.send("Classroom backend is running");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});