import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { classes, enrollments, subjects, user } from "../db/schema/index.js";

const router = express.Router();

// Helper to resolve student by id, email, or demo alias
async function resolveStudent(studentId?: string, studentEmail?: string) {
  if (studentId) {
    const [userById] = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, String(studentId)));
    if (userById) return userById;
  }

  const emailCandidate = studentEmail || (studentId && String(studentId).includes("@") ? String(studentId) : undefined);
  if (emailCandidate) {
    const [userByEmail] = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.email, emailCandidate));
    if (userByEmail) return userByEmail;
  }

  if (studentId === "demo-student" || !studentId) {
    const [demoStudent] = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.email, "student1@classroom.com"));
    if (demoStudent) return demoStudent;
  }

  // Fallback to first student if available
  const [firstStudent] = await db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.role, "student"))
    .limit(1);

  return firstStudent;
}

// GET /api/enrollments/my
// Returns all enrolled classes for the given student
router.get("/my", async (req, res) => {
  try {
    const studentId = req.query.studentId as string | undefined;
    const studentEmail = req.query.studentEmail as string | undefined;

    const resolved = await resolveStudent(studentId, studentEmail);
    if (!resolved) {
      return res.status(200).json({ data: [] });
    }

    const myEnrollments = await db
      .select({
        enrollmentId: enrollments.id,
        enrolledAt: enrollments.createdAt,
        class: {
          ...getTableColumns(classes),
        },
        subject: {
          ...getTableColumns(subjects),
        },
        teacher: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(eq(enrollments.studentId, resolved.id))
      .orderBy(desc(enrollments.createdAt));

    res.status(200).json({ data: myEnrollments });
  } catch (e: any) {
    console.error(`GET /enrollments/my error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to fetch student enrollments" });
  }
});

// GET /api/classes/:id/enrollments
router.get("/:id/enrollments", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class ID" });
    }

    const enrolledStudents = await db
      .select({
        enrollmentId: enrollments.id,
        enrolledAt: enrollments.createdAt,
        student: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        },
      })
      .from(enrollments)
      .innerJoin(user, eq(enrollments.studentId, user.id))
      .where(eq(enrollments.classId, classId))
      .orderBy(desc(enrollments.createdAt));

    res.status(200).json({ data: enrolledStudents });
  } catch (e: any) {
    console.error(`GET /classes/:id/enrollments error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get enrolled students" });
  }
});

// POST /api/classes/:id/enroll
router.post("/:id/enroll", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    const { studentId } = req.body;

    if (!Number.isFinite(classId) || !studentId) {
      return res.status(400).json({ error: "Valid class ID and student ID are required" });
    }

    // 1. Fetch class details & capacity
    const [targetClass] = await db
      .select({
        id: classes.id,
        name: classes.name,
        capacity: classes.capacity,
        status: classes.status,
      })
      .from(classes)
      .where(eq(classes.id, classId));

    if (!targetClass) {
      return res.status(404).json({ error: "Class not found" });
    }

    if (targetClass.status === "archived") {
      return res.status(400).json({ error: "Cannot enroll in an archived class" });
    }

    // 2. Verify student exists
    const targetStudent = await resolveStudent(studentId);

    if (!targetStudent) {
      return res.status(404).json({ error: "Student not found" });
    }

    // 3. Check if already enrolled
    const [alreadyEnrolled] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.classId, classId),
          eq(enrollments.studentId, targetStudent.id)
        )
      );

    if (alreadyEnrolled) {
      return res.status(400).json({ error: "Student is already enrolled in this class" });
    }

    // 4. CAPACITY SAFEGUARD: check current enrollment count
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(eq(enrollments.classId, classId));

    const currentCount = Number(countRow?.count ?? 0);

    if (currentCount >= targetClass.capacity) {
      return res.status(400).json({
        error: `Capacity limit reached! This class is capped at ${targetClass.capacity} students (${currentCount}/${targetClass.capacity}). Cannot enroll more students.`,
        capacity: targetClass.capacity,
        enrolledCount: currentCount,
      });
    }

    // 5. Insert enrollment
    const [newEnrollment] = await db
      .insert(enrollments)
      .values({
        classId,
        studentId: targetStudent.id,
      })
      .returning();

    res.status(201).json({
      data: newEnrollment,
      message: `Successfully enrolled ${targetStudent.name} in ${targetClass.name}`,
      enrolledCount: currentCount + 1,
      capacity: targetClass.capacity,
    });
  } catch (e: any) {
    console.error(`POST /classes/:id/enroll error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to enroll student" });
  }
});

// DELETE /api/classes/:id/enrollments/:studentId
router.delete("/:id/enrollments/:studentId", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    const studentId = req.params.studentId;

    if (!Number.isFinite(classId) || !studentId) {
      return res.status(400).json({ error: "Valid class ID and student ID are required" });
    }

    const [deleted] = await db
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.classId, classId),
          eq(enrollments.studentId, studentId)
        )
      )
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Enrollment record not found" });
    }

    res.status(200).json({
      data: deleted,
      message: "Student unenrolled successfully",
    });
  } catch (e: any) {
    console.error(`DELETE /classes/:id/enrollments/:studentId error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to unenroll student" });
  }
});

// POST /api/classes/join-by-invite
router.post("/join-by-invite", async (req, res) => {
  try {
    const { inviteCode, studentId, studentEmail } = req.body;

    if (!inviteCode) {
      return res.status(400).json({ error: "Invite code is required" });
    }

    const formattedCode = String(inviteCode).trim().toUpperCase();

    // 1. Find class by invite code (case-insensitive)
    const [targetClass] = await db
      .select({
        id: classes.id,
        name: classes.name,
        capacity: classes.capacity,
        status: classes.status,
      })
      .from(classes)
      .where(ilike(classes.inviteCode, formattedCode));

    if (!targetClass) {
      return res.status(404).json({ error: "Invalid invite code. Class not found. Please verify the code received from your teacher." });
    }

    if (targetClass.status !== "active") {
      return res.status(400).json({ error: `This class is currently ${targetClass.status} and cannot be joined.` });
    }

    // 2. Resolve Student
    const targetStudent = await resolveStudent(studentId, studentEmail);
    if (!targetStudent) {
      return res.status(404).json({ error: "Student account could not be found to complete enrollment." });
    }

    // 3. Check if already enrolled
    const [alreadyEnrolled] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.classId, targetClass.id),
          eq(enrollments.studentId, targetStudent.id)
        )
      );

    if (alreadyEnrolled) {
      return res.status(400).json({
        error: `You are already enrolled in "${targetClass.name}".`,
        alreadyEnrolled: true,
        classId: targetClass.id,
      });
    }

    // 4. Capacity safeguard
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(eq(enrollments.classId, targetClass.id));

    const currentCount = Number(countRow?.count ?? 0);

    if (currentCount >= targetClass.capacity) {
      return res.status(400).json({
        error: `Cannot join. Class has reached maximum seat capacity (${currentCount}/${targetClass.capacity} spots taken).`,
      });
    }

    // 5. Enroll
    const [newEnrollment] = await db
      .insert(enrollments)
      .values({
        classId: targetClass.id,
        studentId: targetStudent.id,
      })
      .returning();

    res.status(201).json({
      data: {
        enrollment: newEnrollment,
        class: targetClass,
        student: targetStudent,
      },
      message: `Successfully joined ${targetClass.name}!`,
    });
  } catch (e: any) {
    console.error(`POST /classes/join-by-invite error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to join class" });
  }
});

export default router;

