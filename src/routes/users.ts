import { and, desc, eq, getTableColumns, ilike, or, sql, asc } from "drizzle-orm";
import express from "express";
import { user, classes, enrollments, subjects } from "../db/schema/index.js";
import { db } from "../db/index.js";
import { auth } from "../lib/auth.js";
import crypto from "crypto";

const router = express.Router();

// GET /api/users
router.get("/", async (req, res) => {
  try {
    const { search, role, page = 1, limit = 10, _sort = "createdAt", _order = "desc" } = req.query;

    const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
    const limitPerPage = Math.min(
      Math.max(1, parseInt(String(limit), 10) || 10),
      100
    );
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    if (search) {
      filterConditions.push(
        or(
          ilike(user.name, `%${search}%`),
          ilike(user.email, `%${search}%`)
        )
      );
    }

    if (role && role !== "all") {
      filterConditions.push(eq(user.role, role as "student" | "teacher" | "admin"));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .where(whereClause);

    const totalCount = Number(countResult[0]?.count ?? 0);

    const sortOrder = String(_order).toLowerCase() === "asc" ? asc : desc;
    const sortField =
      String(_sort) === "name"
        ? user.name
        : String(_sort) === "email"
        ? user.email
        : String(_sort) === "role"
        ? user.role
        : user.createdAt;

    const usersList = await db
      .select({
        ...getTableColumns(user),
      })
      .from(user)
      .where(whereClause)
      .orderBy(sortOrder(sortField))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: usersList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (e: any) {
    console.error(`GET /users error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get users" });
  }
});

// GET /api/users/:id
router.get("/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    let [foundUser] = await db
      .select({
        ...getTableColumns(user),
      })
      .from(user)
      .where(eq(user.id, userId));

    if (!foundUser) {
      const emailLookup =
        userId === "demo-student"
          ? "student1@classroom.com"
          : userId === "demo-teacher"
          ? "teacher@classroom.com"
          : userId === "demo-admin"
          ? "admin@classroom.com"
          : userId.includes("@")
          ? userId
          : undefined;

      if (emailLookup) {
        const [byEmail] = await db
          .select({ ...getTableColumns(user) })
          .from(user)
          .where(eq(user.email, emailLookup));
        if (byEmail) {
          foundUser = byEmail;
        }
      }
    }

    if (!foundUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const realUserId = foundUser.id;

    // If teacher, fetch classes taught
    let taughtClasses: any[] = [];
    if (foundUser.role === "teacher" || foundUser.role === "admin") {
      taughtClasses = await db
        .select({
          ...getTableColumns(classes),
          subjectName: subjects.name,
          subjectCode: subjects.code,
        })
        .from(classes)
        .leftJoin(subjects, eq(classes.subjectId, subjects.id))
        .where(eq(classes.teacherId, realUserId));
    }

    // If student, fetch enrolled classes
    let enrolledClasses: any[] = [];
    if (foundUser.role === "student" || foundUser.role === "admin") {
      enrolledClasses = await db
        .select({
          ...getTableColumns(classes),
          subjectName: subjects.name,
          subjectCode: subjects.code,
          enrolledAt: enrollments.createdAt,
          teacherName: user.name,
          teacherImage: user.image,
          teacherEmail: user.email,
        })
        .from(enrollments)
        .innerJoin(classes, eq(enrollments.classId, classes.id))
        .leftJoin(subjects, eq(classes.subjectId, subjects.id))
        .leftJoin(user, eq(classes.teacherId, user.id))
        .where(eq(enrollments.studentId, realUserId));
    }

    res.status(200).json({
      data: {
        ...foundUser,
        taughtClasses,
        enrolledClasses,
      },
    });
  } catch (e: any) {
    console.error(`GET /users/:id error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get user details" });
  }
});

// POST /api/users
router.post("/", async (req, res) => {
  try {
    const { name, email, password, role = "student", image, imageCldPubId } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Check email uniqueness
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, String(email).trim().toLowerCase()));

    if (existing.length > 0) {
      return res.status(400).json({ error: `User with email '${email}' already exists` });
    }

    // Try Better-Auth signup if password is provided
    if (password && typeof password === "string" && password.length >= 6) {
      try {
        const authRes = await auth.api.signUpEmail({
          body: {
            email: String(email).trim().toLowerCase(),
            password,
            name: String(name).trim(),
            role: role as "student" | "teacher" | "admin",
            imageCldPubId: imageCldPubId || undefined,
          },
        });

        if (authRes?.user) {
          if (image) {
            await db
              .update(user)
              .set({ image })
              .where(eq(user.id, authRes.user.id));
          }
          const [newUser] = await db
            .select()
            .from(user)
            .where(eq(user.id, authRes.user.id));
          return res.status(201).json({ data: newUser || authRes.user });
        }
      } catch (authErr: any) {
        console.warn("Better-auth direct signup fallback:", authErr?.message);
      }
    }

    // Fallback: direct insert with random ID
    const newId = crypto.randomUUID();
    const [created] = await db
      .insert(user)
      .values({
        id: newId,
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        emailVerified: true,
        role: (role as "student" | "teacher" | "admin") || "student",
        image: image || null,
        imageCldPubId: imageCldPubId || null,
      })
      .returning();

    res.status(201).json({ data: created });
  } catch (e: any) {
    console.error(`POST /users error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to create user" });
  }
});

// PUT /api/users/:id
router.put("/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const { name, email, role, image, imageCldPubId } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    if (email) {
      const existing = await db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            eq(user.email, String(email).trim().toLowerCase()),
            sql`${user.id} != ${userId}`
          )
        );
      if (existing.length > 0) {
        return res.status(400).json({ error: `Email '${email}' is already in use` });
      }
    }

    const [updated] = await db
      .update(user)
      .set({
        name: String(name).trim(),
        ...(email ? { email: String(email).trim().toLowerCase() } : {}),
        ...(role ? { role: role as "student" | "teacher" | "admin" } : {}),
        ...(image !== undefined ? { image: image || null } : {}),
        ...(imageCldPubId !== undefined ? { imageCldPubId: imageCldPubId || null } : {}),
      })
      .where(eq(user.id, userId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ data: updated });
  } catch (e: any) {
    console.error(`PUT /users/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to update user" });
  }
});

// DELETE /api/users/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Constraint Check: If user is teacher, check if they are instructor for active classes
    const teachingClasses = await db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(eq(classes.teacherId, userId));

    if (teachingClasses.length > 0) {
      return res.status(400).json({
        error: `Cannot delete user. This teacher is currently assigned as instructor for ${teachingClasses.length} class(es) (${teachingClasses.map((c) => c.name).slice(0, 3).join(", ")}${teachingClasses.length > 3 ? "..." : ""}). Please reassign the instructor for these classes first.`,
      });
    }

    const [deleted] = await db
      .delete(user)
      .where(eq(user.id, userId))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ data: deleted, message: "User deleted successfully" });
  } catch (e: any) {
    console.error(`DELETE /users/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to delete user" });
  }
});

export default router;
